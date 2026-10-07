"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Game = require("../public/game.js");

const mk = (n, goal, level) => Game.newGame(Array.from({ length: n }, (_, i) => ({ name: "P" + i })), goal || 1, level || 2);
const total = (S) => S.players.reduce((s, p) => s + p.hand.length, 0) + S.deck.length + S.disc.length + S.boom.length + (S.phase === "place" ? 1 : 0);
const closeWindow = (S) => { if (S.stack) S.stack.until = Date.now() - 1; return Game.tick(S, Date.now()); };
// a quiet table: nobody holds a Nö, the deck is a known list (top is the last entry)
const setup = (S, deck) => {
  S.players.forEach((p) => { p.hand = p.hand.filter((c) => c !== "nope"); });
  S.deck = deck.slice();
  S.peeks = {};
};
const give = (S, pi, ...cards) => { S.players[pi].hand.push(...cards); };

test("deal: 7 cards plus a defuse each, kittens = players - 1", () => {
  for (let n = 2; n <= Game.MAX_PLAYERS; n++) {
    const S = mk(n);
    for (const p of S.players) {
      assert.strictEqual(p.hand.length, 8);
      assert.strictEqual(p.hand.filter((c) => c === "defuse").length, 1);
    }
    assert.strictEqual(S.deck.filter((c) => c === "kitten").length, n - 1);
    assert.strictEqual(S.deck.filter((c) => c === "defuse").length, Math.min(2, 6 - n));
    assert.ok(!S.players.some((p) => p.hand.includes("kitten")));
    assert.strictEqual(total(S), 46 + n + Math.min(2, 6 - n) + (n - 1));
  }
});

test("settings are normalised", () => {
  assert.strictEqual(Game.normGoal(9), 1);
  assert.strictEqual(Game.normGoal("3"), 3);
  assert.strictEqual(Game.normLevel(3), 3);
  assert.strictEqual(Game.normLevel("x"), 2);
  assert.ok(Game.AVATARS.includes(mk(2).players[0].avatar));
});

test("only the player on turn may act", () => {
  const S = mk(3), other = (S.cur + 1) % 3;
  assert.strictEqual(Game.act(S, other, { t: "draw" }).ok, false);
  assert.strictEqual(Game.act(S, S.cur, { t: "dance" }).ok, false);
  assert.strictEqual(Game.act(S, 7, { t: "draw" }).ok, false);
});

test("drawing a normal card ends the turn", () => {
  const S = mk(3), p = S.cur;
  setup(S, ["kitten", "cat1"]);
  const n = S.players[p].hand.length;
  assert.ok(Game.act(S, p, { t: "draw" }).ok);
  assert.strictEqual(S.players[p].hand.length, n + 1);
  assert.strictEqual(S.cur, (p + 1) % 3);
});

test("cards are conserved through a draw and a defuse", () => {
  const S = mk(3), p = S.cur;
  setup(S, ["cat1", "kitten"]);
  const t0 = total(S);
  Game.act(S, p, { t: "draw" });
  assert.strictEqual(S.phase, "place");
  assert.strictEqual(total(S), t0);
  assert.strictEqual(Game.act(S, (p + 1) % 3, { t: "place", pos: 0 }).ok, false);
  assert.strictEqual(Game.act(S, p, { t: "place", pos: 99 }).ok, false);
  assert.strictEqual(Game.act(S, p, { t: "draw" }).ok, false);
  assert.ok(Game.act(S, p, { t: "place", pos: 0 }).ok);
  assert.strictEqual(S.deck[S.deck.length - 1], "kitten");
  assert.strictEqual(S.cur, (p + 1) % 3);
  assert.strictEqual(total(S), t0);
});

test("a kitten without defuse knocks you out; the last one standing wins", () => {
  const S = mk(2, 1), p = S.cur;
  setup(S, ["kitten"]);
  S.players[p].hand = S.players[p].hand.filter((c) => c !== "defuse");
  const r = Game.act(S, p, { t: "draw" });
  assert.ok(r.ok);
  assert.ok(r.events.some((e) => e.t === "boom"));
  assert.strictEqual(S.players[p].out, true);
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [1 - p]);
  assert.strictEqual(S.last.over, true);
  assert.strictEqual(S.players[p].hand.length, 0);
});

