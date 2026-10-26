// موقع تجريبي (وهمي) لاختبار حماية الـ crawler — مفيهوش أي مكتبات خارجية.
// كل "قسم" هو موقع صغير (80 صفحة) له رابط بداية مختلف وسلوك مختلف:
//   /s403/   بيرفض بـ 403 لو السرعة زادت (أكتر من 4 طلبات في 3 ثواني) ويمدد الحجب 20 ثانية مع كل طلب مرفوض
//   /s429/   نفس الفكرة لكن بيرد 429 (ومعاه Retry-After: 20)
//   /s503/   نفس الفكرة لكن بيرد 503
//   /never/  بيرفض كل حاجة بـ 403 من أول طلب (موقع بيحجب السيرفر خالص)
//   /still/  أول 15 صفحة تمام، وبعدها بيرفض كل حاجة بـ 403 للأبد
//   /startban/   بيرفض كل حاجة بـ 403 أول 25 ثانية من أول طلب (حجب مؤقت في أول الزحف)، وبعدها كل حاجة تمام. فيه Sitemap
//   /startban2/  نفس /startban/ لكن من غير Sitemap
//   /flaky/      استضافة ضعيفة: كل صفحة بتاخد حوالي ثانية ونص عشان تتخدم، ولو طلب تاني جه وهي بتخدم الأول بتقطع الاتصال عليه (زي سيرفر مش بيستحمل طلبين مع بعض)
//   /flaky504/  نفس /flaky/ لكن بدل قطع الاتصال بترد 504
// /never/sitemap.xml و /still/sitemap.xml بيعرضوا 80 رابط للقسم، عشان الـ crawler يلاقي طابور كبير من أول لحظة (زي موقع حقيقي عنده Sitemap).
// /stats بيعرض اللي حصل، و /reset بيصفّر العدّادات (وبتتصفّر لوحدها بعد 15 دقيقة من غير طلبات).
const http = require("http");

const PAGES = 80;
const FLAKY_DELAY_MS = Number(process.env.FLAKY_DELAY_MS) || 1200;
const WINDOW_MS = 3000, LIMIT = 4, BAN_MS = 20000, START_BAN_MS = 25000, IDLE_RESET_MS = 15 * 60 * 1000, STILL_OK_PAGES = 15;
const SECTIONS = {
  s403: { kind: "speed", status: 403 },
  s429: { kind: "speed", status: 429, retryAfter: 20 },
  s503: { kind: "speed", status: 503 },
  never: { kind: "all", status: 403 },
  still: { kind: "after", status: 403 },
  startban: { kind: "startban", status: 403 },
  startban2: { kind: "startban", status: 403 },
  flaky: { kind: "weak", mode: "drop" },
  flaky504: { kind: "weak", mode: "504" },
};
const fresh = () => ({ busy: false, startAt: 0, times: [], bannedUntil: 0, requests: 0, ok: 0, refused: 0, bans: 0, lastAt: 0, firstAt: 0 });
const state = {}; for (const k of Object.keys(SECTIONS)) state[k] = fresh();

const WORDS = "contact services pricing support team about company policy delivery returns warranty booking quote consultation experience quality customers solutions industry location hours account payment shipping".split(" ");
function pageHtml(sec, n) {
  const words = []; for (let i = 0; i < 90; i++) words.push(WORDS[(n * 7 + i * 13 + i * i) % WORDS.length]);
  const links = new Set(); for (const d of [1, 2, 5, 11]) links.add((n + d) % PAGES); links.add(Math.floor(n / 2));
  const a = [...links].filter(x => x !== n).map(x => `<a href="/${sec}/p${x}">Page ${x}</a>`).join(" ");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${sec} page ${n}</title></head><body><main><h1>Test page ${n} (${sec})</h1><p>This is test page number ${n}. ${words.join(" ")}.</p><p>${a}</p></main></body></html>`;
}
function homeHtml(sec) {
  const a = []; for (let i = 0; i < 12; i++) a.push(`<a href="/${sec}/p${i}">Page ${i}</a>`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${sec} home</title></head><body><main><h1>Test site ${sec}</h1><p>This is the home page of the test site section ${sec}, used only to test a crawler.</p><p>${a.join(" ")}</p></main></body></html>`;
}

