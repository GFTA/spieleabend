"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

const size = (S) => (S.rules.chaos ? 140 : 108);
const total = (S) => S.deck.length + S.discard.length + S.players.reduce((a, p) => a + p.hand.length, 0);
const card = (c, v, id) => ({ id, c, v });

function rig(n = 3) {
  const S = G.newGame(Array.from({ length: n }, (_, i) => `P${i}`), 500);
  return S;
}

test("deck has 108 cards and deal gives 7 each", () => {
  assert.strictEqual(G.buildDeck().length, 108);
  const S = rig(4);
  S.players.forEach((p) => assert.strictEqual(p.hand.length, 7));
  assert.ok(G.isNum(S.discard[0]));
  assert.strictEqual(total(S), 108);
});

test("only the current player may act", () => {
  const S = rig();
  const other = (S.cur + 1) % 3;
  assert.strictEqual(G.act(S, other, { t: "draw" }).ok, false);
});

test("playing a non-matching card is rejected", () => {
  const S = rig();
  S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[S.cur].hand = [card("b", "7", 901), card("g", "1", 902)];
  assert.strictEqual(G.act(S, S.cur, { t: "play", id: 901 }).ok, false);
});

test("skip, reverse, +2 and +4 effects with the skip-after-draw rule", () => {
  const S = G.newGame(["P0", "P1", "P2", "P3"], 500, { skipAfterDraw: true });
  S.cur = 0; S.dir = 1; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "skip", 901), card("r", "1", 950), card("r", "2", 951)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.cur, 2);

  S.players[2].hand = [card("r", "rev", 902), card("r", "1", 952), card("r", "2", 953)];
  G.act(S, 2, { t: "play", id: 902 });
  assert.strictEqual(S.dir, -1);
  assert.strictEqual(S.cur, 1);

  const before = S.players[0].hand.length;
  S.players[1].hand = [card("r", "d2", 903), card("r", "1", 954), card("r", "2", 955)];
  G.act(S, 1, { t: "play", id: 903 });
  assert.strictEqual(S.cur, 0);
  assert.strictEqual(S.players[0].hand.length, before, "the victim draws by tapping the pile");
  G.act(S, 0, { t: "draw" });
  assert.strictEqual(S.players[0].hand.length, before + 2);
  assert.strictEqual(S.cur, 3);

  const b2 = S.players[2].hand.length;
  S.players[3].hand = [card("w", "d4", 904), card("r", "1", 956), card("r", "2", 957)];
  assert.strictEqual(G.act(S, 3, { t: "play", id: 904 }).ok, false, "wild needs a color");
  G.act(S, 3, { t: "play", id: 904, color: "g" });
  assert.strictEqual(S.color, "g");
  G.act(S, 2, { t: "draw" });
  assert.strictEqual(S.players[2].hand.length, b2 + 4);
  assert.strictEqual(S.cur, 1);
});

test("reverse with two players acts like skip", () => {
  const S = rig(2);
  S.cur = 0; S.discard = [card("b", "5", 900)]; S.color = "b";
  S.players[0].hand = [card("b", "rev", 901), card("r", "1", 950), card("r", "2", 951)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.cur, 0);
});

test("second-to-last card opens a 3 second UNO window", () => {
  const S = rig(3);
  S.cur = 0; S.discard = [card("b", "5", 900)]; S.color = "b";
  S.players[0].hand = [card("b", "1", 901), card("r", "2", 902)];
  const res = G.act(S, 0, { t: "play", id: 901 });
  assert.ok(res.events.some((e) => e.t === "unoWait" && e.pi === 0));
  assert.strictEqual(S.cur, 1, "play goes on while the window is open");
  assert.strictEqual(G.act(S, 2, { t: "uno" }).ok, false, "only the waiting player can call");
  assert.strictEqual(G.act(S, 0, { t: "uno" }).ok, true, "allowed although it is not player 0's turn");
  assert.strictEqual(S.unoWaits.length, 0);
  assert.deepStrictEqual(G.tick(S, Date.now() + 60000), []);
  assert.strictEqual(S.players[0].hand.length, 1);
});

