"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Game = require("../public/game.js");

const mk = (n = 2, goal = 1, stock = 0, level = 2) =>
  Game.newGame(Array.from({ length: n }, (_, i) => ({ name: "P" + i, bot: i > 0 })), goal, stock, level);
const count = (S) => {
  const all = [...S.deck, ...S.done, ...S.build.flat()];
  for (const p of S.players) all.push(...p.hand, ...p.stock, ...p.disc.flat());
  return all;
};
// a table where `S.cur` has a known hand and stock
function set(S, { hand, stock, disc, build, deck }) {
  const P = S.players[S.cur];
  if (hand) P.hand = hand.slice();
  if (stock) P.stock = stock.slice();
  if (disc) P.disc = disc.map((d) => d.slice());
  if (build) S.build = build.map((b) => b.slice());
  if (deck) S.deck = deck.slice();
  return P;
}

test("a new game deals stock, hand and the 162-card deck", () => {
  for (const [n, size] of [[2, 30], [4, 30], [5, 20], [6, 20]]) {
    const S = mk(n);
    assert.strictEqual(S.phase, "play");
    assert.strictEqual(count(S).length, 162);
    assert.strictEqual(count(S).filter((c) => c === 0).length, 18);
    for (let v = 1; v <= 12; v++) assert.strictEqual(count(S).filter((c) => c === v).length, 12);
    S.players.forEach((p, i) => { assert.strictEqual(p.stock.length, size); assert.strictEqual(p.hand.length, i === S.cur ? 5 : 0); });
  }
  assert.strictEqual(mk(2, 1, 10).players[0].stock.length, 10);
  assert.strictEqual(mk(6, 1, 20).players[0].stock.length, 20);
  assert.strictEqual(mk(8).players.length, 6);
});

test("settings are normalised", () => {
  assert.strictEqual(Game.normGoal(9), 1);
  assert.strictEqual(Game.normGoal("3"), 3);
  assert.strictEqual(Game.normStock(10), 10);
  assert.strictEqual(Game.normStock(15), 0);
  assert.strictEqual(Game.normStock("constructor"), 0);
  assert.strictEqual(Game.normStock("__proto__"), 0);
  assert.strictEqual(Game.normLevel(3), 3);
  assert.strictEqual(Game.normLevel("toString"), 2);
  assert.strictEqual(Game.stockSize(4, 0), 30);
  assert.strictEqual(Game.stockSize(5, 0), 20);
  assert.strictEqual(Game.stockSize(6, 10), 10);
});

test("build piles take 1, 2, 3 … and jokers stand for the next number", () => {
  const S = mk();
  const me = S.cur;
  set(S, { hand: [0, 1, 2, 5, 7], stock: [9, 4], build: [[], [], [], []] });
  assert.strictEqual(Game.act(S, me, { t: "play", from: "hand", c: 2, to: 0 }).ok, false); // an empty pile wants a 1
  assert.ok(Game.act(S, me, { t: "play", from: "hand", c: 1, to: 0 }).ok);
  assert.ok(Game.act(S, me, { t: "play", from: "hand", c: 2, to: 0 }).ok);
  const r = Game.act(S, me, { t: "play", from: "hand", c: 0, to: 0 }); // joker as 3
  assert.ok(r.ok);
  assert.strictEqual(r.events[0].v, 3);
  assert.strictEqual(Game.view(S, me).wild[0], true);
  assert.strictEqual(S.cur, me); // playing does not end the turn
  assert.strictEqual(Game.act(S, me, { t: "play", from: "stock", c: 4, to: 0 }).ok, true); // 4 follows the joker
  assert.strictEqual(S.players[me].stock.length, 1);
});

test("playing from the stock and from discard piles checks the card that is really on top", () => {
  const S = mk(), me = S.cur;
  set(S, { hand: [1, 2, 3, 4, 5], stock: [6, 1], disc: [[3, 1], [], [], []], build: [[], [], [], []] });
  assert.strictEqual(Game.act(S, me, { t: "play", from: "stock", c: 6, to: 0 }).ok, false); // stale: top is 1
  assert.strictEqual(Game.act(S, me, { t: "play", from: "disc", c: 3, i: 0, to: 0 }).ok, false); // 3 is buried
  assert.strictEqual(Game.act(S, me, { t: "play", from: "disc", c: 1, i: 1, to: 0 }).ok, false); // empty pile
  assert.ok(Game.act(S, me, { t: "play", from: "disc", c: 1, i: 0, to: 0 }).ok);
  assert.deepStrictEqual(S.players[me].disc[0], [3]);
  assert.ok(Game.act(S, me, { t: "play", from: "stock", c: 1, to: 1 }).ok);
  assert.strictEqual(S.players[me].stock.length, 1);
});

