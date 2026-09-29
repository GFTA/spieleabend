"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vier-"));
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
  return { ws, next, send: (m) => ws.send(JSON.stringify(m)), open: new Promise((r) => ws.on("open", r)) };
}

test("rooms, avatars, spectators, a full game and a computer opponent over WebSockets", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;

  const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
  assert.strictEqual(info.vier, true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Vier gewinnt/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/vendor/qrcode.js`)).status, 200);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);

  const a = client(port), b = client(port), c = client(port);
  await a.open; await b.open; await c.open;
  a.send({ t: "create", name: "Anna", size: 8, goal: 1, rules: { popout: true }, avatar: "🐙", color: "#e0393e" });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code.toLowerCase(), name: "Ben", avatar: "💣", color: "red" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.members[0].avatar, "🐙");
  assert.strictEqual(lobby.members[0].color, "#e0393e");
  assert.strictEqual(lobby.members[1].color, "", "colours outside the palette are dropped");
  assert.ok(Game.AVATARS.includes(lobby.members[1].avatar));
  assert.strictEqual(lobby.size, 8);
  assert.deepStrictEqual(lobby.rules, { popout: true, five: false, clock: false });

  // the room is full: a third person watches
  c.send({ t: "join", code: joined.code, name: "Chris", avatar: "🦉" });
  assert.strictEqual((await c.next((m) => m.t === "watching")).name, "Chris");
  a.send({ t: "bot" });
  assert.match((await a.next((m) => m.t === "error")).msg, /Mehr als 2/);

  b.send({ t: "avatar", color: "#2d6fd6" });
  assert.strictEqual((await a.next((m) => m.t === "room" && m.members[1] && m.members[1].color === "#2d6fd6")).members[1].avatar, lobby.members[1].avatar, "a colour change keeps the avatar");
  b.send({ t: "avatar", avatar: "🦖" });
  await a.next((m) => m.t === "room" && m.members[1].avatar === "🦖");
  b.send({ t: "start" });
  assert.match((await b.next((m) => m.t === "error")).msg, /Nur/);
  b.send({ t: "ready", on: true }); // the host starts with everyone who is ready
  await a.next((m) => m.t === "room" && m.members[1].ready);
  a.send({ t: "settings", size: 7 });
  await a.next((m) => m.t === "room" && m.size === 7);
  a.send({ t: "start" });
  let v = (await a.next((m) => m.t === "room" && m.view)).view;
  assert.strictEqual(v.cols, 7);
  assert.deepStrictEqual(v.players.map((p) => p.avatar), ["🐙", "🦖"]);
  b.send({ t: "avatar", avatar: "🦊" }); // not during a game
  const watched = await c.next((m) => m.t === "room" && m.view);
  assert.strictEqual(watched.you, -1);

  // play: whoever begins stacks column 0, the other column 1, first to four wins
  const seat = [a, b];
  let guard = 0;
  while (v.phase === "play" && guard++ < 20) {
    const me = seat[v.cur], col = v.cur === 0 ? 0 : 1, turn = v.turn;
    me.send({ t: "act", a: { t: "drop", col } });
    const got = await me.next((m) => m.t === "error" || (m.t === "room" && m.view && (m.view.turn > turn || m.view.phase === "roundEnd")));
    assert.ok(got.view, got.msg);
    v = got.view;
  }
  assert.strictEqual(v.phase, "roundEnd");
  assert.strictEqual(v.last.cells.length, 4);
  assert.strictEqual(rooms.get(joined.code).members[1].avatar, "🦖");
  c.send({ t: "react", e: "Gut gespielt!" });
  assert.deepStrictEqual(await a.next((m) => m.t === "react"), { t: "react", pi: -1, e: "Gut gespielt!", name: "Chris" });

  // back to the waiting room; Ben leaves, the spectator sits down, then the computer takes over
  a.send({ t: "end" });
  await a.next((m) => m.t === "room" && !m.view);
  b.send({ t: "leave" });
  await b.next((m) => m.t === "left");
  c.send({ t: "sit" });
  assert.strictEqual((await c.next((m) => m.t === "joined")).pid, 1);
  c.send({ t: "leave" });
  await c.next((m) => m.t === "left");
  await a.next((m) => m.t === "room" && m.members.length === 1 && m.watchers.length === 0);
  a.send({ t: "bot" });
  const withBot = await a.next((m) => m.t === "room" && m.members.length === 2 && m.members[1].bot);
  assert.deepStrictEqual(withBot.members[1], { name: "Robo Rudi", bot: true, avatar: "🤖", color: "", online: true, lobby: false, ready: false });
  a.send({ t: "settings", level: 1 });
  a.send({ t: "start" });
  v = (await a.next((m) => m.t === "room" && m.view)).view;
  // Anna always drops into the middle; the computer answers on its own
  guard = 0;
  while (v.phase === "play" && guard++ < 60) {
    if (v.cur === 1) { v = (await a.next((m) => m.t === "room" && m.view && (m.view.cur === 0 || m.view.phase !== "play"))).view; continue; }
    const free = [3, 2, 4, 1, 5, 0, 6].find((col) => v.grid[col + (v.rows - 1) * v.cols] === -1);
    const turn = v.turn;
    a.send({ t: "act", a: { t: "drop", col: free } });
    v = (await a.next((m) => m.t === "room" && m.view && (m.view.turn > turn || m.view.phase !== "play"))).view;
  }
  assert.strictEqual(v.phase, "roundEnd");
  a.ws.close(); b.ws.close(); c.ws.close();
});
