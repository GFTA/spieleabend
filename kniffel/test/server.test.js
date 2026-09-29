"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kn-"));
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

test("spectators watch a running game without seeing any secrets", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;
  const a = client(port), b = client(port), w = client(port);
  await a.open; await b.open; await w.open;
  a.send({ t: "create", name: "Anna" });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code, name: "Ben" });
  await b.next((m) => m.t === "joined");
  b.send({ t: "ready", on: true });
  await a.next((m) => m.t === "room" && m.members[1] && m.members[1].ready);
  a.send({ t: "start" });
  await a.next((m) => m.t === "room" && m.view);

  w.send({ t: "join", code: joined.code, name: "Zoe", watch: true });
  assert.strictEqual((await w.next((m) => m.t === "watching")).name, "Zoe");
  const seen = await w.next((m) => m.t === "room" && m.view);
  assert.strictEqual(seen.you, -1);
  assert.strictEqual(seen.view.me, -1);
  assert.strictEqual(seen.view.players.length, 2);
  const roster = await a.next((m) => m.t === "room" && m.watchers.includes("Zoe"));
  assert.deepStrictEqual(roster.watchers, ["Zoe"]);
  w.send({ t: "act", a: { t: "roll" } });
  assert.match((await w.next((m) => m.t === "error")).msg, /./);
  w.send({ t: "chat", text: "hallo" });
  assert.strictEqual((await a.next((m) => m.t === "chat")).line.name, "Zoe");
  a.ws.close(); b.ws.close(); w.ws.close();
});

test("rooms, rolls, holds and entries are shared live", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;
  const info = await (await fetch(`http://127.0.0.1:${port}/kniffel-server`)).json();
  assert.strictEqual(info.kniffel, true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Kniffel/);

  const a = client(port), b = client(port);
  await a.open; await b.open;
  a.send({ t: "create", name: "Anna", avatar: "🐙", rules: { joker: true } });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code, name: "Ben", avatar: "not-an-emoji" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.members[0].avatar, "🐙");
  assert.ok(lobby.members[1].avatar && lobby.members[1].avatar !== "not-an-emoji");
  assert.strictEqual(lobby.rules.joker, true);
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
  roller.send({ t: "act", a: { t: "score", c: "chance" } });
  const done = await watcher.next((m) => m.t === "room" && m.events.some((e) => e.t === "scored"));
  assert.strictEqual(done.view.players[cur].sheet.chance, done.events.find((e) => e.t === "scored").points);
  assert.strictEqual(done.view.cur, 1 - cur, "the next player is up");
  assert.ok(done.view.rules.joker, "house rule reached the game");
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
  let botRolls = 0, botEntries = 0;
  const end = Date.now() + 25000;
  while (Date.now() < end && botEntries < 2) {
    const m = await h.next((x) => x.t === "room" && x.view, 8000);
    botRolls += m.events.filter((e) => e.t === "rolled" && e.pi !== 0).length;
    botEntries += m.events.filter((e) => e.t === "scored" && e.pi !== 0).length;
    if (m.view.phase === "play" && m.view.cur === 0) {
      const open = Object.keys(m.view.options)[0];
      h.send({ t: "act", a: m.view.rolls ? { t: "score", c: open } : { t: "roll" } });
    }
  }
  assert.ok(botRolls >= 2, "the computers rolled");
  assert.ok(botEntries >= 2, "the computers wrote down boxes");
  h.ws.close();
});
