"use strict";
// Unified mid-game leave vote (shared room-server): bot vs wait, reconnect clears vote / standIn.
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "maedn-leave-"));
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

async function twoPlayerGame(port) {
  const a = client(port), b = client(port), c = client(port);
  await a.open; await b.open; await c.open;
  a.send({ t: "create", name: "Anna", goal: 1 });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code, name: "Ben" });
  await b.next((m) => m.t === "joined");
  await a.next((m) => m.t === "room" && m.members && m.members.length === 2);
  c.send({ t: "join", code: joined.code, name: "Cleo" });
  await c.next((m) => m.t === "joined");
  await a.next((m) => m.t === "room" && m.members && m.members.length === 3);
  b.send({ t: "ready", on: true });
  c.send({ t: "ready", on: true });
  await a.next((m) => m.t === "room" && m.members[1] && m.members[1].ready && m.members[2] && m.members[2].ready);
  a.send({ t: "start" });
  await a.next((m) => m.t === "room" && m.view);
  return { a, b, c, code: joined.code };
}

test("leave opens a leaveVote; majority bot installs standIn and keeps the secret", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;
  const { a, b, c, code } = await twoPlayerGame(port);
  const secret = rooms.get(code).members[1].secret;
  b.send({ t: "leave" });
  await b.next((m) => m.t === "left");
  const vote = await a.next((m) => m.t === "room" && m.leaveVote);
  assert.deepStrictEqual({ seat: vote.leaveVote.seat, name: vote.leaveVote.name }, { seat: 1, name: "Ben" });
  assert.ok(!("secret" in vote.leaveVote), "secret is never broadcast");
  a.send({ t: "leaveVote", choice: "bot" });
  await a.next((m) => m.t === "room" && m.leaveVote && m.leaveVote.votes["0"] === "bot");
  c.send({ t: "leaveVote", choice: "bot" }); // all eligible voted bot → resolve immediately
  const done = await a.next((m) => m.t === "room" && !m.leaveVote && m.members[1].bot);
  assert.strictEqual(rooms.get(code).members[1].standIn, true);
  assert.strictEqual(rooms.get(code).members[1].secret, secret);
  assert.strictEqual(done.view.players[1].bot, true);
  a.ws.close(); c.ws.close();
});

test("reconnect during the leave vote clears the vote and restores the seat", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;
  const { a, b, c, code } = await twoPlayerGame(port);
  const secret = rooms.get(code).members[1].secret;
  b.ws.close(); // drop without leave → detach starts leaveVote
  const vote = await a.next((m) => m.t === "room" && m.leaveVote && m.leaveVote.seat === 1);
  assert.strictEqual(vote.leaveVote.name, "Ben");
  const back = client(port); await back.open;
  back.send({ t: "resume", code, secret });
  const cleared = await a.next((m) => m.t === "room" && !m.leaveVote && m.members[1].online);
  assert.strictEqual(cleared.members[1].bot, false);
  assert.strictEqual(cleared.members[1].name, "Ben");
  a.ws.close(); c.ws.close(); back.ws.close();
});

test("reconnect after standIn clears the bot and hands the seat back", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;
  const { a, b, c, code } = await twoPlayerGame(port);
  const secret = rooms.get(code).members[1].secret;
  b.send({ t: "leave" });
  await b.next((m) => m.t === "left");
  await a.next((m) => m.t === "room" && m.leaveVote);
  a.send({ t: "leaveVote", choice: "bot" });
  c.send({ t: "leaveVote", choice: "bot" });
  await a.next((m) => m.t === "room" && m.members[1].bot && !m.leaveVote);
  const back = client(port); await back.open;
  back.send({ t: "resume", code, secret });
  const restored = await a.next((m) => m.t === "room" && m.members[1].online && !m.members[1].bot);
  assert.strictEqual(restored.view.players[1].bot, false);
  assert.strictEqual(rooms.get(code).members[1].standIn, undefined);
  a.ws.close(); c.ws.close(); back.ws.close();
});
