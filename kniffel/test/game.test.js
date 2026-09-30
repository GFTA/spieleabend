"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

const pts = (k, d, j) => G.points(k, d, j);

test("boxes score like Kniffel", () => {
  assert.strictEqual(pts("ones", [1, 1, 3, 4, 1]), 3);
  assert.strictEqual(pts("sixes", [6, 6, 3, 4, 1]), 12);
  assert.strictEqual(pts("three", [3, 3, 3, 5, 6]), 20);
  assert.strictEqual(pts("three", [3, 3, 2, 5, 6]), 0);
  assert.strictEqual(pts("four", [2, 2, 2, 2, 6]), 14);
  assert.strictEqual(pts("four", [2, 2, 2, 3, 6]), 0);
  assert.strictEqual(pts("house", [2, 2, 5, 5, 5]), 25);
  assert.strictEqual(pts("house", [5, 5, 5, 5, 5]), 0, "a Kniffel is no Full House without the joker");
  assert.strictEqual(pts("house", [5, 5, 5, 5, 5], true), 25);
  assert.strictEqual(pts("small", [1, 2, 3, 4, 6]), 30);
  assert.strictEqual(pts("small", [3, 4, 5, 6, 6]), 30);
  assert.strictEqual(pts("small", [1, 2, 3, 5, 6]), 0);
  assert.strictEqual(pts("large", [2, 3, 4, 5, 6]), 40);
  assert.strictEqual(pts("large", [1, 2, 3, 4, 6]), 0);
  assert.strictEqual(pts("kniffel", [4, 4, 4, 4, 4]), 50);
  assert.strictEqual(pts("kniffel", [4, 4, 4, 4, 3]), 0);
  assert.strictEqual(pts("chance", [1, 2, 3, 4, 6]), 16);
});

test("totals: upper bonus at 63", () => {
  const p = { sheet: Object.fromEntries(G.CATS.map((c) => [c.k, null])), extra: 0 };
  Object.assign(p.sheet, { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18, chance: 20 });
  const t = G.totals(p);
  assert.deepStrictEqual([t.up, t.bonus, t.low, t.total, t.filled], [63, 35, 20, 118, 7]);
  p.sheet.ones = 2;
  assert.strictEqual(G.totals(p).bonus, 0);
});

// put known dice on the table for the player on turn
function setDice(S, dice) { S.dice = dice.slice(); S.rolls = 1; }

test("fourRolls: a fourth roll, and the bonus pace", () => {
  const S = G.newGame(["a", "b"], { fourRolls: true });
  assert.strictEqual(S.maxRolls, 4);
  assert.strictEqual(G.view(S, 0).maxRolls, 4);
  assert.strictEqual(G.newGame(["a", "b"], {}).maxRolls, 3);
  assert.strictEqual(G.normRules({}).fourRolls, false);
  const p = S.cur;
  for (let i = 0; i < 4; i++) assert.strictEqual(G.act(S, p, { t: "roll" }).ok, true, "roll " + (i + 1));
  assert.strictEqual(G.act(S, p, { t: "roll" }).ok, false, "no fifth roll");
});

test("bonusState: pace against three of each, and a lost bonus", () => {
  const sheet = Object.fromEntries(G.CATS.map((c) => [c.k, null]));
  assert.deepStrictEqual(G.bonusState({ sheet }), { up: 0, need: 63, pace: 0, done: false, out: false, open: 6 });
  sheet.ones = 4; sheet.twos = 4;
  assert.strictEqual(G.bonusState({ sheet }).pace, 4 - 3 + 4 - 6);
  Object.assign(sheet, { ones: 0, twos: 0, threes: 0 });
  assert.strictEqual(G.bonusState({ sheet }).out, false, "5x4+5x5+5x6=75 can still do it");
  Object.assign(sheet, { fours: 0, fives: 0 });
  assert.strictEqual(G.bonusState({ sheet }).out, true, "only 30 left");
  Object.assign(sheet, { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 });
  assert.strictEqual(G.bonusState({ sheet }).done, true);
});

test("odds: exact chance of the next roll completing a box", () => {
  const sheet = Object.fromEntries(G.CATS.map((c) => [c.k, null]));
  const o = (dice, keep, sh = sheet) => Object.fromEntries(G.odds(dice, keep, sh).map((x) => [x.c, x.p]));
  assert.deepStrictEqual(G.odds([1, 2, 3, 4, 5], [true, true, true, true, true], sheet), [], "nothing loose, nothing to roll");
  const four = o([6, 6, 6, 6, 1], [true, true, true, true, false]);
  assert.strictEqual(four.kniffel, 1 / 6);
  assert.strictEqual(four.four, 1, "already four of a kind");
  const run = o([1, 2, 3, 4, 6], [true, true, true, true, false]);
  assert.strictEqual(run.large, 1 / 6, "only a 5 completes 1-2-3-4-5");
  assert.ok(run.small === 1);
  assert.strictEqual(G.odds([6, 6, 6, 6, 1], [true, true, true, true, false], Object.assign({}, sheet, { kniffel: 0 })).some((x) => x.c === "kniffel"), false, "filled boxes are not listed");
});

