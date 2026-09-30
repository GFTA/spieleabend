// Shared server for every Spieleabend game: serves the web app and runs the online rooms
// over WebSockets. Rooms, waiting room and ready-up, rematch, reconnecting, computer
// players, the turn clock, closing a room and idle cleanup all live here, once. A game's
// own server.js only hands over its engine (public/game.js) and a few game-specific hooks:
//
//   require("../shared/room-server.js")({
//     dir: __dirname, Game, id: "uno", title: "Uno", maxPlayers: 10, reactions: [...],
//     newRoom(msg)            -> the settings a new room starts with ({ goal, rules, ... })
//     roomFields(room)        -> those settings as sent to the players with every room update
//     settings(room, msg)     -> host changes settings in the waiting room ({t:"settings"})
//     handlers: { t(room, msg, ctx) }  extra messages (Uno's {t:"rules"}, {t:"goal"}, ...)
//     newGame(room, players)  -> a fresh game state for these members
//     // optional:
//     watchers: 20            -> a full room lets people watch instead of turning them away
//     botPlan(room, ctx)      -> { key, delay, pi } for the next computer move, or null
//     botMove(room, pi, ctx)  -> make that move, true if it happened (default: Game.botMove)
//     turnClock(room)         -> key of the running 30 s turn clock (Game.TURN_MS), or null
//     hostHandover: true      -> when the host goes offline, the next person online becomes host
//     legacyPath, metaName    -> old /info alias and the version <meta> name
//   })  -> { server, wss, rooms }
//
// Start a game with `node server.js` (PORT, HOST, DATA_DIR, BOT_MS and RATE_PER_S, the messages per second
// one connection may send, are optional env vars).
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { createRequire } = require("module");