test("missing the UNO window costs two cards", () => {
  const S = rig(3);
  S.cur = 0; S.discard = [card("b", "5", 900)]; S.color = "b";
  S.players[0].hand = [card("b", "1", 901), card("r", "2", 902)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.deepStrictEqual(G.tick(S, Date.now() + 1000), [], "still inside the window");
  const ev = G.tick(S, Date.now() + G.UNO_MS + 5000);
  assert.deepStrictEqual(ev, [{ t: "penalty", pi: 0 }]);
  assert.strictEqual(S.players[0].hand.length, 3);
  assert.strictEqual(G.act(S, 0, { t: "uno" }).ok, false, "too late");
  assert.strictEqual(G.nextDeadline(S), -1);
});

test("playing the last card without having called UNO costs two cards", () => {
  const S = rig(2);
  S.cur = 0; S.discard = [card("b", "5", 900)]; S.color = "b";
  S.players[0].hand = [card("b", "skip", 901), card("b", "2", 902)];
  G.act(S, 0, { t: "play", id: 901 }); // skip with two players: own turn again
  assert.strictEqual(S.cur, 0);
  G.act(S, 0, { t: "play", id: 902 });
  assert.strictEqual(S.phase, "play", "no win: penalty cards came first");
  assert.strictEqual(S.players[0].hand.length, 2);
});

test("+2 waits until the victim draws it from the pile, then they play on", () => {
  const S = rig(3);
  S.cur = 0; S.dir = 1; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "d2", 901), card("r", "1", 950), card("r", "2", 951)];
  S.players[1].hand = [card("b", "d2", 902), card("y", "7", 953)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.players[1].hand.length, 2, "nothing drawn by itself");
  assert.strictEqual(S.pending, 2);
  assert.strictEqual(S.cur, 1);
  assert.strictEqual(G.act(S, 1, { t: "play", id: 953 }).ok, false, "the +2 has to be drawn (or countered)");
  const res = G.act(S, 1, { t: "draw" });
  assert.strictEqual(S.players[1].hand.length, 4);
  assert.ok(res.events.some((e) => e.t === "took" && e.pi === 1 && e.n === 2));
  assert.strictEqual(S.cur, 1, "no skipping by default");
  assert.strictEqual(S.pending, 0);
  assert.strictEqual(S.phase, "play");
});

test("stacking: counter or draw everything; the pile has to be tapped when nothing fits", () => {
  const S = G.newGame(["a", "b", "c"], 0, { stack: true });
  S.cur = 0; S.dir = 1; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "d2", 901), card("r", "1", 950), card("r", "2", 951)];
  S.players[1].hand = [card("b", "d2", 902), card("g", "d2", 952), card("y", "7", 953)];
  S.players[2].hand = [card("w", "d4", 903), card("b", "d2", 954), card("y", "8", 955)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.cur, 1);
  assert.strictEqual(S.pending, 2, "b can counter, so nothing drawn yet");
  assert.strictEqual(S.players[1].hand.length, 3);
  assert.strictEqual(G.act(S, 1, { t: "play", id: 953 }).ok, false, "only +2/+4 while stacking");
  G.act(S, 1, { t: "play", id: 902 });
  assert.strictEqual(S.pending, 4);
  G.act(S, 2, { t: "play", id: 903, color: "g" });
  // player 0 has no +4: the 8 cards wait for their tap on the pile, then it is still their turn
  assert.strictEqual(S.pending, 8);
  assert.strictEqual(S.players[0].hand.length, 2);
  const took = G.act(S, 0, { t: "draw" });
  assert.ok(took.events.some((e) => e.t === "took" && e.pi === 0 && e.n === 8));
  assert.strictEqual(S.pending, 0);
  assert.strictEqual(S.players[0].hand.length, 2 + 8);
  assert.strictEqual(S.cur, 0);
  assert.strictEqual(S.phase, "play");
});

test("stacking: choosing to draw instead of countering", () => {
  const S = G.newGame(["a", "b"], 0, { stack: true, skipAfterDraw: true });
  S.cur = 0; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "d2", 901), card("r", "1", 950)];
  S.players[1].hand = [card("b", "d2", 902), card("y", "7", 953)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.pending, 2);
  G.act(S, 1, { t: "draw" });
  assert.strictEqual(S.players[1].hand.length, 4);
  assert.strictEqual(S.cur, 0, "skip-after-draw rule sends the turn on");
});

