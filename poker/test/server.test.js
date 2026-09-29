"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pk-"));
const { server } = require("../server.js");

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let waiter = null;
  ws.on("message", (d) => { inbox.push(JSON.parse(d)); if (waiter) waiter(); });
  const next = (pred, ms = 3000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout")), ms);
    const check = () => { const i = inbox.findIndex(pred); if (i >= 0) { clearTimeout(t); waiter = null; res(inbox.splice(0, i + 1).pop()); } };
    waiter = check; check();
  });
  return { ws, next, send: (m) => ws.send(JSON.stringify(m)), open: new Promise((r) => ws.on("open", r)) };
}

// open sockets would keep the process alive after a failed assertion
test.after(() => { server.close(); setImmediate(() => process.exit()); });

test("spectators watch a running game without seeing any cards", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;
  const a = client(port), b = client(port), w = client(port);
  await a.open; await b.open; await w.open;
  a.send({ t: "create", name: "Anna", chips: 2000 });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code, name: "Ben" });
  await b.next((m) => m.t === "joined");
  b.send({ t: "ready", on: true });
  await a.next((m) => m.t === "room" && m.members[1] && m.members[1].ready);
  a.send({ t: "start" });
  const start = await a.next((m) => m.t === "room" && m.view);
  assert.strictEqual(start.view.players[0].chips + start.view.players[0].bet, 2000, "start chips");

  w.send({ t: "join", code: joined.code, name: "Zoe", watch: true });
  assert.strictEqual((await w.next((m) => m.t === "watching")).name, "Zoe");
  const seen = await w.next((m) => m.t === "room" && m.view);
  assert.strictEqual(seen.you, -1);
  assert.deepStrictEqual(seen.view.hole, []);
  assert.deepStrictEqual(seen.view.players.map((p) => p.hole), [[null, null], [null, null]]);
  w.send({ t: "act", a: { t: "call" } });
  assert.match((await w.next((m) => m.t === "error")).msg, /./);
  w.send({ t: "chat", text: "hallo" });
  assert.strictEqual((await a.next((m) => m.t === "chat")).line.name, "Zoe");
  a.ws.close(); b.ws.close(); w.ws.close();
});

test("everybody sees only their own cards, and bets are shared live", async () => {
  const port = server.address().port;
  const info = await (await fetch(`http://127.0.0.1:${port}/poker-server`)).json();
  assert.strictEqual(info.poker, true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Poker/);

  const a = client(port), b = client(port);
  await a.open; await b.open;
  a.send({ t: "create", name: "Anna", avatar: "🐙", rules: { blindsUp: true } });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code, name: "Ben" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.rules.blindsUp, true);
  a.send({ t: "settings", chips: 5000 });
  assert.strictEqual((await a.next((m) => m.t === "room" && m.chips === 5000)).chips, 5000);
  b.send({ t: "ready", on: true });
  await a.next((m) => m.t === "room" && m.members[1].ready);
  a.send({ t: "start" });
  const sa = await a.next((m) => m.t === "room" && m.view);
  const sb = await b.next((m) => m.t === "room" && m.view);
  assert.strictEqual(sa.view.hole.length, 2);
  assert.strictEqual(sb.view.hole.length, 2);
  assert.deepStrictEqual(sa.view.players[sb.you].hole, [null, null], "the other's cards are hidden");
  assert.ok(!JSON.stringify(sa.view).includes(JSON.stringify(sb.view.hole)) || JSON.stringify(sb.view.hole) === JSON.stringify(sa.view.hole));
  assert.strictEqual(sa.view.blinds.bb, 100);
  const cur = sa.view.cur;
  const [mover, other] = cur === 0 ? [a, b] : [b, a];
  other.send({ t: "act", a: { t: "call" } });
  assert.match((await other.next((m) => m.t === "error")).msg, /dran/);
  mover.send({ t: "act", a: { t: "raise", to: 300 } });
  const raised = await other.next((m) => m.t === "room" && m.events.some((e) => e.t === "bet"));
  assert.strictEqual(raised.view.cbet, 300);
  assert.strictEqual(raised.view.players[cur].act, "raise");
  assert.ok(raised.view.opts && raised.view.opts.call > 0, "the other player has a call to make");
  other.send({ t: "act", a: { t: "fold" } });
  const end = await mover.next((m) => m.t === "room" && m.view.phase === "roundEnd");
  assert.deepStrictEqual(end.view.last.winners, [cur]);
  assert.strictEqual(end.view.last.kind, "fold");
  a.ws.close(); b.ws.close();
});

test("a room with computer players plays by itself", async () => {
  const port = server.address().port;
  const h = client(port); await h.open;
  h.send({ t: "create", name: "Host" });
  await h.next((m) => m.t === "joined");
  h.send({ t: "addBot" }); h.send({ t: "addBot" });
  const lobby = await h.next((m) => m.t === "room" && m.members.length === 3);
  assert.deepStrictEqual(lobby.members.map((m) => m.bot), [false, true, true]);
  h.send({ t: "start" });
  let botActs = 0;
  const end = Date.now() + 30000;
  while (Date.now() < end && botActs < 4) {
    const m = await h.next((x) => x.t === "room" && x.view, 10000);
    botActs += m.events.filter((e) => e.t === "bet" && e.pi !== 0).length;
    if (m.view.phase === "play" && m.view.cur === 0) h.send({ t: "act", a: { t: m.view.opts.canCheck ? "check" : "call" } });
    if (m.view.phase === "roundEnd") h.send({ t: "act", a: { t: "next" } });
  }
  assert.ok(botActs >= 4, "the computers bet");
  h.ws.close();
});
