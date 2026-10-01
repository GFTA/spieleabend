"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.RATE_PER_S = "5000";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "monopoly-"));
const { server, wss, rooms } = require("../server.js");
const Game = require("../public/game.js");
test.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let waiter = null;
  ws.on("message", (d) => { inbox.push(JSON.parse(d)); if (waiter) waiter(); });
  const next = (pred, ms = 3000) => new Promise((res, rej) => {
    const where = new Error("timeout").stack;
    const t = setTimeout(() => rej(Object.assign(new Error("timeout"), { stack: where })), ms);
    const check = () => {
      const i = inbox.findIndex(pred);
      if (i >= 0) { clearTimeout(t); waiter = null; res(inbox.splice(0, i + 1).pop()); }
    };
    waiter = check; check();
  });
  const flush = () => { inbox.length = 0; };
  return { ws, next, flush, send: (m) => ws.send(JSON.stringify(m)), open: new Promise((r) => ws.on("open", r)) };
}

// what a human at the table does with the least thought: buy, never bid, end the turn
const simple = (v) => {
  if (v.trade) return { t: "reject" };
  if (v.step === "auction") return { t: "pass" };
  if (v.step === "buy") return { t: v.players[v.cur].cash >= Game.BOARD[v.buy].p ? "buy" : "decline" };
  if (v.step === "debt") return { t: "bankrupt" };
  return { t: v.step === "roll" ? "roll" : "end" };
};

test("rooms, house rules, ready-up, a full game, skip, a spectator and a computer opponent over WebSockets", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;

  const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
  assert.strictEqual(info["monopoly"], true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Monopoly/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);

  const a = client(port), b = client(port);
  await a.open; await b.open;
  a.send({ t: "create", name: "Anna", goal: 1, rules: { limit: 20, goDouble: true }, avatar: "🐙" });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code.toLowerCase(), name: "Ben", avatar: "🦖" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.members[0].avatar, "🐙");
  assert.deepStrictEqual(lobby.rules, { goDouble: true, parking: false, auction: true, cash: 1500, limit: 20 });

  // the host sets house rules, hostile values change nothing, a guest may not
  a.send({ t: "settings", rules: { goDouble: false, parking: true, cash: 1000 } });
  const set = await a.next((m) => m.t === "room" && m.rules.cash === 1000);
  assert.deepStrictEqual(set.rules, { goDouble: false, parking: true, auction: true, cash: 1000, limit: 20 });
  a.send({ t: "settings", rules: "constructor" });
  a.send({ t: "settings", rules: { cash: "__proto__", limit: 7, parking: "yes" } });
  a.send({ t: "settings", rules: { goDouble: true, parking: false, cash: 1500 } });
  const again = await a.next((m) => m.t === "room" && m.rules.cash === 1500);
  assert.deepStrictEqual(again.rules, { goDouble: true, parking: false, auction: true, cash: 1500, limit: 20 });
  b.send({ t: "settings", rules: { cash: 2500 } });
  b.send({ t: "ready", on: true });
  const rdy = await a.next((m) => m.t === "room" && m.members[1].ready);
  assert.strictEqual(rdy.rules.cash, 1500);

  a.send({ t: "start" });
  let v = (await a.next((m) => m.t === "room" && m.view)).view;
  assert.strictEqual(v.rules.limit, 20);
  assert.ok(v.players.every((p) => p.cash === 1500));

  // the host skips whoever is on turn: the computer plays that move; a guest may not
  const seat = [a, b];
  b.send({ t: "act", a: { t: "skip" } });
  assert.match((await b.next((m) => m.t === "error")).msg, /Host/);
  a.flush(); b.flush();
  a.send({ t: "act", a: { t: "skip" } });
  v = (await a.next((m) => m.t === "room" && m.view && m.view.log.some((l) => /übersprungen/.test(l)))).view;
  assert.ok(v.log.length > 1);

  // both play on with the simplest moves until the turn limit ends the game
  let guard = 0;
  while (v.phase === "play" && guard++ < 1500) {
    const me = seat[v.actor], before = JSON.stringify(v);
    await new Promise((r) => setTimeout(r, 5)); a.flush(); b.flush();
    me.send({ t: "act", a: simple(v) });
    const got = await me.next((m) => m.t === "error" || (m.t === "room" && m.view && JSON.stringify(m.view) !== before)).catch((e) => { throw new Error(`${e.message} step=${v.step} actor=${v.actor} cur=${v.cur} act=${JSON.stringify(simple(v))} trade=${!!v.trade} auc=${JSON.stringify(v.auction)} n=${guard}`); });
    assert.ok(got.view, got.msg);
    v = got.view;
  }
  assert.strictEqual(v.phase, "roundEnd");
  assert.strictEqual(v.last.over, true);
  assert.ok(["limit", "last"].includes(v.last.reason));
  assert.ok(v.players[v.last.winners[0]].wins >= 1);

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
  guard = 0;
  while (v.phase === "play" && guard++ < 1500) {
    if (v.actor === 1) { v = (await a.next((m) => m.t === "room" && m.view && (m.view.actor === 0 || m.view.phase !== "play"))).view; continue; }
    const before = JSON.stringify(v);
    a.send({ t: "act", a: simple(v) });
    v = (await a.next((m) => m.t === "room" && m.view && JSON.stringify(m.view) !== before)).view;
  }
  assert.strictEqual(v.phase, "roundEnd");
  assert.ok(rooms.get(joined.code));
  a.ws.close(); b.ws.close();
});
