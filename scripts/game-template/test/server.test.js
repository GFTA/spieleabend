"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "@@ID@@-"));
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
  assert.strictEqual(info["@@ID@@"], true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /@@TITLE@@/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);

  const a = client(port), b = client(port);
  await a.open; await b.open;
  a.send({ t: "create", name: "Anna", goal: 1, target: 30, avatar: "🐙" });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code.toLowerCase(), name: "Ben", avatar: "🦖" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.members[0].avatar, "🐙");
  assert.strictEqual(lobby.target, 30);

  a.send({ t: "settings", target: 50 });
  await a.next((m) => m.t === "room" && m.target === 50);
  a.send({ t: "settings", target: 30 });
  b.send({ t: "ready", on: true });
  await a.next((m) => m.t === "room" && m.members[1].ready);
  a.send({ t: "start" });
  let v = (await a.next((m) => m.t === "room" && m.view)).view;
  assert.strictEqual(v.target, 30);

  // whoever is on turn rolls; from 10 points on they hold, until somebody reaches the target
  const seat = [a, b];
  let guard = 0;
  while (v.phase === "play" && guard++ < 400) {
    const me = seat[v.cur], turn = v.turn, pot = v.pot;
    await new Promise((r) => setTimeout(r, 10)); a.flush(); b.flush(); // drop broadcasts of earlier moves
    me.send({ t: "act", a: { t: pot >= 10 ? "hold" : "roll" } });
    const got = await me.next((m) => m.t === "error" || (m.t === "room" && m.view && (m.view.turn !== turn || m.view.pot !== pot || m.view.phase === "roundEnd")));
    assert.ok(got.view, got.msg);
    v = got.view;
  }
  assert.strictEqual(v.phase, "roundEnd");
  assert.strictEqual(v.last.over, true);
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
  while (v.phase === "play" && guard++ < 400) {
    if (v.cur === 1) { v = (await a.next((m) => m.t === "room" && m.view && (m.view.cur === 0 || m.view.phase !== "play"))).view; continue; }
    const turn = v.turn, pot = v.pot;
    a.send({ t: "act", a: { t: pot >= 10 ? "hold" : "roll" } });
    v = (await a.next((m) => m.t === "room" && m.view && (m.view.turn !== turn || m.view.pot !== pot || m.view.phase !== "play"))).view;
  }
  assert.strictEqual(v.phase, "roundEnd");
  assert.ok(rooms.get(joined.code));
  a.ws.close(); b.ws.close();
});