test("+2 on +4 is not allowed while a stack is open", () => {
  const S = G.newGame(["a", "b"], 0, { stack: true });
  S.cur = 0; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("w", "d4", 901), card("r", "1", 950), card("r", "2", 951)];
  S.players[1].hand = [card("r", "d2", 902), card("w", "d4", 903), card("r", "3", 952)];
  G.act(S, 0, { t: "play", id: 901, color: "r" });
  assert.strictEqual(G.act(S, 1, { t: "play", id: 902 }).ok, false);
});

test("a +2 as the winning card is still drawn before scoring", () => {
  const S = G.newGame(["a", "b"], 0, { stack: true });
  S.cur = 0; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "d2", 901)];
  S.players[1].hand = [card("r", "3", 952)];
  const res = G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.players[1].hand.length, 3);
  assert.ok(res.events.some((e) => e.t === "took" && e.pi === 1 && e.n === 2), "the extra draw is announced");
});

test("draw until it fits", () => {
  const S = G.newGame(["a", "b"], 0, { drawUntil: true });
  S.cur = 0; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.deck.push(card("b", "9", 960), card("g", "3", 961), card("r", "8", 962), card("y", "1", 963), card("b", "2", 964));
  const before = S.players[0].hand.length;
  const res = G.act(S, 0, { t: "draw" });
  assert.strictEqual(S.players[0].hand.length, before + 3, "yellow 1, blue 2 ... stop at red 8");
  assert.strictEqual(S.phase, "drawn");
  assert.strictEqual(S.drawnId, 962);
  assert.ok(res.events.some((e) => e.t === "drew" && e.n === 3));
});

test("7 swaps hands with a chosen player, 0 rotates all hands", () => {
  const S = G.newGame(["a", "b", "c"], 0, { sevenZero: true });
  S.cur = 0; S.dir = 1; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "7", 901), card("y", "1", 950), card("y", "2", 951)];
  S.players[1].hand = [card("b", "1", 960)];
  S.players[2].hand = [card("r", "0", 970), card("g", "4", 971), card("g", "5", 972), card("g", "6", 973)];
  assert.strictEqual(G.act(S, 0, { t: "play", id: 901 }).ok, false, "needs a target");
  G.act(S, 0, { t: "play", id: 901, target: 2 });
  assert.deepStrictEqual(S.players[0].hand.map((c) => c.id), [970, 971, 972, 973]);
  assert.deepStrictEqual(S.players[2].hand.map((c) => c.id), [950, 951]);
  assert.strictEqual(S.cur, 1);
  S.players[1].hand.push(card("r", "0", 961));
  G.act(S, 1, { t: "play", id: 961 });
  // hands move one seat in play direction: 0 -> 1, 1 -> 2, 2 -> 0
  assert.deepStrictEqual(S.players[1].hand.map((c) => c.id), [970, 971, 972, 973]);
  assert.deepStrictEqual(S.players[2].hand.map((c) => c.id), [960]);
  assert.deepStrictEqual(S.players[0].hand.map((c) => c.id), [950, 951]);
});

test("jump-in with the identical card takes over the turn", () => {
  const S = G.newGame(["a", "b", "c"], 0, { jumpIn: true });
  S.cur = 0; S.dir = 1; S.discard = [card("g", "4", 900)]; S.color = "g";
  S.players[2].hand = [card("g", "4", 901), card("g", "5", 902), card("r", "1", 903)];
  assert.strictEqual(G.act(S, 2, { t: "play", id: 902 }).ok, false, "only the identical card");
  const res = G.act(S, 2, { t: "play", id: 901 });
  assert.ok(res.ok);
  assert.ok(res.events.some((e) => e.t === "jump"));
  assert.strictEqual(S.cur, 0, "play continues after the jumper");
  const T = G.newGame(["a", "b", "c"], 0, {});
  T.cur = 0; T.discard = [card("g", "4", 900)]; T.color = "g";
  T.players[2].hand = [card("g", "4", 901), card("r", "1", 903)];
  assert.strictEqual(G.act(T, 2, { t: "play", id: 901 }).ok, false, "rule off");
});