test("a full pile is cleared and comes back through the draw pile", () => {
  const S = mk(), me = S.cur;
  const pile = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  set(S, { hand: [12, 3, 3, 3, 3], build: [pile, [], [], []], deck: [] });
  const r = Game.act(S, me, { t: "play", from: "hand", c: 12, to: 0 });
  assert.ok(r.ok);
  assert.ok(r.events.some((e) => e.t === "clear" && e.to === 0));
  assert.deepStrictEqual(S.build[0], []);
  assert.strictEqual(S.done.length, 12);
  // the next draw reshuffles the cleared cards
  set(S, { hand: [3, 3, 3, 3] });
  const d = Game.act(S, me, { t: "discard", c: 3, to: 0 });
  assert.ok(d.ok);
  assert.ok(d.events.some((e) => e.t === "reshuffle"));
  assert.strictEqual(S.done.length, 0);
  assert.strictEqual(S.players[S.cur].hand.length, 5);
});

test("discarding ends the turn, the next player draws up to five", () => {
  const S = mk(3), me = S.cur;
  const c = S.players[me].hand[0];
  const r = Game.act(S, me, { t: "discard", c, to: 2 });
  assert.ok(r.ok);
  assert.strictEqual(S.players[me].disc[2].length, 1);
  assert.strictEqual(S.cur, (me + 1) % 3);
  assert.strictEqual(S.players[S.cur].hand.length, 5);
  assert.deepStrictEqual(r.events.map((e) => e.t), ["discard", "draw"]);
  // hand sizes: nobody else drew yet
  assert.strictEqual(S.players[me].hand.length, 4);
});

test("an empty hand is refilled at once, and the turn goes on", () => {
  const S = mk(), me = S.cur;
  set(S, { hand: [1], build: [[], [], [], []] });
  const r = Game.act(S, me, { t: "play", from: "hand", c: 1, to: 0 });
  assert.ok(r.ok);
  assert.strictEqual(S.cur, me);
  assert.strictEqual(S.players[me].hand.length, 5);
  assert.ok(r.events.some((e) => e.t === "draw" && e.n === 5));
});

test("hands stay sorted with jokers first", () => {
  const S = mk(4);
  for (const p of S.players) if (p.hand.length) assert.deepStrictEqual(p.hand, p.hand.slice().sort((a, b) => a - b));
});

test("only the player on turn may act", () => {
  const S = mk(3), other = (S.cur + 1) % 3;
  const c = S.players[other].hand[0];
  assert.strictEqual(Game.act(S, other, { t: "discard", c: S.players[S.cur].hand[0], to: 0 }).ok, false);
  assert.strictEqual(Game.act(S, S.cur, { t: "pass" }).ok, false); // a hand has to be played out first
  assert.strictEqual(Game.act(S, S.cur, { t: "dance" }).ok, false);
  assert.strictEqual(c, undefined);
});

test("emptying the stock wins the round, then the game, and a new game starts clean", () => {
  const S = mk(2, 2), me = S.cur;
  set(S, { stock: [1], build: [[], [], [], []] });
  const r = Game.act(S, me, { t: "play", from: "stock", c: 1, to: 0 });
  assert.ok(r.ok);
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [me]);
  assert.strictEqual(S.last.over, false);
  assert.ok(r.events.some((e) => e.t === "end"));
  assert.strictEqual(Game.act(S, me, { t: "discard", c: 1, to: 0 }).ok, false);
  assert.ok(Game.act(S, 1 - me, { t: "next" }).ok);
  assert.strictEqual(S.phase, "play");
  assert.strictEqual(S.round, 2);
  assert.strictEqual(S.players[me].wins, 1);
  assert.strictEqual(S.players[me].stock.length, 30);
  set(S, { stock: [1], build: [[], [], [], []] });
  Game.act(S, S.cur, { t: "play", from: "stock", c: 1, to: 0 });
  const winner = S.last.winners[0];
  assert.strictEqual(S.players[winner].wins, S.last.over ? 2 : 1);
  if (S.last.over) {
    Game.act(S, 0, { t: "next" });
    assert.strictEqual(S.round, 1);
    assert.deepStrictEqual(S.players.map((p) => p.wins), [0, 0]);
  }
});