test("with three players the round goes on after one is out", () => {
  const S = mk(3), p = S.cur;
  setup(S, ["kitten"]);
  S.players[p].hand = S.players[p].hand.filter((c) => c !== "defuse");
  Game.act(S, p, { t: "draw" });
  assert.strictEqual(S.phase, "play");
  assert.strictEqual(S.cur, (p + 1) % 3);
  assert.strictEqual(Game.act(S, p, { t: "draw" }).ok, false);
  const q = (p + 2) % 3;
  S.cur = q; // skipped over the one who is out
  Game.act(S, q, { t: "draw" });
  assert.strictEqual(S.cur, (p + 1) % 3);
});

test("a played card waits for a Nö window; tick resolves it", () => {
  const S = mk(3), p = S.cur;
  setup(S, ["cat1", "cat2"]);
  give(S, p, "skip");
  assert.ok(Game.act(S, p, { t: "play", c: "skip" }).ok);
  assert.strictEqual(S.phase, "stack");
  assert.ok(Game.nextDeadline(S) > 0);
  assert.strictEqual(Game.act(S, p, { t: "draw" }).ok, false);
  assert.strictEqual(Game.tick(S, Date.now()).length, 0);
  assert.ok(closeWindow(S).some((e) => e.t === "skip"));
  assert.strictEqual(S.cur, (p + 1) % 3);
  assert.strictEqual(S.deck.length, 2);
  assert.strictEqual(Game.nextDeadline(S), -1);
});

test("Nö cancels, a Nö on the Nö brings it back, and the window restarts", () => {
  const S = mk(3), p = S.cur, a = (p + 1) % 3, b = (p + 2) % 3;
  setup(S, ["cat1", "cat2"]);
  give(S, p, "skip"); give(S, a, "nope"); give(S, b, "nope");
  Game.act(S, p, { t: "play", c: "skip" });
  const until = S.stack.until;
  S.stack.until = Date.now() + 100;
  assert.ok(Game.act(S, a, { t: "nope" }).ok);
  assert.ok(S.stack.until > Date.now() + 1000 && until > 0);
  assert.strictEqual(Game.act(S, a, { t: "nope" }).ok, false); // not twice in a row
  assert.strictEqual(Game.act(S, p, { t: "nope" }).ok, false); // no Nö in hand
  closeWindow(S);
  assert.strictEqual(S.cur, p); // cancelled

  give(S, p, "skip"); give(S, a, "nope"); give(S, b, "nope");
  Game.act(S, p, { t: "play", c: "skip" });
  Game.act(S, a, { t: "nope" });
  Game.act(S, b, { t: "nope" });
  closeWindow(S);
  assert.strictEqual(S.cur, a); // went through
});

test("nobody can Nö their own card, but the player may Nö a Nö", () => {
  const S = mk(3), p = S.cur, a = (p + 1) % 3;
  give(S, p, "shuffle", "nope"); give(S, a, "nope");
  Game.act(S, p, { t: "play", c: "shuffle" });
  assert.strictEqual(Game.act(S, p, { t: "nope" }).ok, false);
  assert.ok(Game.act(S, a, { t: "nope" }).ok);
  assert.strictEqual(Game.view(S, p).stack.short, false);
  assert.ok(Game.act(S, p, { t: "nope" }).ok);
});

test("Nö only works inside the window and not without a played card", () => {
  const S = mk(3), p = S.cur, a = (p + 1) % 3;
  give(S, a, "nope");
  assert.strictEqual(Game.act(S, a, { t: "nope" }).ok, false);
  give(S, p, "shuffle");
  Game.act(S, p, { t: "play", c: "shuffle" });
  S.stack.until = Date.now() - 5;
  assert.strictEqual(Game.act(S, a, { t: "nope" }).ok, false);
});

