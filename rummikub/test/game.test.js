"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Game = require("../public/game.js");

// color 0..3, number 1..13, copy 0|1; the jokers are 104 and 105
const T = (c, n, k = 0) => c * 26 + (n - 1) * 2 + k;
const J = 104, J2 = 105;
const two = (meld = 30, level = 2) => Game.newGame([{ name: "Anna" }, { name: "Ben" }], 1, meld, level);
// a fixed position: player 0 on turn with this rack, the given table, player 1 with a dummy rack
function setup(rack, table = [], { meld = 30, melded = false, other = [T(3, 13), T(3, 12), T(2, 1)], level = 2 } = {}) {
  const S = two(meld, level);
  S.cur = 0; S.phase = "play";
  S.players[0].rack = rack.slice(); S.players[0].melded = melded || meld === 0;
  S.players[1].rack = other.slice(); S.players[1].melded = melded || meld === 0;
  S.table = table.map((s) => s.slice());
  const used = new Set([].concat(rack, other, ...table));
  S.pool = Array.from({ length: 106 }, (_, i) => i).filter((i) => !used.has(i));
  return S;
}

test("tiles: 106 ids, 4 colors x 13 numbers x 2 and two jokers", () => {
  const seen = new Set();
  for (let id = 0; id < 106; id++) {
    if (id >= 104) { assert.ok(Game.isJoker(id)); assert.strictEqual(Game.pointsOf(id), 30); continue; }
    seen.add(`${Game.colorOf(id)}:${Game.numOf(id)}`);
    assert.strictEqual(Game.pointsOf(id), Game.numOf(id));
  }
  assert.strictEqual(seen.size, 52);
  assert.strictEqual(T(2, 7, 1), 2 * 26 + 6 * 2 + 1);
  assert.strictEqual(Game.numOf(T(2, 7, 1)), 7);
  assert.strictEqual(Game.colorOf(T(2, 7, 1)), 2);
});

test("settings are normalised", () => {
  assert.strictEqual(Game.normGoal(9), 1);
  assert.strictEqual(Game.normGoal(3), 3);
  assert.strictEqual(Game.normMeld(20), 20);
  assert.strictEqual(Game.normMeld(0), 0);
  assert.strictEqual(Game.normMeld("constructor"), 30);
  assert.strictEqual(Game.normMeld(99), 30);
  assert.strictEqual(Game.normLevel(3), 3);
  assert.strictEqual(Game.normLevel(7), 2);
});

test("a new round deals 14 tiles each from 106 different tiles", () => {
  for (const n of [2, 3, 4]) {
    const S = Game.newGame(Array.from({ length: n }, (_, i) => ({ name: "P" + i })), 1, 30, 2);
    const all = [].concat(S.pool, ...S.players.map((p) => p.rack));
    assert.strictEqual(all.length, 106);
    assert.strictEqual(new Set(all).size, 106);
    for (const p of S.players) assert.strictEqual(p.rack.length, 14);
    assert.strictEqual(S.pool.length, 106 - 14 * n);
    assert.ok(S.cur >= 0 && S.cur < n);
  }
});

test("analyze: runs", () => {
  const run = Game.analyze([T(1, 5), T(1, 3), T(1, 4)]);
  assert.strictEqual(run.kind, "run");
  assert.deepStrictEqual(run.order, [T(1, 3), T(1, 4), T(1, 5)]);
  assert.strictEqual(run.value, 12);
  assert.ok(Game.analyze([T(0, 11), T(0, 12), T(0, 13)]), "ends at 13");
  assert.ok(Game.analyze([T(0, 1), T(0, 2), T(0, 3)]), "starts at 1");
  assert.strictEqual(Game.analyze([T(0, 12), T(0, 13), T(0, 1)]), null, "no wrap-around");
  assert.strictEqual(Game.analyze([T(0, 3), T(0, 4)]), null, "two tiles are not a set");
  assert.strictEqual(Game.analyze([T(0, 3), T(0, 4), T(1, 5)]), null, "one color only");
  assert.strictEqual(Game.analyze([T(0, 3), T(0, 4), T(0, 4, 1), T(0, 5)]), null, "no number twice");
  assert.strictEqual(Game.analyze([T(0, 3), T(0, 4), T(0, 6)]), null, "gap");
  const all = Array.from({ length: 13 }, (_, i) => T(2, i + 1));
  assert.strictEqual(Game.analyze(all).value, 91);
  assert.strictEqual(Game.analyze(all.concat([T(2, 1, 1)])), null);
});

