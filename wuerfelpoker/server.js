// Würfelpoker server: serves the web app and runs online rooms over WebSockets.
// Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const Game = require("./public/game.js");

const PORT = process.env.PORT ? +process.env.PORT : 8080; // "0" = any free port (tests)
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SAVE_FILE = path.join(DATA_DIR, "rooms.json");
const MAX_PLAYERS = 8;
const MAX_ROOMS = 200;
const ROOM_TTL = 12 * 3600 * 1000;
const IDLE_TTL = 5 * 60 * 1000; // close a room nobody has touched in a while, even mid-game
const REACTIONS = ["👍", "😂", "😱", "😡", "🎉", "🙈", "Gut gespielt!", "Uff …", "Beeil dich!", "Na warte!"];
const avatarOf = (a) => (Game.AVATARS.includes(a) ? a : Game.AVATARS[crypto.randomInt(Game.AVATARS.length)]);
const levelOf = (r) => (Game.BOT_LEVELS[r.botLevel] ? r.botLevel : "normal");
const QR_LIB = require.resolve("qrcode-generator/qrcode.js");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json"
};

// ---------- rooms ----------
/** code -> { code, host, goal, members: [{ name, secret }], state, touched } */
const rooms = new Map();
/** code -> Set<ws> */
const sockets = new Map();
function loadRooms() {
  try {
    const list = JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
    for (const r of list) if (Date.now() - r.touched < ROOM_TTL) rooms.set(r.code, r);
    for (const r of rooms.values()) schedule(r); // bots carry on after a restart
    console.log(`${rooms.size} Räume aus ${SAVE_FILE} geladen`);
  } catch (e) { /* first start */ }
}
let saveTimer = null;
function saveRooms() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SAVE_FILE + ".tmp", JSON.stringify([...rooms.values()]));
      fs.renameSync(SAVE_FILE + ".tmp", SAVE_FILE);
    } catch (e) { console.error("Speichern fehlgeschlagen:", e.message); }
  }, 500);
}

function newCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid mix-ups with 1/0
  for (;;) {
    let c = "";
    for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!rooms.has(c)) return c;
  }
}
const cleanName = (n) => String(n || "").replace(/\s+/g, " ").trim().slice(0, 18);

const roomRules = (r) => r.rules || (r.rules = Game.normRules({ chaos: r.chaos, stack: r.stack }));

function online(code) {
  const on = new Set();
  for (const ws of sockets.get(code) || []) if (ws.pid != null) on.add(ws.pid);
  return on;
}

// ---------- computer players and the turn clock ----------
const BOT_NAMES = Game.BOT_NAMES;
const botTimers = new Map();  // code -> { key, t }
const turnTimers = new Map(); // code -> { key, t, ends }

function clearTimer(map, code) { const x = map.get(code); if (x) clearTimeout(x.t); map.delete(code); }

// Runs after every change: lets a bot move when it is its turn, and
// starts the 30 s clock for humans when that house rule is on.
function schedule(room) {
  const S = room.state, code = room.code;
  if (!S || S.phase === "roundEnd" || !rooms.has(code)) { clearTimer(botTimers, code); clearTimer(turnTimers, code); return; }
  const cur = S.players[S.cur];
  let key = null, delay = 0, pi = -1;
  // every roll or hold changes seq, so a bot takes its turn one visible step at a time
  if (cur.bot) { key = `bot:${S.round}:${S.turn}:${S.phase}:${S.seq || 0}`; delay = (S.rolls ? 850 : 2400) + Math.random() * 700; pi = S.cur; } // first roll waits: everybody looks at the last result
  const old = botTimers.get(code);
  if (!old || old.key !== key) {
    clearTimer(botTimers, code);
    if (key) botTimers.set(code, { key, t: setTimeout(() => { botTimers.delete(code); botMove(room, pi); }, delay) });
  }
  const tkey = `${S.round}:${S.turn}`;
  if (roomRules(room).turnTimer && !cur.bot && S.phase === "play") {
    const t = turnTimers.get(code);
    if (!t || t.key !== tkey) {
      clearTimer(turnTimers, code);
      turnTimers.set(code, { key: tkey, ends: Date.now() + Game.TURN_MS, t: setTimeout(() => {
        turnTimers.delete(code);
        if (room.state === S && `${S.round}:${S.turn}` === tkey) apply(room, S.cur, { t: "timeout" });
      }, Game.TURN_MS) });
    }
  } else clearTimer(turnTimers, code);
}

