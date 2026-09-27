// Spieleabend start page: serves the game overview and a small status endpoint that asks
// every game server (inside the Docker network) whether it is up and how many rooms are open.
// Start with `node server.js`; PORT, HOST and GAMES_FILE are optional env vars.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT ? +process.env.PORT : 8080;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC = path.join(__dirname, "public");
const GAMES_FILE = process.env.GAMES_FILE || path.join(__dirname, "games.json");
const TYPES = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
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
    res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": ext === ".html" ? "no-store" : "public, max-age=86400" });
    res.end(body);
  });
});

server.listen(PORT, HOST, () => console.log(`Spieleabend-Startseite läuft auf Port ${server.address().port}`));
module.exports = { server };
