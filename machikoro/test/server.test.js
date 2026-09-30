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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "machikoro-"));
const { server, wss, rooms } = require("../server.js");
const Game = require("../public/game.js");
test.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let waiter = null;
  ws.on("message", (d) => { inbox.push(JSON.parse(d)); if (waiter) waiter(); });
  const next = (pred, ms = 8000) => new Promise((res, rej) => {
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
  assert.strictEqual(info.machikoro, true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Machi Koro/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);

  const a = client(port), b = client(port);
  await a.open; await b.open;
  a.send({ t: "create", name: "Anna", goal: 1, level: 1, avatar: "🐙" });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code.toLowerCase(), name: "Ben", avatar: "🦖" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.members[0].avatar, "🐙");
  assert.strictEqual(lobby.goal, 1);

  a.send({ t: "settings", level: 2 });
  await a.next((m) => m.t === "room" && m.level === 2);
  a.send({ t: "settings", level: 1 });
  b.send({ t: "ready", on: true });
  await a.next((m) => m.t === "room" && m.members[1].ready);
  a.send({ t: "start" });
  let v = (await a.next((m) => m.t === "room" && m.view)).view;
  assert.strictEqual(v.goal, 1);
  assert.strictEqual(v.step, "roll");

  // Play until round end: each human rolls, then buys the cheapest landmark/card or passes.
  // To finish reasonably fast, after a few turns we cheat via act by buying landmarks when coins allow —
  // but we can't mutate server state. Instead: keep playing; bots aren't here yet. With 2 humans
  // games can be long. Strategy: roll, then if we can afford any landmark buy it, else buy cheapest
  // card, else pass. Also grant luck by... we just play many turns.
  // Faster path: after start, leave and use bot path below for the long play; first verify moves work.

  const seat = [a, b];
  let guard = 0;
  // Do a few legal turns then force end via giveup from the trailing player after checking moves
  while (v.phase === "play" && guard++ < 30) {
    const me = seat[v.cur], turn = v.turn, step = v.step, seq = v.seq;
    await new Promise((r) => setTimeout(r, 5)); a.flush(); b.flush();
    let aAct;
    if (step === "roll") aAct = { t: "roll", dice: 1 };
    else if (step === "reroll") aAct = { t: "keep" };
    else if (step === "tv") {
      const t = v.players.findIndex((_, i) => i !== v.cur);
      aAct = { t: "tv", target: t < 0 ? 0 : t };
    } else if (step === "trade") aAct = { t: "trade", skip: true };
    else if (step === "build") {
      if (v.affordable.landmarks.length) aAct = { t: "landmark", id: v.affordable.landmarks[0] };
      else if (v.affordable.cards.length) aAct = { t: "buy", id: v.affordable.cards[0] };
      else aAct = { t: "pass" };
    } else break;
    me.send({ t: "act", a: aAct });
    const got = await me.next((m) => m.t === "error" || (m.t === "room" && m.view && (m.view.seq !== seq || m.view.phase === "roundEnd")));
    assert.ok(got.view, got.msg);
    v = got.view;
  }
  assert.ok(v.phase === "play" || v.phase === "roundEnd");

  // give up to reach round end quickly if still playing
  if (v.phase === "play") {
    a.flush(); b.flush();
    const loser = seat[v.me === 0 ? 0 : 0];
    a.send({ t: "act", a: { t: "giveup" } });
    v = (await a.next((m) => m.t === "room" && m.view && m.view.phase === "roundEnd")).view;
  }
  assert.strictEqual(v.phase, "roundEnd");
  assert.strictEqual(v.last.over, true);
  assert.ok(v.players[v.last.winners[0]].wins >= 1);

  b.send({ t: "act", a: { t: "roll", dice: 1 } });
  assert.match((await b.next((m) => m.t === "error")).msg, /niemand/i);

  // back to waiting room, Ben leaves, computer joins and plays
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
  while (v.phase === "play" && guard++ < 800) {
    if (v.players[v.cur].bot) {
      v = (await a.next((m) => m.t === "room" && m.view && (m.view.seq !== v.seq || m.view.phase !== "play"), 10000)).view;
      continue;
    }
    const seq = v.seq, step = v.step;
    let aAct;
    if (step === "roll") aAct = { t: "roll", dice: 1 };
    else if (step === "reroll") aAct = { t: "keep" };
    else if (step === "tv") aAct = { t: "tv", target: 1 };
    else if (step === "trade") aAct = { t: "trade", skip: true };
    else if (step === "build") {
      if (v.affordable.landmarks.length) aAct = { t: "landmark", id: v.affordable.landmarks[0] };
      else if (v.affordable.cards.length) aAct = { t: "buy", id: v.affordable.cards[0] };
      else aAct = { t: "pass" };
    } else break;
    a.flush();
    a.send({ t: "act", a: aAct });
    v = (await a.next((m) => m.t === "room" && m.view && (m.view.seq !== seq || m.view.phase !== "play"))).view;
  }
  // If still playing after many turns, give up so the bot wins
  if (v.phase === "play") {
    a.flush();
    a.send({ t: "act", a: { t: "giveup" } });
    v = (await a.next((m) => m.t === "room" && m.view && m.view.phase === "roundEnd")).view;
  }
  assert.strictEqual(v.phase, "roundEnd");
  assert.ok(rooms.get(joined.code));
  a.ws.close(); b.ws.close();
});