test("analyze: groups", () => {
  const g = Game.analyze([T(3, 7), T(0, 7), T(1, 7)]);
  assert.strictEqual(g.kind, "group");
  assert.strictEqual(g.value, 21);
  assert.deepStrictEqual(g.order, [T(0, 7), T(1, 7), T(3, 7)]);
  assert.strictEqual(Game.analyze([T(0, 7), T(1, 7), T(2, 7), T(3, 7)]).value, 28);
  assert.strictEqual(Game.analyze([T(0, 7), T(1, 7), T(1, 7, 1)]), null, "colors must differ");
  assert.strictEqual(Game.analyze([T(0, 7), T(1, 7), T(2, 7), T(3, 7), J]), null, "at most four");
  assert.strictEqual(Game.analyze([T(0, 7), T(1, 8), T(2, 7)]), null);
});

test("analyze: jokers stand in for any tile", () => {
  const mid = Game.analyze([T(0, 4), J, T(0, 6)]);
  assert.strictEqual(mid.kind, "run");
  assert.deepStrictEqual(mid.order, [T(0, 4), J, T(0, 6)]);
  assert.strictEqual(mid.value, 15);
  const top = Game.analyze([T(0, 5), T(0, 6), J]);
  assert.deepStrictEqual(top.order, [T(0, 5), T(0, 6), J], "a joker that could go either way goes on top");
  assert.strictEqual(top.value, 18);
  const high = Game.analyze([T(0, 12), T(0, 13), J]);
  assert.deepStrictEqual(high.order, [J, T(0, 12), T(0, 13)], "...unless the run ends at 13");
  assert.strictEqual(high.value, 11 + 12 + 13);
  assert.deepStrictEqual(Game.analyze([T(0, 12), J, J2, T(0, 13)]).order.slice(2), [T(0, 12), T(0, 13)], "two jokers below the top");
  assert.strictEqual(Game.analyze([T(0, 1), J, J2, T(0, 2)]).value, 10, "...or above the bottom");
  assert.strictEqual(Game.analyze(Array.from({ length: 12 }, (_, i) => T(0, i + 1)).concat([J, J2])), null, "no more than 13 in a run");
  const grp = Game.analyze([T(0, 9), T(2, 9), J]);
  assert.strictEqual(grp.kind, "group");
  assert.strictEqual(grp.value, 27);
  assert.ok(Game.analyze([T(0, 9), J, J2]));
  assert.strictEqual(Game.analyze([J, J2, T(0, 1)]).value, 6, "joker joker 1 is a run 1 2 3 or a group of 1s: the better one counts");
  assert.strictEqual(Game.analyze([J, J2, J]), null, "jokers alone are no set");
  assert.strictEqual(Game.analyze([T(0, 3), T(1, 4), J]), null);
});