module.exports = function roomServer(g) {
  const Game = g.Game;
  // npm packages come from the game's own node_modules, this folder has none
  const gameRequire = createRequire(path.join(g.dir, "server.js"));
  const { WebSocketServer } = gameRequire("ws");
  const QR_LIB = gameRequire.resolve("qrcode-generator/qrcode.js");

  const PORT = process.env.PORT ? +process.env.PORT : 8080; // "0" = any free port (tests)
  const HOST = process.env.HOST || "0.0.0.0";
  const PUBLIC = path.join(g.dir, "public");
  const DATA_DIR = process.env.DATA_DIR || path.join(g.dir, "data");
  const SAVE_FILE = path.join(DATA_DIR, "rooms.json");
  const MAX_PLAYERS = g.maxPlayers;
  const MAX_WATCHERS = g.watchers || 0;
  const MAX_ROOMS = 200;
  const CHAT_MAX = 200, CHAT_KEEP = 100; // characters per chat line, lines kept per room
  const ROOM_TTL = 12 * 3600 * 1000;
  const IDLE_TTL = 5 * 60 * 1000; // close a room nobody has touched in a while, even mid-game
  const LEAVE_VOTE_MS = 45 * 1000; // soft timeout for mid-game leave votes
  const BOT_MS = +process.env.BOT_MS || 1100; // how long a computer player "thinks" (default bot plan)
  const BOT_AVATAR = Game.BOT_AVATAR || "🤖";
  const avatarOf = (a) => (Game.AVATARS.includes(a) ? a : Game.AVATARS[crypto.randomInt(Game.AVATARS.length)]);
  const COLORS = require("./avatars.js").COLORS;
  const colorOf = (c) => (COLORS.includes(c) ? c : "");

  const TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json"
  };

  // ---------- rooms ----------
  /** code -> { code, host, ...settings, members: [{ name, secret, avatar, bot, standIn, lobby, ready }], state, rematch, touched } */
  const rooms = new Map();
  /** code -> Set<ws> */
  const sockets = new Map();

  function loadRooms() {
    try {
      const list = JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
      for (const r of list) if (Date.now() - r.touched < ROOM_TTL) rooms.set(r.code, r);
      for (const r of rooms.values()) { schedule(r); if (r.leaveVote) armLeaveVoteTimer(r); } // bots, clocks and leave votes carry on after a restart
      console.log(`${rooms.size} Räume aus ${SAVE_FILE} geladen`);
    } catch (e) { /* first start */ }
  }
  let saveTimer = null;
  function saveNow() {
    clearTimeout(saveTimer);
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SAVE_FILE + ".tmp", JSON.stringify([...rooms.values()]));
      fs.renameSync(SAVE_FILE + ".tmp", SAVE_FILE);
    } catch (e) { console.error("Speichern fehlgeschlagen:", e.message); }
  }
  function saveRooms() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }
  // a timer callback that throws must not take the whole server, and with it every room, down
  const guard = (what, fn) => () => { try { fn(); } catch (e) { console.error(`${g.id}: ${what} fehlgeschlagen:`, e); } };

  function newCode() {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid mix-ups with 1/0
    for (;;) {
      let c = "";
      for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
      if (!rooms.has(c)) return c;
    }
  }
  const cleanName = (n) => String(n || "").replace(/\s+/g, " ").trim().slice(0, 18);

  function online(code) {
    const on = new Set();
    for (const ws of sockets.get(code) || []) if (ws.pid != null && ws.pid >= 0) on.add(ws.pid);
    return on;
  }
  // spectators: sockets with pid -1 and a name, they watch the table without any secrets
  const watchers = (code) => [...(sockets.get(code) || [])].filter((ws) => ws.pid === -1).map((ws) => ws.watchName);
  function watch(ws, room, name) {
    detach(ws);
    ws.code = room.code; ws.pid = -1; ws.watchName = name;
    if (!sockets.has(room.code)) sockets.set(room.code, new Set());
    sockets.get(room.code).add(ws);
    send(ws, { t: "watching", code: room.code, name });
    send(ws, { t: "chatlog", list: room.chat || [] });
    broadcast(room);
  }

  // ---------- computer players and clocks ----------
  // Three timers per room: the next computer move, the engine's own deadline (UNO window,
  // shot clock, ...) and the server's 30 s turn clock. schedule() runs after every change.
  const botTimers = new Map();  // code -> { key, t }
  const deadTimers = new Map(); // code -> timeout
  const turnTimers = new Map(); // code -> { key, t, ends }
  const leaveVoteTimers = new Map(); // code -> timeout for soft leave-vote resolve
  const moves = new Map();      // code -> counter of applied actions, tells one bot move from the next
  const bump = (room) => moves.set(room.code, (moves.get(room.code) || 0) + 1);

  function clearTimer(map, code) { const x = map.get(code); if (x) clearTimeout(x.t || x); map.delete(code); }
  function clearTimers(code) { clearTimer(botTimers, code); clearTimer(deadTimers, code); clearTimer(turnTimers, code); clearLeaveVoteTimer(code); moves.delete(code); }

  // Mid-game leave: remaining players vote bot vs wait (same for every game).
  // leaveVote keeps the member + secret so reconnect still works; bot path uses standIn.
  function clearLeaveVoteTimer(code) { const t = leaveVoteTimers.get(code); if (t) clearTimeout(t); leaveVoteTimers.delete(code); }
  function publicLeaveVote(lv) {
    if (!lv) return null;
    return { seat: lv.seat, name: lv.name, started: lv.started, votes: Object.assign({}, lv.votes) };
  }
  function clearLeaveVote(room) { clearLeaveVoteTimer(room.code); delete room.leaveVote; }
  function installStandIn(room, seat) {
    const m = room.members[seat];
    if (!m || !room.state || !room.state.players[seat]) return;
    m.bot = true; m.standIn = true; // keep secret/name/avatar so reconnect hands the seat back
    room.state.players[seat].bot = true;
    if (Game.resetClock && room.state.phase === "play") Game.resetClock(room.state);
    room.touched = Date.now();
  }
  function eligibleLeaveVoters(room) {
    const on = online(room.code), seat = room.leaveVote && room.leaveVote.seat;
    return room.members.map((_, i) => i).filter((i) => i !== seat && inGame(room, i) && !room.members[i].bot && on.has(i));
  }
  function armLeaveVoteTimer(room) {
    clearLeaveVoteTimer(room.code);
    if (!room.leaveVote) return;
    const left = Math.max(0, LEAVE_VOTE_MS - (Date.now() - room.leaveVote.started));
    leaveVoteTimers.set(room.code, setTimeout(guard("Leave-Abstimmung", () => {
      leaveVoteTimers.delete(room.code);
      if (rooms.get(room.code) !== room || !room.leaveVote) return;
      resolveLeaveVote(room);
    }), left).unref());
  }
  function startLeaveVote(room, pid) {
    if (room.leaveVote || !room.state || !inGame(room, pid)) return;
    const m = room.members[pid];
    if (!m || m.bot) return;
    room.leaveVote = { seat: pid, name: m.name, secret: m.secret, started: Date.now(), votes: {} };
    armLeaveVoteTimer(room);
    room.touched = Date.now();
  }
  function resolveLeaveVote(room) {
    const lv = room.leaveVote;
    if (!lv) return;
    const eligible = eligibleLeaveVoters(room);
    let bots = 0, waits = 0;
    // all voted → count every eligible vote; soft timeout → majority among cast; none cast / no eligible → wait
    const pool = !eligible.length ? []
      : eligible.every((i) => lv.votes[i]) ? eligible
      : eligible.filter((i) => lv.votes[i]);
    for (const i of pool) { if (lv.votes[i] === "bot") bots++; else waits++; }
    const seat = lv.seat;
    clearLeaveVote(room);
    if (bots > waits) installStandIn(room, seat); // tie prefers wait
    room.touched = Date.now();
    broadcast(room); saveRooms();
  }
  function maybeResolveLeaveVote(room) {
    if (!room.leaveVote) return false;
    const eligible = eligibleLeaveVoters(room);
    if (!eligible.length || eligible.every((i) => room.leaveVote.votes[i])) { resolveLeaveVote(room); return true; }
    return false;
  }

  // the default computer player: the one whose turn it is moves after BOT_MS
  function defaultBotPlan(room) {
    const S = room.state;
    if (!Game.botMove || S.phase !== "play" || !S.players[S.cur] || !S.players[S.cur].bot) return null;
    return { key: `bot:${moves.get(room.code) || 0}`, delay: BOT_MS, pi: S.cur };
  }
  function defaultBotMove(room, pi) {
    const a = Game.botMove(room.state, pi);
    return !!a && apply(room, pi, a).ok;
  }

  function schedule(room) {
    const S = room.state, code = room.code;
    clearTimer(deadTimers, code);
    if (!S || !rooms.has(code)) { clearTimer(botTimers, code); clearTimer(turnTimers, code); return; }
    // the engine's own deadline: always re-armed, it counts to a fixed point in time
    const ms = Game.nextDeadline ? Game.nextDeadline(S) : -1;
    if (ms >= 0) deadTimers.set(code, setTimeout(guard("Zeitschritt", () => {
      deadTimers.delete(code);
      if (rooms.get(code) !== room || room.state !== S) return;
      const events = Game.tick(S);
      if (events.length) { room.touched = Date.now(); bump(room); broadcast(room, events); saveRooms(); }
      else schedule(room);
    }), ms + 30).unref());
    if (S.phase === "roundEnd") { clearTimer(botTimers, code); clearTimer(turnTimers, code); return; }
    // the next computer move, restarted only when it is a different move than the waiting one
    const plan = (g.botPlan ? g.botPlan(room, ctx) : defaultBotPlan(room)) || { key: null };
    const old = botTimers.get(code);
    if (!old || old.key !== plan.key) {
      clearTimer(botTimers, code);
      if (plan.key) botTimers.set(code, { key: plan.key, t: setTimeout(guard("Computerzug", () => {
        botTimers.delete(code);
        if (rooms.get(code) !== room || room.state !== S) return;
        const done = g.botMove ? g.botMove(room, plan.pi, ctx) : defaultBotMove(room, plan.pi);
        if (!done) schedule(room); // try again after another pause
      }), plan.delay).unref() });
    }
    // the 30 s turn clock (house rule): runs out into a {t:"timeout"} only the server may send
    const tkey = g.turnClock ? g.turnClock(room) : null;
    if (tkey) {
      const t = turnTimers.get(code);
      if (!t || t.key !== tkey) {
        clearTimer(turnTimers, code);
        turnTimers.set(code, { key: tkey, ends: Date.now() + Game.TURN_MS, t: setTimeout(guard("Zugzeit", () => {
          turnTimers.delete(code);
          if (room.state === S && g.turnClock(room) === tkey) apply(room, S.cur, { t: "timeout" });
        }), Game.TURN_MS).unref() });
      }
    } else clearTimer(turnTimers, code);
  }

  // apply an action for player pi and tell everybody; run-out deadlines are resolved first
  function apply(room, pi, a) {
    const expired = Game.tick ? Game.tick(room.state) : [];
    const res = Game.act(room.state, pi, a);
    room.touched = Date.now();
    if (res.ok || expired.length) {
      bump(room);
      broadcast(room, expired.concat(res.ok ? res.events || [] : []));
      saveRooms();
    }
    return res;
  }

  function broadcast(room, events) {
    const on = online(room.code);
    // the host went away: the next person who is still here takes over (games with hostHandover)
    if (g.hostHandover && !on.has(room.host)) { const h = room.members.findIndex((m, i) => !m.bot && on.has(i)); if (h >= 0) room.host = h; }
    schedule(room);
    const clock = turnTimers.get(room.code);
    const members = room.members.map((m, i) => ({
      name: m.name, online: !!m.bot || on.has(i), bot: !!m.bot, avatar: m.bot && !m.standIn ? BOT_AVATAR : avatarOf(m.avatar), color: m.bot ? "" : colorOf(m.color),
      lobby: !!room.state && !inGame(room, i), ready: !!m.ready
    }));
    const seen = watchers(room.code), fields = g.roomFields(room);
    for (const ws of sockets.get(room.code) || []) {
      if (ws.pid == null) continue;
      send(ws, Object.assign({ t: "room", code: room.code, you: ws.pid, host: room.host, party: room.party || null }, fields, {
        members, rematch: room.rematch || [], watchers: seen, leaveVote: publicLeaveVote(room.leaveVote),
        turnLeft: clock ? Math.max(0, clock.ends - Date.now()) : 0,
        view: room.state ? Game.view(room.state, ws.pid >= 0 && ws.pid < room.state.players.length ? ws.pid : -1) : null, events: events || []
      }));
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
    if (room.leaveVote && room.leaveVote.seat === pid) clearLeaveVote(room); // back during the vote: cancel it
    if (m.bot && m.standIn) { // back from a break: the computer hands the seat back
      m.bot = false; delete m.standIn;
      if (room.state && room.state.players[pid]) room.state.players[pid].bot = false;
    }
    send(ws, { t: "joined", code: room.code, pid, secret: m.secret });
    send(ws, { t: "chatlog", list: room.chat || [] });
  }
  function detach(ws) {
    if (!ws.code) return;
    const code = ws.code, pid = ws.pid;
    const set = sockets.get(code);
    if (set) { set.delete(ws); if (!set.size) sockets.delete(code); }
    const room = rooms.get(code);
    ws.code = null; ws.pid = null;
    if (!room) return;
    // phone kill / drop mid-game: same leave vote as an explicit leave (if none is running yet)
    if (pid != null && pid >= 0 && room.state && inGame(room, pid)) {
      const m = room.members[pid];
      if (m && !m.bot && !room.leaveVote) {
        const still = [...(sockets.get(code) || [])].some((s) => s.pid === pid);
        if (!still) startLeaveVote(room, pid);
      } else if (room.leaveVote && !maybeResolveLeaveVote(room)) { /* voter dropped: maybe everyone else already voted */ }
    }
    if (!checkRematch(room) && !autoStart(room)) broadcast(room);
  }

  // take a seat out of the waiting room and shift everyone behind it
  function removeMember(room, pid) {
    room.members.splice(pid, 1);
    for (const s of sockets.get(room.code) || []) if (s.pid > pid) s.pid--;
    if (room.host > pid) room.host--;
    else if (room.host === pid) room.host = Math.max(0, room.members.findIndex((m) => !m.bot));
  }

  // A party (start page group) asks for a room with everyone already seated, host first. More
  // people than seats: only those who got ready play (the host always), the rest watch if the game
  // has watchers. Each seat gets its secret, the phones open the game with it and resume that seat.
  function partyRoom(body) {
    const seen = new Set(), list = [];
    for (const m of (Array.isArray(body.members) ? body.members : []).slice(0, 40)) {
      const name = cleanName(m && m.name);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      list.push({ name, avatar: avatarOf(m.avatar), color: colorOf(m.color), ready: !!m.ready });
    }
    if (!list.length) return { error: "Die Party ist leer." };
    if (rooms.size >= MAX_ROOMS) return { error: "Der Server ist voll." };
    const seated = list.length <= MAX_PLAYERS ? list : list.filter((m, i) => i === 0 || m.ready).slice(0, MAX_PLAYERS);
    const rest = list.filter((m) => !seated.includes(m));
    const watch = MAX_WATCHERS ? rest.slice(0, MAX_WATCHERS) : [];
    const r = Object.assign({ code: newCode(), host: 0, party: String(body.party || "").replace(/[^A-Z]/g, "").slice(0, 8) || null }, g.newRoom({}), {
      members: seated.map((m) => ({ name: m.name, secret: crypto.randomUUID(), avatar: m.avatar, color: m.color, ready: m.ready })), state: null, touched: Date.now()
    });
    rooms.set(r.code, r); saveRooms();
    return { code: r.code, max: MAX_PLAYERS, seats: r.members.map((m) => ({ name: m.name, secret: m.secret })),
      watch: watch.map((m) => m.name), out: rest.filter((m) => !watch.includes(m)).map((m) => m.name) };
  }
  const PARTY_SECRET = process.env.PARTY_SECRET || "";
  const sameSecret = (a) => {
    const h = (x) => crypto.createHash("sha256").update(String(x || "")).digest();
    return !!PARTY_SECRET && crypto.timingSafeEqual(h(a), h(PARTY_SECRET));
  };

  // what a game's hooks may use
  const ctx = { rooms, sockets, online, broadcast, saveRooms, apply, schedule, send, BOT_MS };

  function handle(ws, msg) {
    const err = (m) => send(ws, { t: "error", msg: m });
    const room = ws.code ? rooms.get(ws.code) : null;
    const isHost = !!room && ws.pid === room.host;

    switch (msg.t) {
      case "ping": return send(ws, { t: "pong" }); // clients check that a socket that looks open is still alive
      case "create": {
        const name = cleanName(msg.name);
        if (!name) return err("Bitte gib deinen Namen ein.");
        if (rooms.size >= MAX_ROOMS) return err("Der Server ist voll. Versuch es später nochmal.");
        const r = Object.assign({ code: newCode(), host: 0 }, g.newRoom(msg), {
          members: [{ name, secret: crypto.randomUUID(), avatar: avatarOf(msg.avatar), color: colorOf(msg.color) }], state: null, touched: Date.now()
        });
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
        const same = r.members.findIndex((m) => m.name.toLowerCase() === name.toLowerCase());
        if (same >= 0) {
          // same name: only allowed to take the seat back when that player is offline
          const m = r.members[same];
          if ((m.bot && !m.standIn) || online(r.code).has(same)) return err(`Der Name „${name}“ ist schon vergeben.`);
          attach(ws, r, same); broadcast(r); return;
        }
        if (r.members.length >= MAX_PLAYERS || (msg.watch && MAX_WATCHERS)) {
          if (!MAX_WATCHERS) return err(`Der Raum ist voll (${MAX_PLAYERS} Spieler).`);
          // full room (or asked to only watch): watch instead
          if (watchers(r.code).length >= MAX_WATCHERS) return err("Der Raum ist voll, auch zum Zuschauen.");
          ws.watchAvatar = avatarOf(msg.avatar); ws.watchColor = colorOf(msg.color);
          return watch(ws, r, name);
        }
        r.members.push({ name, secret: crypto.randomUUID(), avatar: avatarOf(msg.avatar), color: colorOf(msg.color), lobby: !!r.state });
        attach(ws, r, r.members.length - 1);
        broadcast(r); saveRooms();
        return;
      }
      case "resume": {
        const r = rooms.get(String(msg.code || ""));
        const pid = r && msg.secret ? r.members.findIndex((m) => m.secret === msg.secret) : -1;
        if (pid < 0) return send(ws, { t: "gone" });
        attach(ws, r, pid); broadcast(r);
        return;
      }
      case "sit": { // a spectator takes a free seat in the waiting room (also while a game runs)
        if (!room || ws.pid !== -1) return;
        if (room.members.length >= MAX_PLAYERS) return err(`Der Raum ist voll (${MAX_PLAYERS} Spieler).`);
        const name = ws.watchName;
        if (room.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) return err(`Der Name „${name}“ ist schon vergeben.`);
        room.members.push({ name, secret: crypto.randomUUID(), avatar: avatarOf(ws.watchAvatar), color: colorOf(ws.watchColor), lobby: !!room.state });
        attach(ws, room, room.members.length - 1);
        broadcast(room); saveRooms();
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
        if (!gameOver(room.state)) return;
        room.members[ws.pid].lobby = true; room.members[ws.pid].ready = false;
        room.rematch = (room.rematch || []).filter((i) => i !== ws.pid);
        room.touched = Date.now();
        if (!checkRematch(room)) { broadcast(room); saveRooms(); }
        return;
      }
      case "close": { // host closes the room for everyone
        if (!room || !isHost) return;
        closeRoom(room.code, "closed");
        return;
      }
      case "leave": {
        if (!room) return;
        const pid = ws.pid;
        if (pid === -1) { send(ws, { t: "left" }); detach(ws); return; }
        // mid-game seat: keep the member + secret and start a leave vote (bot vs wait)
        if (room.state && inGame(room, pid)) startLeaveVote(room, pid);
        else removeMember(room, pid);
        send(ws, { t: "left" });
        detach(ws);
        if (!room.members.some((m) => !m.bot)) { rooms.delete(room.code); clearTimers(room.code); }
        else if (!room.leaveVote || !maybeResolveLeaveVote(room)) broadcast(room);
        saveRooms();
        return;
      }
      case "leaveVote": {
        if (!room || !room.leaveVote || ws.pid == null || ws.pid < 0) return;
        const choice = msg.choice === "bot" || msg.choice === "wait" ? msg.choice : null;
        if (!choice || !eligibleLeaveVoters(room).includes(ws.pid)) return;
        room.leaveVote.votes[ws.pid] = choice; // idempotent update
        room.touched = Date.now();
        if (!maybeResolveLeaveVote(room)) { broadcast(room); saveRooms(); }
        return;
      }
      case "bot": case "addBot": { // host adds a computer player in the waiting room
        if (!room || !isHost || room.state) return;
        if (room.members.length >= MAX_PLAYERS) return err(`Mehr als ${MAX_PLAYERS} Spieler gehen nicht.`);
        const taken = new Set(room.members.map((m) => m.name));
        const name = Game.BOT_NAMES.find((n) => !taken.has(n)) || `Computer ${room.members.length + 1}`;
        room.members.push({ name, bot: true, secret: null, avatar: BOT_AVATAR });
        broadcast(room); saveRooms();
        return;
      }
      case "unbot": case "removeBot": {
        const i = +(msg.i != null ? msg.i : msg.seat);
        if (!room || !isHost || room.state || !room.members[i] || !room.members[i].bot) return;
        removeMember(room, i);
        broadcast(room); saveRooms();
        return;
      }
      case "standIn": { // host lets the computer play for someone who dropped out (manual override when no vote / after "wait")
        const i = +msg.seat;
        if (!room || !isHost || !room.state || !room.members[i] || room.members[i].bot || !room.state.players[i]) return;
        if (room.leaveVote && room.leaveVote.seat === i) return err("Die anderen stimmen gerade ab.");
        if (online(room.code).has(i)) return err(`${room.members[i].name} ist noch online.`);
        installStandIn(room, i);
        broadcast(room); saveRooms();
        return;
      }
      case "avatar": { // change your own avatar, only in the waiting room
        if (!room || room.state || ws.pid == null || ws.pid < 0) return;
        const m = room.members[ws.pid];
        if (Game.AVATARS.includes(msg.avatar)) m.avatar = msg.avatar;
        if (msg.color !== undefined) m.color = colorOf(msg.color);
        broadcast(room); saveRooms();
        return;
      }
      case "settings": { // host changes what was picked when creating the room, in the waiting room
        if (!room || !isHost || room.state || !g.settings) return;
        g.settings(room, msg);
        broadcast(room); saveRooms();
        return;
      }
      case "start": {
        if (!room) return;
        if (!isHost) return err("Nur wer den Raum erstellt hat, kann starten.");
        if (room.state) return;
        const e = startWith(room, readyPlayers(room, true));
        if (e) err(e);
        return;
      }
      case "act": {
        if (!room || !room.state) return;
        const a = msg.a || {};
        if (ws.pid == null || !inGame(room, ws.pid)) return err("Du bist gerade nicht im Spiel.");
        if (a.t === "next" && gameOver(room.state)) { // rematch: a vote
          room.rematch = (room.rematch || []).filter((i) => i !== ws.pid).concat(ws.pid);
          room.touched = Date.now();
          if (!checkRematch(room)) { broadcast(room); saveRooms(); }
          return;
        }
        if (a.t === "skip" && !isHost) return err("Nur der Host kann Spieler überspringen.");
        if (a.t === "timeout") return; // only the server's clock may do that
        const res = apply(room, ws.pid, a);
        if (!res.ok) err(res.error);
        return;
      }
      case "chat": { // a chat line for everyone in the room, watchers too; the last CHAT_KEEP stay while the room lives
        if (!room || ws.pid == null) return;
        const text = String(msg.text || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, CHAT_MAX);
        if (!text) return;
        const now = Date.now();
        if (now - (ws.lastChat || 0) < 1000) return err("Nicht so schnell, eine Nachricht pro Sekunde.");
        ws.lastChat = now;
        const me = ws.pid >= 0 ? room.members[ws.pid] : null;
        const line = { id: (room.chatSeq = (room.chatSeq || 0) + 1), at: now, pi: ws.pid, name: me ? me.name : ws.watchName, avatar: me ? avatarOf(me.avatar) : avatarOf(ws.watchAvatar), color: me ? colorOf(me.color) : colorOf(ws.watchColor), text };
        room.chat = (room.chat || []).concat(line).slice(-CHAT_KEEP);
        room.touched = now;
        for (const s of sockets.get(room.code) || []) if (s.pid != null) send(s, { t: "chat", line });
        saveRooms();
        return;
      }
      case "react": { // emoji for everyone at the table, at most one per second
        if (!room || !g.reactions.includes(msg.e)) return;
        const now = Date.now();
        if (now - (ws.lastReact || 0) < 1000) return;
        ws.lastReact = now;
        for (const s of sockets.get(room.code) || []) if (s.pid != null) send(s, { t: "react", pi: ws.pid, e: msg.e, name: ws.pid === -1 ? ws.watchName : undefined });
        return;
      }
      case "end": { // host ends the game and returns everyone to the waiting room
        if (!room || !isHost) return;
        toLobby(room);
        broadcast(room); saveRooms();
        return;
      }
      default: { // game-specific messages
        const h = g.handlers && Object.prototype.hasOwnProperty.call(g.handlers, msg.t) && g.handlers[msg.t];
        if (!h || !room) return;
        if (h(room, msg, Object.assign({ ws, isHost, err }, ctx)) !== false) { broadcast(room); saveRooms(); }
      }
    }
  }

  // ---------- waiting room: ready up, sit out, rematch ----------
  // While a game runs, room.members[0..n) are its players (member index = seat, n =
  // state.players.length). Everyone behind them, and anyone marked .lobby, is in the
  // waiting room and may watch. Waiting-room members mark themselves .ready for the next game.
  const inGame = (room, i) => !!room.state && i >= 0 && i < room.state.players.length && !room.members[i].lobby;
  const gameOver = (S) => S.phase === "roundEnd" && !!S.last && !!S.last.over;

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
    room.state = g.newGame(room, room.members.slice(0, play.length));
    room.touched = Date.now();
    bump(room);
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
    clearLeaveVote(room);
    room.members.forEach((m) => { m.lobby = false; m.ready = false; });
    schedule(room);
  }
  // after a game: the rematch starts once everyone still at the table (and online) has voted,
  // with them, the computers and whoever got ready in the waiting room; if no one is left at
  // the table, everybody goes back to the waiting room. Returns true if it acted.
  function checkRematch(room) {
    const S = room.state;
    if (!S || !gameOver(S)) return false;
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
    clearTimers(code);
    sockets.delete(code);
    rooms.delete(code); saveRooms();
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
  // The shared base (kit.css/.js) and waiting room + menu (room-ui.css/.js) are served next to the game's files.
  const SHARED = { "/avatars.js": path.join(__dirname, "avatars.js"), "/profile.js": path.join(__dirname, "profile.js"), "/kit.css": path.join(__dirname, "kit.css"), "/kit.js": path.join(__dirname, "kit.js"), "/room-ui.js": path.join(__dirname, "room-ui.js"), "/room-ui.css": path.join(__dirname, "room-ui.css"), "/home-ui.js": path.join(__dirname, "home-ui.js") };
  const SCRIPTS = ["/kit.css", "/room-ui.css", "/avatars.js", "/profile.js", "/kit.js", "/room-ui.js", "/home-ui.js", "/game.js", "/app.js"];
  const fileOf = (p) => SHARED[p] || path.join(PUBLIC, p);
  const hash = crypto.createHash("sha1");
  for (const p of SCRIPTS) hash.update(fs.readFileSync(fileOf(p)));
  const VERSION = hash.digest("hex").slice(0, 10);
  const INDEX = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8")
    .replace('<link rel="stylesheet" href="kit.css">', `<link rel="stylesheet" href="kit.css?v=${VERSION}">`)
    .replace('<script src="avatars.js"></script>', `<script src="avatars.js?v=${VERSION}"></script>`)
    .replace('<script src="profile.js"></script>', `<script src="profile.js?v=${VERSION}"></script>`)
    .replace('<script src="kit.js"></script>', `<script src="kit.js?v=${VERSION}"></script>`)
    .replace('<link rel="stylesheet" href="room-ui.css">', `<link rel="stylesheet" href="room-ui.css?v=${VERSION}">`)
    .replace('<script src="room-ui.js"></script>', `<script src="room-ui.js?v=${VERSION}"></script>`)
    .replace('<script src="home-ui.js"></script>', `<script src="home-ui.js?v=${VERSION}"></script>`)
    .replace('<script src="game.js"></script>', `<script src="game.js?v=${VERSION}"></script>`)
    .replace('<script src="app.js"></script>', `<script src="app.js?v=${VERSION}"></script>`)
    .replace("<head>", `<head>\n<meta name="${g.metaName || g.id + "-version"}" content="${VERSION}">`);

  // text goes out gzipped when the browser accepts it (the compressed copy is kept until the file changes)
  const gzCache = new Map();
  const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json)|image\/svg)/;
  function reply(req, res, code, headers, data, key) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buf.length > 1024 && COMPRESSIBLE.test(headers["content-type"] || "") && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
      let c = gzCache.get(key);
      if (!c || !c.raw.equals(buf)) { c = { raw: buf, gz: zlib.gzipSync(buf, { level: 9 }) }; gzCache.set(key, c); }
      res.writeHead(code, Object.assign({}, headers, { "content-encoding": "gzip", vary: "accept-encoding" }));
      return res.end(c.gz);
    }
    res.writeHead(code, headers);
    res.end(buf);
  }

  const server = http.createServer((req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "same-origin");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/info" || url.pathname === (g.legacyPath || `/${g.id}-server`)) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ [g.id]: true, version: VERSION, ips: lanIps(), port: PORT, rooms: rooms.size }));
    }
    if (url.pathname === "/party-room") { // only for the start page's party server, which knows PARTY_SECRET
      const reply = (code, obj) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
      if (req.method !== "POST") return reply(405, { error: "POST" });
      if (!PARTY_SECRET) return reply(503, { error: "Party-Räume sind hier nicht eingerichtet." });
      if (!sameSecret(req.headers["x-party-secret"])) return reply(403, { error: "Nicht erlaubt." });
      let raw = "";
      req.on("data", (c) => { raw += c; if (raw.length > 16384) req.destroy(); });
      req.on("end", () => {
        let body;
        try { body = JSON.parse(raw); } catch (e) { return reply(400, { error: "Kein JSON." }); }
        const out = partyRoom(body || {});
        reply(out.error ? 400 : 200, out);
      });
      return;
    }
    const p0 = url.pathname;
    if (url.pathname === "/vendor/qrcode.js") {
      return fs.readFile(QR_LIB, (e, data) => {
        if (e) { res.writeHead(404); return res.end(); }
        reply(req, res, 200, { "content-type": TYPES[".js"], "cache-control": "public, max-age=86400" }, data, p0);
      });
    }
    let p;
    try { p = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
    if (p === "/" || p === "/index.html") {
      return reply(req, res, 200, { "content-type": TYPES[".html"], "cache-control": "no-store" }, INDEX, "/");
    }
    const file = SHARED[p] || path.normalize(path.join(PUBLIC, p));
    if (!SHARED[p] && !file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (e, data) => {
      if (e) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("Nicht gefunden"); }
      const ext = path.extname(file);
      const versioned = url.searchParams.get("v") === VERSION && SCRIPTS.includes(p);
      reply(req, res, 200, {
        "content-type": TYPES[ext] || "application/octet-stream",
        "cache-control": versioned ? "public, max-age=31536000, immutable"
          : ext === ".png" || ext === ".svg" ? "public, max-age=86400" : "no-store"
      }, data, file);
    });
  });

  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 8192 });
  // one connection may send a burst, then RATE_PER_S messages a second; more is dropped, a flood is cut off
  const RATE_BURST = 40, RATE_PER_S = +process.env.RATE_PER_S || 15, FLOOD_CUT = 400;
  wss.on("connection", (ws) => {
    ws.alive = true; ws.tokens = RATE_BURST; ws.tokenAt = Date.now(); ws.dropped = 0; ws.warnAt = 0;
    ws.on("pong", () => { ws.alive = true; });
    ws.on("message", (raw) => {
      const now = Date.now();
      ws.tokens = Math.min(RATE_BURST, ws.tokens + ((now - ws.tokenAt) * RATE_PER_S) / 1000); ws.tokenAt = now;
      if (ws.tokens < 1) {
        if (++ws.dropped > FLOOD_CUT) return ws.terminate();
        if (now - ws.warnAt > 2000) { ws.warnAt = now; send(ws, { t: "error", msg: "Zu viele Nachrichten, bitte etwas langsamer." }); }
        return;
      }
      ws.tokens--; ws.dropped = 0;
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      if (msg && typeof msg.t === "string") {
        try { handle(ws, msg); } catch (e) { console.error(e); send(ws, { t: "error", msg: "Serverfehler." }); }
      }
    });
    ws.on("close", () => detach(ws));
  });

  // keep connections alive through phones' sleep and home routers; drop dead ones;
  // close rooms nobody has done anything in for IDLE_TTL
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

  loadRooms();
  // docker stop sends SIGTERM: write the rooms now (the save is debounced) and let the clients
  // reconnect to the new container instead of waiting for the kill after ten seconds
  let closing = false;
  function shutdown(sig) {
    if (closing) return;
    closing = true;
    console.log(`${sig}: speichere ${rooms.size} Räume und beende mich`);
    saveNow();
    for (const ws of wss.clients) ws.close(1001, "restart");
    server.close();
    setTimeout(() => process.exit(0), 300).unref();
  }
  if (!process.env.NO_SIGNAL_HANDLERS) for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, () => shutdown(sig));
  server.listen(PORT, HOST, () => {
    console.log(`${g.title} läuft auf Port ${PORT} (Version ${VERSION})`);
    for (const ip of lanIps()) console.log(`  im WLAN öffnen: http://${ip}:${PORT}`);
  });

  return { server, wss, rooms, saveNow };
};
