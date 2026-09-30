"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

const two = [{ name: "Anna" }, { name: "Ben" }];
// a game in "player picks" mode where Anna (0) has to pick, Ben guesses
function picked(word, rules) {
  for (;;) {
    const S = G.newGame(two, 3, "player", rules, 2);
    if (S.chooser !== 0) continue;
    const r = G.act(S, 0, { t: "word", word });
    assert.ok(r.ok, r.error);
    return S;
  }
}

test("house rule streak: every further hit in a row adds a bonus point, a miss ends the series", () => {
  const S = picked("ABBAZ", { streak: true });
  const b = S.cur;
  assert.strictEqual(G.act(S, b, { t: "letter", l: "A" }).events[0].bonus, 0);
  const r = G.act(S, b, { t: "letter", l: "B" });
  assert.strictEqual(r.events[0].bonus, 1);
  assert.strictEqual(S.players[b].score, 2 + 2 + 1, "A twice, B twice, bonus 1 for the second hit");
  assert.strictEqual(G.view(S, b).run, 2);
  const N = picked("ABBAZ");
  G.act(N, N.cur, { t: "letter", l: "A" });
  assert.strictEqual(G.act(N, N.cur, { t: "letter", l: "B" }).events[0].bonus, 0, "off without the rule");
  const M = picked("ABBAZ", { streak: true });
  G.act(M, M.cur, { t: "letter", l: "Q" });
  assert.strictEqual(M.run, 0);
});

test("the round keeps a move list and suggest() picks a sensible letter from what is visible", () => {
  const S = picked("STRAßE");
  const b = S.cur;
  G.act(S, b, { t: "letter", l: "S" }); G.act(S, b, { t: "letter", l: "Q" });
  const v = G.view(S, S.cur);
  assert.deepStrictEqual(v.moves.map((m) => [m.l, m.n]), [["S", 1], ["Q", 0]]);
  const s = G.suggest(v);
  assert.ok(s && !v.guessed.includes(s.l) && !v.wrong.includes(s.l));
  // the category narrows it: only animals of four letters with an H in the middle -> E is out, the list has no such word
  const fresh = { mask: [null, null, null, null, null], guessed: [], wrong: [], cat: "Tiere" };
  const t = G.suggest(fresh);
  assert.ok(G.ALPHABET.includes(t.l) && t.of > 0);
  assert.strictEqual(G.suggest({ mask: [null], guessed: G.ALPHABET, wrong: [], cat: "" }), null);
});

test("word list: only German letters, no duplicates, sensible lengths", () => {
  const seen = new Set();
  for (const { w, cat } of G.LIST) {
    assert.match(w, /^[A-ZÄÖÜß]{3,20}$/, `${cat}: ${w}`);
    assert.ok(!seen.has(w), `doppelt: ${w}`);
    seen.add(w);
  }
  assert.ok(G.LIST.length > 400);
  assert.ok(G.LIST.some((x) => x.w.includes("ß")) && G.LIST.some((x) => /[ÄÖÜ]/.test(x.w)));
});

test("normWord keeps ß as one letter and checks the input", () => {
  assert.strictEqual(G.normWord(" Straße "), "STRAßE");
  assert.strictEqual(G.normWord("Käsebrötchen"), "KÄSEBRÖTCHEN");
  assert.strictEqual(G.wordError(G.normWord("zwei Wörter")), "Nur ein einzelnes Wort, ohne Leerzeichen.");
  assert.match(G.wordError(G.normWord("R2D2")), /Nur Buchstaben/);
  assert.match(G.wordError("AB"), /Mindestens/);
  assert.strictEqual(G.wordError("HAUS"), null);
});

test("a picked word: hits score and keep the turn, misses grow the gallows, solving gives the bonus", () => {
  const S = picked("Straße");
  assert.strictEqual(S.phase, "play");
  assert.strictEqual(S.cur, 1);
  assert.strictEqual(G.view(S, 1).word, null, "the guesser can't see it");
  assert.strictEqual(G.view(S, 0).word, "STRAßE", "the chooser can");
  assert.strictEqual(G.view(S, -1).word, null);
  assert.deepStrictEqual(G.view(S, 1).mask, [null, null, null, null, null, null]);
  assert.match(G.act(S, 0, { t: "letter", l: "S" }).error, /ausgesucht/);

  let r = G.act(S, 1, { t: "letter", l: "s" });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.events, [{ t: "hit", pi: 1, l: "S", n: 1, bonus: 0 }]);
  assert.strictEqual(S.cur, 1, "a hit keeps the turn");
  assert.strictEqual(S.players[1].score, 1);
  assert.match(G.act(S, 1, { t: "letter", l: "S" }).error, /schon geraten/);
  r = G.act(S, 1, { t: "letter", l: "ß" });
  assert.deepStrictEqual(G.view(S, 1).mask, ["S", null, null, null, "ß", null]);
  r = G.act(S, 1, { t: "letter", l: "Q" });
  assert.strictEqual(S.errors, 1);
  assert.deepStrictEqual(S.wrong, ["Q"]);
  // with two players the only guesser goes again after a miss
  assert.strictEqual(S.cur, 1);
  r = G.act(S, 1, { t: "solve", word: "straße" });
  assert.ok(r.ok);
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.solver, 1);
  // S + ß + 4 hidden letters + bonus
  assert.strictEqual(S.players[1].score, 1 + 1 + 4 + G.SOLVE_BONUS);
  assert.strictEqual(G.view(S, 1).word, "STRAßE");
});