test("the first meld needs the limit from the rack alone and leaves the table alone", () => {
  const S = setup([T(0, 5), T(0, 6), T(0, 7), T(1, 9), T(2, 9), T(3, 9), T(3, 1)]);
  let r = Game.act(S, 0, { t: "commit", table: [[T(0, 5), T(0, 6), T(0, 7)]] });
  assert.strictEqual(r.ok, false, "18 points are not enough");
  assert.match(r.error, /30/);
  assert.strictEqual(S.players[0].rack.length, 7);
  assert.strictEqual(S.table.length, 0);
  r = Game.act(S, 0, { t: "commit", table: [[T(0, 5), T(0, 6), T(0, 7)], [T(3, 9), T(1, 9), T(2, 9)]] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(S.table.length, 2);
  assert.deepStrictEqual(S.table[1], [T(1, 9), T(2, 9), T(3, 9)], "stored in order");
  assert.strictEqual(S.players[0].rack.length, 1);
  assert.strictEqual(S.players[0].melded, true);
  assert.strictEqual(S.cur, 1);
  assert.deepStrictEqual(r.events[0], { t: "play", pi: 0, added: r.events[0].added, first: true });
  assert.strictEqual(r.events[0].added.length, 6);
});

test("before the first meld the table must not be touched, after it everything may be rearranged", () => {
  const table = [[T(0, 3), T(0, 4), T(0, 5), T(0, 6), T(0, 7), T(0, 8), T(0, 9)]];
  const rack = [T(1, 6), T(2, 6), T(1, 10), T(1, 11), T(1, 12), T(3, 2)];
  // a rack set of 33 plus a rearrangement: not allowed yet
  let S = setup(rack, table);
  const split = [[T(0, 3), T(0, 4), T(0, 5)], [T(0, 7), T(0, 8), T(0, 9)], [T(0, 6), T(1, 6), T(2, 6)], [T(1, 10), T(1, 11), T(1, 12)]];
  let r = Game.act(S, 0, { t: "commit", table: split });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /umbauen/);
  const ok = [table[0], [T(1, 10), T(1, 11), T(1, 12)]];
  r = Game.act(S, 0, { t: "commit", table: ok });
  assert.strictEqual(r.ok, true, r.error); // 33 points from the rack, table untouched
  // a player who has met the limit may split runs and borrow a tile
  S = setup(rack, table, { melded: true });
  r = Game.act(S, 0, { t: "commit", table: split });
  assert.ok(r.ok, r.error);
  assert.strictEqual(S.table.length, 4);
  assert.strictEqual(S.players[0].rack.length, 1);
});

test("a commit may not lose table tiles, take foreign tiles, add nothing or contain bad sets", () => {
  const table = [[T(0, 3), T(0, 4), T(0, 5)], [T(1, 8), T(2, 8), T(3, 8)]];
  const rack = [T(0, 6), T(0, 9), T(2, 2)];
  const S = setup(rack, table, { melded: true });
  const before = JSON.stringify(S);
  const bad = [
    [table[0], table[1]], // nothing added
    [[T(0, 3), T(0, 4), T(0, 5), T(0, 6)]], // lost a set from the table
    [[T(0, 3), T(0, 4), T(0, 5), T(0, 6)], table[1].slice(0, 2)], // set of two
    [[T(0, 3), T(0, 4), T(0, 5), T(0, 6)], table[1], [T(0, 7), T(0, 8), T(0, 9)]], // tiles from nowhere
    [[T(0, 3), T(0, 4), T(0, 5), T(0, 6)], [T(1, 8), T(2, 8), T(3, 8)], [T(0, 3), T(1, 3), T(2, 3)]], // tile twice
    [[T(0, 3), T(0, 4), T(0, 5), T(0, 6), T(0, 9)], table[1]], // gap
    [[T(0, 3), T(0, 4), T(0, 5), T(0, 6)], [T(1, 8), T(2, 8), T(3, 8), T(3, 8, 1)]]
  ];
  for (const t of bad) { assert.strictEqual(Game.act(S, 0, { t: "commit", table: t }).ok, false, JSON.stringify(t)); assert.strictEqual(JSON.stringify(S), before); }
  assert.ok(Game.act(S, 0, { t: "commit", table: [[T(0, 3), T(0, 4), T(0, 5), T(0, 6)], table[1]] }).ok);
  assert.strictEqual(Game.act(S, 0, { t: "commit", table: S.table }).ok, false, "not your turn");
});

test("jokers: swapping one out of a run is fine as long as it is played again", () => {
  const table = [[T(0, 4), J, T(0, 6)]];
  const S = setup([T(0, 5), T(1, 7), T(2, 7)], table, { melded: true });
  // Rack 5 replaces the joker, the joker joins 7 7 as a group
  const r = Game.act(S, 0, { t: "commit", table: [[T(0, 4), T(0, 5), T(0, 6)], [T(1, 7), T(2, 7), J]] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(S.players[0].rack.length, 0);
  assert.strictEqual(S.phase, "roundEnd");
  // leaving the joker out is not
  const S2 = setup([T(0, 5), T(1, 7), T(2, 7)], table, { melded: true });
  const r2 = Game.act(S2, 0, { t: "commit", table: [[T(0, 4), T(0, 5), T(0, 6)]] });
  assert.strictEqual(r2.ok, false);
});

test("drawing takes a tile and passes the turn; with an empty pool you pass", () => {
  const S = setup([T(0, 1)], [], { other: [T(0, 2)] });
  const pool = S.pool.length;
  const r = Game.act(S, 0, { t: "draw" });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.events, [{ t: "draw", pi: 0, empty: false }]);
  assert.strictEqual(S.pool.length, pool - 1);
  assert.strictEqual(S.players[0].rack.length, 2);
  assert.strictEqual(S.cur, 1);
  assert.strictEqual(Game.act(S, 0, { t: "draw" }).ok, false);
  S.pool = [];
  const e = Game.act(S, 1, { t: "draw" });
  assert.ok(e.ok);
  assert.strictEqual(e.events[0].empty, true);
  assert.strictEqual(S.players[1].rack.length, 1);
  assert.strictEqual(S.cur, 0);
});

test("when nobody can move and the pool is empty the lowest rack wins", () => {
  const S = setup([T(0, 1), T(0, 5)], [], { other: [T(1, 2)] });
  S.pool = [];
  assert.ok(Game.act(S, 0, { t: "draw" }).ok);
  assert.strictEqual(S.phase, "play");
  const r = Game.act(S, 1, { t: "draw" });
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.how, "blocked");
  assert.deepStrictEqual(S.last.winners, [1]);
  assert.deepStrictEqual(S.last.pts, [6, 2]);
  assert.strictEqual(S.players[1].score, 6);
  assert.strictEqual(S.players[0].score, -6);
  assert.strictEqual(r.events[r.events.length - 1].t, "end");
});

test("emptying the rack wins: the winner scores the other racks (a joker counts 30)", () => {
  const S = setup([T(0, 5), T(0, 6), T(0, 7)], [], { meld: 0, other: [J, T(1, 10), T(1, 4)] });
  const r = Game.act(S, 0, { t: "commit", table: [[T(0, 5), T(0, 6), T(0, 7)]] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [0]);
  assert.strictEqual(S.last.over, true);
  assert.strictEqual(S.players[0].score, 44);
  assert.strictEqual(S.players[1].score, -44);
  assert.strictEqual(S.last.how, "out");
  assert.deepStrictEqual(S.last.racks[1], [J, T(1, 10), T(1, 4)]);
  assert.strictEqual(Game.act(S, 0, { t: "draw" }).ok, false);
  assert.ok(Game.act(S, 1, { t: "next" }).ok);
  assert.strictEqual(S.round, 1);
  assert.strictEqual(S.players[0].wins, 0);
  assert.strictEqual(S.players[0].rack.length, 14);
});

test("without a first-meld limit everybody may play right away", () => {
  const S = two(0);
  assert.ok(S.players.every((p) => p.melded));
});

test("a match over several rounds keeps the wins", () => {
  const S = Game.newGame([{ name: "Anna" }, { name: "Ben" }], 2, 0, 2);
  S.cur = 0; S.players[0].rack = [T(0, 5), T(0, 6), T(0, 7)]; S.table = [];
  Game.act(S, 0, { t: "commit", table: [[T(0, 5), T(0, 6), T(0, 7)]] });
  assert.strictEqual(S.last.over, false);
  assert.strictEqual(S.players[0].wins, 1);
  Game.act(S, 0, { t: "next" });
  assert.strictEqual(S.round, 2);
  assert.strictEqual(S.players[0].wins, 1);
});

test("giving up hands the round to the best of the others", () => {
  const S = Game.newGame([{ name: "A" }, { name: "B" }, { name: "C" }], 1, 30, 2);
  S.players[0].rack = [T(0, 12)]; S.players[1].rack = [T(0, 13)]; S.players[2].rack = [T(0, 2)];
  Game.act(S, 1, { t: "giveup" }); // allowed for anyone, also off turn
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [2]);
  assert.strictEqual(S.last.how, "giveup");
});

test("skip moves on without drawing", () => {
  const S = two();
  const cur = S.cur, n = S.players[cur].rack.length;
  assert.ok(Game.act(S, 1 - cur, { t: "skip" }).ok);
  assert.strictEqual(S.cur, 1 - cur);
  assert.strictEqual(S.players[cur].rack.length, n);
});

test("view hides the other racks but shows the table, the counts and, after a round, everything", () => {
  const S = setup([T(0, 1), T(1, 2)], [[T(0, 3), T(0, 4), T(0, 5)]]);
  const v = Game.view(S, 1);
  assert.strictEqual(v.me, 1);
  assert.deepStrictEqual(v.rack, S.players[1].rack);
  assert.strictEqual(v.players[0].count, 2);
  assert.deepStrictEqual(v.table, S.table);
  assert.strictEqual(v.pool, S.pool.length);
  const sp = Game.view(S, -1);
  assert.strictEqual(sp.me, -1);
  assert.deepStrictEqual(sp.rack, []);
  assert.strictEqual(v.last, null);
});

// ---------- computer ----------
const botLegal = (S) => {
  const pi = S.cur, a = Game.botMove(S, pi);
  assert.ok(a, "a move");
  const r = Game.act(S, pi, a);
  assert.ok(r.ok, `${a.t}: ${r.error}`);
  return a;
};

test("computer level 3 rearranges the table to get rid of tiles", () => {
  const table = [[T(0, 3), T(0, 4), T(0, 5), T(0, 6), T(0, 7), T(0, 8), T(0, 9)]];
  const S = setup([T(1, 6), T(2, 6), T(3, 1)], table, { melded: true, level: 3 });
  const a = botLegal(S);
  assert.strictEqual(a.t, "commit");
  assert.strictEqual(S.players[0].rack.length, 1);
  assert.strictEqual(S.table.length, 3);
  assert.strictEqual(S.table.flat().length, 9);
});

test("computer level 2 adds to the table but does not rearrange; level 1 only lays new sets", () => {
  const table = [[T(0, 3), T(0, 4), T(0, 5), T(0, 6), T(0, 7), T(0, 8), T(0, 9)]];
  let S = setup([T(1, 6), T(2, 6), T(3, 1)], table, { melded: true, level: 2 });
  assert.strictEqual(botLegal(S).t, "draw");
  S = setup([T(0, 10), T(3, 1)], table, { melded: true, level: 2 });
  assert.strictEqual(botLegal(S).t, "commit");
  assert.strictEqual(S.table[0].length, 8);
  const real = Math.random;
  try {
    Math.random = () => 0.9; // level 1 does not hold back
    S = setup([T(0, 10), T(3, 1)], table, { melded: true, level: 1 });
    assert.strictEqual(botLegal(S).t, "draw", "level 1 cannot extend");
    S = setup([T(1, 2), T(2, 2), T(3, 2), T(0, 12)], table, { melded: true, level: 1 });
    assert.strictEqual(botLegal(S).t, "commit");
    assert.strictEqual(S.table.length, 2);
  } finally { Math.random = real; }
});

test("computer needs the first meld from its own rack and finds the best sets for it", () => {
  const rack = [T(0, 10), T(1, 10), T(2, 10), T(0, 3), T(1, 4), T(3, 12), T(3, 11), T(3, 13), T(2, 1)];
  for (const level of [1, 2, 3]) {
    const S = setup(rack, [[T(0, 5), T(0, 6), T(0, 7)]], { level });
    const real = Math.random; Math.random = () => 0.9;
    try { assert.strictEqual(botLegal(S).t, "commit"); } finally { Math.random = real; }
    assert.strictEqual(S.players[0].melded, true);
    assert.deepStrictEqual(S.table[0], [T(0, 5), T(0, 6), T(0, 7)], "table untouched");
    assert.ok(S.players[0].rack.length <= 3);
  }
  const poor = setup([T(0, 2), T(1, 2), T(2, 2), T(3, 9), T(2, 5)], [], { level: 3 });
  assert.strictEqual(botLegal(poor).t, "draw", "6 points are not enough");
});

test("computer uses jokers and finds sets that need a joker from the table", () => {
  const S = setup([T(0, 5), T(3, 2), T(3, 3)], [[T(0, 4), J, T(0, 6)], [T(1, 8), T(2, 8), T(3, 8)]], { melded: true, level: 3 });
  botLegal(S);
  assert.strictEqual(S.players[0].rack.length, 0, "swap the joker for the 5, then 2 3 joker");
  const S2 = setup([T(1, 9), T(2, 9), J], [], { melded: true, level: 3 });
  botLegal(S2);
  assert.strictEqual(S2.players[0].rack.length, 0);
});

test("the computer always makes a legal move and finishes rounds (all levels, 2-4 players)", () => {
  for (const level of [1, 2, 3]) for (const n of [2, 3, 4]) {
    const S = Game.newGame(Array.from({ length: n }, (_, i) => ({ name: "R" + i, bot: true })), 1, 30, level);
    let guard = 0;
    while (S.phase === "play" && guard++ < 1200) {
      botLegal(S);
      const all = [].concat(S.pool, ...S.players.map((p) => p.rack), ...S.table);
      assert.strictEqual(new Set(all).size, 106);
      assert.strictEqual(all.length, 106, "no tile appears or vanishes");
    }
    assert.strictEqual(S.phase, "roundEnd", `level ${level}, ${n} players: ${guard} moves`);
  }
});

test("botPlan paces the computer and its key changes with every turn", () => {
  const S = Game.newGame([{ name: "R", bot: true }, { name: "M" }], 1, 30, 2);
  S.cur = 0;
  const p = Game.botPlan(S);
  assert.strictEqual(p.pi, 0);
  assert.ok(p.delay >= 1000);
  assert.strictEqual(Game.botPlan(S).key, p.key);
  Game.act(S, 0, Game.botMove(S, 0));
  assert.strictEqual(Game.botPlan(S), null, "a person is on turn");
  S.phase = "roundEnd";
  assert.strictEqual(Game.botPlan(S), null);
});

// The engine runs on the server's only thread for every room at once. A bot move searches the table and must
// stay in the low milliseconds; a whole round of three level 3 computers well under a second.
test("the engine is fast: level 3 computer rounds and the table search", () => {
  const t0 = Date.now();
  let moves = 0, worst = 0;
  for (let k = 0; k < 8; k++) {
    const S = Game.newGame([{ name: "R1", bot: true }, { name: "R2", bot: true }, { name: "R3", bot: true }], 1, 30, 3);
    let guard = 0;
    while (S.phase === "play" && guard++ < 1200) {
      const t = Date.now();
      Game.act(S, S.cur, Game.botMove(S, S.cur));
      worst = Math.max(worst, Date.now() - t); moves++;
    }
  }
  assert.ok(Date.now() - t0 < 6000, `took ${Date.now() - t0} ms for ${moves} moves`);
  assert.ok(worst < 250, `slowest move ${worst} ms`);
});

// Every message from a browser reaches Game.act unchecked: nothing hostile may change the state or throw.
test("hostile messages are rejected and leave the state untouched", () => {
  const S = setup([T(0, 5), T(0, 6), T(0, 7), T(1, 9)], [[T(2, 1), T(2, 2), T(2, 3)]], { melded: true });
  const big = Array.from({ length: 60 }, (_, i) => [i, i + 1, i + 2]);
  const hostile = [null, undefined, 5, "commit", [], {}, { t: null }, { t: "constructor" }, { t: "__proto__" }, { t: "toString" }, { t: "timeout" }, { t: "commit" },
    { t: "commit", table: null }, { t: "commit", table: "x" }, { t: "commit", table: {} }, { t: "commit", table: [null] }, { t: "commit", table: [5] }, { t: "commit", table: [[]] },
    { t: "commit", table: [["a", "b", "c"]] }, { t: "commit", table: [[1.5, 2.5, 3.5]] }, { t: "commit", table: [[-1, -2, -3]] }, { t: "commit", table: [[106, 107, 108]] },
    { t: "commit", table: [[NaN, Infinity, 0]] }, { t: "commit", table: [{ length: 3 }] }, { t: "commit", table: [["constructor", "__proto__", "toString"]] },
    { t: "commit", table: big }, { t: "commit", table: [[T(0, 5), T(0, 5), T(0, 5)]] }, { t: "commit", table: [[[T(0, 5)], [T(0, 6)], [T(0, 7)]]] },
    { t: "commit", table: [[T(0, 5), T(0, 6), T(0, 7)]], extra: { a: 1 } }, { t: "draw", table: 5, n: NaN }, { t: "next" }];
  for (let pi = -1; pi <= 2; pi++) for (const a of hostile) {
    const before = JSON.stringify(S);
    let res;
    assert.doesNotThrow(() => { res = Game.act(S, pi, a); });
    if (!res.ok) assert.strictEqual(JSON.stringify(S), before, "a rejected action must not change the state: " + JSON.stringify(a));
    Object.assign(S, JSON.parse(before)); // keep one fixed start state even if a harmless action was accepted
  }
});