function botMove(room, pi) {
  const S = room.state;
  if (!S || !rooms.has(room.code)) return;
  const a = Game.suggest(Game.view(S, pi), levelOf(room));
  if (!a) return schedule(room);
  if (!apply(room, pi, a) && a.t === "play") apply(room, pi, { t: S.phase === "drawn" ? "keep" : "draw" });
}

// apply an action for player pi and tell everybody; returns false if it was not allowed
function apply(room, pi, a) {
  const res = Game.act(room.state, pi, a);
  room.touched = Date.now();
  if (!res.ok) return false;
  broadcast(room, res.events || []);
  saveRooms();
  return true;
}

function broadcast(room, events) {
  const on = online(room.code);
  // the host went away: the next person who is still here takes over
  if (!on.has(room.host)) { const h = room.members.findIndex((m, i) => !m.bot && on.has(i)); if (h >= 0) room.host = h; }
  schedule(room);
  const clock = turnTimers.get(room.code);
  const members = room.members.map((m, i) => ({ name: m.name, online: !!m.bot || on.has(i), bot: !!m.bot, avatar: m.bot && !m.standIn ? "🤖" : m.avatar || "", lobby: !!room.state && !inGame(room, i), ready: !!m.ready }));
  for (const ws of sockets.get(room.code) || []) {
    if (ws.pid == null) continue;
    send(ws, {
      t: "room", code: room.code, you: ws.pid, host: room.host, goal: room.goal, rules: roomRules(room), botLevel: levelOf(room), members, rematch: room.rematch || [],
      turnLeft: clock ? Math.max(0, clock.ends - Date.now()) : 0,
      view: room.state ? Game.view(room.state, ws.pid >= 0 && ws.pid < room.state.players.length ? ws.pid : -1) : null, events: events || []
    });
  }
}
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function attach(ws, room, pid) {
  detach(ws);
  ws.code = room.code;
  ws.pid = pid;
  if (!sockets.has(room.code)) sockets.set(room.code, new Set());
  sockets.get(room.code).add(ws);
  room.touched = Date.now();
  const m = room.members[pid];
  if (m.bot && m.standIn) { // back from a break: the computer hands the seat back
    m.bot = false; delete m.standIn;
    if (room.state) room.state.players[pid].bot = false;
  }
  send(ws, { t: "joined", code: room.code, pid, secret: room.members[pid].secret });
}
function detach(ws) {
  if (!ws.code) return;
  const set = sockets.get(ws.code);
  if (set) { set.delete(ws); if (!set.size) sockets.delete(ws.code); }
  const room = rooms.get(ws.code);
  ws.code = null; ws.pid = null;
  if (room && !checkRematch(room) && !autoStart(room)) broadcast(room);
}

