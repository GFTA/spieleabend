"use strict";
// Phase 10 online: settings, hands stay private, a turn over the wire, the computer takes over a seat.
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "phase10-"));
const { server, wss, rooms } = require("../server.js");
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
  return { ws, next, send: (m) => ws.send(JSON.stringify(m)), open: new Promise((r) => ws.on("open", r)) };
}

test("two players: private hands, draw and discard over the wire, a computer takes over a leaver", async () => {
  await new Promise((r) => (server.listening ? r() : server.once("listening", r)));
  const port = server.address().port;
  const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
  assert.strictEqual(info.phase10, true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Phase 10/);

  const anna = client(port), ben = client(port);
  await Promise.all([anna.open, ben.open]);
  anna.send({ t: "create", name: "Anna", goal: 5, rules: { skipChoose: true } });
  const { code } = await anna.next((m) => m.t === "joined");
  const lobby = await anna.next((m) => m.t === "room");
  assert.strictEqual(lobby.goal, 5);
  assert.ok(lobby.rules.skipChoose);
  anna.send({ t: "settings", goal: 7 });
  assert.strictEqual((await anna.next((m) => m.t === "room" && m.goal !== 5)).goal, 10, "unknown lengths fall back to all 10 phases");

  ben.send({ t: "join", code, name: "Ben" });
  await ben.next((m) => m.t === "joined");
  ben.send({ t: "ready", on: true });
  await anna.next((m) => m.t === "room" && m.members.length === 2 && m.members[1].ready);
  anna.send({ t: "start" });
  const a = await anna.next((m) => m.t === "room" && m.view);
  const b = await ben.next((m) => m.t === "room" && m.view);
  assert.strictEqual(a.view.hand.length, 10);
  assert.strictEqual(b.view.hand.length, 10);
  const annaIds = new Set(a.view.hand.map((c) => c.id));
  assert.ok(!b.view.hand.some((c) => annaIds.has(c.id)), "Ben can't see Anna's cards");
  assert.ok(!JSON.stringify(b).includes(`"id":${a.view.hand[0].id},`), "not anywhere in Ben's message");
  assert.deepStrictEqual(b.view.players.map((p) => p.count), [10, 10]);

  // whoever is on draws and throws their first card
  const cur = a.view.cur, P = cur === a.view.me ? anna : ben, first = cur === a.view.me ? a : b;
  const Other = P === anna ? ben : anna;
  Other.send({ t: "act", a: { t: "draw", from: "deck" } });
  assert.match((await Other.next((m) => m.t === "error")).msg, /ist dran/);
  P.send({ t: "act", a: { t: "draw", from: "deck" } });
  const drawn = await P.next((m) => m.t === "room" && m.view && m.view.step === "act");
  assert.strictEqual(drawn.view.hand.length, 11);
  assert.ok(drawn.events.some((e) => e.t === "draw"));
  const card = drawn.view.hand.find((c) => c.c !== "s") || drawn.view.hand[0];
  P.send({ t: "act", a: { t: "discard", id: card.id } });
  const after = await Other.next((m) => m.t === "room" && m.view && m.view.top && m.view.top.id === card.id);
  assert.strictEqual(after.view.players[first.view.cur].count, 10, "drew one, threw one");
  assert.notStrictEqual(after.view.cur, first.view.cur, "the turn moved on");

  // Ben leaves mid-game: leave vote → Anna votes bot → standIn takes over
  ben.send({ t: "leave" });
  await ben.next((m) => m.t === "left");
  await anna.next((m) => m.t === "room" && m.leaveVote && m.leaveVote.seat === 1);
  anna.send({ t: "leaveVote", choice: "bot" });
  await anna.next((m) => m.t === "room" && m.members[1].bot && !m.leaveVote);
  const room = rooms.get(code);
  assert.ok(room.members[1].bot && room.state.players[1].bot);
  assert.strictEqual(room.members[1].standIn, true);
});

test("with a computer player the game moves on by itself", async () => {
  const port = server.address().port;
  const c = client(port); await c.open;
  c.send({ t: "create", name: "Cleo" });
  await c.next((m) => m.t === "room");
  c.send({ t: "bot" });
  await c.next((m) => m.t === "room" && m.members.length === 2);
  c.send({ t: "start" });
  let m = await c.next((x) => x.t === "room" && x.view);
  // Cleo just draws and throws; the bot must get turns in between
  let botTurns = 0;
  for (let k = 0; k < 80 && botTurns < 3; k++) {
    if (m.view.phase === "roundEnd") break;
    if (m.view.cur === m.view.me) {
      if (m.view.step === "draw") c.send({ t: "act", a: { t: "draw", from: "deck" } });
      else { const x = m.view.hand.find((h) => h.c !== "s") || m.view.hand[0]; c.send({ t: "act", a: { t: "discard", id: x.id } }); }
    }
    m = await c.next((x) => x.t === "room" && x.view, 5000);
    if (m.events.some((e) => e.t === "discard" && e.pi !== m.view.me)) botTurns++;
  }
  assert.ok(botTurns >= 3 || m.view.phase === "roundEnd", `bot turns: ${botTurns}`);
});
