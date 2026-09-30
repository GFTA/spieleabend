"use strict";
// Leave vote on a former giveup-on-leave game: leaving does not auto-giveup; vote → bot or wait.
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "schiffe-leave-"));
const { server, wss, rooms } = require("../server.js");
test.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let waiter = null;
  ws.on("message", (d) => { inbox.push(JSON.parse(d)); if (waiter) waiter(); });
  const next = (pred, ms = 4000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout")), ms);
    const check = () => {
      const i = inbox.findIndex(pred);
      if (i >= 0) { clearTimeout(t); waiter = null; res(inbox.splice(0, i + 1).pop()); }
    };
    waiter = check; check();
  });
  return { ws, next, send: (m) => ws.send(JSON.stringify(m)), open: new Promise((r) => ws.on("open", r)) };
}

test("leave mid-game starts a leaveVote instead of giveup; bot vote keeps the seat in play", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;
  const a = client(port), b = client(port);
  await a.open; await b.open;
  a.send({ t: "create", name: "Anna", goal: 1 });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code, name: "Ben" });
  await b.next((m) => m.t === "joined");
  await a.next((m) => m.t === "room" && m.members && m.members.length === 2);
  b.send({ t: "ready", on: true });
  await a.next((m) => m.t === "room" && m.members && m.members[1] && m.members[1].ready);
  a.send({ t: "start" });
  await a.next((m) => m.t === "room" && m.view);
  const secret = rooms.get(joined.code).members[1].secret;

  b.send({ t: "leave" });
  await b.next((m) => m.t === "left");
  const vote = await a.next((m) => m.t === "room" && m.leaveVote && m.leaveVote.seat === 1);
  assert.strictEqual(vote.leaveVote.name, "Ben");
  // not given up: still in the game as a human seat until the vote resolves
  assert.strictEqual(vote.view.players[1].out, false);
  assert.strictEqual(vote.members[1].bot, false);

  a.send({ t: "leaveVote", choice: "bot" });
  const taken = await a.next((m) => m.t === "room" && m.members[1].bot && !m.leaveVote);
  assert.strictEqual(taken.view.players[1].bot, true);
  assert.strictEqual(taken.view.players[1].out, false, "standIn bot does not give up");
  assert.strictEqual(rooms.get(joined.code).members[1].secret, secret);
  assert.strictEqual(rooms.get(joined.code).members[1].standIn, true);

  // reconnect after standIn restores the human
  const back = client(port); await back.open;
  back.send({ t: "resume", code: joined.code, secret });
  const restored = await a.next((m) => m.t === "room" && m.members[1].online && !m.members[1].bot);
  assert.strictEqual(restored.view.players[1].bot, false);

  a.ws.close(); back.ws.close();
});

test("majority wait leaves the seat offline for a later host standIn", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;
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

  b.send({ t: "leave" });
  await b.next((m) => m.t === "left");
  await a.next((m) => m.t === "room" && m.leaveVote);
  a.send({ t: "leaveVote", choice: "wait" });
  c.send({ t: "leaveVote", choice: "wait" });
  const waited = await a.next((m) => m.t === "room" && !m.leaveVote);
  assert.strictEqual(waited.members[1].bot, false);
  assert.strictEqual(waited.members[1].online, false);
  // host standIn still works after "wait"
  a.send({ t: "standIn", seat: 1 });
  const si = await a.next((m) => m.t === "room" && m.members[1].bot);
  assert.strictEqual(rooms.get(joined.code).members[1].standIn, true);
  a.ws.close(); c.ws.close();
});
