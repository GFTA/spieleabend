"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sudoku-"));
const { server, wss, rooms } = require("../server.js");
const Game = require("../public/game.js");
test.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let waiter = null;
  ws.on("message", (d) => { inbox.push(JSON.parse(d)); if (waiter) waiter(); });
  const next = (pred, ms = 5000) => new Promise((res, rej) => {
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

test("rooms, shared puzzle race, privacy, spectator and computer opponent over WebSockets", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;

  const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
  assert.strictEqual(info.sudoku, true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Sudoku/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);

  const a = client(port), b = client(port);
  await a.open; await b.open;
  a.send({ t: "create", name: "Anna", goal: 1, level: 1, avatar: "🐙" });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code.toLowerCase(), name: "Ben", avatar: "🦖" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.members[0].avatar, "🐙");
  assert.strictEqual(lobby.level, 1);

  a.send({ t: "settings", level: 2 });
  await a.next((m) => m.t === "room" && m.level === 2);
  a.send({ t: "settings", level: 1 });
  b.send({ t: "ready", on: true });
  await a.next((m) => m.t === "room" && m.members[1].ready);
  a.send({ t: "start" });
  let va = (await a.next((m) => m.t === "room" && m.view)).view;
  let vb = (await b.next((m) => m.t === "room" && m.view)).view;
  assert.strictEqual(va.level, 1);
  assert.deepStrictEqual(va.puzzle, vb.puzzle);
  assert.ok(va.players[0].grid);
  assert.strictEqual(va.players[1].grid, null);
  assert.ok(vb.players[1].grid);
  assert.strictEqual(vb.players[0].grid, null);

  // Anna solves via submit once the grid is complete (one act avoids the rate limit).
  const room = rooms.get(joined.code);
  const solution = room.state.solution;
  const empties = va.puzzle.map((n, i) => (n ? -1 : i)).filter((i) => i >= 0);
  // fill locally on the server state is not allowed; send sets with a small pause
  for (let k = 0; k < empties.length; k++) {
    const i = empties[k];
    a.flush(); b.flush();
    a.send({ t: "act", a: { t: "set", i, n: solution[i] } });
    const pred = k === empties.length - 1
      ? (m) => m.t === "error" || (m.t === "room" && m.view && m.view.phase === "roundEnd")
      : (m) => m.t === "error" || (m.t === "room" && m.view && m.view.players[0].filled === k + 1);
    const got = await a.next(pred, 8000);
    assert.ok(got.view, got.msg || "set failed");
    va = got.view;
    await new Promise((r) => setTimeout(r, 40)); // stay under the server rate limit
  }
  assert.strictEqual(va.phase, "roundEnd");
  assert.deepStrictEqual(va.last.winners, [0]);
  assert.ok(va.solution);
  assert.ok(va.players[1].grid); // reveal after round

  b.send({ t: "act", a: { t: "set", i: empties[0], n: 1 } });
  assert.match((await b.next((m) => m.t === "error")).msg, /vorbei|fertig|Runde/i);

  // back to lobby, Ben leaves, computer joins and races Anna
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
  va = (await a.next((m) => m.t === "room" && m.view)).view;
  // wait until the computer (or Anna if she somehow wins) finishes — bot fills on a timer
  const end = await a.next((m) => m.t === "room" && m.view && m.view.phase === "roundEnd", 60000);
  assert.strictEqual(end.view.phase, "roundEnd");
  assert.ok(rooms.get(joined.code));
  a.ws.close(); b.ws.close();
});
