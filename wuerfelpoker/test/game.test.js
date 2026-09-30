"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

const ev = (d, r) => G.evaluate(d, r);

test("hands are recognised", () => {
  const cases = [
    [[6, 6, 6, 6, 6], "Fünfling"], [[2, 2, 2, 2, 5], "Vierling"], [[3, 3, 3, 5, 5], "Full House"],
    [[2, 3, 4, 5, 6], "Große Straße"], [[5, 4, 3, 2, 1], "Kleine Straße"], [[4, 4, 4, 1, 6], "Drilling"],
    [[5, 5, 2, 2, 6], "Zwei Paare"], [[1, 1, 3, 4, 6], "Ein Paar"], [[1, 2, 3, 4, 6], "Nichts"]
  ];
  for (const [d, name] of cases) assert.strictEqual(ev(d).name, name, d.join());
  assert.strictEqual(ev([3, 3, 3, 5, 5]).label, "Full House (Dreien und Fünfen)");
});

test("ranking and tie-breaks", () => {
  const order = [[1, 2, 3, 4, 6], [1, 1, 3, 4, 6], [5, 5, 2, 2, 6], [4, 4, 4, 1, 6], [1, 2, 3, 4, 5], [2, 3, 4, 5, 6], [3, 3, 3, 5, 5], [2, 2, 2, 2, 5], [1, 1, 1, 1, 1]];
  for (let i = 1; i < order.length; i++) assert.ok(G.compare(ev(order[i]), ev(order[i - 1])) > 0, order[i].join());
  assert.ok(G.compare(ev([6, 6, 1, 2, 3]), ev([5, 5, 4, 3, 2])) > 0, "higher pair wins");
  assert.ok(G.compare(ev([5, 5, 2, 2, 6]), ev([5, 5, 2, 2, 4])) > 0, "kicker decides");
  assert.strictEqual(G.compare(ev([5, 5, 2, 2, 6]), ev([2, 6, 5, 2, 5])), 0, "same hand is a tie");
  const r = { straightsHigh: true };
  assert.ok(G.compare(ev([1, 2, 3, 4, 5], r), ev([6, 6, 6, 5, 5], r)) > 0, "house rule: straight beats full house");
  assert.ok(G.compare(ev([2, 2, 2, 2, 1], r), ev([2, 3, 4, 5, 6], r)) > 0, "four of a kind still above");
});

test("a turn: roll, hold, roll, stop; holds are kept and public", () => {
  const S = G.newGame(["a", "b"], 3, {});
  const p = S.cur;
  assert.strictEqual(G.act(S, p, { t: "hold", i: 0 }).ok, false, "no holding before the first roll");
  assert.strictEqual(G.act(S, p, { t: "stop" }).ok, false, "must roll once");
  assert.strictEqual(G.act(S, 1 - p, { t: "roll" }).ok, false, "not your turn");
  const r1 = G.act(S, p, { t: "roll" });
  assert.deepStrictEqual(r1.events[0].which, [0, 1, 2, 3, 4]);
  G.act(S, p, { t: "hold", i: 1 }); G.act(S, p, { t: "hold", i: 3 });
  assert.deepStrictEqual(G.view(S, 1 - p).hold, [false, true, false, true, false], "others see the holds");
  const kept = [S.dice[1], S.dice[3]];
  const r2 = G.act(S, p, { t: "roll" });
  assert.deepStrictEqual(r2.events[0].which, [0, 2, 4]);
  assert.deepStrictEqual([S.dice[1], S.dice[3]], kept);
  G.act(S, p, { t: "hold", keep: [true, true, true, true, true] });
  assert.strictEqual(G.act(S, p, { t: "roll" }).ok, false, "all held: stop instead");
  G.act(S, p, { t: "stop" });
  assert.notStrictEqual(S.cur, p);
  assert.ok(S.players[p].result && S.players[p].result.rolls === 2);
});

test("third roll ends the turn, best hand wins the round, ties share", () => {
  const S = G.newGame(["a", "b", "c"], 2, {});
  const first = S.cur;
  for (let k = 0; k < 3; k++) G.act(S, first, { t: "roll" });
  assert.notStrictEqual(S.cur, first, "turn ended after three rolls");
  // fix the remaining two players' dice for a known outcome
  const [p2, p3] = S.order.slice(1);
  S.players[first].result = Object.assign(G.evaluate([1, 2, 3, 4, 6]), { dice: [1, 2, 3, 4, 6] });
  G.act(S, p2, { t: "roll" }); S.dice = [6, 6, 6, 2, 2]; G.act(S, p2, { t: "stop" });
  G.act(S, p3, { t: "roll" }); S.dice = [2, 2, 6, 6, 6]; G.act(S, p3, { t: "stop" });
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners.sort(), [p2, p3].sort(), "tie: both win");
  assert.strictEqual(S.players[p2].score, 1);
  G.act(S, 0, { t: "next" });
  assert.strictEqual(S.round, 2);
  assert.ok(S.players.every((p) => p.result === null));
});

