"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { createParties, PartyError } = require("../party.js");

// a stream that just remembers what was written to it
function stream() {
  const s = { chunks: [], ended: false, writeHead() {}, write(c) { s.chunks.push(c); }, end() { s.ended = true; } };
  s.last = () => JSON.parse([...s.chunks].reverse().find((c) => c.includes("data: {\"code\"") || c.includes("\"members\"")).split("data: ").pop());
  return s;
}
const GAMES = [
  { id: "phase10", name: "Phase 10", status: "http://phase10:8080/info" },
  { id: "uno", name: "Uno", status: "http://uno:8080/info" }
];
function setup(reply) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    return reply ? reply(calls.at(-1)) : { ok: true, json: async () => ({ code: "ABCD", max: 6, seats: calls.at(-1).body.members.map((m) => ({ name: m.name, secret: "s-" + m.name })), watch: [], out: [] }) };
  };
  return { calls, parties: createParties({ games: () => GAMES, secret: "geheim", fetchImpl }) };
}

test("create and join: names are unique, the code works, everyone sees the same list", () => {
  const { parties } = setup();
  const a = parties.create("Anna", "🦊");
  assert.strictEqual(a.view.host, 0);
  assert.match(a.view.code, /^[A-Z]{4}$/);
  assert.throws(() => parties.create("  ", "🦊"), PartyError);
  const b = parties.join(a.view.code.toLowerCase(), "Ben", "🐼");
  assert.deepStrictEqual(b.view.members.map((m) => m.name), ["Anna", "Ben"]);
  assert.strictEqual(b.view.you, 1);
  assert.throws(() => parties.join(a.view.code, "anna", "🐸"), /vergeben/);
  assert.throws(() => parties.join("ZZZZ", "Cem", "🐸"), /nicht/);

  const sa = stream(), sb = stream();
  parties.attach(a.view.code, a.secret, sa);
  parties.attach(a.view.code, b.secret, sb);
  assert.strictEqual(sa.last().members.find((m) => m.name === "Ben").online, true);
  assert.strictEqual(sb.last().you, 1);
  assert.throws(() => parties.attach(a.view.code, "falsch", stream()), /nicht/);
});

test("only the host launches; the game server gets the members host first, each one gets a personal way in", async () => {
  const { parties, calls } = setup();
  const a = parties.create("Anna", "🦊"), code = a.view.code;
  const b = parties.join(code, "Ben", "🐼");
  const sa = stream(), sb = stream();
  parties.attach(code, a.secret, sa); parties.attach(code, b.secret, sb);
  await assert.rejects(parties.act(code, b.secret, { t: "launch", game: "phase10" }), /Host/);
  await assert.rejects(parties.act(code, a.secret, { t: "launch", game: "gibtsnicht" }), /gibt es nicht/);
  await parties.act(code, a.secret, { t: "launch", game: "phase10" });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, "http://phase10:8080/party-room");
  assert.strictEqual(calls[0].opts.headers["x-party-secret"], "geheim");
  assert.deepStrictEqual(calls[0].body.members.map((m) => m.name), ["Anna", "Ben"]);
  const ga = sa.last().game, gb = sb.last().game;
  assert.deepStrictEqual([ga.role, ga.params], ["play", { pr: "ABCD", ps: "s-Anna" }]);
  assert.deepStrictEqual([gb.role, gb.params], ["play", { pr: "ABCD", ps: "s-Ben" }]);
  assert.strictEqual(JSON.stringify(sa.last()).includes("s-Ben"), false, "nobody sees another member's seat secret");
});

test("a party larger than the game: watchers get a watch link, the rest none", async () => {
  const { parties } = setup(({ body }) => ({
    ok: true,
    json: async () => ({ code: "WXYZ", max: 2, seats: [{ name: "Anna", secret: "x1" }, { name: "Ben", secret: "x2" }], watch: ["Cem"], out: ["Dora"] })
  }));
  const a = parties.create("Anna", "🦊"), code = a.view.code;
  const others = ["Ben", "Cem", "Dora"].map((n) => parties.join(code, n, "🐼"));
  const streams = [a, ...others].map((m) => { const s = stream(); parties.attach(code, m.secret, s); return s; });
  await parties.act(code, a.secret, { t: "launch", game: "phase10" });
  const roles = streams.map((s) => s.last().game.role);
  assert.deepStrictEqual(roles, ["play", "play", "watch", "out"]);
  assert.deepStrictEqual(streams[2].last().game.params, { pr: "WXYZ", pw: "Cem" });
  assert.strictEqual(streams[3].last().game.params, null);
  assert.deepStrictEqual([streams[0].last().game.playing, streams[0].last().game.watching, streams[0].last().game.out], [2, 1, 1]);
});

test("launch errors: game server down or refusing keeps the party unchanged", async () => {
  let mode = "down";
  const { parties } = setup(() => { if (mode === "down") throw new Error("ECONNREFUSED"); return { ok: false, json: async () => ({ error: "Der Server ist voll." }) }; });
  const a = parties.create("Anna", "🦊"), s = stream();
  parties.attach(a.view.code, a.secret, s);
  await assert.rejects(parties.act(a.view.code, a.secret, { t: "launch", game: "uno" }), /nicht erreichbar/);
  mode = "full";
  await assert.rejects(parties.act(a.view.code, a.secret, { t: "launch", game: "uno" }), /voll/);
  assert.strictEqual(s.last().game, null);
  mode = "ok"; // and it is not stuck in "launching"
  await assert.rejects(parties.act(a.view.code, a.secret, { t: "launch", game: "uno" }), /voll/);
});

test("ready flag, kick, leave and host hand-over", async () => {
  const { parties } = setup();
  const a = parties.create("Anna", "🦊"), code = a.view.code;
  const b = parties.join(code, "Ben", "🐼"), c = parties.join(code, "Cem", "🐸");
  const sa = stream(), sb = stream(), sc = stream();
  parties.attach(code, a.secret, sa); parties.attach(code, b.secret, sb); parties.attach(code, c.secret, sc);
  await parties.act(code, b.secret, { t: "ready", on: true });
  assert.strictEqual(sa.last().members[1].ready, true);
  await assert.rejects(parties.act(code, b.secret, { t: "kick", index: 2 }), /Host/);
  await parties.act(code, a.secret, { t: "kick", index: 2 });
  assert.strictEqual(sc.ended, true);
  assert.deepStrictEqual(sa.last().members.map((m) => m.name), ["Anna", "Ben"]);
  await assert.rejects(parties.act(code, c.secret, { t: "ready", on: true }), /nicht/);
  await parties.act(code, a.secret, { t: "leave" });
  assert.strictEqual(sb.last().host, 0, "Ben is host now");
  await parties.act(code, b.secret, { t: "leave" });
  assert.strictEqual(parties.count(), 0, "an empty party disappears");
});

test("peek gives a link preview without anything that lets you in", () => {
  const { parties } = setup();
  const a = parties.create("Anna", "🦊");
  parties.join(a.view.code, "Ben", "🐼");
  assert.deepStrictEqual(parties.peek(a.view.code.toLowerCase()), { code: a.view.code, host: "Anna", avatar: "🦊", count: 2, game: null });
  assert.strictEqual(parties.peek("ZZZZ"), null);
});