test("attack: the next player owes two turns, and attacks stack up", () => {
  const S = mk(3), p = S.cur, a = (p + 1) % 3;
  setup(S, ["cat1", "cat2", "cat3", "cat4", "cat5", "cat1"]);
  give(S, p, "attack"); give(S, a, "attack");
  Game.act(S, p, { t: "play", c: "attack" });
  closeWindow(S);
  assert.strictEqual(S.cur, a);
  assert.strictEqual(S.owed, 2);
  Game.act(S, a, { t: "draw" });
  assert.strictEqual(S.cur, a);
  assert.strictEqual(S.owed, 1);
  Game.act(S, a, { t: "draw" });
  assert.strictEqual(S.cur, (a + 1) % 3);
  assert.strictEqual(S.owed, 1);

  const T = mk(3), q = T.cur, r = (q + 1) % 3;
  setup(T, ["cat1", "cat2", "cat3", "cat4", "cat5", "cat1"]);
  give(T, q, "attack"); give(T, r, "attack");
  Game.act(T, q, { t: "play", c: "attack" }); closeWindow(T);
  Game.act(T, r, { t: "play", c: "attack" }); closeWindow(T);
  assert.strictEqual(T.cur, (r + 1) % 3);
  assert.strictEqual(T.owed, 3);
});

test("skip ends one turn of several without drawing", () => {
  const S = mk(3), p = S.cur;
  setup(S, ["cat1", "cat2", "cat3"]);
  S.owed = 2;
  give(S, p, "skip");
  Game.act(S, p, { t: "play", c: "skip" }); closeWindow(S);
  assert.strictEqual(S.cur, p);
  assert.strictEqual(S.owed, 1);
  assert.strictEqual(S.deck.length, 3);
});

test("shuffle and future: only the player who looked sees the top three", () => {
  const S = mk(3), p = S.cur;
  setup(S, ["cat4", "kitten", "cat2", "cat1"]);
  give(S, p, "future", "shuffle");
  Game.act(S, p, { t: "play", c: "future" }); closeWindow(S);
  assert.deepStrictEqual(Game.view(S, p).peek, ["cat1", "cat2", "kitten"]);
  assert.strictEqual(Game.view(S, (p + 1) % 3).peek, null);
  Game.act(S, p, { t: "play", c: "shuffle" }); closeWindow(S);
  assert.strictEqual(Game.view(S, p).peek, null);
  assert.strictEqual(S.deck.length, 4);
});

test("favor: the target chooses what to give, and must do so", () => {
  const S = mk(3), p = S.cur, a = (p + 1) % 3;
  setup(S, ["cat1", "cat2"]);
  give(S, p, "favor");
  assert.strictEqual(Game.act(S, p, { t: "play", c: "favor" }).ok, false); // needs a target
  assert.strictEqual(Game.act(S, p, { t: "play", c: "favor", target: p }).ok, false);
  assert.ok(Game.act(S, p, { t: "play", c: "favor", target: a }).ok);
  closeWindow(S);
  assert.strictEqual(S.phase, "give");
  assert.strictEqual(Game.waitingFor(S), a);
  assert.strictEqual(Game.act(S, p, { t: "draw" }).ok, false);
  assert.strictEqual(Game.act(S, p, { t: "give", c: "cat1" }).ok, false);
  const c = S.players[a].hand[0], n = S.players[p].hand.length, m = S.players[a].hand.length;
  assert.strictEqual(Game.act(S, a, { t: "give", c: "kitten" }).ok, false);
  assert.ok(Game.act(S, a, { t: "give", c }).ok);
  assert.strictEqual(S.players[p].hand.length, n + 1);
  assert.strictEqual(S.players[a].hand.length, m - 1);
  assert.strictEqual(S.phase, "play");
  assert.strictEqual(S.cur, p);
  // the card is visible only to the two who traded
  const third = (p + 2) % 3;
  assert.strictEqual(Game.view(S, third).txs.at(-1).c, null);
  assert.strictEqual(Game.view(S, p).txs.at(-1).c, c);
});

