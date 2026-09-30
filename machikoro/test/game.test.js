"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Game = require("../public/game.js");

const two = () => Game.newGame([{ name: "Anna" }, { name: "Ben" }], 1, 2);
const bots = (n = 2, level = 2) => Game.newGame(
  Array.from({ length: n }, (_, i) => ({ name: "R" + (i + 1), bot: true })),
  1, level
);

test("a new game starts with Wheat Field + Bakery and 3 coins", () => {
  const S = two();
  assert.strictEqual(S.phase, "play");
  assert.ok(S.cur === 0 || S.cur === 1);
  assert.strictEqual(S.step, "roll");
  for (const p of S.players) {
    assert.strictEqual(p.coins, 3);
    assert.strictEqual(p.cards.wheat, 1);
    assert.strictEqual(p.cards.bakery, 1);
    assert.strictEqual(Game.landmarksDone(p), 0);
  }
  assert.ok(Game.AVATARS.includes(S.players[0].avatar));
});

test("settings are normalised", () => {
  assert.strictEqual(Game.normGoal(9), 1);
  assert.strictEqual(Game.normGoal(2), 2);
  assert.strictEqual(Game.normLevel(3), 3);
  assert.strictEqual(Game.normLevel("x"), 2);
});

test("only the player on turn may act", () => {
  const S = two(), other = 1 - S.cur;
  assert.strictEqual(Game.act(S, other, { t: "roll", dice: 1 }).ok, false);
  assert.strictEqual(Game.act(S, S.cur, { t: "pass" }).ok, false);
  assert.strictEqual(Game.act(S, S.cur, { t: "dance" }).ok, false);
});

test("rolling activates blue income for everyone and green for the roller", () => {
  const S = two(), first = S.cur;
  const real = Math.random;
  try {
    Math.random = () => 0; // die = 1 → Wheat Field
    const res = Game.act(S, first, { t: "roll", dice: 1 });
    assert.ok(res.ok);
    assert.ok(res.events.some((e) => e.t === "roll"));
    assert.ok(res.events.some((e) => e.t === "income"));
    // both players have wheat → both gain 1
    assert.strictEqual(S.players[0].coins, 4);
    assert.strictEqual(S.players[1].coins, 4);
    assert.strictEqual(S.step, "build");
  } finally { Math.random = real; }
});

test("café takes coins from the roller on red activation", () => {
  const S = two(), first = S.cur, other = 1 - first;
  S.players[other].cards.cafe = 1;
  const real = Math.random;
  try {
    Math.random = () => 2 / 6; // die ≈ 3 (floor(0.333*6)+1 = 3)
    // more reliable: force exactly
    Math.random = () => (3 - 1) / 6; // 2/6 = 0.333 → floor(2)+1 = 3? floor(0.333*6)=floor(2)=2 +1 =3
    Game.act(S, first, { t: "roll", dice: 1 });
    assert.strictEqual(S.dice[0], 3);
    // roller had 3, cafe takes 1 → 3-1+bakery(green on 2-3)=3-1+1=3; other had 3+1 cafe =4
    assert.ok(S.players[other].coins >= 4);
    assert.ok(S.players[first].coins <= 4);
  } finally { Math.random = real; }
});

test("buying a card and completing all landmarks wins the round", () => {
  const S = two(), pi = S.cur;
  S.step = "build";
  S.players[pi].coins = 100;
  // build all landmarks
  for (const id of Game.LANDMARK_ORDER) {
    assert.ok(Game.act(S, pi, { t: "landmark", id }).ok, id);
    if (S.phase === "roundEnd") break;
    // after landmark, turn may advance — force back to build for remaining
    if (S.phase === "play" && Game.landmarksDone(S.players[pi]) < 4) {
      S.cur = pi;
      S.step = "build";
      S.extra = true; // prevent amusement park looping oddly
    }
  }
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.winners[0], pi);
  assert.strictEqual(S.last.over, true);
});

test("train station allows two dice; amusement park grants an extra turn on doubles", () => {
  const S = two(), pi = S.cur;
  S.players[pi].lm.station = true;
  S.players[pi].lm.park = true;
  const real = Math.random;
  try {
    let calls = 0;
    Math.random = () => { // always 4 → doubles 4+4
      calls++;
      return (4 - 1) / 6;
    };
    Game.act(S, pi, { t: "roll", dice: 2 });
    assert.deepStrictEqual(S.dice, [4, 4]);
    assert.strictEqual(S.doubles, true);
    // skip build
    assert.strictEqual(S.step, "build");
    Game.act(S, pi, { t: "pass" });
    // extra turn for same player
    assert.strictEqual(S.cur, pi);
    assert.strictEqual(S.extra, true);
    assert.strictEqual(S.step, "roll");
  } finally { Math.random = real; }
});

