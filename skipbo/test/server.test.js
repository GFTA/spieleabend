"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "skipbo-"));
const { server, wss, rooms } = require("../server.js");
const Game = require("../public/game.js");
test.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let waiter = null;
  ws.on("message", (d) => { inbox.push(JSON.parse(d)); if (waiter) waiter(); });
  const next = (pred, ms = 3000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout waiting for " + pred)), ms);
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
  assert.strictEqual(info["skipbo"], true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Skip-Bo/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);

  const a = client(port), b = client(port), c = client(port);
  await a.open; await b.open; await c.open;
  a.send({ t: "create", name: "Anna", goal: 2, stock: 10, level: 1, avatar: "🐙" });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code.toLowerCase(), name: "Ben", avatar: "🦖" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.members[0].avatar, "🐙");
  assert.strictEqual(lobby.goal, 2);
  assert.strictEqual(lobby.stock, 10);
  assert.strictEqual(lobby.level, 1);

  a.send({ t: "settings", stock: 20, goal: 1, level: 3 });
  await a.next((m) => m.t === "room" && m.stock === 20 && m.goal === 1 && m.level === 3);
  a.send({ t: "settings", stock: "constructor", goal: "x", level: 77 });
  await a.next((m) => m.t === "room" && m.stock === 0 && m.goal === 1 && m.level === 2);
  a.send({ t: "settings", stock: 10, goal: 2 });
  await a.next((m) => m.t === "room" && m.stock === 10 && m.goal === 2);
  b.send({ t: "ready", on: true });
  await a.next((m) => m.t === "room" && m.members[1].ready);
  a.send({ t: "start" });
  let v = (await a.next((m) => m.t === "room" && m.view)).view;
  assert.strictEqual(v.players[0].stockN, 10);
  assert.strictEqual(v.me, 0);
  assert.ok(Array.isArray(v.hand));
  const vb = (await b.next((m) => m.t === "room" && m.view)).view;
  assert.strictEqual(vb.me, 1);
  c.send({ t: "join", code: joined.code, name: "Chris", avatar: "🦉", watch: true }); // Chris only watches
  assert.strictEqual((await c.next((m) => m.t === "watching")).name, "Chris");
  const wv = (await c.next((m) => m.t === "room" && m.view)).view;
  assert.strictEqual(wv.me, -1);
  assert.strictEqual(wv.hand, null);

  // the one on turn discards, everybody sees it, the others' hands never travel
  const seat = [a, b];
  const first = seat[v.cur], second = seat[1 - v.cur];
  assert.ok(first && second);
  const fv = first === a ? v : vb;
  assert.strictEqual(fv.hand.length, 5);
  second.send({ t: "act", a: { t: "discard", c: 1, to: 0 } });
  assert.match((await second.next((m) => m.t === "error")).msg, /ist dran/);
  first.send({ t: "act", a: { t: "discard", c: 13, to: 0 } });
  assert.ok((await first.next((m) => m.t === "error")).msg);
  first.send({ t: "act", a: { t: "discard", c: fv.hand[0], to: 1 } });
  const after = await second.next((m) => m.t === "room" && m.view && m.view.turn > v.turn);
  assert.strictEqual(after.view.cur, 1 - v.cur);
  assert.strictEqual(after.view.players[v.cur].disc[1].length, 1);
  assert.strictEqual(after.view.hand.length, 5);
  assert.deepStrictEqual(after.events.map((e) => e.t), ["discard", "draw"]);
  assert.ok(!JSON.stringify(after.events).includes('"hand"'));

  // only the host may skip somebody
  b.send({ t: "act", a: { t: "skip" } });
  assert.match((await b.next((m) => m.t === "error")).msg, /Host/);

  // somebody gives up: round over, the other one wins, then a new round and the waiting room
  second.send({ t: "act", a: { t: "giveup" } });
  v = (await a.next((m) => m.t === "room" && m.view && m.view.phase === "roundEnd")).view;
  assert.strictEqual(v.last.how, "giveup");
  assert.strictEqual(v.players[v.last.winners[0]].wins, 1);
  a.send({ t: "act", a: { t: "next" } });
  v = (await a.next((m) => m.t === "room" && m.view && m.view.phase === "play" && m.view.round === 2)).view;
  assert.strictEqual(v.players[0].stockN, 10);

  a.send({ t: "end" });
  await a.next((m) => m.t === "room" && !m.view);
  b.send({ t: "leave" });
  await b.next((m) => m.t === "left");
  c.send({ t: "leave" });
  await c.next((m) => m.t === "left");
  await a.next((m) => m.t === "room" && m.members.length === 1 && m.watchers.length === 0);
  a.send({ t: "bot" });
  const withBot = await a.next((m) => m.t === "room" && m.members.length === 2 && m.members[1].bot);
  assert.strictEqual(withBot.members[1].name, Game.BOT_NAMES[0]);
  a.send({ t: "settings", level: 3 });
  a.send({ t: "start" });
  v = (await a.next((m) => m.t === "room" && m.view)).view;

  // I discard whenever it is my turn, the computer answers by itself on the server's pacing
  let guard = 0, botMoves = 0;
  while (v.phase === "play" && guard++ < 12) {
    if (v.cur === 1) {
      const mv = v.mv;
      v = (await a.next((m) => m.t === "room" && m.view && (m.view.cur === 0 || m.view.phase !== "play"))).view;
      if (v.mv > mv) botMoves++;
      continue;
    }
    const hand = v.hand;
    a.send({ t: "act", a: { t: "discard", c: hand[0], to: guard % 4 } });
    v = (await a.next((m) => m.t === "room" && m.view && (m.view.cur !== 0 || m.view.phase !== "play"))).view;
  }
  assert.ok(botMoves >= 3, "the computer played its turns");
  assert.ok(rooms.get(joined.code));
  a.ws.close(); b.ws.close(); c.ws.close();
});