test("pairs steal at random, triples name a card", () => {
  const S = mk(3), p = S.cur, a = (p + 1) % 3;
  setup(S, ["cat1", "cat2"]);
  S.players[p].hand = ["cat3", "cat3", "cat3", "defuse"];
  S.players[a].hand = ["attack", "cat1"];
  assert.strictEqual(Game.act(S, p, { t: "combo", c: "cat3", n: 2 }).ok, false);
  assert.strictEqual(Game.act(S, p, { t: "combo", c: "cat3", n: 3, target: a }).ok, false); // needs a name
  assert.strictEqual(Game.act(S, p, { t: "combo", c: "cat3", n: 3, target: a, name: "kitten" }).ok, false);
  assert.strictEqual(Game.act(S, p, { t: "combo", c: "cat3", n: 4, target: a }).ok, false);
  assert.strictEqual(Game.act(S, p, { t: "combo", c: "attack", n: 2, target: a }).ok, false);
  assert.ok(Game.act(S, p, { t: "combo", c: "cat3", n: 3, target: a, name: "attack" }).ok);
  closeWindow(S);
  assert.deepStrictEqual(S.players[a].hand, ["cat1"]);
  assert.ok(S.players[p].hand.includes("attack"));
  assert.strictEqual(S.cur, p);

  S.players[p].hand = ["cat2", "cat2"];
  Game.act(S, p, { t: "combo", c: "cat2", n: 2, target: a }); closeWindow(S);
  assert.strictEqual(S.players[a].hand.length, 0);
  assert.deepStrictEqual(S.players[p].hand, ["cat1"]);
  // a target with nothing left is not valid any more
  S.players[p].hand = ["cat2", "cat2"];
  assert.strictEqual(Game.act(S, p, { t: "combo", c: "cat2", n: 2, target: a }).ok, false);
});

test("an empty deck is refilled from the discard pile", () => {
  const S = mk(2), p = S.cur;
  S.deck = [];
  S.disc = ["cat1", "cat2", "cat3"];
  const r = Game.act(S, p, { t: "draw" });
  assert.ok(r.ok);
  assert.ok(r.events.some((e) => e.t === "reshuffle"));
  assert.strictEqual(S.deck.length, 2);
});

test("cards are conserved while playing every kind of card", () => {
  for (let n = 2; n <= 5; n++) {
    const S = mk(n);
    const t0 = total(S);
    for (let i = 0; i < 200 && S.phase !== "roundEnd"; i++) {
      if (S.phase === "stack") { closeWindow(S); }
      else { const w = Game.waitingFor(S), m = Game.botMove(S, w); Game.act(S, w, m); }
      assert.strictEqual(total(S) , t0, `n=${n} step ${i}`);
    }
  }
});

test("the view never leaks other hands or the deck", () => {
  const S = mk(3);
  const v = Game.view(S, 0);
  assert.strictEqual(v.hand.length, 8);
  assert.strictEqual(v.players[1].hand, undefined);
  assert.strictEqual(v.deck, undefined);
  assert.strictEqual(v.players[1].handN, 8);
  assert.strictEqual(Game.view(S, 9).hand, null);
});

test("hostile input is rejected without changing the state", () => {
  const S = mk(3), p = S.cur;
  const before = JSON.stringify(S);
  const bad = [
    null, 5, "x", {}, { t: 1 }, { t: "play" }, { t: "play", c: "constructor" }, { t: "play", c: "__proto__" },
    { t: "play", c: "cat1" }, { t: "play", c: "kitten" }, { t: "play", c: "defuse" }, { t: "play", c: ["skip"] },
    { t: "combo", c: "constructor", n: 2, target: 1 }, { t: "combo", c: "cat1", n: "2", target: 1 },
    { t: "combo", c: "cat1", n: 2, target: "1" }, { t: "give", c: "cat1" }, { t: "place", pos: 0 },
    { t: "place", pos: "0" }, { t: "nope" }, { t: "next" }, { t: "constructor" }, { t: "__proto__" }
  ];
  for (const a of bad) {
    const r = Game.act(S, p, a);
    assert.strictEqual(r.ok, false, JSON.stringify(a));
    assert.ok(typeof r.error === "string");
  }
  for (const pi of [-1, 1.5, "0", NaN, 99, null, undefined, "constructor"]) assert.strictEqual(Game.act(S, pi, { t: "draw" }).ok, false);
  assert.strictEqual(JSON.stringify(S), before);
});