function handle(ws, msg) {
  const err = (m) => send(ws, { t: "error", msg: m });
  const room = ws.code ? rooms.get(ws.code) : null;

  switch (msg.t) {
    case "create": {
      const name = cleanName(msg.name);
      if (!name) return err("Bitte gib deinen Namen ein.");
      if (rooms.size >= MAX_ROOMS) return err("Der Server ist voll. Versuch es später nochmal.");
      const goal = [0, 3, 5, 7].includes(+msg.goal) ? +msg.goal : 5;
      const r = { code: newCode(), host: 0, goal, rules: Game.normRules(msg.rules), members: [{ name, secret: crypto.randomUUID(), avatar: avatarOf(msg.avatar) }], state: null, touched: Date.now() };
      rooms.set(r.code, r);
      attach(ws, r, 0);
      broadcast(r); saveRooms();
      return;
    }
    case "join": {
      const r = rooms.get(String(msg.code || "").toUpperCase().trim());
      const name = cleanName(msg.name);
      if (!r) return err("Diesen Raum gibt es nicht. Prüf den Code.");
      if (!name) return err("Bitte gib deinen Namen ein.");
      const same = r.members.findIndex((m) => m.name.toLowerCase() === name.toLowerCase() && (!m.bot || m.standIn));
      if (same >= 0) {
        // same name: only allowed to take the seat back when that player is offline
        if (online(r.code).has(same)) return err(`Der Name „${name}“ ist schon vergeben.`);
        attach(ws, r, same); broadcast(r); return;
      }
      if (r.members.length >= MAX_PLAYERS) return err("Der Raum ist voll (8 Spieler).");
      r.members.push({ name, secret: crypto.randomUUID(), avatar: avatarOf(msg.avatar), lobby: !!r.state });
      attach(ws, r, r.members.length - 1);
      broadcast(r); saveRooms();
      return;
    }
    case "resume": {
      const r = rooms.get(String(msg.code || ""));
      const pid = r ? r.members.findIndex((m) => m.secret === msg.secret) : -1;
      if (pid < 0) return send(ws, { t: "gone" });
      attach(ws, r, pid); broadcast(r);
      return;
    }
    case "ready": { // waiting room: ready for the next game (or to join the rematch)
      if (!room || ws.pid == null || ws.pid < 0 || inGame(room, ws.pid) || room.members[ws.pid].bot) return;
      room.members[ws.pid].ready = !!msg.on;
      room.touched = Date.now();
      if (!(room.state ? checkRematch(room) : autoStart(room))) { broadcast(room); saveRooms(); }
      return;
    }
    case "lobby": { // after a game: back to the waiting room instead of a rematch
      if (!room || !room.state || !inGame(room, ws.pid)) return;
      const S = room.state;
      if (S.phase !== "roundEnd" || !S.last || !S.last.over) return;
      room.members[ws.pid].lobby = true; room.members[ws.pid].ready = false;
      room.rematch = (room.rematch || []).filter((i) => i !== ws.pid);
      room.touched = Date.now();
      if (!checkRematch(room)) { broadcast(room); saveRooms(); }
      return;
    }
    case "close": { // host closes the room for everyone
      if (!room || ws.pid !== room.host) return;
      closeRoom(room.code, "closed");
      return;
    }
    case "leave": {
      if (!room) return;
      const pid = ws.pid;
      if (!room.state || pid >= room.state.players.length) {
        room.members.splice(pid, 1);
        for (const s of sockets.get(room.code) || []) if (s.pid > pid) s.pid--;
        if (room.host === pid) room.host = 0;
        else if (room.host > pid) room.host--;
      }
      send(ws, { t: "left" });
      detach(ws);
      if (!room.members.length) rooms.delete(room.code);
      else broadcast(room);
      saveRooms();
      return;
    }
    case "start": {
      if (!room) return;
      if (ws.pid !== room.host) return err("Nur wer den Raum erstellt hat, kann starten.");
      if (room.state) return;
      const e = startWith(room, readyPlayers(room, true));
      if (e) err(e);
      return;
    }
    case "act": {
      if (!room || !room.state) return;
      const a = msg.a || {};
      if (ws.pid == null || !inGame(room, ws.pid)) return err("Du bist gerade nicht im Spiel.");
      if (a.t === "next" && room.state.phase === "roundEnd" && room.state.last && room.state.last.over) { // rematch: a vote
        room.rematch = (room.rematch || []).filter((i) => i !== ws.pid).concat(ws.pid);
        room.touched = Date.now();
        if (!checkRematch(room)) { broadcast(room); saveRooms(); }
        return;
      }
      if (a.t === "skip" && ws.pid !== room.host) return err("Nur der Host kann Spieler überspringen.");
      if (a.t === "timeout") return; // only the server's clock may do that
      const res = Game.act(room.state, ws.pid, a);
      room.touched = Date.now();
      if (!res.ok) {
        err(res.error);
        return;
      }
      broadcast(room, res.events || []); saveRooms();
      return;
    }
    case "rules": { // host changes house rules in the waiting room
      if (!room || ws.pid !== room.host || room.state) return;
      room.rules = Game.normRules(msg.rules);
      broadcast(room); saveRooms();
      return;
    }
    case "goal": { // host changes the goal in the waiting room
      if (!room || ws.pid !== room.host || room.state || ![0, 3, 5, 7].includes(+msg.goal)) return;
      room.goal = +msg.goal;
      broadcast(room); saveRooms();
      return;
    }
    case "react": { // emoji for everyone at the table, at most one per second
      if (!room || !REACTIONS.includes(msg.e)) return;
      const now = Date.now();
      if (now - (ws.lastReact || 0) < 1000) return;
      ws.lastReact = now;
      for (const s of sockets.get(room.code) || []) if (s.pid != null) send(s, { t: "react", pi: ws.pid, e: msg.e });
      return;
    }
    case "botLevel": {
      if (!room || ws.pid !== room.host || !Game.BOT_LEVELS[msg.level]) return;
      room.botLevel = msg.level;
      broadcast(room); saveRooms();
      return;
    }
    case "avatar": { // change your own avatar in the waiting room
      if (!room || room.state || !Game.AVATARS.includes(msg.avatar)) return;
      room.members[ws.pid].avatar = msg.avatar;
      broadcast(room); saveRooms();
      return;
    }
    case "addBot": { // host adds a computer player in the waiting room
      if (!room || ws.pid !== room.host || room.state) return;
      if (room.members.length >= MAX_PLAYERS) return err("Der Raum ist voll (8 Spieler).");
      const taken = new Set(room.members.map((m) => m.name));
      const name = BOT_NAMES.find((n) => !taken.has(n)) || `Bot ${room.members.length + 1}`;
      room.members.push({ name, secret: crypto.randomUUID(), bot: true });
      broadcast(room); saveRooms();
      return;
    }
    case "removeBot": {
      const i = +msg.seat;
      if (!room || ws.pid !== room.host || room.state || !room.members[i] || !room.members[i].bot) return;
      room.members.splice(i, 1);
      for (const s of sockets.get(room.code) || []) if (s.pid > i) s.pid--;
      if (room.host > i) room.host--;
      broadcast(room); saveRooms();
      return;
    }
    case "standIn": { // host lets the computer play for someone who dropped out
      const i = +msg.seat;
      if (!room || ws.pid !== room.host || !room.state || !room.members[i] || room.members[i].bot) return;
      if (online(room.code).has(i)) return err(`${room.members[i].name} ist noch online.`);
      room.members[i].bot = true; room.members[i].standIn = true;
      room.state.players[i].bot = true;
      broadcast(room); saveRooms();
      return;
    }
    case "end": { // host closes the game and returns everyone to the lobby
      if (!room || ws.pid !== room.host) return;
      toLobby(room);
      broadcast(room); saveRooms();
      return;
    }
  }
}

