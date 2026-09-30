#!/usr/bin/env node
// Conformance check: does every game follow the shared Spieleabend conventions (ARCHITECTURE.md)?
//   scripts/check-games            check all games listed in start/games.json
//   scripts/check-games <id> ...   check only these games
// Exits 1 with one line per problem. No dependencies, runs in CI and after scripts/new-game.
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...p) => { try { return fs.readFileSync(path.join(root, ...p), "utf8"); } catch { return null; } };
const exists = (...p) => fs.existsSync(path.join(root, ...p));

const games = JSON.parse(read("start", "games.json"));
const only = process.argv.slice(2);
const ids = only.length ? only : games.map((g) => g.id);
const problems = [];
const bad = (id, msg) => problems.push(`${id}: ${msg}`);

const PAGE_ORDER = ["kit.css", "room-ui.css", "avatars.js", "profile.js", "kit.js", "room-ui.js", "home-ui.js", "game.js", "app.js"];
const REQUIRED_FILES = [
  "server.js", "Dockerfile", "docker-compose.yml", "docker-compose.tunnel.yml", "package.json", "package-lock.json", "README.md",
  "public/index.html", "public/app.js", "public/game.js", "public/sw.js", "public/manifest.webmanifest", "public/icon.svg",
  "test/game.test.js", "test/server.test.js",
];

const dockerfiles = new Set(ids.map((id) => read(id, "Dockerfile")).filter(Boolean));
const reference = (read("scripts", "game-template", "Dockerfile") || "");
const ports = new Map();
const readme = read("README.md") || "";