test("giving up: skipped for the round, last one standing wins", () => {
  const S = G.newGame(["a", "b", "c"], 0, {});
  S.cur = 0; S.dir = 1; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "1", 950), card("y", "2", 951)];
  assert.ok(G.act(S, 1, { t: "surrender" }).ok, "any time, not only on your turn");
  assert.strictEqual(G.act(S, 1, { t: "draw" }).ok, false);
  G.act(S, 0, { t: "play", id: 950 });
  assert.strictEqual(S.cur, 2, "b is skipped");
  assert.strictEqual(G.view(S, 0).players[1].out, true);
  const res = G.act(S, 2, { t: "surrender" });
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.winner, 0);
  assert.ok(res.events.some((e) => e.t === "surrender"));
  G.act(S, 0, { t: "next" });
  assert.ok(S.players.every((p) => !p.out), "back in next round");
});

test("computer player plays whole games on its own", () => {
  for (let g = 0; g < 60; g++) {
    const S = G.newGame(["a", "b", "c"], 0, { stack: g % 2 === 0, sevenZero: g % 3 === 0, drawUntil: g % 5 === 0 });
    let steps = 0;
    while (S.phase !== "roundEnd" && steps++ < 3000) {
      const w = S.unoWaits[0];
      const pi = w ? w.pi : S.cur;
      const a = G.suggest(G.view(S, pi));
      assert.ok(a, "always has a move");
      const res = G.act(S, pi, a);
      assert.ok(res.ok, `${JSON.stringify(a)} -> ${res.error}`);
      assert.strictEqual(total(S), size(S));
    }
    assert.strictEqual(S.phase, "roundEnd", "the bots finish the round");
  }
});

test("timeout draws a card and passes the turn", () => {
  const S = G.newGame(["a", "b", "c"], 0, { turnTimer: true });
  const cur = S.cur, n = S.players[cur].hand.length;
  const res = G.act(S, cur, { t: "timeout" });
  assert.ok(res.ok);
  assert.strictEqual(S.players[cur].hand.length, n + 1);
  assert.notStrictEqual(S.cur, cur);
  assert.strictEqual(G.act(S, cur, { t: "timeout" }).ok, false, "only for the player on turn");
});

test("chaos mode doubles every action and wild card", () => {
  const d = G.buildDeck(true);
  assert.strictEqual(d.length, 140);
  const n = (v) => d.filter((c) => c.v === v).length;
  assert.deepStrictEqual([n("skip"), n("rev"), n("d2"), n("wild"), n("d4"), n("7")], [16, 16, 16, 8, 8, 8]);
  assert.strictEqual(new Set(d.map((c) => c.id)).size, 140);
  const S = G.newGame(["a", "b"], 0, { chaos: true });
  assert.strictEqual(total(S), 140);
  assert.strictEqual(G.view(S, 0).rules.chaos, true);
});

test("drawing an unplayable card ends the turn, a playable one can be played or kept", () => {
  const S = rig(3);
  S.cur = 0; S.discard = [card("b", "5", 900)]; S.color = "b";
  S.deck.push(card("r", "1", 950));
  G.act(S, 0, { t: "draw" });
  assert.strictEqual(S.cur, 1);

  S.deck.push(card("b", "9", 951));
  G.act(S, 1, { t: "draw" });
  assert.strictEqual(S.phase, "drawn");
  assert.strictEqual(S.drawnId, 951);
  const other = S.players[1].hand.find((c) => c.id !== 951 && G.canPlay(S, c));
  if (other) assert.strictEqual(G.act(S, 1, { t: "play", id: other.id }).ok, false);
  G.act(S, 1, { t: "keep" });
  assert.strictEqual(S.cur, 2);
});

test("round end scores the other hands and view hides foreign cards", () => {
  const S = rig(2);
  S.cur = 0; S.discard = [card("b", "5", 900)]; S.color = "b"; S.uno = true;
  S.players[0].hand = [card("b", "1", 901)];
  S.players[1].hand = [card("r", "7", 902), card("w", "wild", 903), card("g", "skip", 904)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.players[0].score, 77);
  const v = G.view(S, 1);
  assert.strictEqual(v.hand.length, 3);
  assert.deepStrictEqual(v.players.map((p) => p.count), [0, 3]);
  assert.ok(!("hand" in v.players[0]));
  G.act(S, 1, { t: "next" });
  assert.strictEqual(S.round, 2);
  assert.strictEqual(total(S), size(S));
});