// ---------- http ----------
function lanIps() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) ips.push(a.address);
  return ips;
}

// Scripts get a content hash in their URL (app.js?v=1a2b3c4d), so a phone or a CDN
// holding an old copy can never mix old and new files after an update.
const VERSION = crypto.createHash("sha1")
  .update(fs.readFileSync(path.join(PUBLIC, "game.js")))
  .update(fs.readFileSync(path.join(PUBLIC, "app.js")))
  .digest("hex").slice(0, 10);
const INDEX = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8")
  .replace('<script src="game.js"></script>', `<script src="game.js?v=${VERSION}"></script>`)
  .replace('<script src="app.js"></script>', `<script src="app.js?v=${VERSION}"></script>`)
  .replace("<head>", `<head>\n<meta name="wuerfelpoker-version" content="${VERSION}">`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/info" || url.pathname === "/wuerfelpoker-server") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({ wuerfelpoker: true, version: VERSION, ips: lanIps(), port: PORT, rooms: rooms.size }));
  }
  if (url.pathname === "/vendor/qrcode.js") {
    return fs.readFile(QR_LIB, (e, data) => {
      if (e) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "public, max-age=86400" });
      res.end(data);
    });
  }
  let p;
  try { p = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === "/" || p === "/index.html") {
    res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
    return res.end(INDEX);
  }
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("Nicht gefunden"); }
    const ext = path.extname(file);
    const versioned = url.searchParams.get("v") === VERSION && (p === "/app.js" || p === "/game.js");
    res.writeHead(200, {
      "content-type": TYPES[ext] || "application/octet-stream",
      "cache-control": versioned ? "public, max-age=31536000, immutable"
        : ext === ".png" || ext === ".svg" ? "public, max-age=86400" : "no-store"
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 });
wss.on("connection", (ws) => {
  ws.alive = true;
  ws.on("pong", () => { ws.alive = true; });
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg && typeof msg.t === "string") {
      try { handle(ws, msg); } catch (e) { console.error(e); send(ws, { t: "error", msg: "Serverfehler." }); }
    }
  });
  ws.on("close", () => detach(ws));
});

// keep connections alive through phones' sleep and home routers; drop dead ones
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
  for (const [code, r] of rooms) {
    if (Date.now() - r.touched > IDLE_TTL) closeRoom(code, "idle");
  }
}, 25000).unref();

