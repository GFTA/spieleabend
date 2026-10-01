"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dame-"));
const { server, wss, rooms } = require("../server.js");
const Game = require("../public/game.js");
test.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let waiter = null;
  ws.on("message", (d) => { inbox.push(JSON.parse(d)); if (waiter) waiter(); });
  const next = (pred, ms = 3000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout waiting for " + pred + "\ninbox: " + JSON.stringify(inbox).slice(0, 400))), ms);
    const check = () => {
      const i = inbox.findIndex(pred);
      if (i >= 0) { clearTimeout(t); waiter = null; res(inbox.splice(0, i + 1).pop()); }
    };
    waiter = check; check();
  });
  const flush = () => { inbox.length = 0; };
  return { ws, next, flush, send: (m) => ws.send(JSON.stringify(m)), open: new Promise((r) => ws.on("open", r)) };
}

test("rooms, settings, spectators, moves, a rematch and a computer opponent over WebSockets", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;

  const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
  assert.strictEqual(info["dame"], true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Dame/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);

  const a = client(port), b = client(port), c = client(port);
  await a.open; await b.open; await c.open;
  a.send({ t: "create", name: "Anna", goal: 2, rules: { free: true, bogus: true }, avatar: "🐙" });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code.toLowerCase(), name: "Ben", avatar: "🦖" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.members[0].avatar, "🐙");
  assert.deepStrictEqual(lobby.rules, { free: true, clock: false });
  assert.strictEqual(lobby.goal, 2);

  c.send({ t: "join", code: joined.code, name: "Chris", avatar: "🦉" });
  assert.strictEqual((await c.next((m) => m.t === "watching")).name, "Chris");

  a.send({ t: "settings", rules: { clock: true }, goal: 1, level: 3 });
  await a.next((m) => m.t === "room" && m.goal === 1 && m.level === 3 && m.rules.clock && !m.rules.free);
  a.send({ t: "settings", rules: { free: false }, level: 2 });
  await a.next((m) => m.t === "room" && m.level === 2 && !m.rules.clock);
  b.send({ t: "ready", on: true });
  await a.next((m) => m.t === "room" && m.members[1].ready);
  a.send({ t: "start" });
  let v = (await a.next((m) => m.t === "room" && m.view)).view;
  assert.strictEqual(v.legal.length, 7);
  assert.strictEqual((await c.next((m) => m.t === "room" && m.view)).view.me, -1);

  // a move that is not legal is refused, a legal one is played for everybody
  const seat = [a, b];
  const first = seat[v.cur];
  first.send({ t: "act", a: { t: "move", path: [0, 63] } });
  assert.match((await first.next((m) => m.t === "error")).msg, /nicht erlaubt/);
  seat[1 - v.cur].send({ t: "act", a: { t: "move", path: v.legal[0].path } });
  assert.match((await seat[1 - v.cur].next((m) => m.t === "error")).msg, /ist dran/);
  first.send({ t: "act", a: { t: "move", path: v.legal[0].path } });
  const after = (await first.next((m) => m.t === "room" && m.view && m.view.turn > v.turn)).view;
  assert.strictEqual(after.lastMove.pi, v.cur);
  assert.strictEqual(after.cur, 1 - v.cur);
  assert.deepStrictEqual(after.lastMove.path, v.legal[0].path);

  // the one on turn gives up: round over, the colours swap in the rematch
  const other = seat[after.cur];
  other.send({ t: "act", a: { t: "giveup" } });
  v = (await a.next((m) => m.t === "room" && m.view && m.view.phase === "roundEnd")).view;
  assert.strictEqual(v.last.why, "giveup");
  assert.strictEqual(v.last.winners[0], 1 - after.cur);
  a.send({ t: "act", a: { t: "next" } });
  b.send({ t: "act", a: { t: "next" } });
  const again = (await a.next((m) => m.t === "room" && m.view && m.view.phase === "play" && m.view.round >= 1)).view;
  assert.strictEqual(again.col[again.cur], 0);

  // back to the waiting room, then the computer takes Ben's seat
  a.send({ t: "end" });
  await a.next((m) => m.t === "room" && !m.view);
  b.send({ t: "leave" });
  await b.next((m) => m.t === "left");
  c.send({ t: "leave" });
  await c.next((m) => m.t === "left");
  await a.next((m) => m.t === "room" && m.members.length === 1 && m.watchers.length === 0);
  a.send({ t: "bot" });
  await a.next((m) => m.t === "room" && m.members.length === 2 && m.members[1].bot);
  a.send({ t: "settings", level: 1 });
  a.send({ t: "start" });
  v = (await a.next((m) => m.t === "room" && m.view)).view;
  // Anna plays the first legal move each time, the computer answers on its own, until she has had enough
  for (let k = 0; k < 6 && v.phase === "play"; k++) {
    if (v.cur === 1) { v = (await a.next((m) => m.t === "room" && m.view && (m.view.cur === 0 || m.view.phase !== "play"))).view; continue; }
    const turn = v.turn;
    a.send({ t: "act", a: { t: "move", path: v.legal[0].path } });
    v = (await a.next((m) => m.t === "room" && m.view && (m.view.turn > turn || m.view.phase !== "play"))).view;
  }
  assert.ok(v.players[0].moves >= 1 && Game.QUIET_PLIES > 0);
  a.send({ t: "act", a: { t: "giveup" } });
  v = (await a.next((m) => m.t === "room" && m.view && m.view.phase === "roundEnd")).view;
  assert.strictEqual(v.last.winners[0], 1);
  assert.ok(rooms.get(joined.code));
  a.ws.close(); b.ws.close(); c.ws.close();
});
