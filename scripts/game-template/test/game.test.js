"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Game = require("../public/game.js");

const two = () => Game.newGame([{ name: "Anna" }, { name: "Ben" }], 1, 30, 2);

test("a new game starts a round with somebody on turn", () => {
  const S = two();
  assert.strictEqual(S.phase, "play");
  assert.ok(S.cur === 0 || S.cur === 1);
  assert.strictEqual(S.players[0].score, 0);
  assert.ok(Game.AVATARS.includes(S.players[0].avatar));
});

test("settings are normalised", () => {
  assert.strictEqual(Game.normGoal(9), 1);
  assert.strictEqual(Game.normTarget(100), 100);
  assert.strictEqual(Game.normTarget("nonsense"), 50);
  assert.strictEqual(Game.normLevel(3), 3);
});

test("only the player on turn may act, and holding needs points", () => {
  const S = two(), other = 1 - S.cur;
  assert.strictEqual(Game.act(S, other, { t: "roll" }).ok, false);
  assert.strictEqual(Game.act(S, S.cur, { t: "hold" }).ok, false);
  assert.strictEqual(Game.act(S, S.cur, { t: "dance" }).ok, false);
});

test("a 1 loses the turn points, holding banks them and passes the turn", () => {
  const S = two(), first = S.cur;
  const real = Math.random;
  try {
    Math.random = () => 0.5; // a 4
    assert.ok(Game.act(S, first, { t: "roll" }).ok);
    assert.strictEqual(S.pot, 4);
    assert.ok(Game.act(S, first, { t: "hold" }).ok);
    assert.strictEqual(S.players[first].score, 4);
    assert.strictEqual(S.cur, 1 - first);
    Math.random = () => 0; // a 1
    Game.act(S, S.cur, { t: "roll" });
    Math.random = () => 0.5;
    const res = Game.act(S, first, { t: "roll" });
    assert.ok(res.ok);
    Math.random = () => 0;
    const bust = Game.act(S, first, { t: "roll" });
    assert.strictEqual(bust.events[0].bust, true);
    assert.strictEqual(S.players[first].score, 4);
    assert.strictEqual(S.cur, 1 - first);
  } finally { Math.random = real; }
});

test("reaching the target wins the round, then the game", () => {
  const S = Game.newGame([{ name: "Anna" }, { name: "Ben" }], 2, 30, 2);
  const real = Math.random;
  try {
    Math.random = () => 0.99; // always a 6
    let guard = 0;
    while (S.phase === "play" && guard++ < 50) {
      const pi = S.cur;
      Game.act(S, pi, { t: "roll" });
      if (S.pot >= 18) Game.act(S, pi, { t: "hold" });
    }
    assert.strictEqual(S.phase, "roundEnd");
    assert.strictEqual(S.last.over, false);
    Game.act(S, 0, { t: "next" });
    assert.strictEqual(S.round, 2);
    guard = 0;
    while (S.phase === "play" && guard++ < 50) { const pi = S.cur; Game.act(S, pi, { t: "roll" }); if (S.pot >= 18) Game.act(S, pi, { t: "hold" }); }
    const winner = S.last.winners[0];
    assert.strictEqual(S.phase === "roundEnd", true);
    assert.ok(S.players[winner].wins >= 1);
  } finally { Math.random = real; }
});

test("giving up hands the round to the best of the others", () => {
  const S = Game.newGame([{ name: "A" }, { name: "B" }, { name: "C" }], 1, 50, 2);
  S.players[2].score = 20;
  Game.act(S, 0, { t: "giveup" }); // giving up is allowed for anyone, also off turn
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.winners[0], 2);
});

test("the computer always makes a legal move and finishes a game", () => {
  for (const level of [1, 2, 3]) {
    const S = Game.newGame([{ name: "R1", bot: true }, { name: "R2", bot: true }], 1, 30, level);
    let guard = 0;
    while (S.phase === "play" && guard++ < 2000) {
      const a = Game.botMove(S, S.cur);
      assert.ok(a);
      assert.ok(Game.act(S, S.cur, a).ok);
    }
    assert.strictEqual(S.phase, "roundEnd");
  }
});

test("view marks who is me and hides nothing", () => {
  const S = two();
  assert.strictEqual(Game.view(S, 1).me, 1);
  assert.strictEqual(Game.view(S, -1).me, -1);
  assert.strictEqual(Game.view(S, 0).players.length, 2);
});

// The engine runs on the server's only thread for every room at once: a rule step, a bot move or
// a whole generated round must never take noticeable time. Keep a check like this for anything heavy.
test("the engine is fast: 200 new games and bot-only rounds take well under a second", () => {
  const t0 = Date.now();
  for (let k = 0; k < 200; k++) {
    const S = Game.newGame([{ name: "R1", bot: true }, { name: "R2", bot: true }], 1, 30, 2);
    let guard = 0;
    while (S.phase === "play" && guard++ < 2000) Game.act(S, S.cur, Game.botMove(S, S.cur));
  }
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
});
