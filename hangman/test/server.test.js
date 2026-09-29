"use strict";
// Galgenmännchen online: settings, a player picks the word, the others guess, the word stays hidden.
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.PARTY_SECRET = "test-geheim";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hangman-"));
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

test("a player picks the word, the other guesses, nobody else sees it", async () => {
  await new Promise((r) => (server.listening ? r() : server.once("listening", r)));
  const port = server.address().port;
  const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
  assert.strictEqual(info.hangman, true);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /Galgenmännchen/);

  const anna = client(port), ben = client(port);
  await Promise.all([anna.open, ben.open]);
  anna.send({ t: "create", name: "Anna", pick: "player", goal: 3 });
  const { code } = await anna.next((m) => m.t === "joined");
  const lobby = await anna.next((m) => m.t === "room");
  assert.strictEqual(lobby.pick, "player");
  assert.strictEqual(lobby.goal, 3);
  anna.send({ t: "settings", pick: "nonsense", rules: { hard: true } });
  const set = await anna.next((m) => m.t === "room" && m.rules.hard);
  assert.strictEqual(set.pick, "random", "unknown picks fall back to random words");
  anna.send({ t: "settings", pick: "player" });
  await anna.next((m) => m.t === "room" && m.pick === "player");

  ben.send({ t: "join", code, name: "Ben" });
  await ben.next((m) => m.t === "joined");
  ben.send({ t: "ready", on: true });
  await anna.next((m) => m.t === "room" && m.members.length === 2 && m.members[1].ready);
  anna.send({ t: "start" });
  const a1 = await anna.next((m) => m.t === "room" && m.view);
  const chooser = a1.view.chooser, picker = chooser === 0 ? anna : ben, guesser = chooser === 0 ? ben : anna;
  assert.strictEqual(a1.view.phase, "choose");
  assert.strictEqual(a1.view.maxErrors, 6);

  picker.send({ t: "act", a: { t: "word", word: "zwei Wörter" } });
  assert.match((await picker.next((m) => m.t === "error")).msg, /Leerzeichen/);
  picker.send({ t: "act", a: { t: "word", word: "Straße", hint: "draußen" } });
  const pv = await picker.next((m) => m.t === "room" && m.view && m.view.phase === "play");
  assert.strictEqual(pv.view.word, "STRAßE", "the picker sees the word");
  const gv = await guesser.next((m) => m.t === "room" && m.view && m.view.phase === "play");
  assert.strictEqual(gv.view.word, null, "the guesser does not");
  assert.strictEqual(gv.view.hint, "draußen");
  assert.ok(JSON.stringify(rooms.get(code).state).includes("STRAßE"));
  assert.ok(!JSON.stringify(gv).includes("STRAßE"), "not anywhere in the guesser's message");

  guesser.send({ t: "act", a: { t: "letter", l: "a" } });
  const hit = await guesser.next((m) => m.t === "room" && m.view && m.view.guessed.includes("A"));
  assert.deepStrictEqual(hit.view.mask, [null, null, null, "A", null, null]);
  picker.send({ t: "act", a: { t: "letter", l: "S" } });
  assert.match((await picker.next((m) => m.t === "error")).msg, /du rätst nicht mit/);
  guesser.send({ t: "act", a: { t: "solve", word: "straße" } });
  const end = await guesser.next((m) => m.t === "room" && m.view && m.view.phase === "roundEnd");
  assert.strictEqual(end.view.word, "STRAßE");
  assert.strictEqual(end.view.last.solver, end.view.me);
});

test("random words with a computer player: the bot guesses on its own", async () => {
  const port = server.address().port;
  const c = client(port); await c.open;
  c.send({ t: "create", name: "Cleo", pick: "random", level: 3 });
  await c.next((m) => m.t === "room");
  c.send({ t: "bot" });
  await c.next((m) => m.t === "room" && m.members.length === 2);
  c.send({ t: "start" });
  const v = await c.next((m) => m.t === "room" && m.view);
  assert.strictEqual(v.view.phase, "play");
  assert.ok(v.view.cat, "random words come with their category");
  // whenever it is Cleo's turn she plays the rarest letter still open; the round has to end
  const rare = "QXYßJÖÄÜVPKZFWBOMGCLUHDTARSINE".split("");
  const done = await (async () => {
    let m = v; // Cleo may be the one to start
    for (let k = 0; k < 120; k++) {
      if (m.view.phase === "roundEnd") return m;
      if (m.view.cur === m.view.me) {
        const l = rare.find((x) => !m.view.guessed.includes(x) && !m.view.wrong.includes(x));
        c.send({ t: "act", a: { t: "letter", l } });
      }
      m = await c.next((x) => x.t === "room" && x.view, 5000);
    }
  })();
  assert.ok(done, "the round ended");
});

test("a party asks for a room: seats come pre-filled and resume, ready decides an oversize party, the rest watch", async () => {
  await new Promise((r) => (server.listening ? r() : server.once("listening", r)));
  const port = server.address().port, url = `http://127.0.0.1:${port}/party-room`;
  const post = (secret, body) => fetch(url, { method: "POST", headers: { "x-party-secret": secret, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.strictEqual((await fetch(url)).status, 405);
  assert.strictEqual((await post("falsch", { members: [{ name: "A" }] })).status, 403);
  assert.strictEqual((await post("test-geheim", { members: [] })).status, 400);

  // 11 people, 8 seats: the host and the ready ones sit, the others watch (the game has watchers)
  const names = Array.from({ length: 11 }, (_, i) => "P" + i);
  const members = names.map((name, i) => ({ name, avatar: "🦊", ready: [1, 2, 3, 4, 5, 6, 9, 10].includes(i) }));
  const res = await post("test-geheim", { party: "PART", members });
  assert.strictEqual(res.status, 200);
  const out = await res.json();
  assert.strictEqual(out.max, 8);
  assert.deepStrictEqual(out.seats.map((s) => s.name), ["P0", "P1", "P2", "P3", "P4", "P5", "P6", "P9"]);
  assert.deepStrictEqual(out.watch, ["P7", "P8", "P10"]);
  assert.deepStrictEqual(out.out, []);

  const host = client(port), guest = client(port);
  await Promise.all([host.open, guest.open]);
  host.send({ t: "resume", code: out.code, secret: out.seats[0].secret });
  const joined = await host.next((m) => m.t === "room");
  assert.strictEqual(joined.you, 0);
  assert.strictEqual(joined.host, 0);
  assert.strictEqual(joined.party, "PART");
  assert.strictEqual(joined.members.length, 8);
  assert.deepStrictEqual(joined.members.map((m) => m.ready), [false, true, true, true, true, true, true, true], "the party's ready flags carry over");
  guest.send({ t: "join", code: out.code, name: "P7", watch: true });
  const w = await guest.next((m) => m.t === "watching");
  assert.strictEqual(w.name, "P7");
  assert.strictEqual((await guest.next((m) => m.t === "room")).you, -1);

  // a small party: everybody sits, nobody watches
  const small = await (await post("test-geheim", { members: [{ name: "A" }, { name: "B" }, { name: "a" }] })).json();
  assert.deepStrictEqual(small.seats.map((s) => s.name), ["A", "B"], "duplicate names are dropped");
  host.ws.close(); guest.ws.close();
});
