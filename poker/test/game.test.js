"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

// cards from text like "As Kh 9d" (rank + suit letters s h d c)
const C = (txt) => txt.split(" ").map((t) => {
  const r = "23456789TJQKA".indexOf(t[0]) + 2, s = "shdc".indexOf(t[1]);
  return s * 13 + (r - 2);
});
const key = (t) => G.best(C(t));
const better = (a, b) => assert.ok(G.cmpKey(key(a), key(b)) > 0, `${a} > ${b}`);

test("hands are recognised and ranked", () => {
  const names = [["As Ks Qs Js Ts", 8], ["9h 9d 9s 9c 2d", 7], ["3h 3d 3s 8c 8d", 6], ["2s 7s 9s Js Ks", 5], ["5h 6d 7s 8c 9d", 4],
    ["Qh Qd Qs 8c 2d", 3], ["Qh Qd 8s 8c 2d", 2], ["Qh Qd 7s 8c 2d", 1], ["Ah Qd 7s 8c 2d", 0]];
  for (const [t, cat] of names) assert.strictEqual(key(t)[0], cat, t);
  assert.strictEqual(G.label(key("As Ks Qs Js Ts")), "Royal Flush");
  assert.strictEqual(G.label(key("Qh Qd 8s 8c 2d")), "Zwei Paare (Damen und Achter)");
  better("Ah 2d 3s 4c 5d", "Kh Kd 3s 4c 6d"); // wheel is a straight, beats a pair
  assert.strictEqual(key("Ah 2d 3s 4c 5d")[1], 5, "the wheel plays as five high");
  better("6h 7d 8s 9c Td", "Ah 2d 3s 4c 5d");
  better("Kh Kd 3s 4c 6d", "Qh Qd Ks 4c 6d");
  better("Kh Kd Qs 4c 6d", "Kh Kd Js 4c 6d");
  better("2h 2d 2s 3c 3d", "Ah Ad As Kc Qd");
});

test("best five of seven", () => {
  assert.strictEqual(key("Ah Kh Qh Jh 2h 3c 9d")[0], 5);
  assert.strictEqual(key("Ah Kh Qh Jh Th 3c 9d")[0], 8);
  assert.strictEqual(key("2h 2d 2s 9c 9d 9h 4c")[1], 9, "two triples make the higher full house");
  assert.deepStrictEqual(key("Ah Ad Kc Kd 2s 2c 5h"), [2, 14, 13, 5], "best kicker with three pairs");
});

function chipsTotal(S) { return S.players.reduce((s, p) => s + p.chips + (S.phase === "roundEnd" ? 0 : p.total), 0); }

test("dealing, blinds, and betting order", () => {
  const S = G.newGame([{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }], 1000, {}, true);
  assert.deepStrictEqual([S.sb, S.bb], [10, 20]);
  assert.ok(S.players.every((p) => p.hole.length === 2));
  const sb = (S.dealer + 1) % 4, bb = (S.dealer + 2) % 4, utg = (S.dealer + 3) % 4;
  assert.strictEqual(S.players[sb].bet, 10);
  assert.strictEqual(S.players[bb].bet, 20);
  assert.strictEqual(S.cur, utg);
  assert.strictEqual(G.act(S, sb, { t: "call" }).ok, false, "not your turn");
  assert.strictEqual(G.act(S, utg, { t: "check" }).ok, false, "must pay the blind");
  assert.strictEqual(G.act(S, utg, { t: "raise", to: 30 }).ok, false, "min raise is 40");
  assert.strictEqual(G.act(S, utg, { t: "raise", to: 60 }).ok, true);
  assert.strictEqual(S.cbet, 60);
  assert.strictEqual(S.minRaise, 40);
  assert.strictEqual(chipsTotal(S), 4000);
});

test("heads-up: the dealer is the small blind and acts first before the flop, last after", () => {
  const S = G.newGame([{ name: "a" }, { name: "b" }], 1000, {}, true);
  const d = S.dealer;
  assert.strictEqual(S.players[d].bet, 10);
  assert.strictEqual(S.cur, d);
  G.act(S, d, { t: "call" });
  assert.strictEqual(S.cur, 1 - d, "the big blind has the option");
  G.act(S, 1 - d, { t: "check" });
  assert.strictEqual(S.street, "flop");
  assert.strictEqual(S.board.length, 3);
  assert.strictEqual(S.cur, 1 - d, "big blind first after the flop");
});

test("views hide other people's cards until they are turned over", () => {
  const S = G.newGame([{ name: "a" }, { name: "b" }, { name: "c" }], 1000, {}, true);
  const v = G.view(S, 0);
  assert.strictEqual(v.hole.length, 2);
  assert.deepStrictEqual(v.players[1].hole, [null, null]);
  assert.ok(!JSON.stringify(v).includes(JSON.stringify(S.players[1].hole)), "no leak");
  const w = G.view(S, -1);
  assert.deepStrictEqual(w.hole, []);
  assert.deepStrictEqual(w.players[0].hole, [null, null]);
  assert.ok(!("deck" in v));
});

test("everybody folds: the last player takes the pot without showing", () => {
  const S = G.newGame([{ name: "a" }, { name: "b" }, { name: "c" }], 1000, {}, false);
  let g = 0;
  while (S.phase === "play" && g++ < 10) { const o = G.options(S); assert.ok(G.act(S, S.cur, { t: o.canCheck ? "check" : "fold" }).ok); }
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.kind, "fold");
  assert.strictEqual(chipsTotal(S), 3000);
  const w = S.last.winners[0];
  assert.strictEqual(G.view(S, (w + 1) % 3).players[w].hole[0], null, "the winner's cards stay hidden");
});

