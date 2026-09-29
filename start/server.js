// Spieleabend start page: serves the game overview and a small status endpoint that asks
// every game server (inside the Docker network) whether it is up and how many rooms are open.
// It also runs the party groups (see party.js). Start with `node server.js`; PORT, HOST and
// GAMES_FILE are optional env vars, PARTY_SECRET lets parties open rooms on the game servers.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { createParties, PartyError } = require("./party.js");

const PORT = process.env.PORT ? +process.env.PORT : 8080;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC = path.join(__dirname, "public");
const GAMES_FILE = process.env.GAMES_FILE || path.join(__dirname, "games.json");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const games = () => JSON.parse(fs.readFileSync(GAMES_FILE, "utf8"));

// status of all games, cached for a few seconds so a busy page does not hammer the servers
let cache = { at: 0, data: null };
async function status() {
  if (cache.data && Date.now() - cache.at < 5000) return cache.data;
  const list = games();
  const data = await Promise.all(list.map(async (g) => {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(g.status, { signal: ctl.signal });
      clearTimeout(t);
      const j = await r.json();
      return { id: g.id, online: r.ok, rooms: +j.rooms || 0 };
    } catch (e) { return { id: g.id, online: false, rooms: 0 }; }
  }));
  cache = { at: Date.now(), data };
  return data;
}

const parties = createParties({ games, secret: process.env.PARTY_SECRET || "" });

// link preview tags: a plain link says what Spieleabend is, a party link names the party
function embed(req, url) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const proto = req.headers["x-forwarded-proto"] || (/^(localhost|[\d.]+)(:\d+)?$/.test(host) ? "http" : "https");
  const base = (process.env.PUBLIC_URL || `${proto}://${host}`).replace(/\/$/, "");
  const code = String(url.searchParams.get("party") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  const p = code.length === 4 ? parties.peek(code) : null;
  const title = p ? `${p.host} lädt dich zum Spieleabend ein` : "Spieleabend";
  const desc = p
    ? `Party ${p.code} · ${p.count} ${p.count === 1 ? "Person ist" : "Leute sind"} schon dabei${p.game ? ` · gerade: ${p.game}` : ""}. Tippen und mitspielen, ohne Anmeldung.`
    : "Brettspiele und Kartenspiele für den Spieleabend: Uno, Poker, Kniffel, Mensch ärgere dich nicht und mehr. Online mit Freunden, direkt im Browser.";
  const link = p ? `${base}/?party=${p.code}` : `${base}/`;
  return [
    `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="Spieleabend">`,
    `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(link)}">`, `<meta property="og:image" content="${esc(base)}/og.png">`,
    `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`, `<meta name="description" content="${esc(desc)}">`
  ].join("\n");
}

const json = (res, code, obj) => { res.writeHead(code, { "content-type": TYPES[".json"], "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 4096) { reject(new PartyError("Zu viele Daten.")); req.destroy(); } });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (e) { reject(new PartyError("Kein JSON.")); } });
    req.on("error", reject);
  });
}
async function partyRoute(req, res, url) {
  try {
    if (url.pathname === "/party/events" && req.method === "GET") {
      const detach = parties.attach(url.searchParams.get("code"), url.searchParams.get("secret"), res);
      const beat = setInterval(() => res.write(": ping\n\n"), 20000);
      req.on("close", () => { clearInterval(beat); detach(); });
      return;
    }
    if (req.method !== "POST") return json(res, 405, { error: "POST" });
    const b = await readJson(req);
    if (url.pathname === "/party/create") return json(res, 200, parties.create(b.name, b.avatar, b.color));
    if (url.pathname === "/party/join") return json(res, 200, parties.join(b.code, b.name, b.avatar, b.color));
    if (url.pathname === "/party/act") return json(res, 200, await parties.act(b.code, b.secret, b));
    return json(res, 404, { error: "Nicht gefunden" });
  } catch (e) {
    if (e instanceof PartyError) return json(res, e.status, { error: e.message });
    console.error(e); json(res, 500, { error: "Serverfehler" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/party/")) return partyRoute(req, res, url);
  if (url.pathname === "/status.json") {
    res.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-store" });
    return res.end(JSON.stringify(await status()));
  }
  if (url.pathname === "/games.json") {
    res.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-store" });
    // the internal status URLs stay on the server
    return res.end(JSON.stringify(games().map(({ status: _, ...g }) => g)));
  }
  let p;
  try { p = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, body) => {
    if (e) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("Nicht gefunden"); }
    const ext = path.extname(file);
    if (p === "/index.html") body = Buffer.from(String(body).replace("<!--embed-->", () => embed(req, url)));
    res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": ext === ".html" || ext === ".js" ? "no-store" : "public, max-age=86400" });
    res.end(body);
  });
});

server.listen(PORT, HOST, () => console.log(`Spieleabend-Startseite läuft auf Port ${server.address().port}`));
module.exports = { server };