// ---------- waiting room: ready up, sit out, rematch ----------
// While a game runs, room.members[0..n) are its players (member index = seat, n =
// state.players.length). Everyone behind them, and anyone marked .lobby, is in the
// waiting room and may watch. Waiting-room members mark themselves .ready for the next game.
const inGame = (room, i) => !!room.state && i >= 0 && i < room.state.players.length && !room.members[i].lobby;

// put the next game's players first and everyone else behind them; sockets and host follow
function seatPlayers(room, play) {
  const order = play.concat(room.members.map((_, i) => i).filter((i) => !play.includes(i)));
  const to = new Map(order.map((from, i) => [from, i]));
  room.members = order.map((i) => room.members[i]);
  for (const ws of sockets.get(room.code) || []) if (ws.pid != null && ws.pid >= 0) ws.pid = to.get(ws.pid);
  room.host = to.get(room.host);
  room.members.forEach((m, i) => { m.lobby = i >= play.length; m.ready = false; });
  room.rematch = null;
}
// who plays next: the computers, and whoever is here and ready (the host too when starting by hand)
function readyPlayers(room, withHost) {
  const on = online(room.code);
  return room.members.map((_, i) => i).filter((i) => room.members[i].bot || (on.has(i) && (room.members[i].ready || (withHost && i === room.host))));
}
// start a new game with these members; returns an error text if that isn't possible
function startWith(room, play) {
  play = play.slice(0, MAX_PLAYERS);
  if (play.length < 2 || play.every((i) => room.members[i].bot)) return "Es braucht mindestens 2 Spieler, die bereit sind.";
  seatPlayers(room, play);
  const players = room.members.slice(0, play.length);
  room.state = Game.newGame(players.map((m) => m.name), room.goal, roomRules(room));
  players.forEach((m, i) => { room.state.players[i].bot = !!m.bot; room.state.players[i].avatar = m.bot ? "🤖" : m.avatar; });
  room.touched = Date.now();
  broadcast(room); saveRooms();
  return null;
}
// everyone here in the waiting room is ready: off we go
function autoStart(room) {
  if (room.state) return false;
  const on = online(room.code);
  const people = room.members.map((_, i) => i).filter((i) => !room.members[i].bot && on.has(i));
  if (!people.length || !people.every((i) => room.members[i].ready)) return false;
  return startWith(room, readyPlayers(room, false)) === null;
}
// everyone back to the waiting room
function toLobby(room) {
  room.state = null; room.rematch = null;
  room.members.forEach((m) => { m.lobby = false; m.ready = false; });
}
// after a game: the rematch starts once everyone still at the table (and online) has voted,
// with them, the computers and whoever got ready in the waiting room; if no one is left at
// the table, everybody goes back to the waiting room. Returns true if it acted.
function checkRematch(room) {
  const S = room.state;
  if (!S || S.phase !== "roundEnd" || !S.last || !S.last.over) return false;
  const on = online(room.code), votes = room.rematch || [];
  const table = room.members.map((_, i) => i).filter((i) => inGame(room, i));
  const people = table.filter((i) => !room.members[i].bot && on.has(i));
  if (!people.length) { toLobby(room); broadcast(room); saveRooms(); return true; }
  if (!people.every((i) => votes.includes(i))) return false;
  const play = room.members.map((_, i) => i).filter((i) => inGame(room, i)
    ? room.members[i].bot || votes.includes(i)
    : !room.members[i].bot && room.members[i].ready && on.has(i));
  if (play.length === S.players.length && play.every((x, i) => x === i)) { // same table: the engine's own rematch
    room.rematch = null;
    room.members.forEach((m, i) => { if (i < play.length) { m.lobby = false; m.ready = false; } });
    apply(room, play.find((i) => !room.members[i].bot), { t: "next" });
    return true;
  }
  return startWith(room, play) === null;
}

// close a room for good and tell everyone still in it why ("idle" or "closed" by the host)
function closeRoom(code, reason) {
  for (const ws of sockets.get(code) || []) { send(ws, { t: "gone", reason }); ws.code = null; ws.pid = null; }
  clearTimer(botTimers, code); clearTimer(turnTimers, code);
  sockets.delete(code);
  rooms.delete(code); saveRooms();
}

loadRooms();
server.listen(PORT, HOST, () => {
  console.log(`Würfelpoker läuft auf Port ${PORT} (Version ${VERSION})`);
  for (const ip of lanIps()) console.log(`  im WLAN öffnen: http://${ip}:${PORT}`);
});

module.exports = { server, rooms };
