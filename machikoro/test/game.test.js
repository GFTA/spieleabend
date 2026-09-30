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
  assert.strictEqual(v.cards, undefined);
  assert.strictEqual(v.landmarks, undefined);
  assert.strictEqual(v.cardOrder, undefined);
  assert.strictEqual(v.landmarkOrder, undefined);
  assert.ok(Game.CARD_ORDER.length >= 15);
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

// Every message from a browser reaches Game.act unchecked: nothing hostile may change the state or throw.
// Table lookups by a client value need hasOwnProperty, else "constructor" / "__proto__" slip through.
test("hostile messages are rejected and leave the state untouched", () => {
  const phases = [
    { step: "build", setup: (S) => { S.step = "build"; S.players[S.cur].coins = 20; } },
    { step: "trade", setup: (S) => { S.step = "trade"; S.pendingTrade = true; S.players[S.cur].cards.wheat = 1; S.players[1 - S.cur].cards.ranch = 1; } },
    { step: "tv", setup: (S) => { S.step = "tv"; S.pendingTv = true; S.players[1 - S.cur].coins = 5; } },
    { step: "reroll", setup: (S) => { S.step = "reroll"; S.dice = [1]; S.diceN = 1; S.players[S.cur].lm.tower = true; } },
    { step: "roll", setup: (S) => { S.step = "roll"; } }
  ];
  const hostile = [
    null, undefined, 5, "roll", [], {},
    { t: null }, { t: "constructor" }, { t: "__proto__" }, { t: "toString" },
    { t: "buy", id: "constructor" }, { t: "buy", id: "__proto__" }, { t: "buy", id: "toString" },
    { t: "buy", id: null }, { t: "buy", id: 1 }, { t: "buy", id: ["wheat"] },
    { t: "landmark", id: "constructor" }, { t: "landmark", id: "__proto__" },
    { t: "trade", from: "constructor", their: "wheat", with: 1 },
    { t: "trade", from: "wheat", their: "constructor", with: 1 },
    { t: "trade", from: "wheat", their: "ranch", with: "constructor" },
    { t: "trade", from: "__proto__", their: "toString", with: 0 },
    { t: "tv", target: "constructor" }, { t: "tv", target: null }, { t: "tv", target: 1.5 },
    { t: "tv", target: -1 }, { t: "tv", target: 99 },
    { t: "roll", dice: "constructor" }, { t: "roll", dice: null }, { t: "roll", dice: 1.5 },
    { t: "roll", dice: 0 }, { t: "roll", dice: 3 }, { t: "roll", dice: Infinity },
    { t: "buy", id: "wheat", extra: { __proto__: { polluted: true } } }
  ];
  for (const phase of phases) {
    const S = two();
    phase.setup(S);
    for (let pi = -1; pi <= 2; pi++) {
      for (const a of hostile) {
        const before = JSON.stringify(S);
        let res;
        assert.doesNotThrow(() => { res = Game.act(S, pi, a); });
        if (!res.ok) assert.strictEqual(JSON.stringify(S), before, `rejected action must not change state (${phase.step}): ` + JSON.stringify(a));
        Object.assign(S, JSON.parse(before));
      }
    }
  }
  // Specific: buy constructor must not NaN coins; trade constructor must not write a function into cards
  {
    const S = two();
    S.step = "build";
    S.players[S.cur].coins = 20;
    const beforeCoins = S.players[S.cur].coins;
    const beforeCards = JSON.stringify(S.players[S.cur].cards);
    const res = Game.act(S, S.cur, { t: "buy", id: "constructor" });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(S.players[S.cur].coins, beforeCoins);
    assert.strictEqual(JSON.stringify(S.players[S.cur].cards), beforeCards);
    assert.ok(typeof S.players[S.cur].coins === "number" && !Number.isNaN(S.players[S.cur].coins));
  }
  {
    const S = two();
    const pi = S.cur, other = 1 - pi;
    S.step = "trade";
    S.pendingTrade = true;
    S.players[pi].cards.wheat = 1;
    S.players[other].cards.ranch = 1;
    const before = JSON.stringify(S.players.map((p) => p.cards));
    assert.strictEqual(Game.act(S, pi, { t: "trade", from: "constructor", their: "ranch", with: other }).ok, false);
    assert.strictEqual(Game.act(S, pi, { t: "trade", from: "wheat", their: "constructor", with: other }).ok, false);
    assert.strictEqual(JSON.stringify(S.players.map((p) => p.cards)), before);
    for (const p of S.players) for (const id of Object.keys(p.cards)) assert.strictEqual(typeof p.cards[id], "number");
  }
});