test("house rule: the first player limits the rolls", () => {
  const S = G.newGame(["a", "b"], 3, { firstSets: true });
  const first = S.cur;
  G.act(S, first, { t: "roll" }); G.act(S, first, { t: "stop" });
  assert.strictEqual(S.maxRolls, 1);
  const second = S.cur;
  G.act(S, second, { t: "roll" });
  assert.strictEqual(S.phase, "roundEnd", "one roll and done");
});

test("computer players finish whole games at every level", () => {
  for (const level of ["easy", "normal", "hard"]) {
    for (let g = 0; g < 30; g++) {
      const S = G.newGame(["a", "b", "c", "d"].slice(0, 2 + (g % 3)), 3, { firstSets: g % 2 === 0, straightsHigh: g % 3 === 0 });
      let steps = 0;
      while (!(S.phase === "roundEnd" && S.last.over) && steps++ < 5000) {
        if (S.phase === "roundEnd") { G.act(S, 0, { t: "next" }); continue; }
        const a = G.suggest(G.view(S, S.cur), level);
        assert.ok(a, "always has a move");
        const res = G.act(S, S.cur, a);
        assert.ok(res.ok, `${level} ${JSON.stringify(a)}: ${res.error}`);
      }
      assert.ok(S.last && S.last.over, "someone reached the goal");
      assert.ok(S.players.some((p) => p.score >= 3));
    }
  }
});

test("skip and timeout finish the turn with at least one roll", () => {
  const S = G.newGame(["a", "b"], 3, {});
  const p = S.cur;
  assert.ok(G.act(S, p, { t: "timeout" }).ok);
  assert.ok(S.players[p].result, "rolled once for them");
  assert.notStrictEqual(S.cur, p);
});

test("odds: holding five of a kind cannot improve, a pair usually can", () => {
  assert.strictEqual(G.odds([6, 6, 6, 6, 6], [true, true, true, true, true], {}, null).better, 0);
  const o = G.odds([3, 3, 1, 2, 6], [true, true, false, false, false], {}, null);
  assert.ok(o.better > 0.4 && o.better < 1);
  const t = G.evaluate([6, 6, 6, 6, 6]);
  assert.strictEqual(G.odds([1, 2, 3, 4, 6], [false, false, false, false, false], {}, t).beat, 0);
  const all = G.odds([1, 1, 1, 1, 1], [false, false, false, false, false], {}, G.evaluate([1, 1, 1, 1, 1]));
  assert.ok(Math.abs(all.beat - 5 / 6 ** 5) < 1e-9 + 0, "only a higher five of a kind beats ones");
});

test("view target is the best finished hand of the round", () => {
  const S = G.newGame(["a", "b", "c"], 5, {});
  assert.strictEqual(G.view(S, 0).target, null);
  const first = S.cur;
  G.act(S, first, { t: "roll" }); G.act(S, first, { t: "stop" });
  assert.strictEqual(G.view(S, S.cur).target, first);
});

function setResult(S, i, dice) { S.players[i].result = Object.assign(G.evaluate(dice, S.rules), { dice, rolls: 1 }); }

test("playoff: a tie for the best hand is thrown again by the tied players only", () => {
  const S = G.newGame(["a", "b", "c"], 5, { playoff: true });
  S.order = [0, 1, 2]; S.done = 2; S.cur = 2; S.rolls = 1; S.dice = [1, 2, 3, 4, 6];
  setResult(S, 0, [5, 5, 2, 2, 6]); setResult(S, 1, [5, 5, 2, 2, 6]);
  const r = G.act(S, 2, { t: "stop" });
  assert.ok(r.ok);
  assert.strictEqual(S.phase, "play");
  assert.deepStrictEqual(S.order, [0, 1]);
  assert.strictEqual(S.cur, 0);
  assert.strictEqual(S.playoff, 1);
  assert.ok(r.events.some((e) => e.t === "playoff"));
  assert.ok(S.players.every((p) => p.score === 0));
  assert.strictEqual(G.view(S, 0).playoff, 1);
  // the playoff is decided: only one of the two gets the point
  S.dice = [6, 6, 6, 1, 2]; G.act(S, 0, { t: "roll" });
  assert.ok(S.rolls > 0);
  S.dice = [1, 1, 1, 2, 3]; S.rolls = 1; G.act(S, 0, { t: "stop" });
  S.dice = [1, 2, 3, 4, 6]; S.rolls = 1; G.act(S, 1, { t: "stop" });
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [0]);
  assert.strictEqual(S.players[0].score, 1);
  assert.strictEqual(S.last.playoffs, 1);
});

test("without the rule a tie shares the point", () => {
  const S = G.newGame(["a", "b"], 5, {});
  S.order = [0, 1]; S.done = 1; S.cur = 1; S.rolls = 1; S.dice = [5, 5, 2, 2, 6];
  setResult(S, 0, [5, 5, 2, 2, 6]);
  G.act(S, 1, { t: "stop" });
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [0, 1]);
});