function decide(sec, n, now) { // بترجّع null (تمام) أو { status, headers }
  const cfg = SECTIONS[sec], s = state[sec];
  if (s.lastAt && now - s.lastAt > IDLE_RESET_MS) Object.assign(s, fresh());
  s.lastAt = now; if (!s.firstAt) s.firstAt = now; s.requests++;
  const refuse = () => { s.refused++; return { status: cfg.status, headers: cfg.retryAfter ? { "Retry-After": String(cfg.retryAfter) } : {} }; };
  if (cfg.kind === "all") return refuse();
  if (cfg.kind === "startban") { if (!s.startAt) s.startAt = now; if (now < s.startAt + START_BAN_MS) return refuse(); s.ok++; return null; }
  if (cfg.kind === "after") { if (s.ok >= STILL_OK_PAGES) return refuse(); s.ok++; return null; }
  s.times.push(now); while (s.times.length && s.times[0] <= now - WINDOW_MS) s.times.shift();
  if (now < s.bannedUntil) { s.bannedUntil = now + BAN_MS; return refuse(); }
  if (s.times.length > LIMIT) { s.bannedUntil = now + BAN_MS; s.bans++; console.log(`[${sec}] too fast → blocked with ${cfg.status} for ${BAN_MS / 1000}s`); return refuse(); }
  s.ok++; return null;
}

function createServer() {
  return http.createServer((req, res) => {
    const send = (code, body, type = "text/html; charset=utf-8", headers = {}) => { res.writeHead(code, { "Content-Type": type, ...headers }); res.end(body); };
    let path; try { path = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { return send(400, "bad"); }
    if (path === "/") return send(200, "<!doctype html><html><head><title>Crawler test site</title></head><body><p>Crawler test site. See /stats</p></body></html>");
    if (path === "/stats") { const o = {}; for (const [k, s] of Object.entries(state)) o[k] = { requests: s.requests, ok: s.ok, refused: s.refused, bans: s.bans }; return send(200, JSON.stringify(o, null, 2), "application/json"); }
    if (path === "/reset") { for (const k of Object.keys(state)) state[k] = fresh(); console.log("[reset]"); return send(200, "reset done", "text/plain"); }
    const sm = /^\/(never|still|startban)\/sitemap\.xml$/.exec(path);
    if (sm) {
      const base = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`; const u = [];
      for (let i = 0; i < PAGES; i++) u.push(`<url><loc>${base}/${sm[1]}/p${i}</loc></url>`);
      return send(200, `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u.join("")}</urlset>`, "application/xml");
    }
    const m = /^\/(s403|s429|s503|never|still|startban2|startban|flaky504|flaky)(?:\/(?:p(\d+))?)?$/.exec(path);
    if (!m) return send(404, "not found", "text/plain");
    const sec = m[1], n = m[2] === undefined ? null : Number(m[2]);
    if (n !== null && n >= PAGES) return send(404, "not found", "text/plain");
    if (!path.endsWith("/") && n === null) { return send(301, "", "text/plain", { Location: `/${sec}/` }); }
    if (SECTIONS[sec].kind === "weak") { // استضافة ضعيفة: طلب واحد في المرة، وأي طلب تاني في نفس الوقت بيتقطع (أو بيتردله 504)
      const s = state[sec], now = Date.now();
      if (s.lastAt && now - s.lastAt > IDLE_RESET_MS) Object.assign(s, fresh());
      s.lastAt = now; if (!s.firstAt) s.firstAt = now; s.requests++;
      if (s.busy) { s.refused++; if (SECTIONS[sec].mode === "drop") return req.socket.destroy(); return send(504, "gateway timeout", "text/plain"); }
      s.busy = true;
      return setTimeout(() => { s.busy = false; s.ok++; send(200, n === null ? homeHtml(sec) : pageHtml(sec, n)); }, FLAKY_DELAY_MS);
    }
    const d = decide(sec, n, Date.now());
    if (d) return send(d.status, "blocked", "text/plain", d.headers);
    return send(200, n === null ? homeHtml(sec) : pageHtml(sec, n));
  });
}
module.exports = { createServer, state, PAGES };
if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  createServer().listen(PORT, "0.0.0.0", () => console.log(`Crawler test site listening on port ${PORT}`));
}
