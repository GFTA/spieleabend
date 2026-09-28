"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "maedn-"));
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
  // newest room state seen so far; empties the inbox so no stale state is read later
  const latest = () => {
    const err = inbox.find((m) => m.t === "error");
    if (err) throw new Error(err.msg);
    const last = inbox.filter((m) => m.t === "room" && m.view).pop();
    inbox.length = 0;
    return last;
  };
  return { ws, next, latest, send: (m) => ws.send(JSON.stringify(m)), open: new Promise((r) => ws.on("open", r)) };
}

test("rooms, avatars, spectators, a full game with computers over WebSockets", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;

  const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
  assert.strictEqual(info.maedn, true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Mensch ärgere dich nicht/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/vendor/qrcode.js`)).status, 200);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);

  const a = client(port), b = client(port), c = client(port), d = client(port);
  await a.open; await b.open; await c.open; await d.open;
  a.send({ t: "create", name: "Anna", goal: 1, rules: { hit: true }, avatar: "🐙" });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code.toLowerCase(), name: "Ben", avatar: "🦖" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.members[0].avatar, "🐙");
  assert.strictEqual(lobby.members[1].avatar, "🦖");
  assert.strictEqual(lobby.rules.hit, true);
  assert.strictEqual(lobby.rules.three, false);

  // two computers fill the room, a fourth person watches
  a.send({ t: "bot" }); a.send({ t: "bot" });
  const full = await a.next((m) => m.t === "room" && m.members.length === 4);
  assert.deepStrictEqual(full.members.slice(2).map((m) => m.name), ["Robo Rudi", "Käpt'n Chip"]);
  c.send({ t: "join", code: joined.code, name: "Chris", avatar: "🦉" });
  assert.strictEqual((await c.next((m) => m.t === "watching")).name, "Chris");
  a.send({ t: "bot" });
  assert.match((await a.next((m) => m.t === "error")).msg, /Mehr als 4/);
  b.send({ t: "start" });
  assert.match((await b.next((m) => m.t === "error")).msg, /Nur/);
  a.send({ t: "settings", goal: 2, level: 1, rules: { rush: true } });
  await a.next((m) => m.t === "room" && m.goal === 2 && m.rules.rush);

  a.send({ t: "start" });
  let v = (await a.next((m) => m.t === "room" && m.view)).view;
  assert.deepStrictEqual(v.players.map((p) => p.seat), [0, 1, 2, 3]);
  assert.deepStrictEqual(v.players.map((p) => p.pieces[0]), [0, 0, 0, 0], "quick start");
  assert.strictEqual((await c.next((m) => m.t === "room" && m.view)).you, -1);
  c.send({ t: "react", e: "Ärger dich nicht!" });
  assert.deepStrictEqual(await a.next((m) => m.t === "react"), { t: "react", pi: -1, e: "Ärger dich nicht!", name: "Chris" });

  // Anna and Ben roll and take the first move; the computers play on their own
  // (both inboxes get drained before every step and the newest state wins; reading one
  // inbox while the other kept older states made the test act for the wrong player)
  const seat = [a, b];
  for (let k = 0; k < 12; k++) {
    await new Promise((r) => setTimeout(r, 60));
    const la = a.latest(), lb = b.latest();
    v = (la || lb || { view: v }).view;
    if (v.phase !== "play" || v.cur > 1) continue; // the computers are on
    const me = seat[v.cur];
    if (v.need === "roll") me.send({ t: "act", a: { t: "roll" } });
    else me.send({ t: "act", a: { t: "move", k: v.moves[0].k } });
  }
  await new Promise((r) => setTimeout(r, 60));
  a.latest(); b.latest(); // a move that went wrong shows up here as an error
  // Ben leaves mid-game: a computer takes his seat and the game goes on
  b.send({ t: "leave" });
  await b.next((m) => m.t === "left");
  const taken = await a.next((m) => m.t === "room" && m.members[1].bot);
  assert.strictEqual(taken.members[1].name, "Ben");
  assert.strictEqual(taken.view.players[1].bot, true);
  // Anna gives up: the computers finish without her
  a.send({ t: "act", a: { t: "giveup" } });
  v = (await a.next((m) => m.t === "room" && m.view && m.view.players[0].out)).view;
  v = (await a.next((m) => m.t === "room" && m.view && m.view.phase === "roundEnd", 60000)).view;
  assert.strictEqual(v.last.places.length, 4);
  assert.strictEqual(v.last.places[3], 0, "whoever gave up is last");

  // back to the waiting room; the spectator sits down on a free seat
  a.send({ t: "end" });
  await a.next((m) => m.t === "room" && !m.view);
  a.send({ t: "unbot", i: 3 });
  await a.next((m) => m.t === "room" && m.members.length === 3);
  c.send({ t: "sit" });
  assert.strictEqual((await c.next((m) => m.t === "joined")).pid, 3);
  d.send({ t: "join", code: joined.code, name: "anna" });
  assert.match((await d.next((m) => m.t === "error")).msg, /vergeben/);
  a.ws.close(); b.ws.close(); c.ws.close(); d.ws.close();
});