test("random games stay consistent", () => {
  for (let g = 0; g < 300; g++) {
    const pick = () => Math.random() < 0.5;
    const S = G.newGame(["a", "b", "c", "d"].slice(0, 2 + (g % 3)), 0,
      { chaos: pick(), stack: pick(), skipAfterDraw: pick(), drawUntil: pick(), sevenZero: pick(), jumpIn: pick(), challenge: pick() });
    for (let step = 0; step < 2000 && S.phase !== "roundEnd"; step++) {
      const p = S.players[S.cur];
      for (const w of S.unoWaits) if (g % 3) G.act(S, w.pi, { t: "uno" });
      if (g % 3 === 0) G.tick(S, Date.now() + 10000);
      // somebody else may throw in first
      const j = S.players.findIndex((q, k) => k !== S.cur && q.hand.some((x) => G.canJumpIn(S, x)));
      if (j >= 0 && step % 2) {
        const x = S.players[j].hand.find((y) => G.canJumpIn(S, y));
        assert.ok(G.act(S, j, { t: "play", id: x.id, target: (j + 1) % S.players.length }).ok);
        assert.strictEqual(total(S), size(S));
        continue;
      }
      const c = p.hand.find((x) => (S.phase === "drawn" ? x.id === S.drawnId : true) && G.canPlay(S, x));
      if (c) assert.ok(G.act(S, S.cur, { t: "play", id: c.id, color: "r", target: (S.cur + 1) % S.players.length }).ok);
      else if (S.phase === "drawn") G.act(S, S.cur, { t: "keep" });
      else G.act(S, S.cur, { t: "draw" });
      assert.strictEqual(total(S), size(S));
    }
  }
});

// a game where player 0 is about to play a +4 on player 1
function d4Table(hadColor) {
  const S = G.newGame(["a", "b", "c"], 0, { challenge: true });
  S.cur = 0; S.dir = 1; S.phase = "play"; S.pending = 0; S.unoWaits = [];
  S.color = "r";
  S.discard = [card("r", "5", 900)];
  S.players[0].hand = [card("w", "d4", 901), card("g", "1", 902), ...(hadColor ? [card("r", "9", 903)] : [])];
  S.players[1].hand = [card("g", "2", 904), card("b", "3", 905)];
  S.players[2].hand = [card("y", "4", 906)];
  return S;
}

test("challenge: a +4 bluff is caught, the bluffer draws 4 and the doubter plays on", () => {
  const S = d4Table(true);
  assert.ok(G.act(S, 0, { t: "play", id: 901, color: "b" }).ok);
  assert.strictEqual(S.pending, 4);
  assert.strictEqual(G.view(S, 1).canChallenge, true);
  assert.strictEqual(G.view(S, 2).canChallenge, false);
  const r = G.act(S, 1, { t: "challenge" });
  assert.ok(r.ok);
  assert.strictEqual(S.players[0].hand.length, 2 + 4);
  assert.strictEqual(S.players[1].hand.length, 2);
  assert.strictEqual(S.pending, 0);
  assert.strictEqual(S.cur, 1);
  assert.strictEqual(S.color, "b");
  assert.ok(r.events.some((e) => e.t === "challenge" && e.won));
});

test("challenge: a fair +4 costs the doubter 6 cards and the turn", () => {
  const S = d4Table(false);
  assert.ok(G.act(S, 0, { t: "play", id: 901, color: "b" }).ok);
  const r = G.act(S, 1, { t: "challenge" });
  assert.ok(r.ok);
  assert.strictEqual(S.players[1].hand.length, 2 + 6);
  assert.strictEqual(S.players[0].hand.length, 1);
  assert.strictEqual(S.pending, 0);
  assert.strictEqual(S.cur, 2);
  assert.ok(r.events.some((e) => e.t === "challenge" && !e.won));
});

test("challenge: not without the rule, not when stacked, not after a move", () => {
  const off = d4Table(true); off.rules.challenge = false;
  G.act(off, 0, { t: "play", id: 901, color: "b" });
  assert.strictEqual(G.act(off, 1, { t: "challenge" }).ok, false);

  const S = d4Table(true);
  G.act(S, 0, { t: "play", id: 901, color: "b" });
  assert.strictEqual(G.act(S, 0, { t: "challenge" }).ok, false, "only the one facing the +4");
  G.act(S, 1, { t: "draw" }); // takes the 4 instead
  assert.strictEqual(G.act(S, 2, { t: "challenge" }).ok, false);

  const T = d4Table(true); T.rules.stack = true;
  T.discard = [card("r", "5", 900), card("b", "d2", 910)]; T.pending = 2; T.color = "b";
  G.act(T, 0, { t: "play", id: 901, color: "g" });
  assert.strictEqual(T.pending, 6);
  assert.strictEqual(G.view(T, 1).canChallenge, false, "a stacked +4 cannot be doubted");
});