test("all-in and call: cards are turned over and the board runs out", () => {
  const S = G.newGame([{ name: "a" }, { name: "b" }], 1000, {}, false);
  const d = S.dealer;
  assert.ok(G.act(S, d, { t: "allin" }).ok);
  assert.ok(G.act(S, 1 - d, { t: "call" }).ok);
  assert.strictEqual(S.phase, "runout");
  assert.ok(G.view(S, d).players[1 - d].hole[0] != null, "all-in cards are open");
  let n = 0;
  S.nextAt = 1;
  while (S.phase === "runout" && n++ < 10) { G.tick(S); if (S.phase === "runout") S.nextAt = 1; }
  assert.strictEqual(S.board.length, 5);
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(chipsTotal(S), 2000);
});

test("side pots: the short stack can only win its share", () => {
  const S = G.newGame([{ name: "a" }, { name: "b" }, { name: "c" }], 1000, {}, false);
  S.players[0].chips = 100; S.players[1].chips = 500; S.players[2].chips = 1000;
  // rig the deck/hole cards: seat 0 has the best hand, then seat 1, then seat 2
  S.players[0].hole = C("As Ad"); S.players[1].hole = C("Ks Kd"); S.players[2].hole = C("Qs Qd");
  S.board = C("2c 7h 9d Jc 4s"); S.street = "river"; S.phase = "play";
  S.players.forEach((p) => { p.bet = 0; p.total = 0; p.folded = false; p.allin = false; });
  S.players[0].total = 100; S.players[0].chips = 0; S.players[0].allin = true;
  S.players[1].total = 500; S.players[1].chips = 0; S.players[1].allin = true;
  S.players[2].total = 500; S.players[2].chips = 500;
  const before = chipsTotal(S);
  S.nextAt = 0; S.phase = "runout";
  S.street = "river"; S.board = C("2c 7h 9d Jc 4s");
  S.nextAt = 1; G.tick(S);
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.players[0].chips, 300, "main pot 3 x 100");
  assert.strictEqual(S.players[1].chips, 800, "side pot 2 x 400");
  assert.strictEqual(S.players[2].chips, 500);
  assert.ok(S.players[0].chips + S.players[1].chips + S.players[2].chips === before);
  assert.strictEqual(S.last.pots.length, 2);
});

test("a short all-in raise does not reopen the betting", () => {
  const S = G.newGame([{ name: "a" }, { name: "b" }, { name: "c" }], 1000, {}, false);
  const utg = S.cur, sb = (S.dealer + 1) % 3, bb = (S.dealer + 2) % 3;
  assert.strictEqual(utg, S.dealer);
  G.act(S, utg, { t: "raise", to: 100 });   // full raise, min re-raise is 80 more
  S.players[sb].chips = 130 - S.players[sb].bet; // short: can raise to 130 only (30 more, less than 80)
  G.act(S, sb, { t: "allin" });
  assert.strictEqual(S.cbet, 130);
  assert.strictEqual(S.minRaise, 80, "unchanged");
  G.act(S, bb, { t: "call" });
  assert.strictEqual(S.cur, utg);
  assert.strictEqual(G.options(S).canRaise, false, "the first raiser may only call or fold");
  assert.strictEqual(G.act(S, utg, { t: "raise", to: 400 }).ok, false);
  assert.strictEqual(G.act(S, utg, { t: "call" }).ok, true);
});

test("computer players finish whole tournaments and no chips get lost", () => {
  for (const lvl of Object.keys(G.BOT_LEVELS)) {
    const S = G.newGame([{ name: "a", bot: true }, { name: "b", bot: true }, { name: "c", bot: true }, { name: "d", bot: true }], 1000, { blindsUp: true }, false);
    let steps = 0;
    while (!(S.phase === "roundEnd" && S.last.over) && steps++ < 20000) {
      if (S.phase === "play") {
        let a = G.suggest(G.view(S, S.cur), lvl);
        let r = G.act(S, S.cur, a);
        assert.ok(r.ok, `${lvl}: ${JSON.stringify(a)} ${r.error}`);
      } else if (S.phase === "runout") { S.nextAt = 1; G.tick(S); }
      else G.act(S, 0, { t: "next" });
      assert.strictEqual(chipsTotal(S), 4000, "chips are conserved");
    }
    assert.ok(S.last.over, `${lvl} finished in ${steps} steps`);
    assert.strictEqual(S.players.filter((p) => !p.out).length, 1);
    assert.strictEqual(S.players[S.last.champ].chips, 4000);
    assert.ok(G.act(S, 0, { t: "next" }).ok);
    assert.ok(S.players.every((p) => p.chips + p.total === 1000 && !p.out), "rematch resets");
  }
});

test("timeout checks when free and folds otherwise", () => {
  const S = G.newGame([{ name: "a" }, { name: "b" }, { name: "c" }], 1000, {}, false);
  const cur = S.cur;
  assert.strictEqual(G.act(S, (cur + 1) % 3, { t: "timeout" }).ok, false);
  assert.ok(G.act(S, cur, { t: "timeout" }).ok);
  assert.ok(S.players[cur].folded);
});
