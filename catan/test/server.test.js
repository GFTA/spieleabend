"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "catan-"));
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

test("rooms, ready-up, a full game, a spectator and a computer opponent over WebSockets", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;

  const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
  assert.strictEqual(info["catan"], true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Catan/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);

  const a = client(port), b = client(port);
  await a.open; await b.open;
  a.send({ t: "create", name: "Anna", goal: 1, target: 8, level: 3, avatar: "🐙" });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code.toLowerCase(), name: "Ben", avatar: "🦖" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.members[0].avatar, "🐙");
  assert.strictEqual(lobby.target, 8);
  assert.strictEqual(lobby.level, 3);

  a.send({ t: "settings", target: 12 });
  await a.next((m) => m.t === "room" && m.target === 12);
  a.send({ t: "settings", target: 99 }); // nonsense falls back to the default
  await a.next((m) => m.t === "room" && m.target === 10);
  a.send({ t: "settings", target: 8 });
  b.send({ t: "ready", on: true });
  await a.next((m) => m.t === "room" && m.members[1].ready);
  a.send({ t: "start" });
  let v = (await a.next((m) => m.t === "room" && m.view)).view;
  assert.strictEqual(v.target, 8);
  assert.strictEqual(v.step, "settle");
  assert.strictEqual(v.hexes.length, 19);
  assert.strictEqual(v.hand && Object.values(v.hand).reduce((x, y) => x + y, 0), 0);

  const room = rooms.get(joined.code);
  const seat = [a, b];
  const play = async (pi, act) => {
    await new Promise((r) => setTimeout(r, 5)); a.flush(); b.flush();
    const seq = room.state.seq;
    seat[pi].send({ t: "act", a: act });
    const got = await seat[pi].next((m) => m.t === "error" || (m.t === "room" && m.view && m.view.step !== undefined));
    assert.ok(got.view, got.msg);
    assert.ok(room.state.seq > seq);
    return got.view;
  };

  // a hostile client: not your turn, nonsense, a hand the server never sent
  b.send({ t: "act", a: { t: "roll" } });
  assert.ok((await b.next((m) => m.t === "error")).msg);
  a.send({ t: "act", a: { t: "build", k: "constructor", id: "__proto__" } });
  assert.ok((await a.next((m) => m.t === "error")).msg);

  // both set up (the host plays the computer's choices for the people), then the first turn
  let guard = 0;
  while (room.state.step === "settle" || room.state.step === "sroad") {
    v = await play(room.state.cur, Game.botMove(room.state, room.state.cur));
    assert.ok(guard++ < 20);
  }
  assert.strictEqual(room.state.step, "roll");
  const first = room.state.cur;
  v = await play(first, { t: "roll" });
  for (let i = 0; i < 2; i++) assert.ok(v.players.every((p) => typeof p.n === "number"), "others only show card counts");
  const other = 1 - first;
  const ov = Game.view(room.state, other);
  assert.ok(ov.hand, "own hand is sent");
  assert.ok(!("hand" in v.players[other]));

  // finish quickly: the person on turn holds enough victory cards and builds a road
  const S = room.state;
  while (S.step !== "main") { // a seven: discard, then the robber
    const who = Game.actors(S)[0], m = Game.botMove(S, who);
    v = await play(who, m);
  }
  const me = S.cur;
  S.players[me].devs.push(...Array.from({ length: 8 }, () => ({ k: "vp", t: -1 })));
  Object.assign(S.players[me].hand, { wood: 1, brick: 1 });
  v = await play(me, { t: "build", k: "road", id: Game.spots(S, me, "road")[0] });
  assert.strictEqual(v.phase, "roundEnd");
  assert.strictEqual(v.last.over, true);
  assert.ok(v.players[me].wins >= 1);
  assert.strictEqual(v.players[me].vpCards, 8, "victory cards are shown at the end");

  b.send({ t: "act", a: { t: "roll" } }); // nobody is on turn any more
  assert.match((await b.next((m) => m.t === "error")).msg, /niemand/);

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
  const R = rooms.get(joined.code).state;
  // Anna's moves are played for her; the computer answers by itself after BOT_MS
  guard = 0;
  while (R.phase === "play" && R.step !== "main" || (R.phase === "play" && R.turn < 3)) {
    assert.ok(guard++ < 300, "stuck in " + R.step);
    const who = Game.actors(R).find((i) => !R.players[i].bot);
    if (who == null) { await new Promise((r) => setTimeout(r, 30)); continue; }
    a.flush();
    a.send({ t: "act", a: R.step === "main" ? { t: "end" } : Game.botMove(R, who) });
    await a.next((m) => m.t === "room" && m.view || m.t === "error");
  }
  assert.ok(R.turn >= 3, "the computer took its turns on its own");
  assert.ok(R.players[1].bot && R.edge.some((e) => e === 1), "the computer built roads");
  a.ws.close(); b.ws.close();
});
