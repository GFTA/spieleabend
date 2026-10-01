"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "15";
process.env.RATE_PER_S = "5000";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "carcassonne-"));
const { server, wss, rooms } = require("../server.js");
const Game = require("../public/game.js");
test.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let waiter = null;
  ws.on("message", (d) => { inbox.push(JSON.parse(d)); if (waiter) waiter(); });
  const next = (pred, ms = 5000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout waiting for " + pred)), ms);
    const check = () => {
      const i = inbox.findIndex(pred);
      if (i >= 0) { clearTimeout(t); waiter = null; res(inbox.splice(0, i + 1).pop()); }
    };
    waiter = check; check();
  });
  const flush = () => { inbox.length = 0; };
  return { ws, next, flush, send: (m) => ws.send(JSON.stringify(m)), open: new Promise((r) => ws.on("open", r)) };
}

test("info, create, bot opponent, start, place+meeple, view has no stack", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;

  const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
  assert.strictEqual(info.carcassonne, true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Carcassonne/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);

  const a = client(port);
  await a.open;
  a.send({ t: "create", name: "Anna", goal: 1, level: 1, avatar: "🐙" });
  const joined = await a.next((m) => m.t === "joined");
  a.send({ t: "bot" });
  const withBot = await a.next((m) => m.t === "room" && m.members.length === 2 && m.members[1].bot);
  assert.strictEqual(withBot.members[1].name, Game.BOT_NAMES[0]);
  a.send({ t: "settings", level: 1 });
  a.send({ t: "start" });
  let room = await a.next((m) => m.t === "room" && m.view);
  let v = room.view;
  assert.ok(v.stackLeft >= 0);
  assert.ok(!("stack" in v));
  assert.ok(Array.isArray(v.board));
  assert.ok(v.board.some((t) => t.id === "D"));

  // Wait until Anna is on turn (bot may start)
  let guard = 0;
  while (v.phase !== "roundEnd" && guard++ < 200) {
    if (v.cur === 0 && v.phase === "place") {
      a.flush();
      const tries = [];
      for (const t of v.board) {
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          for (let r = 0; r < 4; r++) tries.push({ x: t.x + dx, y: t.y + dy, r });
        }
      }
      let done = false;
      for (const m of tries) {
        a.send({ t: "act", a: { t: "place", x: m.x, y: m.y, r: m.r } });
        const got = await a.next((msg) => msg.t === "error" || (msg.t === "room" && msg.view));
        if (got.view) { v = got.view; done = true; break; }
      }
      assert.ok(done, "could not place");
      if (v.phase === "meeple" && v.cur === 0) {
        a.send({ t: "act", a: { t: "meeple", feature: null } });
        v = (await a.next((m) => m.t === "room" && m.view)).view;
      }
      // one full human turn is enough for the smoke test
      break;
    }
    if (v.phase === "meeple" && v.cur === 0) {
      a.send({ t: "act", a: { t: "meeple", feature: null } });
      v = (await a.next((m) => m.t === "room" && m.view)).view;
      break;
    }
    // wait for bot sub-step
    try {
      const prev = `${v.turn}:${v.phase}:${v.cur}:${v.board.length}`;
      v = (await a.next((m) => m.t === "room" && m.view && `${m.view.turn}:${m.view.phase}:${m.view.cur}:${m.view.board.length}` !== prev, 2000)).view;
    } catch { break; }
  }
  assert.ok(v.board.length >= 2);
  assert.ok(rooms.get(joined.code));
  a.ws.close();
});
