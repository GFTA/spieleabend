"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "explodingkittens-"));
const { server, wss, rooms } = require("../server.js");
const Game = require("../public/game.js");
test.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let waiter = null;
  ws.on("message", (d) => { inbox.push(JSON.parse(d)); if (waiter) waiter(); });
  const next = (pred, ms = 3000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout")), ms);
    const check = () => {
      const i = inbox.findIndex(pred);
      if (i >= 0) { clearTimeout(t); waiter = null; res(inbox.splice(0, i + 1).pop()); }
    };
    waiter = check; check();
  });
  const flush = () => { inbox.length = 0; };
  return { ws, next, flush, send: (m) => ws.send(JSON.stringify(m)), open: new Promise((r) => ws.on("open", r)) };
}

// one human decision: draw on your turn, give any card for a favor, hide a kitten on top
const move = (v, me) => {
  if (v.phase === "play" && v.cur === me) return { t: "draw" };
  if (v.phase === "give" && v.give.from === me) return { t: "give", c: v.hand[0] };
  if (v.phase === "place" && v.place.pi === me) return { t: "place", pos: 0 };
  return null;
};

test("rooms, ready-up, a full game with a Nö window, a spectator and a computer opponent over WebSockets", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;

  const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
  assert.strictEqual(info["explodingkittens"], true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Exploding Kittens/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);

  const a = client(port), b = client(port);
  await a.open; await b.open;
  a.send({ t: "create", name: "Anna", goal: 1, level: 3, avatar: "🐙" });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code.toLowerCase(), name: "Ben", avatar: "🦖" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.members[0].avatar, "🐙");
  assert.strictEqual(lobby.level, 3);

  a.send({ t: "settings", goal: 2 });
  await a.next((m) => m.t === "room" && m.goal === 2);
  a.send({ t: "settings", goal: 1, level: 99 });
  await a.next((m) => m.t === "room" && m.goal === 1 && m.level === 2);
  b.send({ t: "ready", on: true });
  await a.next((m) => m.t === "room" && m.members[1].ready);
  a.send({ t: "start" });
  let v = (await a.next((m) => m.t === "room" && m.view)).view;
  assert.strictEqual(v.hand.length, 8);
  assert.strictEqual(v.players[1].handN, 8);

  // the server resolves a played card after the Nö window ran out, and tells everybody
  const room = rooms.get(joined.code), seat = [a, b];
  const who = v.cur;
  room.state.players[who].hand.push("shuffle");
  seat[who].send({ t: "act", a: { t: "play", c: "shuffle" } });
  const stacked = await seat[1 - who].next((m) => m.t === "room" && m.view && m.view.phase === "stack");
  assert.strictEqual(stacked.view.stack.c, "shuffle");
  assert.strictEqual(stacked.view.hand.length, 8);
  const resolved = await seat[1 - who].next((m) => m.t === "room" && m.view && m.view.phase === "play", 4000);
  assert.ok(resolved.events.some((e) => e.t === "shuffle"));
  assert.strictEqual(resolved.view.cur, who);

  // both just draw until somebody blows up
  let guard = 0;
  while (v.phase !== "roundEnd" && guard++ < 400) {
    await new Promise((r) => setTimeout(r, 10)); a.flush(); b.flush();
    v = room.state ? Game.view(room.state, 0) : v;
    const mv = v.mv;
    const mine = [0, 1].find((i) => move(Game.view(room.state, i), i));
    if (mine == null) break;
    seat[mine].send({ t: "act", a: move(Game.view(room.state, mine), mine) });
    const got = await seat[mine].next((m) => m.t === "error" || (m.t === "room" && m.view && m.view.mv !== mv));
    assert.ok(got.view, got.msg);
    v = got.view;
  }
  assert.strictEqual(v.phase, "roundEnd");
  assert.strictEqual(v.last.over, true);
  assert.ok(v.players[v.last.winners[0]].wins >= 1);

  b.send({ t: "act", a: { t: "draw" } }); // nobody is on turn any more
  assert.match((await b.next((m) => m.t === "error")).msg, /vorbei/);

  // back to the waiting room, Ben leaves, the computer joins and plays on its own
  a.send({ t: "end" });
  await a.next((m) => m.t === "room" && !m.view);
  b.send({ t: "leave" });
  await b.next((m) => m.t === "left");
  await a.next((m) => m.t === "room" && m.members.length === 1);
  a.send({ t: "bot" });
  const withBot = await a.next((m) => m.t === "room" && m.members.length === 2 && m.members[1].bot);
  assert.strictEqual(withBot.members[1].name, Game.BOT_NAMES[0]);
  a.send({ t: "settings", level: 1 });
  a.send({ t: "start" });
  v = (await a.next((m) => m.t === "room" && m.view)).view;
  guard = 0;
  while (v.phase !== "roundEnd" && guard++ < 400) {
    const cur = Game.view(room.state, 0), m0 = move(cur, 0);
    if (!m0) { v = (await a.next((m) => m.t === "room" && m.view && (move(m.view, 0) || m.view.phase === "roundEnd"), 8000)).view; continue; }
    a.send({ t: "act", a: m0 });
    v = (await a.next((m) => m.t === "room" && m.view && m.view.mv !== cur.mv, 8000)).view;
  }
  assert.strictEqual(v.phase, "roundEnd");
  assert.ok(rooms.get(joined.code));
  a.ws.close(); b.ws.close();
});
