"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wp-"));
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

test("rooms, rolls and holds are shared live", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;
  const info = await (await fetch(`http://127.0.0.1:${port}/wuerfelpoker-server`)).json();
  assert.strictEqual(info.wuerfelpoker, true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Würfelpoker/);

  const a = client(port), b = client(port);
  await a.open; await b.open;
  a.send({ t: "create", name: "Anna", goal: 3, avatar: "🐙", rules: { firstSets: true } });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code, name: "Ben", avatar: "not-an-emoji" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.members[0].avatar, "🐙");
  assert.ok(lobby.members[1].avatar && lobby.members[1].avatar !== "not-an-emoji");
  assert.strictEqual(lobby.rules.firstSets, true);
  b.send({ t: "ready", on: true }); // the host starts with everyone who is ready
  await a.next((m) => m.t === "room" && m.members[1].ready);
  a.send({ t: "start" });
  const s = await b.next((m) => m.t === "room" && m.view);
  const cur = s.view.cur;
  const [roller, watcher] = cur === 0 ? [a, b] : [b, a];
  watcher.send({ t: "act", a: { t: "roll" } });
  assert.match((await watcher.next((m) => m.t === "error")).msg, /dran/);
  roller.send({ t: "act", a: { t: "roll" } });
  const rolled = await watcher.next((m) => m.t === "room" && m.events.some((e) => e.t === "rolled"));
  assert.deepStrictEqual(rolled.events.find((e) => e.t === "rolled").which, [0, 1, 2, 3, 4]);
  roller.send({ t: "act", a: { t: "hold", i: 2 } });
  const held = await watcher.next((m) => m.t === "room" && m.events.some((e) => e.t === "hold"));
  assert.deepStrictEqual(held.view.hold, [false, false, true, false, false], "the other player sees the hold");
  roller.send({ t: "act", a: { t: "stop" } });
  const done = await watcher.next((m) => m.t === "room" && m.events.some((e) => e.t === "done"));
  assert.ok(done.view.players[cur].result.label);
  assert.strictEqual(done.view.maxRolls, 1, "house rule: first player set one roll");
  a.ws.close(); b.ws.close();
});

test("a room with computer players plays by itself", async () => {
  const port = server.address().port;
  const h = client(port); await h.open;
  h.send({ t: "create", name: "Host", goal: 0 });
  await h.next((m) => m.t === "joined");
  h.send({ t: "addBot" }); h.send({ t: "addBot" });
  const lobby = await h.next((m) => m.t === "room" && m.members.length === 3);
  assert.deepStrictEqual(lobby.members.map((m) => m.bot), [false, true, true]);
  h.send({ t: "start" });
  let botRolls = 0;
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const m = await h.next((x) => x.t === "room" && x.view, 8000);
    botRolls += m.events.filter((e) => e.t === "rolled" && e.pi !== 0).length;
    if (m.view.phase === "play" && m.view.cur === 0) h.send({ t: "act", a: { t: m.view.rolls ? "stop" : "roll" } });
    if (m.view.phase === "roundEnd") break;
  }
  assert.ok(botRolls >= 2, "the computers rolled");
  h.ws.close();
});