test("timeout decides for whoever is blocking: draw, give, or place", () => {
  let S = mk(3), p = S.cur;
  setup(S, ["cat1", "cat2"]);
  assert.ok(Game.act(S, 0, { t: "timeout" }).ok);
  assert.strictEqual(S.cur, (p + 1) % 3);

  S = mk(3); p = S.cur;
  setup(S, ["cat1", "cat2"]);
  give(S, p, "favor");
  Game.act(S, p, { t: "play", c: "favor", target: (p + 1) % 3 }); closeWindow(S);
  const hand = S.players[(p + 1) % 3].hand.length;
  assert.ok(Game.act(S, 2, { t: "timeout" }).ok);
  assert.strictEqual(S.phase, "play");
  assert.strictEqual(S.players[(p + 1) % 3].hand.length, hand - 1);

  S = mk(3); p = S.cur;
  setup(S, ["cat1", "kitten"]);
  Game.act(S, p, { t: "draw" });
  assert.strictEqual(S.phase, "place");
  assert.ok(Game.act(S, 0, { t: "timeout" }).ok);
  assert.strictEqual(S.deck.filter((c) => c === "kitten").length, 1);
  assert.strictEqual(S.phase, "play");

  S = mk(3);
  S.phase = "stack"; S.stack = { pi: 0, c: "skip", n: 1, target: -1, name: "", nopes: 0, last: -1, until: Date.now() + 1000 };
  assert.strictEqual(Game.act(S, 0, { t: "timeout" }).ok, false);
});

test("the host can skip a blocking player, but not himself", () => {
  const S = mk(3), p = S.cur, other = (p + 1) % 3;
  setup(S, ["cat1", "cat2"]);
  assert.strictEqual(Game.act(S, p, { t: "skip" }).ok, false);
  assert.ok(Game.act(S, other, { t: "skip" }).ok);
  assert.strictEqual(S.cur, other);
});

test("computer players decide through botMove and botPlan, and finish whole rounds", () => {
  for (let n = 2; n <= 5; n++) for (const level of [1, 2, 3]) {
    const S = mk(n, 1, level);
    S.players.forEach((p) => { p.bot = true; });
    let steps = 0;
    while (S.phase !== "roundEnd" && steps++ < 3000) {
      if (S.phase === "stack") {
        const plan = Game.botPlan(S);
        if (plan) assert.ok(S.players[plan.pi].bot);
        const nopers = S.players.map((p, i) => i).filter((i) => Game.botMove(S, i));
        for (const i of nopers) { const m = Game.botMove(S, i); if (m && m.t === "nope") Game.act(S, i, m); break; }
        closeWindow(S);
        continue;
      }
      const plan = Game.botPlan(S);
      assert.ok(plan && S.players[plan.pi].bot && plan.delay > 0, "plan");
      assert.strictEqual(plan.pi, Game.waitingFor(S));
      const r = Game.act(S, plan.pi, Game.botMove(S, plan.pi));
      assert.ok(r.ok, JSON.stringify(r) + " " + S.phase);
    }
    assert.strictEqual(S.phase, "roundEnd", `n=${n} level=${level}`);
    assert.strictEqual(S.last.winners.length, 1);
    assert.strictEqual(S.players.filter((p) => !p.out).length, 1);
  }
});

test("a bot plans its Nö inside the open window and stays quiet otherwise", () => {
  const S = mk(2, 1, 3), p = S.cur, b = 1 - p;
  S.players[b].bot = true;
  setup(S, ["cat1", "cat2"]);
  give(S, p, "favor"); give(S, b, "nope");
  Game.act(S, p, { t: "play", c: "favor", target: b });
  let plans = 0;
  for (let i = 0; i < 200; i++) { S.mv++; const pl = Game.botPlan(S); if (pl) { plans++; assert.strictEqual(pl.pi, b); assert.ok(pl.delay <= Game.WINDOW_MS); assert.strictEqual(Game.botMove(S, b).t, "nope"); } }
  assert.ok(plans > 100);
  S.stack.until = Date.now() + 200;
  assert.strictEqual(Game.botPlan(S), null);
  assert.strictEqual(Game.botPlan({ ...S, phase: "roundEnd" }), null);
});