test("hanged: the chooser scores; a wrong word costs a try", () => {
  const S = picked("Uhu", { hard: true });
  assert.strictEqual(S.maxErrors, 6);
  G.act(S, 1, { t: "solve", word: "Uhr" });
  assert.strictEqual(S.errors, 1);
  for (const l of ["A", "B", "C", "D", "E"]) G.act(S, 1, { t: "letter", l });
  assert.strictEqual(S.phase, "roundEnd");
  assert.ok(S.last.hanged);
  assert.strictEqual(S.players[0].score, G.HANGED_BONUS);
});

test("rounds: everyone picks about as often, the game ends after goal rounds", () => {
  const S = G.newGame([{ name: "A" }, { name: "B" }, { name: "C" }], 3, "player", {}, 2);
  const choosers = [];
  for (let round = 1; round <= 3; round++) {
    assert.strictEqual(S.round, round);
    choosers.push(S.chooser);
    G.act(S, S.chooser, { t: "word", word: "Haus" });
    const g = S.cur;
    G.act(S, g, { t: "solve", word: "Haus" });
    assert.strictEqual(S.phase, "roundEnd");
    if (round < 3) { assert.ok(!S.last.over); G.act(S, 0, { t: "next" }); }
  }
  assert.deepStrictEqual(choosers.slice().sort(), [0, 1, 2]);
  assert.ok(S.last.over);
  assert.ok(S.last.winners.length >= 1);
  G.act(S, 0, { t: "next" }); // rematch
  assert.strictEqual(S.round, 1);
  assert.ok(S.players.every((p) => p.score === 0));
});

test("random words: category shown, hint rule opens first and last letter, clock passes the turn", () => {
  const S = G.newGame([{ name: "A" }, { name: "B" }, { name: "C" }], 3, "random", { hint: true, clock: true }, 2);
  assert.strictEqual(S.chooser, -1);
  assert.strictEqual(S.phase, "play");
  const v = G.view(S, 0);
  assert.ok(G.WORDS[v.cat]);
  assert.strictEqual(v.mask[0], S.word[0]);
  assert.strictEqual(v.mask[v.mask.length - 1], S.word[S.word.length - 1]);
  const cur = S.cur;
  assert.ok(S.deadline > Date.now());
  const ev = G.tick(S, S.deadline + 5000);
  assert.strictEqual(ev[0].t, "timeout");
  assert.notStrictEqual(S.cur, cur);
  assert.strictEqual(S.errors, 0);
});

test("computer players finish a round on their own, without looking at the word", () => {
  for (const level of [1, 2, 3]) {
    const S = G.newGame([{ name: "A", bot: true }, { name: "B", bot: true }], 3, "random", {}, level);
    let guard = 0;
    while (S.phase === "play" && guard++ < 100) {
      const a = G.botMove(S, S.cur);
      assert.ok(a && G.act(S, S.cur, a).ok, JSON.stringify(a));
    }
    assert.strictEqual(S.phase, "roundEnd", `level ${level}`);
  }
  // a pro bot finds a list word quickly: it narrows the list down with what it sees
  let solvedCount = 0;
  for (let k = 0; k < 20; k++) {
    const S = G.newGame([{ name: "A", bot: true }, { name: "B", bot: true }], 3, "random", {}, 3);
    while (S.phase === "play") G.act(S, S.cur, G.botMove(S, S.cur));
    if (S.last.solver >= 0) solvedCount++;
  }
  assert.ok(solvedCount >= 17, `pro solved ${solvedCount}/20`);
});

test("a bot chooser picks a random word right away; giving up skips a player", () => {
  const S = G.newGame([{ name: "A" }, { name: "B", bot: true }, { name: "C" }], 3, "player", {}, 2);
  if (S.players[S.chooser].bot) assert.strictEqual(S.phase, "play");
  if (S.phase === "choose") G.act(S, S.chooser, { t: "word", word: "Kater" });
  const g = S.cur, other = [0, 1, 2].find((i) => i !== g && i !== S.chooser);
  assert.ok(G.act(S, g, { t: "giveup" }).ok);
  assert.strictEqual(S.cur, other);
  assert.ok(G.act(S, other, { t: "giveup" }).ok);
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.solver, -1);
  assert.ok(!S.last.hanged);
});