for (const id of ids) {
  if (!exists(id)) { bad(id, "folder does not exist"); continue; }
  const entry = games.find((g) => g.id === id);
  if (!entry) bad(id, "missing in start/games.json (id, name, title, desc, players, url, max, status)");
  else for (const k of ["name", "title", "desc", "players", "url", "max", "status"]) if (entry[k] == null) bad(id, `start/games.json entry has no "${k}"`);
  if (!exists("start", "public", `${id}.svg`)) bad(id, `start/public/${id}.svg (tile icon) is missing`);
  if (!readme.includes(`[\`${id}/\`](${id}/)`)) bad(id, "no row in the table of the root README.md");

  for (const f of REQUIRED_FILES) if (!exists(id, f)) bad(id, `${f} is missing`);

  const server = read(id, "server.js") || "";
  if (!server.includes("../shared/room-server.js")) bad(id, "server.js must use ../shared/room-server.js (no own socket/room code)");
  if (!/\bdir:\s*__dirname\b/.test(server) || !/\bGame\b/.test(server) || !/\bmaxPlayers:/.test(server)) bad(id, "server.js adapter needs dir, Game and maxPlayers");
  if (/require\(["'](ws|express|socket\.io)["']\)/.test(server)) bad(id, "server.js must not require ws/express/socket.io itself, the shared server does");

  const engine = read(id, "public", "game.js") || "";
  const code = engine.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  if (/\b(document|window|navigator)\.|\blocalStorage\b|\balert\(/.test(code)) bad(id, "public/game.js must be a pure engine: no document/window/localStorage (it also runs on the server)");
  if (!/module\.exports|typeof module/.test(engine)) bad(id, "public/game.js must export for node (UMD: module.exports + global)");

  const page = read(id, "public", "index.html") || "";
  let last = -1;
  for (const f of PAGE_ORDER) {
    const at = page.search(new RegExp(`(src|href)="[^"]*${f.replace(".", "\\.")}[^"]*"`));
    if (at < 0) { bad(id, `public/index.html does not load ${f}`); continue; }
    if (at < last) bad(id, `public/index.html loads ${f} too early (order: ${PAGE_ORDER.join(", ")})`);
    last = Math.max(last, at);
  }
  if (!/<meta name="viewport"[^>]*viewport-fit=cover/.test(page)) bad(id, "index.html needs the viewport meta with viewport-fit=cover");
  if (!/manifest\.webmanifest/.test(page)) bad(id, "index.html does not link manifest.webmanifest");

  const app = read(id, "public", "app.js") || "";
  if (!/\bRoomUI\s*\(/.test(app)) bad(id, "app.js must create the room client with RoomUI(...), not its own WebSocket code");
  if (/new WebSocket/.test(app)) bad(id, "app.js opens its own WebSocket; RoomUI owns the connection");
  if (!/\bHomeUI\s*\(/.test(app)) bad(id, "app.js must build the single-player line-up with HomeUI(...)");
  if (!/roundEndFooter/.test(app)) bad(id, "app.js: the round/game end screen must use UI.roundEndFooter(...) (rematch, back to start, look at result)");
  if (/rematchStatus\(/.test(app) && !/roundEndFooter/.test(app)) bad(id, "app.js: use UI.roundEndFooter instead of hand-made rematch buttons");
  if (!/profile\.result|\.profile\.|Profile\./.test(app) && !/profile/.test(app)) bad(id, "app.js never records a result in the profile (profile.result at the end of a round)");
  if (!/Spieleabend\.look|\bK\.look\(|\.look\(/.test(app)) bad(id, "app.js must call Spieleabend.look() (table design + avatar)");

  const docker = read(id, "Dockerfile");
  if (docker && reference && docker !== reference) bad(id, "Dockerfile differs from scripts/game-template/Dockerfile (must be identical in every game)");
  const compose = read(id, "docker-compose.yml") || "";
  const port = compose.match(/\$\{[A-Z0-9_]+:-(\d+)\}:8080/);
  if (!port) bad(id, 'docker-compose.yml needs ports: "${…_PORT:-N}:8080"');
  else if (ports.has(port[1])) bad(id, `default host port ${port[1]} is already used by ${ports.get(port[1])}`);
  else ports.set(port[1], id);
  if (!/context:\s*\.\./.test(compose) || !/GAME:\s*\S+/.test(compose)) bad(id, "docker-compose.yml must build from the repo root (context: .., args GAME)");
  const name = compose.match(/container_name:\s*(\S+)/);
  if (entry && name && !entry.status.startsWith(`http://${name[1]}:8080/`)) bad(id, `games.json status ${entry.status} does not point at container_name ${name[1]}`);
  if (!/PARTY_SECRET/.test(compose)) bad(id, "docker-compose.yml must pass PARTY_SECRET through");

  const sw = read(id, "public", "sw.js") || "";
  if (sw && !/\bSHELL\b|\bASSETS\b|addAll/.test(sw)) bad(id, "public/sw.js has no precache list");

  const tests = exists(id, "test") ? fs.readdirSync(path.join(root, id, "test")) : [];
  if (!tests.some((f) => /server/.test(f))) bad(id, "test/ needs a server test (a real websocket round through the shared server)");
  const gt = read(id, "test", "game.test.js") || "";
  if ((gt.match(/\btest\(|\bit\(/g) || []).length < 5) bad(id, "test/game.test.js has fewer than 5 tests");
}

// private details must never end up in the public repo
if (!only.length) {
  if (!/^\.env$/m.test(read(".gitignore") || "")) problems.push(".gitignore: must ignore .env (PARTY_SECRET lives there)");
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if ([".git", "node_modules", "data", ".env"].includes(e.name)) continue;
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel); else files.push(rel);
    }
  })("");
  const SECRET = /192\.168\.178\.|\bhp[ -]?mini\b|debian-main|\.cfargotunnel\.com|PARTY_SECRET\s*=\s*[A-Za-z0-9]{8,}/i;
  for (const f of files) {
    if (f === "scripts/check-games.js" || /\.(png|ico|lock)$|package-lock/.test(f)) continue;
    const text = read(f);
    if (text && SECRET.test(text)) problems.push(`${f}: contains home-network or secret details, keep them out of the repo`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} problem(s). The rules are explained in ARCHITECTURE.md and AGENTS.md.`);
  process.exit(1);
}
console.log(`ok: ${ids.length} game(s) follow the shared conventions`);
