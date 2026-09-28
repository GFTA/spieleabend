"use strict";
// Room chat (shared/room-server.js): lines reach everyone, are cleaned and capped, rate-limited,
// and come back as a log after a reconnect.
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "maedn-chat-"));
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

test("chat in a room: everyone gets it, clean text, one per second, log after reconnect", async () => {
  await new Promise((r) => (server.listening ? r() : server.once("listening", r)));
  const port = server.address().port;
  const anna = client(port), ben = client(port);
  await Promise.all([anna.open, ben.open]);
  anna.send({ t: "create", name: "Anna", avatar: "🦊" });
  const { code, secret } = await anna.next((m) => m.t === "joined");
  assert.deepStrictEqual((await anna.next((m) => m.t === "chatlog")).list, []);
  ben.send({ t: "join", code, name: "Ben" });
  await ben.next((m) => m.t === "chatlog");

  anna.send({ t: "chat", text: "  Hallo\n\n  zusammen  " });
  const a1 = await ben.next((m) => m.t === "chat");
  assert.strictEqual(a1.line.text, "Hallo zusammen");
  assert.strictEqual(a1.line.name, "Anna");
  assert.strictEqual(a1.line.avatar, "🦊");
  assert.strictEqual(a1.line.pi, 0);
  await anna.next((m) => m.t === "chat"); // the sender gets it too

  anna.send({ t: "chat", text: "zu schnell" });
  assert.match((await anna.next((m) => m.t === "error")).msg, /eine Nachricht pro Sekunde/);
  ben.send({ t: "chat", text: "   " }); // empty: ignored
  ben.send({ t: "chat", text: "x".repeat(500) });
  assert.strictEqual((await anna.next((m) => m.t === "chat")).line.text.length, 200);

  // a reconnect brings back the log; the room keeps at most 100 lines
  anna.ws.close();
  const anna2 = client(port); await anna2.open;
  anna2.send({ t: "resume", code, secret });
  const log = await anna2.next((m) => m.t === "chatlog");
  assert.deepStrictEqual(log.list.map((l) => l.name), ["Anna", "Ben"]);
  rooms.get(code).chat = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, text: String(i) }));
  await new Promise((r) => setTimeout(r, 1000));
  anna2.send({ t: "chat", text: "neu" });
  await anna2.next((m) => m.t === "chat" && m.line.text === "neu");
  assert.strictEqual(rooms.get(code).chat.length, 100);
  assert.strictEqual(rooms.get(code).chat[99].text, "neu");
});