test("radio tower offers a reroll that replaces the first result", () => {
  const S = two(), pi = S.cur;
  S.players[pi].lm.tower = true;
  const real = Math.random;
  try {
    let n = 0;
    Math.random = () => (n++ === 0 ? 0 : (6 - 1) / 6); // first 1, then 6
    Game.act(S, pi, { t: "roll", dice: 1 });
    assert.strictEqual(S.step, "reroll");
    assert.strictEqual(S.dice[0], 1);
    Game.act(S, pi, { t: "reroll" });
    assert.strictEqual(S.dice[0], 6);
    assert.ok(S.step === "build" || S.step === "tv" || S.step === "trade");
  } finally { Math.random = real; }
});

test("shopping mall adds +1 to bakery income", () => {
  const S = two(), pi = S.cur;
  S.players[pi].lm.mall = true;
  const real = Math.random;
  try {
    Math.random = () => (2 - 1) / 6; // roll 2 → bakery
    const before = S.players[pi].coins;
    Game.act(S, pi, { t: "roll", dice: 1 });
    // bakery 1+1 mall = 2 (wheat doesn't fire on 2)
    assert.strictEqual(S.players[pi].coins, before + 2);
  } finally { Math.random = real; }
});

test("purple TV station asks for a target, then steals up to 5", () => {
  const S = two(), pi = S.cur, other = 1 - pi;
  S.players[pi].cards.tv = 1;
  S.players[other].coins = 4;
  const real = Math.random;
  try {
    Math.random = () => (6 - 1) / 6;
    Game.act(S, pi, { t: "roll", dice: 1 });
    assert.strictEqual(S.step, "tv");
    Game.act(S, pi, { t: "tv", target: other });
    assert.strictEqual(S.players[other].coins, 0);
    assert.ok(S.players[pi].coins >= 4);
    assert.strictEqual(S.step, "build");
  } finally { Math.random = real; }
});

test("the computer always makes a legal move and finishes a game", () => {
  for (const level of [1, 2, 3]) {
    const S = bots(2, level);
    let guard = 0;
    while (S.phase === "play" && guard++ < 5000) {
      const a = Game.botMove(S, S.cur);
      assert.ok(a, `no move at step=${S.step} turn=${S.turn} level=${level}`);
      const res = Game.act(S, S.cur, a);
      assert.ok(res.ok, res.error + " action=" + JSON.stringify(a));
    }
    assert.strictEqual(S.phase, "roundEnd", `level ${level} did not finish after ${guard} moves`);
  }
});

test("botPlan paces computers and bot-only games stay under a second", () => {
  const S = bots(3, 2);
  const plan = Game.botPlan(S);
  assert.ok(plan);
  assert.strictEqual(plan.pi, S.cur);
  assert.ok(plan.delay >= 500);
  assert.ok(plan.key);

  const t0 = Date.now();
  for (let k = 0; k < 40; k++) {
    const G = bots(2, 2);
    let guard = 0;
    while (G.phase === "play" && guard++ < 5000) {
      const a = Game.botMove(G, G.cur);
      assert.ok(Game.act(G, G.cur, a).ok);
    }
    assert.strictEqual(G.phase, "roundEnd");
  }
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
});

test("view marks who is me and exposes the market", () => {
  const S = two();
  const v = Game.view(S, 1);
  assert.strictEqual(v.me, 1);
  assert.strictEqual(Game.view(S, -1).me, -1);
  assert.strictEqual(v.players.length, 2);
  assert.ok(v.market.wheat > 0);
  assert.ok(v.cardOrder.length >= 15);
});

test("giving up hands the round to the best of the others", () => {
  const S = Game.newGame([{ name: "A" }, { name: "B" }, { name: "C" }], 1, 2);
  S.players[2].lm.station = true;
  S.players[2].lm.mall = true;
  Game.act(S, 0, { t: "giveup" });
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.winners[0], 2);
});

test("solo with one human finishes when all landmarks are built", () => {
  const S = Game.newGame([{ name: "Solo" }], 1, 2);
  assert.strictEqual(S.players.length, 1);
  S.step = "build";
  S.players[0].coins = 100;
  for (const id of Game.LANDMARK_ORDER) {
    if (S.phase !== "play") break;
    S.cur = 0; S.step = "build"; S.extra = true;
    Game.act(S, 0, { t: "landmark", id });
  }
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.winners[0], 0);
});
