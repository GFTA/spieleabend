"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Game = require("../public/game.js");

const { GEO, RES } = Game;
const names = ["Anna", "Ben", "Cleo", "Dirk"];
const make = (n = 3, target = 10, goal = 1) => Game.newGame(names.slice(0, n).map((name) => ({ name })), goal, target, 2);
const ok = (S, pi, a) => { const r = Game.act(S, pi, a); assert.ok(r.ok, `${JSON.stringify(a)}: ${r.error}`); return r; };
const bad = (S, pi, a) => { const r = Game.act(S, pi, a); assert.strictEqual(r.ok, false, JSON.stringify(a)); return r; };
const hand = (S, pi, h) => { Object.assign(S.players[pi].hand, Game.emptyHand(), h); };
const withRandom = (seq, fn) => { const real = Math.random; let i = 0; Math.random = () => seq[Math.min(i++, seq.length - 1)]; try { return fn(); } finally { Math.random = real; } };

// plays the setup phase with the computer's choices; returns when the first player may roll
function setup(S) {
  let guard = 0;
  while (S.step === "settle" || S.step === "sroad") {
    const pi = S.cur, m = Game.botMove(S, pi);
    ok(S, pi, m);
    assert.ok(++guard < 40);
  }
  assert.strictEqual(S.step, "roll");
}
const rolled = (S, a, b) => withRandom([(a - 1) / 6 + 0.01, (b - 1) / 6 + 0.01], () => ok(S, S.cur, { t: "roll" }));
function mainTurn(S) { // roll something harmless (a 2) and clear the table
  withRandom([0.01, 0.01], () => ok(S, S.cur, { t: "roll" }));
  assert.strictEqual(S.step, "main");
}
const freeVertex = (S, pi) => Game.spots(S, pi, "settlement")[0];

test("the island has 19 hexes, 54 corners, 72 edges and nine ports", () => {
  assert.strictEqual(Game.HEX_N, 19);
  assert.strictEqual(Game.VERT_N, 54);
  assert.strictEqual(Game.EDGE_N, 72);
  assert.strictEqual(GEO.ports.length, 9);
  for (const v of GEO.verts) { assert.ok(v.e.length === 2 || v.e.length === 3); assert.strictEqual(v.e.length, v.n.length); assert.ok(v.h.length >= 1 && v.h.length <= 3); }
  for (const h of GEO.hexes) assert.strictEqual(new Set(h.v).size, 6);
  const ends = new Set(); GEO.ports.forEach((p) => p.v.forEach((v) => { assert.ok(!ends.has(v), "ports never share a corner"); ends.add(v); }));
});

