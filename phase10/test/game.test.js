"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

let nextId = 1000;
const C = (c, v) => ({ id: nextId++, c, v: v || 0 });
const W = () => C("w"), SK = () => C("s");
const two = [{ name: "Anna" }, { name: "Ben" }];

test("deck: 108 cards, 96 numbers, 8 jokers, 4 skips", () => {
  const d = G.buildDeck();
  assert.strictEqual(d.length, 108);
  assert.strictEqual(d.filter(G.isWild).length, 8);
  assert.strictEqual(d.filter(G.isSkip).length, 4);
  assert.strictEqual(new Set(d.map((c) => c.id)).size, 108);
  assert.deepStrictEqual([G.points(C("r", 3)), G.points(C("b", 11)), G.points(SK()), G.points(W())], [5, 10, 15, 25]);
  assert.strictEqual(G.phaseName(1), "2 Drillinge");
  assert.strictEqual(G.phaseName(2), "Drilling + 4er-Folge");
  assert.strictEqual(G.phaseName(8), "7 einer Farbe");
});

test("groups: sets, runs and colours with jokers", () => {
  const set = { k: "set", n: 3 }, run = { k: "run", n: 4 }, col = { k: "color", n: 7 };
  assert.ok(G.makeGroup([C("r", 5), C("b", 5), W()], set));
  assert.ok(!G.makeGroup([C("r", 5), C("b", 6), W()], set));
  assert.ok(!G.makeGroup([W(), W(), W()], set), "needs one real card");
  assert.ok(!G.makeGroup([C("r", 5), C("b", 5)], set), "too few");
  assert.ok(!G.makeGroup([C("r", 5), C("b", 5), SK()], set), "skips never count");
  const r = G.makeGroup([C("r", 7), W(), C("g", 5), C("y", 4)], run);
  assert.ok(r);
  assert.deepStrictEqual([r.start, r.len], [4, 4]);
  assert.deepStrictEqual(r.cards.map((c) => c.v || "W"), [4, 5, "W", 7]);
  assert.ok(!G.makeGroup([C("r", 3), C("b", 3), C("g", 4), C("y", 5)], run), "no doubles in a run");
  assert.ok(!G.makeGroup([C("r", 1), C("b", 2), C("g", 3), C("y", 9)], run), "gap too big");
  const top = G.makeGroup([C("r", 11), C("b", 12), W(), W()], run);
  assert.deepStrictEqual([top.start, top.len], [9, 4], "jokers go below when there is no room above");
  assert.ok(G.makeGroup([C("g", 1), C("g", 9), C("g", 4), W(), C("g", 12), C("g", 2), C("g", 7)], col));
  assert.ok(!G.makeGroup([C("g", 1), C("r", 9), C("g", 4), W(), C("g", 12), C("g", 2), C("g", 7)], col));
});

test("hitting: sets take the same number, runs grow at both ends, colours the same colour", () => {
  const set = G.makeGroup([C("r", 5), C("b", 5), C("g", 5)], { k: "set", n: 3 });
  assert.ok(G.fitOnto(set, C("y", 5)) && G.fitOnto(set, W()) && !G.fitOnto(set, C("y", 6)) && !G.fitOnto(set, SK()));
  const run = G.makeGroup([C("r", 5), C("b", 6), C("g", 7), C("y", 8)], { k: "run", n: 4 });
  assert.strictEqual(G.fitOnto(run, C("r", 9)).len, 5);
  assert.strictEqual(G.fitOnto(run, C("r", 4)).start, 4);
  assert.ok(!G.fitOnto(run, C("r", 10)));
  const full = G.makeGroup([C("r", 9), C("b", 10), C("g", 11), C("y", 12)], { k: "run", n: 4 });
  assert.strictEqual(G.fitOnto(full, W()).start, 8, "a joker goes below a run that reaches 12");
  assert.ok(!G.fitOnto(full, C("r", 13)));
});

test("finding a phase and counting what is missing", () => {
  const hand = [C("r", 5), C("b", 5), C("g", 5), C("r", 9), C("y", 9), W(), C("b", 1), C("g", 12), SK(), C("r", 3)];
  const f = G.findPhase(hand, 1);
  assert.ok(f);
  assert.strictEqual(f.length, 2);
  assert.ok(f.every((g) => g.length === 3));
  assert.strictEqual(f[0].filter(G.isWild).length + f[1].filter(G.isWild).length, 1, "real cards first, one joker");
  assert.strictEqual(G.missing(hand, 1), 0);
  assert.ok(G.missing(hand, 4) > 0);
  const run7 = [1, 2, 3, 5, 6, 7].map((v) => C("r", v)).concat([W(), C("b", 11), C("y", 12), SK()]);
  assert.ok(G.findPhase(run7, 4));
  assert.strictEqual(G.missing(run7.filter((c) => !G.isWild(c)), 4), 1);
});

function rigged(p, hand0) {
  const S = G.newGame(two, 10, {}, 2);
  S.cur = 0; S.step = "draw";
  S.players[0].phase = p;
  S.players[0].hand = hand0.slice();
  return S;
}

