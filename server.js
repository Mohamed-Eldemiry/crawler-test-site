// موقع تجريبي (وهمي) لاختبار حماية الـ crawler — مفيهوش أي مكتبات خارجية.
// كل "قسم" هو موقع صغير (80 صفحة) له رابط بداية مختلف وسلوك مختلف:
//   /s403/   بيرفض بـ 403 لو السرعة زادت (أكتر من 4 طلبات في 3 ثواني) ويمدد الحجب 20 ثانية مع كل طلب مرفوض
//   /s429/   نفس الفكرة لكن بيرد 429 (ومعاه Retry-After: 20)
//   /s503/   نفس الفكرة لكن بيرد 503
//   /never/  بيرفض كل حاجة بـ 403 من أول طلب (موقع بيحجب السيرفر خالص)
//   /still/  أول 15 صفحة تمام، وبعدها بيرفض كل حاجة بـ 403 للأبد
// /stats بيعرض اللي حصل، و /reset بيصفّر العدّادات (وبتتصفّر لوحدها بعد 15 دقيقة من غير طلبات).
const http = require("http");

const PAGES = 80;
const WINDOW_MS = 3000, LIMIT = 4, BAN_MS = 20000, IDLE_RESET_MS = 15 * 60 * 1000, STILL_OK_PAGES = 15;
const SECTIONS = {
  s403: { kind: "speed", status: 403 },
  s429: { kind: "speed", status: 429, retryAfter: 20 },
  s503: { kind: "speed", status: 503 },
  never: { kind: "all", status: 403 },
  still: { kind: "after", status: 403 },
};
const fresh = () => ({ times: [], bannedUntil: 0, requests: 0, ok: 0, refused: 0, bans: 0, lastAt: 0, firstAt: 0 });
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
    const m = /^\/(s403|s429|s503|never|still)(?:\/(?:p(\d+))?)?$/.exec(path);
    if (!m) return send(404, "not found", "text/plain");
    const sec = m[1], n = m[2] === undefined ? null : Number(m[2]);
    if (n !== null && n >= PAGES) return send(404, "not found", "text/plain");
    if (!path.endsWith("/") && n === null) { return send(301, "", "text/plain", { Location: `/${sec}/` }); }
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