test("timing: the window length and the turn clock are sane", () => {
  const t0 = Date.now();
  const S = mk(3), p = S.cur;
  setup(S, ["cat1", "cat2"]);
  give(S, p, "shuffle"); give(S, (p + 1) % 3, "nope");
  Game.act(S, p, { t: "play", c: "shuffle" });
  assert.ok(S.stack.until - t0 >= Game.WINDOW_MS - 50);
  assert.ok(Game.nextDeadline(S, t0) > 0);
  assert.strictEqual(Game.nextDeadline(S, S.stack.until + 1), 0);
  assert.ok(Game.TURN_MS >= 20000);
});

test("round end: next starts a new round, after the game is over wins are reset", () => {
  const S = mk(2, 2), p = S.cur;
  setup(S, ["kitten"]);
  S.players[p].hand = S.players[p].hand.filter((c) => c !== "defuse");
  Game.act(S, p, { t: "draw" });
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.over, false);
  assert.strictEqual(Game.act(S, p, { t: "draw" }).ok, false);
  assert.ok(Game.act(S, 0, { t: "next" }).ok);
  assert.strictEqual(S.round, 2);
  assert.strictEqual(S.phase, "play");
  assert.strictEqual(S.players.filter((x) => x.wins === 1).length, 1);
  const q = S.cur;
  setup(S, ["kitten"]);
  S.players[q].hand = S.players[q].hand.filter((c) => c !== "defuse");
  Game.act(S, q, { t: "draw" });
  assert.strictEqual(S.phase, "roundEnd");
  if (S.last.over) { Game.act(S, 0, { t: "next" }); assert.ok(S.players.every((x) => x.wins === 0)); assert.strictEqual(S.round, 1); }
  assert.strictEqual(Game.act(S, 0, { t: "next" }).ok, true);
});

test("nobody can say Nö: the card resolves after a short beat instead of the full window", () => {
  const S = mk(3), p = S.cur;
  setup(S, ["cat1", "cat2"]);
  give(S, p, "shuffle");
  const t0 = Date.now();
  Game.act(S, p, { t: "play", c: "shuffle" });
  assert.ok(S.stack.until - t0 <= Game.SETTLE_MS + 50);
});

test("\"Kein Nö\" from everybody holding one ends the window early; a Nö reopens it", () => {
  const S = mk(3), p = S.cur, a = (p + 1) % 3, b = (p + 2) % 3;
  setup(S, ["cat1", "cat2"]);
  give(S, p, "shuffle"); give(S, a, "nope"); give(S, b, "nope");
  Game.act(S, p, { t: "play", c: "shuffle" });
  const full = S.stack.until;
  assert.ok(full - Date.now() > 500);
  assert.ok(Game.act(S, a, { t: "pass" }).ok);
  assert.strictEqual(S.stack.until, full); // b may still say Nö
  assert.ok(Game.act(S, b, { t: "pass" }).ok);
  assert.ok(S.stack.until - Date.now() <= Game.SETTLE_MS + 50);
  assert.strictEqual(Game.view(S, a).stack.passed, true);
  assert.strictEqual(Game.view(S, p).stack.passed, false);
});

test("a Nö clears earlier passes", () => {
  const S = mk(3), p = S.cur, a = (p + 1) % 3, b = (p + 2) % 3;
  setup(S, ["cat1", "cat2"]);
  give(S, p, "shuffle"); give(S, a, "nope", "nope"); give(S, b, "nope");
  Game.act(S, p, { t: "play", c: "shuffle" });
  Game.act(S, b, { t: "pass" });
  assert.ok(Game.act(S, a, { t: "nope" }).ok);
  assert.deepStrictEqual(S.stack.passed, []);
  assert.ok(S.stack.until - Date.now() > 1000); // a still has one, b is asked again
  assert.strictEqual(Game.act(S, p, { t: "pass" }).ok, true);
});