test("giving up hands the round to the smallest stock of the others", () => {
  const S = mk(3), me = S.cur;
  const a = (me + 1) % 3, b = (me + 2) % 3;
  S.players[a].stock.length = 7;
  const r = Game.act(S, a === me ? b : a, { t: "giveup" });
  assert.ok(r.ok);
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.how, "giveup");
  assert.notStrictEqual(S.last.winners[0], a);
  assert.ok(Game.act(S, me, { t: "next" }).ok);
});

test("with an empty hand and an empty deck players pass, and the round ends in a stall", () => {
  const S = mk(2), me = S.cur;
  S.deck = []; S.done = [];
  S.players[0].hand = []; S.players[1].hand = [];
  S.players[0].stock.length = 12; S.players[1].stock.length = 5;
  let guard = 0;
  while (S.phase === "play" && guard++ < 10) {
    const r = Game.act(S, S.cur, { t: "pass" });
    assert.ok(r.ok);
  }
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.how, "stall");
  assert.deepStrictEqual(S.last.winners, [1]);
  assert.strictEqual(guard, 4);
  assert.ok(me === 0 || me === 1);
});

test("the view hides other hands and never leaks the deck", () => {
  const S = mk(3);
  const v = Game.view(S, 0);
  assert.strictEqual(v.hand === null, false);
  assert.ok(Array.isArray(v.players[1].disc));
  assert.ok(!("hand" in v.players[1]));
  assert.strictEqual(v.players[1].handN, S.players[1].hand.length);
  assert.strictEqual(v.deckN, S.deck.length);
  assert.ok(!JSON.stringify(v).includes('"deck":'));
  const w = Game.view(S, -1);
  assert.strictEqual(w.me, -1);
  assert.strictEqual(w.hand, null);
  const e = Game.act(S, S.cur, { t: "discard", c: S.players[S.cur].hand[0], to: 0 });
  for (const ev of e.events) if (ev.t === "draw") assert.deepStrictEqual(Object.keys(ev).sort(), ["n", "pi", "t"]);
});

test("hostile input is refused without breaking the game", () => {
  const S = mk(), me = S.cur;
  const before = JSON.stringify(S);
  const bad = [
    null, undefined, 5, "play", [], {}, { t: 1 }, { t: "constructor" }, { t: "__proto__" }, { t: "toString" },
    { t: "play" }, { t: "play", from: "constructor", c: 1, to: 0 }, { t: "play", from: "hand", c: "1", to: 0 },
    { t: "play", from: "hand", c: 1.5, to: 0 }, { t: "play", from: "hand", c: -1, to: 0 }, { t: "play", from: "hand", c: 13, to: 0 },
    { t: "play", from: "hand", c: 1, to: 4 }, { t: "play", from: "hand", c: 1, to: -1 }, { t: "play", from: "hand", c: 1, to: "0" },
    { t: "play", from: "hand", c: 1, to: null }, { t: "play", from: "hand", c: NaN, to: 0 }, { t: "play", from: "hand", c: Infinity, to: 0 },
    { t: "play", from: "disc", c: 1, i: 9, to: 0 }, { t: "play", from: "disc", c: 1, i: "constructor", to: 0 },
    { t: "discard", c: 1, to: 9 }, { t: "discard", c: "x", to: 0 }, { t: "discard", c: null, to: 0 }, { t: "discard", to: 0 },
    { t: "next" }, { t: "pass" }
  ];
  for (const a of bad) {
    let r;
    assert.doesNotThrow(() => { r = Game.act(S, me, a); }, JSON.stringify(a));
    assert.strictEqual(r.ok, false, JSON.stringify(a));
  }
  for (const pi of [-1, 2, 99, 1.5, NaN, "0", null, undefined, "constructor", {}]) {
    assert.strictEqual(Game.act(S, pi, { t: "discard", c: 1, to: 0 }).ok, false);
  }
  assert.strictEqual(JSON.stringify(S).replace(/"mv":\d+/, ""), before.replace(/"mv":\d+/, ""));
  assert.strictEqual(count(S).length, 162);
});

