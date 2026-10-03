"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "activity-"));
const { server, wss, rooms } = require("../server.js");
const Game = require("../public/game.js");
test.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let waiter = null;
  ws.on("message", (d) => { inbox.push(JSON.parse(d)); if (waiter) waiter(); });
  const next = (pred, ms = 3000) => { const where = new Error("timeout"); return new Promise((res, rej) => {
    const t = setTimeout(() => rej(where), ms);
    const check = () => {
      const i = inbox.findIndex(pred);
      if (i >= 0) { clearTimeout(t); waiter = null; res(inbox.splice(0, i + 1).pop()); }
    };
    waiter = check; check();
  }); };
  const flush = () => { inbox.length = 0; };
  return { ws, next, flush, inbox: () => inbox, send: (m) => ws.send(JSON.stringify(m)), open: new Promise((r) => ws.on("open", r)) };
}

test("rooms, a full game with drawing, guessing and hints, a spectator and a computer opponent over WebSockets", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;

  const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
  assert.strictEqual(info["activity"], true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Activity/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);

  const a = client(port), b = client(port), w = client(port);
  await a.open; await b.open; await w.open;
  a.send({ t: "create", name: "Anna", goal: 1, modes: 1, time: 1, avatar: "🐙" });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code.toLowerCase(), name: "Ben", avatar: "🦖" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.members[0].avatar, "🐙");
  assert.strictEqual(lobby.modes, 1);
  assert.strictEqual(lobby.time, 1);

  a.send({ t: "settings", modes: 6, time: 2, goal: 2 });
  await a.next((m) => m.t === "room" && m.modes === 6 && m.time === 2 && m.goal === 2);
  a.send({ t: "settings", modes: 99, goal: 1 }); // out of range: back to all modes
  await a.next((m) => m.t === "room" && m.modes === 7 && m.goal === 1);
  a.send({ t: "settings", modes: 1 });
  await a.next((m) => m.t === "room" && m.modes === 1);
  b.send({ t: "ready", on: true });
  await a.next((m) => m.t === "room" && m.members[1].ready);
  a.send({ t: "start" });
  const va = (await a.next((m) => m.t === "room" && m.view)).view, vb = (await b.next((m) => m.t === "room" && m.view)).view;
  let v = va;
  const room = rooms.get(joined.code), S = room.state;
  assert.strictEqual(v.phase, "prep");
  assert.strictEqual(v.mode, "draw");

  const seat = [a, b], actor = seat[v.cur], guesser = seat[1 - v.cur], gi = 1 - v.cur;
  // the word reaches only the one on
  const actorView = v.cur === 0 ? va : vb, guesserView = v.cur === 0 ? vb : va;
  assert.strictEqual(actorView.word, S.word.text);
  assert.strictEqual(guesserView.word, null);
  assert.ok(!JSON.stringify(guesserView).includes(JSON.stringify(S.word.text)));

  // a spectator joins late
  w.send({ t: "join", code: joined.code, name: "Gast", watch: true });
  await w.next((m) => m.t === "joined" || m.t === "watching");

  guesser.send({ t: "act", a: { t: "guess", text: S.word.text } }); // too early
  assert.match((await guesser.next((m) => m.t === "error")).msg, /nicht geraten/);
  actor.send({ t: "act", a: { t: "go" } });
  v = (await guesser.next((m) => m.t === "room" && m.view && m.view.phase === "play")).view;
  assert.ok(v.pattern.includes("_"));

  // strokes are relayed to everybody else, not echoed, and not by a guesser
  guesser.flush(); w.flush(); actor.flush();
  guesser.send({ t: "draw", ops: [["x"]] });
  assert.ok((await guesser.next((m) => m.t === "error")).msg);
  actor.send({ t: "draw", ops: [["b", 1, 1, 100, 100], ["m", 200, 200, 300, 250]] });
  const got = await guesser.next((m) => m.t === "draw");
  assert.deepStrictEqual(got, { t: "draw", from: 0, n: 1, ops: [["b", 1, 1, 100, 100], ["m", 200, 200, 300, 250]] });
  assert.strictEqual((await w.next((m) => m.t === "draw")).n, 1);
  actor.send({ t: "draw", ops: [["b", 0, 0, 5, 5]] });
  assert.strictEqual((await guesser.next((m) => m.t === "draw")).from, 1);
  actor.send({ t: "draw", ops: [["b", 0, 0, "nope", 5]] });
  assert.ok((await actor.next((m) => m.t === "error")).msg);
  actor.send({ t: "draw", ops: "{}" });
  assert.ok((await actor.next((m) => m.t === "error")).msg);
  assert.ok(!actor.inbox().some((m) => m.t === "draw"), "the one drawing gets no echo");
  assert.strictEqual(S.dn, 2);

  // late joiner or missed batch: the whole page on request
  w.send({ t: "drawsync" });
  const full = await w.next((m) => m.t === "draw" && m.full);
  assert.strictEqual(full.n, 2);
  assert.strictEqual(full.strokes.length, 2);
  assert.deepStrictEqual(full.strokes[0], { c: 1, w: 1, p: [100, 100, 200, 200, 300, 250] });

  // a wrong guess is public, the right one scores and ends the turn
  guesser.flush(); actor.flush();
  guesser.send({ t: "act", a: { t: "guess", text: "Quatsch" } });
  const pub = await actor.next((m) => m.t === "room" && m.view && m.view.feed.length === 1);
  assert.strictEqual(pub.view.feed[0].text, "Quatsch");
  guesser.send({ t: "act", a: { t: "guess", text: S.word.text } });
  v = (await actor.next((m) => m.t === "room" && m.view && m.view.phase === "reveal")).view;
  assert.strictEqual(v.lastTurn.word, S.word.text);
  assert.ok(v.players[gi].score >= 2);
  assert.ok(v.players[v.cur].score >= 2);
  assert.strictEqual((await w.next((m) => m.t === "room" && m.view && m.view.phase === "reveal")).view.lastTurn.reason, "all");

  // the engine's own clock moves on (here made due by hand; the next action resolves it)
  const second = gi;
  S.until = Date.now() - 1;
  seat[second].send({ t: "act", a: { t: "swap" } });
  v = (await seat[second].next((m) => m.t === "room" && m.view && m.view.phase === "prep" && m.view.cur === second)).view;
  assert.notStrictEqual(v.word, null);
  seat[second].send({ t: "act", a: { t: "go" } });
  await seat[second].next((m) => m.t === "room" && m.view && m.view.phase === "play");
  seat[second].send({ t: "act", a: { t: "giveup" } });
  v = (await seat[second].next((m) => m.t === "room" && m.view && m.view.phase === "reveal")).view;
  assert.strictEqual(v.lastTurn.reason, "giveup");
  S.until = Date.now() - 1;
  seat[1 - second].send({ t: "act", a: { t: "swap" } }); // resolves the run-out reveal: the game is over
  v = (await seat[1 - second].next((m) => m.t === "room" && m.view && m.view.phase === "roundEnd")).view;
  assert.strictEqual(v.last.over, true);
  assert.deepStrictEqual(v.last.winners.length >= 1, true);

  b.send({ t: "act", a: { t: "go" } }); // nobody is on any more
  assert.match((await b.next((m) => m.t === "error")).msg, /spielt niemand/);

  // back to the waiting room, Ben leaves, the computer joins and guesses on its own
  a.send({ t: "end" });
  await a.next((m) => m.t === "room" && !m.view);
  b.send({ t: "leave" });
  await b.next((m) => m.t === "left");
  await a.next((m) => m.t === "room" && m.members.length === 1);
  a.send({ t: "bot" });
  const withBot = await a.next((m) => m.t === "room" && m.members.length === 2 && m.members[1].bot);
  assert.strictEqual(withBot.members[1].name, Game.BOT_NAMES[0]);
  a.send({ t: "settings", level: 3, modes: 2, goal: 1 });
  await a.next((m) => m.t === "room" && m.level === 3 && m.modes === 2);
  a.send({ t: "start" });
  v = (await a.next((m) => m.t === "room" && m.view)).view;
  assert.strictEqual(v.cur, 0);
  assert.strictEqual(v.mode, "explain");
  const real = Math.random;
  Math.random = () => 0.01; // the computer will make a wrong guess, then the right one
  a.send({ t: "act", a: { t: "go" } });
  v = (await a.next((m) => m.t === "room" && m.view && m.view.phase === "play")).view;
  Math.random = real;
  v = (await a.next((m) => m.t === "room" && m.view && m.view.phase === "reveal", 5000)).view;
  assert.strictEqual(v.lastTurn.reason, "all");
  assert.strictEqual(v.lastTurn.solvers.length, 1);
  assert.ok(v.feed.length === 0 || v.feed.every((f) => f.pi === 1));
  assert.ok(rooms.get(joined.code));
  a.ws.close(); b.ws.close(); w.ws.close();
});