test("a turn: roll, hold, roll, enter a box; the next player is up", () => {
  const S = G.newGame(["a", "b"], {});
  const p = S.cur;
  assert.strictEqual(G.act(S, p, { t: "hold", i: 0 }).ok, false, "no holding before the first roll");
  assert.strictEqual(G.act(S, p, { t: "score", c: "chance" }).ok, false, "must roll once");
  assert.strictEqual(G.act(S, 1 - p, { t: "roll" }).ok, false, "not your turn");
  const r1 = G.act(S, p, { t: "roll" });
  assert.deepStrictEqual(r1.events[0].which, [0, 1, 2, 3, 4]);
  G.act(S, p, { t: "hold", i: 1 }); G.act(S, p, { t: "hold", i: 3 });
  assert.deepStrictEqual(G.view(S, 1 - p).hold, [false, true, false, true, false], "others see the holds");
  const kept = [S.dice[1], S.dice[3]];
  G.act(S, p, { t: "roll" });
  assert.deepStrictEqual([S.dice[1], S.dice[3]], kept, "held dice stay");
  G.act(S, p, { t: "hold", keep: [false, false, false, false, false] });
  assert.strictEqual(G.act(S, p, { t: "roll" }).ok, true, "third roll");
  assert.strictEqual(G.act(S, p, { t: "roll" }).ok, false, "only three rolls");
  const res = G.act(S, p, { t: "score", c: "chance" });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.events.find((e) => e.t === "scored").points, S.players[p].sheet.chance);
  assert.strictEqual(S.cur, 1 - p);
  assert.strictEqual(S.rolls, 0);
  S.rolls = 1;
  assert.strictEqual(G.act(S, p, { t: "score", c: "ones" }).ok, false, "not your turn any more");
});

test("a box can only be filled once, and a zero is allowed", () => {
  const S = G.newGame(["a", "b"], {});
  const p = S.cur;
  setDice(S, [1, 2, 3, 4, 6]);
  assert.strictEqual(G.act(S, p, { t: "score", c: "kniffel" }).ok, true);
  assert.strictEqual(S.players[p].sheet.kniffel, 0);
  S.cur = p; S.rolls = 1; setDice(S, [1, 2, 3, 4, 6]);
  const again = G.act(S, p, { t: "score", c: "kniffel" });
  assert.strictEqual(again.ok, false);
  assert.strictEqual(G.act(S, p, { t: "score", c: "nonsense" }).ok, false);
});

test("a game lasts 13 rounds and ends with a winner", () => {
  const S = G.newGame(["a", "b", "c"], {});
  for (const p of S.players) p.bot = true;
  let turns = 0;
  while (S.phase === "play" && turns++ < 1000) {
    assert.ok(S.round >= 1 && S.round <= 13);
    const a = G.suggest(G.view(S, S.cur), "normal");
    assert.ok(G.act(S, S.cur, a).ok, JSON.stringify(a));
  }
  assert.strictEqual(S.phase, "roundEnd");
  assert.ok(S.last.over);
  assert.ok(S.players.every((p) => G.totals(p).filled === 13));
  const tot = S.players.map((p) => G.totals(p).total);
  assert.ok(S.last.winners.every((i) => tot[i] === Math.max(...tot)));
  assert.ok(G.act(S, 0, { t: "next" }).ok, "rematch");
  assert.ok(S.players.every((p) => G.totals(p).filled === 0) && S.phase === "play" && S.round === 1);
});

test("joker rule: extra Kniffel gives 100 and must go to its number first", () => {
  const S = G.newGame(["a", "b"], { joker: true });
  const p = S.cur, sh = S.players[p].sheet;
  setDice(S, [4, 4, 4, 4, 4]);
  assert.strictEqual(G.act(S, p, { t: "score", c: "kniffel" }).ok, true);
  assert.strictEqual(sh.kniffel, 50);
  S.cur = p; setDice(S, [4, 4, 4, 4, 4]);
  assert.deepStrictEqual(Object.keys(G.options(S)), ["fours"], "the matching upper box comes first");
  assert.strictEqual(G.act(S, p, { t: "score", c: "chance" }).ok, false);
  assert.strictEqual(G.act(S, p, { t: "score", c: "fours" }).ok, true);
  assert.strictEqual(S.players[p].extra, 1);
  assert.strictEqual(G.totals(S.players[p]).total, 50 + 20 + 100);
  S.cur = p; setDice(S, [4, 4, 4, 4, 4]);
  const o = G.options(S);
  assert.strictEqual(o.house, 25);
  assert.strictEqual(o.large, 40);
  assert.ok(!("ones" in o), "lower boxes first");
});

test("without the joker rule an extra Kniffel is just dice", () => {
  const S = G.newGame(["a", "b"], {});
  const p = S.cur;
  S.players[p].sheet.kniffel = 50;
  setDice(S, [4, 4, 4, 4, 4]);
  const o = G.options(S);
  assert.strictEqual(o.house, 0);
  assert.ok("ones" in o);
});

test("timeout and skip write the best free box", () => {
  const S = G.newGame(["a", "b"], {});
  const p = S.cur;
  assert.strictEqual(G.act(S, 1 - p, { t: "timeout" }).ok, false);
  assert.strictEqual(G.act(S, p, { t: "timeout" }).ok, true);
  assert.strictEqual(G.totals(S.players[p]).filled, 1);
  assert.strictEqual(S.cur, 1 - p);
  assert.strictEqual(G.act(S, p, { t: "skip" }).ok, true, "host skips whoever is up");
});

test("computer players finish games at every level", () => {
  for (const lvl of Object.keys(G.BOT_LEVELS)) {
    const S = G.newGame(["a", "b"], { joker: true });
    S.players.forEach((p) => { p.bot = true; });
    let n = 0;
    while (S.phase === "play" && n++ < 1000) assert.ok(G.act(S, S.cur, G.suggest(G.view(S, S.cur), lvl)).ok, lvl);
    assert.strictEqual(S.phase, "roundEnd", lvl);
  }
});
