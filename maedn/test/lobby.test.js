"use strict";
// Waiting room: ready up, sit out, and a rematch with whoever stays at the table.
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "maedn-lobby-"));
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
const names = (m) => m.members.map((x) => x.name);

test("ready up, waiting room while a game runs, rematch with the ones who stay", async () => {
  await new Promise((r) => (server.listening ? r() : server.once("listening", r)));
  const port = server.address().port;
  let [anna, ben, cleo] = [client(port), client(port), client(port)];
  await Promise.all([anna.open, ben.open, cleo.open]);
  anna.send({ t: "create", name: "Anna" });
  const { code } = await anna.next((m) => m.t === "joined");
  ben.send({ t: "join", code, name: "Ben" });
  cleo.send({ t: "join", code, name: "Cleo" });
  await anna.next((m) => m.t === "room" && m.members.length === 3);

  // nobody but the host is ready: starting by hand needs a second ready player
  anna.send({ t: "start" });
  assert.match((await anna.next((m) => m.t === "error")).msg, /bereit/);
  // Ben is ready, Cleo isn't: the host starts, Cleo stays in the waiting room
  ben.send({ t: "ready", on: true });
  await anna.next((m) => m.t === "room" && m.members[1].ready);
  anna.send({ t: "start" });
  let v = await cleo.next((m) => m.t === "room" && m.view);
  assert.deepStrictEqual(v.view.players.map((p) => p.name), ["Anna", "Ben"]);
  assert.strictEqual(v.view.me, -1, "Cleo only watches");
  assert.strictEqual(v.members[2].lobby, true);
  cleo.send({ t: "act", a: { t: "roll" } });
  assert.match((await cleo.next((m) => m.t === "error")).msg, /nicht im Spiel/);

  // a latecomer joins the running game's waiting room instead of being turned away
  const dora = client(port); await dora.open;
  dora.send({ t: "join", code, name: "Dora" });
  assert.strictEqual((await dora.next((m) => m.t === "joined")).pid, 3);
  assert.strictEqual((await dora.next((m) => m.t === "room" && m.view)).members[3].lobby, true);
  dora.send({ t: "leave" });
  await dora.next((m) => m.t === "left");
  await anna.next((m) => m.t === "room" && m.members.length === 3);

  // Ben gives up: the game is over
  ben.send({ t: "act", a: { t: "giveup" } });
  v = await anna.next((m) => m.t === "room" && m.view && m.view.phase === "roundEnd");
  assert.ok(v.view.last.over);

  // Anna wants a rematch, Ben goes back to the waiting room: one player isn't enough, so it waits
  anna.send({ t: "act", a: { t: "next" } });
  await anna.next((m) => m.t === "room" && m.rematch.includes(0));
  ben.send({ t: "lobby" });
  v = await anna.next((m) => m.t === "room" && m.members[1].lobby);
  assert.strictEqual(v.view.phase, "roundEnd", "no rematch alone");
  // Cleo gets ready in the waiting room: the rematch starts with Anna and Cleo, Ben watches
  cleo.send({ t: "ready", on: true });
  v = await anna.next((m) => m.t === "room" && m.view && m.view.phase === "play");
  assert.deepStrictEqual(v.view.players.map((p) => p.name), ["Anna", "Cleo"]);
  assert.deepStrictEqual(names(v), ["Anna", "Cleo", "Ben"], "players first, waiting room behind");
  assert.deepStrictEqual(v.members.map((m) => m.lobby), [false, false, true]);
  assert.strictEqual((await cleo.next((m) => m.t === "room" && m.view && m.view.players.map((p) => p.name).join() === "Anna,Cleo")).you, 1, "Cleo's seat moved along");
  assert.strictEqual((await ben.next((m) => m.t === "room" && m.view && m.view.players.map((p) => p.name).join() === "Anna,Cleo")).view.me, -1);

  // reconnecting keeps everyone where they were: Cleo at her new seat in the game, Ben in the waiting room
  const secretOf = (name) => rooms.get(code).members.find((m) => m.name === name).secret;
  for (const [name, want] of [["Cleo", { you: 1, me: 1 }], ["Ben", { you: 2, me: -1 }]]) {
    (name === "Cleo" ? cleo : ben).ws.close();
    await anna.next((m) => m.t === "room" && !m.members.find((x) => x.name === name).online);
    const back = client(port); await back.open;
    back.send({ t: "resume", code, secret: secretOf(name) });
    const r = await back.next((m) => m.t === "room" && m.view);
    assert.deepStrictEqual({ you: r.you, me: r.view.me, lobby: r.members[r.you].lobby }, { ...want, lobby: name === "Ben" }, `${name} is back where they were`);
    if (name === "Cleo") cleo = back; else ben = back;
  }

  // the host ends it: everyone is back in the waiting room, and once all are ready it starts by itself
  anna.send({ t: "end" });
  await anna.next((m) => m.t === "room" && !m.view);
  for (const p of [ben, cleo, anna]) p.send({ t: "ready", on: true });
  v = await anna.next((m) => m.t === "room" && m.view && m.view.phase === "play");
  assert.deepStrictEqual(v.view.players.map((p) => p.name).sort(), ["Anna", "Ben", "Cleo"]);

  // closing the tab at the end of a game counts as leaving: the rest play the rematch
  for (const p of [ben, cleo]) p.send({ t: "act", a: { t: "giveup" } });
  v = await anna.next((m) => m.t === "room" && m.view && m.view.phase === "roundEnd");
  const seat = (n) => names(v).indexOf(n);
  [anna, cleo][0].send({ t: "act", a: { t: "next" } });
  cleo.send({ t: "act", a: { t: "next" } });
  await anna.next((m) => m.t === "room" && m.rematch.length === 2);
  ben.ws.close();
  v = await anna.next((m) => m.t === "room" && m.view && m.view.phase === "play");
  assert.deepStrictEqual(v.view.players.map((p) => p.name), ["Anna", "Cleo"].sort((a, b) => seat(a) - seat(b)));
  anna.ws.close(); cleo.ws.close();
});