test("a turn: draw, lay the phase, hit, discard; skip cards can't be picked up", () => {
  const hand = [C("r", 5), C("b", 5), C("g", 5), C("r", 9), C("y", 9), C("b", 9), C("g", 9), C("b", 1), C("g", 12), C("r", 3)];
  const S = rigged(1, hand);
  S.discard.push(SK());
  assert.match(G.act(S, 0, { t: "draw", from: "discard" }).error, /Aussetzen/);
  assert.match(G.act(S, 0, { t: "discard", id: hand[0].id }).error, /Zieh zuerst/);
  assert.ok(G.act(S, 0, { t: "draw", from: "deck" }).ok);
  assert.match(G.act(S, 0, { t: "hit", id: hand[6].id, meld: 0 }).error, /eigene Phase/);
  assert.match(G.act(S, 0, { t: "lay", groups: [[hand[0].id, hand[1].id, hand[3].id], [hand[4].id, hand[5].id, hand[6].id]] }).error, /2 Drillinge/);
  const r = G.act(S, 0, { t: "lay", groups: [[hand[0].id, hand[1].id, hand[2].id], [hand[3].id, hand[4].id, hand[5].id]] });
  assert.ok(r.ok, r.error);
  assert.ok(S.players[0].laid);
  assert.strictEqual(S.melds.length, 2);
  assert.ok(G.act(S, 0, { t: "hit", id: hand[6].id, meld: 1 }).ok);
  assert.strictEqual(S.melds[1].cards.length, 4);
  const before = S.players[0].hand.length;
  assert.ok(G.act(S, 0, { t: "discard", id: hand[9].id }).ok);
  assert.strictEqual(S.players[0].hand.length, before - 1);
  assert.strictEqual(S.cur, 1);
  assert.strictEqual(S.step, "draw");
});

test("laying needs a card left to discard", () => {
  const hand = [C("r", 5), C("b", 5), C("g", 5), C("r", 9), C("y", 9), C("b", 9)];
  const S = rigged(1, hand);
  G.act(S, 0, { t: "draw" });
  const drawn = S.players[0].hand[6];
  S.players[0].hand.pop(); // pretend the hand is just the two sets
  assert.match(G.act(S, 0, { t: "lay", groups: [hand.slice(0, 3).map((c) => c.id), hand.slice(3).map((c) => c.id)] }).error, /abwerfen/);
  assert.ok(drawn);
});

test("going out ends the round: penalties, phases move on, the game ends after the last phase", () => {
  const S = rigged(10, [C("r", 4)]);
  S.players[0].laid = true;
  S.players[1].hand = [W(), SK(), C("b", 11), C("y", 2)];
  G.act(S, 0, { t: "draw" });
  S.players[0].hand = [C("r", 4)];
  const r = G.act(S, 0, { t: "discard", id: S.players[0].hand[0].id });
  assert.ok(r.ok);
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.players[1].score, 25 + 15 + 10 + 5);
  assert.strictEqual(S.players[0].phase, 11);
  assert.strictEqual(S.players[1].phase, 1, "no phase laid, no progress");
  assert.ok(S.last.over);
  assert.deepStrictEqual(S.last.winners, [0]);
  G.act(S, 0, { t: "next" });
  assert.ok(S.players.every((p) => p.phase === 1 && p.score === 0), "rematch starts over");
});

test("skip: the next player sits out; with free choice you pick who", () => {
  const S = G.newGame([{ name: "A" }, { name: "B" }, { name: "C" }], 10, { skipChoose: true }, 2);
  S.cur = 0; S.step = "act";
  const sk = SK(); S.players[0].hand.push(sk);
  assert.ok(G.act(S, 0, { t: "discard", id: sk.id, target: 2 }).ok);
  assert.strictEqual(S.cur, 1);
  S.step = "act";
  G.act(S, 1, { t: "discard", id: S.players[1].hand.find((c) => !G.isSkip(c)).id });
  assert.strictEqual(S.cur, 0, "C was skipped");
});

test("computer players play whole games on their own", () => {
  for (const level of [1, 2, 3]) {
    const S = G.newGame([{ name: "A", bot: true }, { name: "B", bot: true }, { name: "C", bot: true }], 5, { skipChoose: true }, level);
    let guard = 0, rounds = 0;
    while (!(S.phase === "roundEnd" && S.last.over) && guard++ < 20000) {
      if (S.phase === "roundEnd") { rounds++; G.act(S, 0, { t: "next" }); continue; }
      const pi = S.cur, a = G.botMove(S, pi);
      const r = G.act(S, pi, a);
      assert.ok(r.ok, `${JSON.stringify(a)}: ${r.error}`);
    }
    assert.ok(S.last && S.last.over, `level ${level} finished`);
    assert.ok(rounds >= 4, `level ${level}: ${rounds} rounds`);
  }
});

test("views: your own hand only, clock turn played for you", () => {
  const S = G.newGame(two, 10, { clock: true }, 2);
  const v = G.view(S, 0);
  assert.strictEqual(v.hand.length, S.players[0].hand.length);
  assert.strictEqual(G.view(S, -1).hand.length, 0);
  const mine = new Set(S.players[0].hand.map((c) => c.id));
  assert.ok(!G.view(S, 1).hand.some((c) => mine.has(c.id)), "nobody sees another hand");
  assert.ok(!("hand" in G.view(S, 1).players[0]), "only the count");
  const pi = S.cur, n = S.players[pi].hand.length;
  const ev = G.tick(S, S.deadline + 5000);
  assert.strictEqual(ev[0].t, "timeout");
  assert.strictEqual(S.players[pi].hand.length, n, "drew one, threw one");
  // with two players the turn only comes straight back when the other one had to sit out (an Aussetzen thrown for them)
  if (!S.log.slice(-2).some((l) => /aussetzen|setzt aus/.test(l))) assert.notStrictEqual(S.cur, pi);
});