test("a new game lays out the right terrain, numbers and ports, never two red numbers side by side", () => {
  for (let i = 0; i < 40; i++) {
    const S = make(4);
    const count = {}; S.hexes.forEach((h) => { count[h.res] = (count[h.res] || 0) + 1; });
    assert.deepStrictEqual(count, { wood: 4, brick: 3, sheep: 4, wheat: 4, ore: 3, desert: 1 });
    assert.deepStrictEqual(S.hexes.filter((h) => h.num).map((h) => h.num).sort((a, b) => a - b), [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
    assert.strictEqual(S.hexes[S.robber].res, "desert");
    assert.strictEqual(S.ports.filter((p) => p === "any").length, 4);
    for (const r of RES) assert.strictEqual(S.ports.filter((p) => p === r).length, 1);
    const hot = (k) => S.hexes[k].num === 6 || S.hexes[k].num === 8;
    GEO.hexes.forEach((a, x) => GEO.hexes.forEach((b, y) => {
      if (y <= x || !hot(x) || !hot(y)) return;
      assert.ok(a.v.filter((v) => b.v.includes(v)).length < 2, "red numbers touch");
    }));
    assert.strictEqual(S.deck.length, 25);
  }
});

test("settings are normalised", () => {
  assert.strictEqual(Game.normGoal(9), 1);
  assert.strictEqual(Game.normTarget(100), 10);
  assert.strictEqual(Game.normTarget(12), 12);
  assert.strictEqual(Game.normTarget("nonsense"), 10);
  assert.strictEqual(Game.normTarget("constructor"), 10);
  assert.strictEqual(Game.normLevel(3), 3);
  assert.strictEqual(Game.normLevel("__proto__"), 2);
});

test("setup: snake order, distance rule, road next to the new settlement, second settlement pays", () => {
  const S = make(3);
  const order = [];
  const seen = [];
  while (S.step === "settle" || S.step === "sroad") {
    if (S.step === "settle") order.push(S.cur);
    const pi = S.cur, m = Game.botMove(S, pi);
    if (S.step === "settle") {
      bad(S, (pi + 1) % 3, m); // not your turn
      bad(S, pi, { t: "build", k: "road", id: 0 }); // a settlement first
      if (seen.length) { const nb = GEO.verts[seen[0]].n[0]; bad(S, pi, { t: "build", k: "settlement", id: nb }); } // too close
      seen.push(m.id);
    } else {
      const far = Game.spots(S, pi, "road", null).find((e) => GEO.edges[e].a !== S.setupV && GEO.edges[e].b !== S.setupV);
      if (far != null) bad(S, pi, { t: "build", k: "road", id: far });
    }
    const before = Game.total(S.players[pi].hand);
    ok(S, pi, m);
    if (m.k === "settlement" && order.length > 3) assert.ok(Game.total(S.players[pi].hand) >= before, "second settlement pays");
  }
  const f = order[0];
  assert.deepStrictEqual(order, [f, (f + 1) % 3, (f + 2) % 3, (f + 2) % 3, (f + 1) % 3, f]);
  assert.strictEqual(S.step, "roll");
  assert.strictEqual(S.cur, f);
  for (const p of S.players) { assert.strictEqual(p.left.settlement, 3); assert.strictEqual(p.left.road, 13); }
  assert.ok(S.players.some((p) => Game.total(p.hand) > 0));
});

test("roll pays settlements one and cities two, the robber blocks, the bank may run short", () => {
  const S = make(3); setup(S);
  S.vert.fill(null); S.edge.fill(-1);
  const hi = S.hexes.findIndex((h) => h.res !== "desert" && h.num === 8) >= 0 ? S.hexes.findIndex((h) => h.num === 8) : 0;
  S.hexes[hi].num = 8; if (S.hexes[hi].res === "desert") S.hexes[hi].res = "wheat";
  const res = S.hexes[hi].res;
  S.robber = (hi + 1) % 19; if (S.hexes[S.robber].num === 8) S.robber = (hi + 2) % 19;
  const [v1, v2] = GEO.hexes[hi].v.filter((v, i) => i % 3 === 0);
  S.vert[v1] = { o: 0, c: false }; S.vert[v2] = { o: 1, c: true };
  S.players.forEach((p) => hand(S, 0, {})); [0, 1, 2].forEach((i) => hand(S, i, {}));
  S.cur = 0; S.step = "roll";
  const r = rolled(S, 4, 4);
  assert.strictEqual(r.events[0].sum, 8);
  assert.strictEqual(S.players[0].hand[res] >= 1, true);
  assert.strictEqual(S.players[1].hand[res] >= 2, true);
  assert.ok(r.events[0].gains.every((g) => g.n > 0 && g.hex >= 0));
  // robber on the hex: nothing
  S.step = "roll"; [0, 1, 2].forEach((i) => hand(S, i, {})); S.bank[res] = 19; S.robber = hi;
  rolled(S, 4, 4);
  assert.strictEqual(S.players[0].hand[res], 0);
  // bank too small for two players: nobody gets it; only one buyer gets what is left
  S.robber = (hi + 1) % 19; if (S.hexes[S.robber].num === 8) S.robber = (hi + 2) % 19;
  S.step = "roll"; S.bank[res] = 2;
  const r3 = rolled(S, 4, 4);
  assert.strictEqual(S.players[0].hand[res] + S.players[1].hand[res], 0);
  assert.deepStrictEqual(r3.events[0].short, [res]);
});

test("building: costs are paid to the bank, pieces count down, roads must connect, a city replaces its settlement", () => {
  const S = make(3); setup(S); mainTurn(S);
  const pi = S.cur;
  hand(S, pi, {});
  bad(S, pi, { t: "build", k: "road", id: Game.spots(S, pi, "road")[0] }); // no money
  hand(S, pi, { wood: 3, brick: 3, sheep: 2, wheat: 4, ore: 3 });
  const bankBefore = S.bank.wood;
  const e = Game.spots(S, pi, "road")[0];
  ok(S, pi, { t: "build", k: "road", id: e });
  assert.strictEqual(S.edge[e], pi);
  assert.strictEqual(S.bank.wood, bankBefore + 1);
  assert.strictEqual(S.players[pi].left.road, 12);
  const far = [...Array(72).keys()].find((x) => S.edge[x] === -1 && !Game.roadOk(S, pi, x, null));
  bad(S, pi, { t: "build", k: "road", id: far });
  const mine = S.vert.findIndex((b) => b && b.o === pi);
  ok(S, pi, { t: "build", k: "city", id: mine });
  assert.strictEqual(S.vert[mine].c, true);
  assert.strictEqual(S.players[pi].left.city, 3);
  assert.strictEqual(S.players[pi].left.settlement, 4);
  bad(S, pi, { t: "build", k: "city", id: mine }); // already a city
  assert.strictEqual(Game.vpOf(S, pi, false), 3);
  bad(S, (pi + 1) % 3, { t: "build", k: "road", id: 0 });
});

test("a settlement needs a road of your own and the distance rule", () => {
  const S = make(2); setup(S); mainTurn(S);
  const pi = S.cur;
  hand(S, pi, { wood: 5, brick: 5, sheep: 5, wheat: 5 });
  const free = Game.spots(S, pi, "settlement");
  assert.ok(free.every((v) => GEO.verts[v].e.some((e) => S.edge[e] === pi)));
  const noRoad = [...Array(54).keys()].find((v) => !S.vert[v] && !GEO.verts[v].n.some((n) => S.vert[n]) && !GEO.verts[v].e.some((e) => S.edge[e] === pi));
  bad(S, pi, { t: "build", k: "settlement", id: noRoad });
  const near = GEO.verts[S.vert.findIndex((b) => b && b.o === pi)].n[0];
  bad(S, pi, { t: "build", k: "settlement", id: near });
});

test("seven: players with more than seven cards discard half, then the robber moves and steals", () => {
  const S = make(3); setup(S);
  [0, 1, 2].forEach((i) => hand(S, i, {}));
  hand(S, 0, { wood: 4, brick: 4 }); hand(S, 1, { ore: 3 }); hand(S, 2, { wheat: 9 });
  const pi = S.cur;
  S.vert.fill(null); S.edge.fill(-1);
  const target = S.hexes.findIndex((h, i) => i !== S.robber && h.res !== "desert");
  const vv = GEO.hexes[target].v[0];
  const victim = (pi + 1) % 3;
  S.vert[vv] = { o: victim, c: false };
  hand(S, victim, { ore: 3 }); if (victim === 2) hand(S, 2, { wheat: 9 }); if (victim === 0) hand(S, 0, { wood: 4, brick: 4 });
  const r = rolled(S, 3, 4);
  assert.strictEqual(r.events[0].sum, 7);
  assert.strictEqual(S.step, Object.keys(S.disc).length ? "discard" : "robber");
  const need = { ...S.disc };
  assert.ok(Object.keys(need).every((i) => Game.total(S.players[i].hand) > 7));
  for (const i of Object.keys(need)) {
    bad(S, +i, { t: "discard", res: { wood: 1 } }); // wrong count
    const h = Game.emptyHand(); let n = need[i];
    for (const x of RES) { const t = Math.min(n, S.players[i].hand[x]); h[x] = t; n -= t; }
    bad(S, +i, { t: "build", k: "road", id: 0 });
    ok(S, +i, { t: "discard", res: h });
  }
  assert.strictEqual(S.step, "robber");
  bad(S, victim, { t: "robber", hex: target }); // not on turn
  bad(S, pi, { t: "robber", hex: S.robber }); // must move
  const before = Game.total(S.players[victim].hand), mine = Game.total(S.players[pi].hand);
  const res = ok(S, pi, { t: "robber", hex: target });
  assert.strictEqual(S.robber, target);
  assert.strictEqual(S.step, "main");
  if (before > 0) { assert.strictEqual(Game.total(S.players[victim].hand), before - 1); assert.strictEqual(Game.total(S.players[pi].hand), mine + 1); assert.ok(res.events.some((e) => e.t === "steal")); }
});

test("with two possible victims the thief has to choose", () => {
  const S = make(3); setup(S); mainTurn(S);
  S.vert.fill(null);
  const pi = S.cur, a = (pi + 1) % 3, b = (pi + 2) % 3;
  const hx = S.hexes.findIndex((h, i) => i !== S.robber);
  S.vert[GEO.hexes[hx].v[0]] = { o: a, c: false }; S.vert[GEO.hexes[hx].v[2]] = { o: b, c: false };
  hand(S, a, { wood: 1 }); hand(S, b, { ore: 1 });
  S.step = "robber";
  bad(S, pi, { t: "robber", hex: hx });
  bad(S, pi, { t: "robber", hex: hx, victim: pi });
  bad(S, pi, { t: "robber", hex: hx, victim: "constructor" });
  ok(S, pi, { t: "robber", hex: hx, victim: b });
  assert.strictEqual(S.players[b].hand.ore, 0);
});

test("bank trades use the best port: 4:1, 3:1 with a general port, 2:1 with the resource's port", () => {
  const S = make(2); setup(S); mainTurn(S);
  const pi = S.cur;
  S.vert.fill(null);
  assert.strictEqual(Game.portRate(S, pi, "wood"), 4);
  const any = S.ports.indexOf("any"), woodPort = S.ports.indexOf("wood");
  S.vert[GEO.ports[any].v[0]] = { o: pi, c: false };
  assert.strictEqual(Game.portRate(S, pi, "wood"), 3);
  S.vert[GEO.ports[woodPort].v[1]] = { o: pi, c: false };
  assert.strictEqual(Game.portRate(S, pi, "wood"), 2);
  assert.strictEqual(Game.portRate(S, pi, "ore"), 3);
  hand(S, pi, { wood: 2 });
  ok(S, pi, { t: "bank", give: "wood", get: "ore" });
  assert.strictEqual(S.players[pi].hand.ore, 1);
  assert.strictEqual(S.players[pi].hand.wood, 0);
  bad(S, pi, { t: "bank", give: "wood", get: "ore" }); // too few
  bad(S, pi, { t: "bank", give: "ore", get: "ore" });
  hand(S, pi, { sheep: 9 }); S.bank.brick = 0;
  bad(S, pi, { t: "bank", give: "sheep", get: "brick" }); // bank empty
});

test("development cards: bought cards wait a turn, one per turn, knight moves the robber and wins the army", () => {
  const S = make(3); setup(S); mainTurn(S);
  const pi = S.cur;
  hand(S, pi, { sheep: 1, wheat: 1, ore: 1 });
  S.deck = ["knight", "knight", "knight", "knight"];
  ok(S, pi, { t: "buyDev" });
  assert.strictEqual(S.players[pi].devs.length, 1);
  assert.strictEqual(S.deck.length, 3);
  bad(S, pi, { t: "play", card: "knight" }); // bought this turn
  bad(S, pi, { t: "buyDev" }); // no money
  S.players[pi].devs.push({ k: "knight", t: -1 }, { k: "knight", t: -1 }, { k: "knight", t: -1 });
  bad(S, pi, { t: "play", card: "vp" });
  bad(S, pi, { t: "play", card: "constructor" });
  ok(S, pi, { t: "play", card: "knight" });
  assert.strictEqual(S.step, "robber");
  bad(S, pi, { t: "play", card: "knight" }); // one a turn
  ok(S, pi, { t: "robber", hex: [...Array(19).keys()].find((h) => h !== S.robber) });
  assert.strictEqual(S.players[pi].knights, 1);
  S.players[pi].knights = 2; S.devPlayed = false;
  const r = ok(S, pi, { t: "play", card: "knight" });
  assert.strictEqual(S.la, pi);
  assert.ok(r.events.some((e) => e.t === "award" && e.kind === "army"));
  assert.strictEqual(Game.vpOf(S, pi, false), 2 + 2);
});

test("a knight may be played before rolling and the turn goes on with the roll", () => {
  const S = make(2); setup(S);
  const pi = S.cur;
  S.players[pi].devs.push({ k: "knight", t: -1 });
  ok(S, pi, { t: "play", card: "knight" });
  ok(S, pi, { t: "robber", hex: [...Array(19).keys()].find((h) => h !== S.robber) });
  assert.strictEqual(S.step, "roll");
  bad(S, pi, { t: "end" });
});

test("road building, year of plenty and monopoly", () => {
  const S = make(3); setup(S); mainTurn(S);
  const pi = S.cur, o1 = (pi + 1) % 3, o2 = (pi + 2) % 3;
  S.players[pi].devs.push({ k: "road", t: -1 }, { k: "yop", t: -1 }, { k: "mono", t: -1 });
  const e1 = Game.spots(S, pi, "road")[0];
  bad(S, pi, { t: "play", card: "road", edges: [e1, e1] });
  bad(S, pi, { t: "play", card: "road", edges: [] });
  bad(S, pi, { t: "play", card: "road", edges: "constructor" });
  const probe = { ...S, edge: S.edge.slice() }; probe.edge[e1] = pi;
  const e2 = Game.spots(probe, pi, "road")[0];
  ok(S, pi, { t: "play", card: "road", edges: [e1, e2] });
  assert.strictEqual(S.edge[e1], pi); assert.strictEqual(S.edge[e2], pi);
  assert.strictEqual(S.players[pi].left.road, 11);
  bad(S, pi, { t: "play", card: "yop", res: ["wood", "wood"] }); // one card per turn
  S.devPlayed = false;
  bad(S, pi, { t: "play", card: "yop", res: ["wood"] });
  bad(S, pi, { t: "play", card: "yop", res: ["wood", "gold"] });
  hand(S, pi, {});
  ok(S, pi, { t: "play", card: "yop", res: ["wood", "ore"] });
  assert.strictEqual(S.players[pi].hand.wood, 1); assert.strictEqual(S.players[pi].hand.ore, 1);
  S.devPlayed = false;
  hand(S, o1, { sheep: 3 }); hand(S, o2, { sheep: 2, ore: 1 }); hand(S, pi, {});
  const r = ok(S, pi, { t: "play", card: "mono", res: "sheep" });
  assert.strictEqual(S.players[pi].hand.sheep, 5);
  assert.strictEqual(S.players[o1].hand.sheep + S.players[o2].hand.sheep, 0);
  assert.deepStrictEqual(r.events[0].from.map((f) => f.n).sort(), [2, 3]);
});

test("longest road: five in a row takes it, a rival's settlement cuts it", () => {
  const S = make(2); setup(S); mainTurn(S);
  const pi = S.cur, rival = 1 - pi;
  S.vert.fill(null); S.edge.fill(-1);
  // walk a path of 6 edges along the coast
  const path = []; let v = 0, prev = -1;
  const used = new Set();
  while (path.length < 6) {
    const e = GEO.verts[v].e.find((x) => !used.has(x) && GEO.edges[x].a !== prev && GEO.edges[x].b !== prev);
    if (e == null) break;
    used.add(e); path.push(e); const E = GEO.edges[e]; prev = v; v = E.a === v ? E.b : E.a;
  }
  assert.strictEqual(path.length, 6);
  S.vert[GEO.edges[path[0]].a] = { o: pi, c: false };
  hand(S, pi, { wood: 20, brick: 20 }); S.players[pi].left.road = 15;
  for (let i = 0; i < path.length; i++) {
    const r = Game.roadOk(S, pi, path[i], null);
    assert.ok(r, "road " + i + " must connect");
    ok(S, pi, { t: "build", k: "road", id: path[i] });
    if (i === 3) assert.strictEqual(S.lr, -1);
    if (i === 4) assert.strictEqual(S.lr, pi);
  }
  assert.strictEqual(Game.roadLength(S, pi), 6);
  assert.strictEqual(S.players[pi].len, 6);
  // a rival settlement in the middle splits the line into 3 + 3
  const mid = GEO.edges[path[3]].a === GEO.edges[path[2]].a || GEO.edges[path[3]].a === GEO.edges[path[2]].b ? GEO.edges[path[3]].a : GEO.edges[path[3]].b;
  S.vert[mid] = { o: rival, c: false };
  assert.ok(Game.roadLength(S, pi) < 6);
});

test("trading between players: offer, answers, confirmation, nobody wants it, timeout", () => {
  const S = make(3); setup(S); mainTurn(S);
  const pi = S.cur, a = (pi + 1) % 3, b = (pi + 2) % 3;
  hand(S, pi, { wood: 2 }); hand(S, a, { ore: 1 }); hand(S, b, {});
  const give = { wood: 1 }, want = { ore: 1 };
  bad(S, pi, { t: "offer", give: {}, want });
  bad(S, pi, { t: "offer", give: { wood: 1 }, want: { wood: 1 } });
  bad(S, pi, { t: "offer", give: { wood: 5 }, want });
  bad(S, pi, { t: "offer", give: { wood: -1 }, want });
  bad(S, pi, { t: "offer", give, want, to: pi });
  bad(S, pi, { t: "offer", give, want, to: "constructor" });
  ok(S, pi, { t: "offer", give, want });
  bad(S, pi, { t: "offer", give, want }); // one at a time
  bad(S, pi, { t: "end" });
  bad(S, pi, { t: "bank", give: "wood", get: "ore" });
  assert.deepStrictEqual(Game.actors(S), [a, b]);
  bad(S, pi, { t: "accept" }); // not for the offerer
  bad(S, b, { t: "accept" }); // lacks the ore
  ok(S, b, { t: "decline" });
  bad(S, b, { t: "decline" });
  ok(S, a, { t: "accept" });
  assert.deepStrictEqual(Game.actors(S), [pi]);
  bad(S, pi, { t: "confirm", with: b });
  const r = ok(S, pi, { t: "confirm", with: a });
  assert.strictEqual(S.players[pi].hand.ore, 1); assert.strictEqual(S.players[pi].hand.wood, 1);
  assert.strictEqual(S.players[a].hand.wood, 1); assert.strictEqual(S.players[a].hand.ore, 0);
  assert.strictEqual(r.events[0].t, "trade");
  assert.strictEqual(S.trade, null);
  // everybody says no
  ok(S, pi, { t: "offer", give: { wood: 1 }, want: { brick: 1 } });
  ok(S, a, { t: "decline" }); ok(S, b, { t: "decline" });
  assert.strictEqual(S.trade, null);
  // a direct offer only asks that player, and an unanswered offer times out
  ok(S, pi, { t: "offer", give: { wood: 1 }, want: { brick: 1 }, to: b });
  assert.deepStrictEqual(Game.actors(S), [b]);
  bad(S, a, { t: "accept" });
  assert.ok(Game.nextDeadline(S) > 0);
  S.trade.until = Date.now() - 1;
  assert.strictEqual(Game.nextDeadline(S), 0);
  const ev = Game.tick(S);
  assert.ok(ev.length);
  assert.strictEqual(S.trade, null);
  // the offerer can take an offer back
  ok(S, pi, { t: "offer", give: { wood: 1 }, want: { brick: 1 } });
  bad(S, a, { t: "cancel" });
  ok(S, pi, { t: "cancel" });
  assert.strictEqual(S.trade, null);
});

test("reaching the target wins the round, then the game; hidden victory cards count", () => {
  const S = make(2, 10, 2); setup(S); mainTurn(S);
  const pi = S.cur;
  S.players[pi].devs.push(...Array.from({ length: 8 }, () => ({ k: "vp", t: -1 })));
  assert.strictEqual(S.phase, "play");
  hand(S, pi, { wood: 1, brick: 1 });
  const e = Game.spots(S, pi, "road")[0];
  const r = ok(S, pi, { t: "build", k: "road", id: e });
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [pi]);
  assert.strictEqual(S.last.over, false);
  assert.strictEqual(S.players[pi].wins, 1);
  assert.ok(r.events.some((x) => x.t === "end"));
  bad(S, pi, { t: "end" });
  const v = Game.view(S, 1 - pi);
  assert.strictEqual(v.players[pi].vpCards, 8, "victory cards are shown when the round is over");
  ok(S, 0, { t: "next" });
  assert.strictEqual(S.phase, "play");
  assert.strictEqual(S.round, 2);
  assert.strictEqual(S.step, "settle");
  S.players[pi].wins = 1;
  setup(S); mainTurn(S);
  S.players[S.cur].devs.push(...Array.from({ length: 10 }, () => ({ k: "vp", t: -1 })));
  const p2 = S.cur; S.players[p2].wins = 1;
  hand(S, p2, { wood: 1, brick: 1 });
  ok(S, p2, { t: "build", k: "road", id: Game.spots(S, p2, "road")[0] });
  assert.strictEqual(S.last.over, S.players[p2].wins >= 2);
  const w = S.players[p2].wins;
  ok(S, 0, { t: "next" });
  if (w >= 2) assert.strictEqual(S.players.every((p) => p.wins === 0), true);
});

test("the view shows everybody's counts but only your own cards", () => {
  const S = make(3); setup(S); mainTurn(S);
  hand(S, 0, { wood: 2, ore: 1 }); hand(S, 1, { sheep: 4 });
  S.players[1].devs.push({ k: "knight", t: -1 }, { k: "vp", t: -1 });
  const v0 = Game.view(S, 0), v1 = Game.view(S, 1), vs = Game.view(S, -1);
  assert.deepStrictEqual(v0.hand, { wood: 2, brick: 0, sheep: 0, wheat: 0, ore: 1 });
  assert.strictEqual(v0.players[1].n, 4);
  assert.strictEqual(v0.players[1].dev, 2);
  assert.deepStrictEqual(v0.devs, []);
  assert.deepStrictEqual(v1.devs.map((d) => d.k), ["knight", "vp"]);
  assert.strictEqual(v1.devs[0].ok, true);
  assert.strictEqual(vs.hand, null);
  assert.strictEqual(vs.me, -1);
  const json = JSON.stringify(v0);
  assert.ok(!json.includes('"knight"') && !json.includes('"deck":['), "no hidden card in another player's view");
  assert.strictEqual(v0.deck, 25 - 0);
  assert.strictEqual(v0.players[1].vpCards, 0);
  assert.strictEqual(v1.players[1].vpCards, 1);
});

test("hostile messages are rejected and leave the state untouched", () => {
  const S = make(3); setup(S); mainTurn(S);
  const pi = S.cur;
  const snap = JSON.stringify(S);
  const evil = [
    null, 5, "x", [], {}, { t: 5 }, { t: "constructor" }, { t: "__proto__" }, { t: "toString" }, { t: "hasOwnProperty" },
    { t: "build" }, { t: "build", k: "constructor", id: 1 }, { t: "build", k: "road", id: "constructor" }, { t: "build", k: "road", id: -1 },
    { t: "build", k: "road", id: 9999 }, { t: "build", k: "road", id: 1.5 }, { t: "build", k: "settlement", id: NaN }, { t: "build", k: "city", id: {} },
    { t: "discard", res: { constructor: 3 } }, { t: "discard", res: "wood" }, { t: "robber", hex: "__proto__" }, { t: "robber", hex: 99 },
    { t: "bank", give: "constructor", get: "wood" }, { t: "bank", give: "wood", get: "__proto__" }, { t: "bank", give: ["wood"], get: "ore" },
    { t: "play", card: "__proto__" }, { t: "play", card: "knight", hex: 3 }, { t: "play", card: "yop", res: { length: 2 } }, { t: "play", card: "mono", res: "toString" },
    { t: "offer", give: { __proto__: { wood: 5 } }, want: { ore: 1 } }, { t: "offer", give: { wood: "1" }, want: { ore: 1 } }, { t: "offer", give: null, want: null },
    { t: "accept" }, { t: "decline" }, { t: "confirm", with: "constructor" }, { t: "cancel" }, { t: "next" }
  ];
  for (const m of evil) for (const who of [pi, (pi + 1) % 3, -1, 7, "constructor", null]) {
    const r = Game.act(S, who, m);
    assert.strictEqual(r.ok, false, JSON.stringify(m) + " by " + who);
  }
  assert.strictEqual(JSON.stringify(S), snap);
  assert.strictEqual(Game.botMove(S, "constructor"), null);
  assert.strictEqual(Game.botMove(S, 99), null);
});

test("the computer plays legal moves: whole games at every level and every table size end", () => {
  for (const [n, lv] of [[2, 1], [3, 2], [4, 3], [3, 3], [2, 2], [4, 1], [4, 2], [3, 1]]) {
    const S = Game.newGame(names.slice(0, n).map((name) => ({ name, bot: true })), 1, 10, lv);
    let steps = 0;
    while (S.phase === "play" && steps < 4000) {
      const plan = Game.botPlan(S);
      assert.ok(plan, "a computer-only table always has somebody to move: " + S.step);
      const m = Game.botMove(S, plan.pi);
      assert.ok(m, "bot has a move in " + S.step);
      const r = Game.act(S, plan.pi, m);
      assert.ok(r.ok, `${S.step} ${JSON.stringify(m)}: ${r.error}`);
      steps++;
    }
    if (S.phase === "play") continue; // a rare stand-off between two timid computers: the rules were still obeyed
    assert.strictEqual(S.phase, "roundEnd");
    assert.ok(S.last.vp[S.last.winners[0]] >= 10);
    for (const r of RES) {
      const held = S.players.reduce((k, p) => k + p.hand[r], 0);
      assert.strictEqual(held + S.bank[r], 19, "resources are never created or lost");
    }
  }
});

test("a human who has to act is skipped by the host: the computer plays their move", () => {
  const S = Game.newGame([{ name: "Anna" }, { name: "Ben", bot: true }], 1, 10, 2);
  assert.strictEqual(Game.botPlan(S) === null || S.players[Game.actorOf(S)].bot, true);
  const who = Game.actorOf(S);
  const r = ok(S, 0, { t: "skip" });
  assert.ok(r.events.some((e) => e.t === "build"));
  assert.ok(S.log.some((l) => l.includes("übersprungen")));
  setup(S);
  assert.strictEqual(S.step, "roll");
  assert.ok(who >= 0);
});

test("computer players wait like humans: the plan names who, how long and changes with every move", () => {
  const S = Game.newGame([{ name: "Anna" }, { name: "Ben", bot: true }, { name: "Cleo", bot: true }], 1, 10, 2);
  let plan = null, keys = new Set(), guard = 0;
  while (S.step === "settle" || S.step === "sroad") {
    plan = Game.botPlan(S);
    if (!plan) { ok(S, S.cur, Game.botMove(S, S.cur)); continue; } // the human's move, played for them
    assert.ok(S.players[plan.pi].bot);
    assert.ok(plan.delay >= 900);
    assert.ok(!keys.has(plan.key), "key differs per move");
    keys.add(plan.key);
    ok(S, plan.pi, Game.botMove(S, plan.pi));
    assert.ok(++guard < 40);
  }
  assert.strictEqual(Game.botMove(S, 0), S.cur === 0 ? Game.botMove(S, 0) : null);
});

test("the engine is fast: board generation and computer-only games take well under a few seconds", () => {
  let t = Date.now();
  for (let i = 0; i < 300; i++) make(4);
  assert.ok(Date.now() - t < 1500, "300 new boards: " + (Date.now() - t) + " ms");
  t = Date.now();
  for (let g = 0; g < 6; g++) {
    const S = Game.newGame(names.slice(0, 4).map((name) => ({ name, bot: true })), 1, 10, 3);
    let n = 0;
    while (S.phase === "play" && n++ < 3000) { const p = Game.botPlan(S); if (!p) break; if (!Game.act(S, p.pi, Game.botMove(S, p.pi)).ok) break; }
  }
  assert.ok(Date.now() - t < 6000, "six full games: " + (Date.now() - t) + " ms");
  const S = make(4); setup(S);
  S.vert.fill(null);
  for (let e = 0; e < 72; e += 2) S.edge[e] = e % 4 === 0 ? 0 : 1;
  t = Date.now();
  for (let i = 0; i < 300; i++) Game.roadLength(S, 0);
  assert.ok(Date.now() - t < 1500, "road length: " + (Date.now() - t) + " ms");
});