test("round end awards: the clean winner and the card collector", () => {
  const S = G.newGame(["a", "b", "c"], 0, {});
  S.players[1].st = { drew: 7, acts: 0, played: 1 };
  S.players[2].st = { drew: 1, acts: 0, played: 2 };
  S.players[0].st = { drew: 0, acts: 0, played: 7 };
  S.players[0].hand = [card("r", "1", 1)];
  S.cur = 0; S.color = "r"; S.discard = [card("r", "5", 900)]; S.unoWaits = [];
  S.players[1].hand = [card("g", "2", 2)]; S.players[2].hand = [card("g", "3", 3)];
  S.players[0].hand = [card("r", "1", 1)];
  assert.ok(G.act(S, 0, { t: "play", id: 1 }).ok);
  const titles = S.last.awards.map((w) => w.title);
  assert.ok(titles.includes("Kartensammler"));
  assert.ok(titles.includes("Glatter Sieg"));
  assert.strictEqual(S.last.awards.find((w) => w.title === "Kartensammler").pi, 1);
});

test("view lists the last played cards, newest first", () => {
  const S = G.newGame(["a", "b"], 0, {});
  S.discard = [card("r", "1", 1), card("r", "2", 2), card("r", "3", 3), card("r", "4", 4)];
  const v = G.view(S, 0);
  assert.deepStrictEqual(v.recent.map((c) => c.id), [3, 2, 1]);
  assert.strictEqual(v.top.id, 4);
});

test("hostile input is refused without touching the game", () => {
  const S = rig(3);
  const before = JSON.stringify(S);
  const bad = [
    null, undefined, 5, "play", [], {}, { t: null }, { t: "constructor" }, { t: "__proto__" }, { t: "toString" }, { t: "buy", id: "constructor" },
    { t: "play" }, { t: "play", id: "constructor" }, { t: "play", id: "__proto__" }, { t: "play", id: -1 }, { t: "play", id: 1e9 }, { t: "play", id: NaN },
    { t: "play", id: {} }, { t: "play", id: [1] }, { t: "play", id: S.players[(S.cur + 1) % 3].hand[0].id }, { t: "color" }, { t: "color", c: "constructor" },
    { t: "keep" }, { t: "next" }, { t: "challenge" }, { t: "uno" }
  ];
  for (const a of bad) {
    const r = G.act(S, S.cur, a);
    assert.strictEqual(r.ok, false, JSON.stringify(a));
  }
  for (const pi of [null, undefined, -1, 3, 99, "0", "constructor", "__proto__", 0.5, NaN]) {
    assert.strictEqual(G.act(S, pi, { t: "draw" }).ok, false, String(pi));
    assert.strictEqual(G.act(S, pi, { t: "play", id: S.players[0].hand[0].id }).ok, false, String(pi));
  }
  assert.strictEqual(G.act(S, (S.cur + 1) % 3, { t: "draw" }).ok, false);
  assert.strictEqual(JSON.stringify(S), before);
});

test("computer players play a legal round to the end at every level", () => {
  for (const level of ["easy", "normal", "hard", "random"]) {
    const S = G.newGame(["A", "B", "C", "D"], 0, {});
    S.players.forEach((p) => { p.bot = true; });
    const t0 = Date.now();
    let steps = 0;
    while (S.phase !== "roundEnd" && steps++ < 4000) {
      const pi = S.cur;
      const a = G.suggest(G.view(S, pi), G.botLevel(S, pi, level));
      assert.ok(a, `${level}: the computer has an action`);
      let r = G.act(S, pi, a);
      if (!r.ok && a.t === "play") r = G.act(S, pi, { t: S.phase === "drawn" ? "keep" : "draw" });
      assert.ok(r.ok, `${level}: ${JSON.stringify(a)} -> ${r.error}`);
      assert.strictEqual(total(S), size(S), "no card is lost or duplicated");
    }
    assert.strictEqual(S.phase, "roundEnd", `${level}: the round ends`);
    assert.ok(S.last && S.last.winner >= 0);
    assert.ok(Date.now() - t0 < 3000, `${level}: a whole round is quick`);
  }
});