// ---------- computer players ----------
function playOut(S, guard = 6000) {
  let n = 0;
  while (S.phase === "play" && n++ < guard) {
    const pi = S.cur, a = Game.botMove(S, pi);
    assert.ok(a, "the bot always has an action");
    const hand = S.players[pi].hand.slice();
    const r = Game.act(S, pi, a);
    assert.ok(r.ok, `${JSON.stringify(a)} ${r.error} hand=${hand}`);
    assert.strictEqual(count(S).length, 162);
  }
  return n;
}

test("computers play whole rounds legally at every level and size", () => {
  for (const level of [1, 2, 3]) {
    for (const [n, stock] of [[2, 10], [3, 20], [4, 0], [6, 0]]) {
      const S = Game.newGame(Array.from({ length: n }, (_, i) => ({ name: "B" + i, bot: true })), 1, stock, level);
      const steps = playOut(S);
      assert.ok(steps < 6000, `round ${level}/${n} did not end`);
      assert.strictEqual(S.phase, "roundEnd");
      assert.strictEqual(S.last.winners.length, 1);
    }
  }
});

test("the profi computer wins most games against the easy one", () => {
  let wins = 0;
  const N = 30;
  for (let g = 0; g < N; g++) {
    const S = Game.newGame([{ name: "pro", bot: true }, { name: "easy", bot: true }], 1, 10, 3);
    S.level = 3;
    let n = 0;
    while (S.phase === "play" && n++ < 3000) {
      S.level = S.cur === 0 ? 3 : 1;
      Game.act(S, S.cur, Game.botMove(S, S.cur));
    }
    if (S.last.winners[0] === 0) wins++;
  }
  assert.ok(wins > N * 0.6, `profi won only ${wins}/${N}`);
});

test("botMove and botPlan only answer for the computer on turn", () => {
  const S = mk(2); // player 1 is a bot
  S.cur = 0;
  assert.strictEqual(Game.botMove(S, 1), null);
  assert.strictEqual(Game.botPlan(S), null);
  S.cur = 1;
  const p = Game.botPlan(S);
  assert.strictEqual(p.pi, 1);
  assert.ok(p.delay >= 650 && p.delay < 2000);
  assert.match(p.key, /^bot:/);
  S.phase = "roundEnd";
  assert.strictEqual(Game.botPlan(S), null);
  assert.strictEqual(Game.botMove(S, 1), null);
});

test("the bot's pause is longer for the first move of a turn", () => {
  const S = mk(2); S.cur = 1;
  S.tm = 0; const first = Game.botPlan(S).delay;
  S.tm = 2; const later = Game.botPlan(S).delay;
  assert.ok(first >= 1100);
  assert.ok(later < 1100);
});

test("the level-2 bot builds toward its stock card", () => {
  const S = mk(2, 1, 0, 2); S.cur = 1;
  set(S, { hand: [1, 2, 3, 11, 12], stock: [4], build: [[], [], [], []] });
  for (let k = 0; k < 4; k++) {
    const a = Game.botMove(S, 1);
    assert.strictEqual(a.t, "play");
    assert.ok(Game.act(S, 1, a).ok);
  }
  assert.strictEqual(S.players[1].stock.length, 0); // 1, 2, 3, then the 4 from the stock: round won
  assert.strictEqual(S.phase, "roundEnd");
});

test("the bot keeps a joker and discards instead when nothing useful fits", () => {
  const S = mk(2, 1, 0, 2); S.cur = 1;
  set(S, { hand: [0, 9, 10, 11, 12], stock: [12], build: [[1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3]] });
  const a = Game.botMove(S, 1);
  assert.strictEqual(a.t, "discard");
  assert.notStrictEqual(a.c, 0);
});

test("a computer move is fast, even on a full six-player table", () => {
  let worst = 0;
  for (let g = 0; g < 6; g++) {
    const S = Game.newGame(Array.from({ length: 6 }, (_, i) => ({ name: "B" + i, bot: true })), 1, 0, 3);
    let n = 0;
    while (S.phase === "play" && n++ < 6000) {
      const t = Date.now();
      const a = Game.botMove(S, S.cur);
      worst = Math.max(worst, Date.now() - t);
      Game.act(S, S.cur, a);
    }
  }
  assert.ok(worst < 100, `slowest bot move took ${worst} ms`);
});
