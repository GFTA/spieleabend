"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Game = require("../public/game.js");

const two = (goal = 1, modes = 7) => Game.newGame([{ name: "Anna" }, { name: "Ben" }], goal, modes, 2, 2);
const three = (modes = 7) => Game.newGame([{ name: "Anna" }, { name: "Ben" }, { name: "Cleo" }], 1, modes, 2, 2);
const start = (S) => { assert.ok(Game.act(S, S.cur, { t: "go" }).ok); return S; };
const other = (S, k = 0) => S.players.map((p, i) => i).filter((i) => i !== S.cur)[k];

test("a new game starts with the first person getting ready", () => {
  const S = two();
  assert.strictEqual(S.phase, "prep");
  assert.ok(S.cur === 0 || S.cur === 1);
  assert.ok(Game.modeList(S.modes).includes(S.mode));
  assert.ok(S.word.text && S.word.d >= 1 && S.word.d <= 3);
  assert.strictEqual(S.turns, 2);
  assert.ok(Game.AVATARS.includes(S.players[0].avatar));
});

test("settings are normalised", () => {
  assert.strictEqual(Game.normGoal(9), 1);
  assert.strictEqual(Game.normGoal(3), 3);
  assert.strictEqual(Game.normModes(0), 7);
  assert.strictEqual(Game.normModes(2), 2);
  assert.strictEqual(Game.normModes("x"), 7);
  assert.deepStrictEqual(Game.modeList(5), ["draw", "mime"]);
  assert.strictEqual(Game.normTime(7), 2);
  assert.strictEqual(Game.normLevel(3), 3);
  assert.strictEqual(Game.normLevel("constructor"), 2);
});

test("every mode has enough words, and none appears twice", () => {
  for (const mode of Object.keys(Game.MODES)) {
    const all = Game.WORDS[mode].flat();
    assert.ok(all.length >= 60, mode);
    assert.strictEqual(new Set(all.map(Game.norm)).size, all.length, "duplicate in " + mode);
    for (const lst of Game.WORDS[mode]) assert.ok(lst.length >= 15);
  }
});

test("the word is only visible to whoever is on, and the others see a pattern", () => {
  const S = start(two(1, 2)), o = other(S);
  const mine = Game.view(S, S.cur), theirs = Game.view(S, o), spec = Game.view(S, -1);
  assert.strictEqual(mine.word, S.word.text);
  assert.strictEqual(theirs.word, null);
  assert.strictEqual(spec.word, null);
  assert.strictEqual(theirs.pattern.length, S.word.text.length);
  assert.ok(/^[_ \-]*$/.test(theirs.pattern.replace(/[^_ \-]/g, "")) && !theirs.pattern.replace(/[ \-_]/g, ""));
  assert.ok(!JSON.stringify(theirs).includes(S.word.text) || S.word.text.length < 4);
  const prep = two();
  assert.strictEqual(Game.view(prep, other(prep)).word, null);
  assert.strictEqual(Game.view(prep, prep.cur).word, prep.word.text);
});

test("guess matching: case, umlauts, articles, plural, typos, near misses", () => {
  assert.strictEqual(Game.match(["Fußball"], "FUSSBALL"), "ok");
  assert.strictEqual(Game.match(["Schlüssel"], "schluessel"), "ok");
  assert.strictEqual(Game.match(["Schlüssel"], "Schlussel"), "ok");
  assert.strictEqual(Game.match(["Katze"], "die katze"), "ok");
  assert.strictEqual(Game.match(["Katze"], "Katzen"), "ok");
  assert.strictEqual(Game.match(["Gitarre spielen", "Gitarre"], "gitarre"), "ok");
  assert.strictEqual(Game.match(["Zähne putzen"], "zähneputzen"), "ok");
  assert.strictEqual(Game.match(["Schmetterling"], "Schmeterling"), "ok");
  assert.strictEqual(Game.match(["Hase"], "Hose"), "close");
  assert.strictEqual(Game.match(["Hase"], "Auto"), "no");
  assert.strictEqual(Game.match(["Hase"], ""), "no");
  assert.strictEqual(Game.match(["Fußball"], "Fußballspiel"), "close");
  assert.strictEqual(Game.match(["Fußball"], "Tennis"), "no");
});

test("a right guess scores for the guesser and the one on, a wrong one only shows up", () => {
  const S = start(two(1, 1)), o = other(S);
  assert.ok(Game.act(S, o, { t: "guess", text: "Nonsens" }).ok);
  assert.strictEqual(S.players[o].score, 0);
  assert.strictEqual(S.feed[0].text, "Nonsens");
  const res = Game.act(S, o, { t: "guess", text: S.word.text.toUpperCase() });
  assert.ok(res.ok);
  assert.strictEqual(res.events.find((e) => e.t === "solve").first, true);
  assert.strictEqual(S.players[o].score, S.word.d + 3);
  assert.strictEqual(S.players[S.cur].score, S.word.d >= 3 ? 3 : 2);
  assert.strictEqual(S.phase, "reveal", "everybody solved, the turn is over");
  assert.strictEqual(S.lastTurn.reason, "all");
  assert.ok(!S.feed.some((f) => f.solved && f.text));
});

test("later guesses score less, and a second try after solving is refused", () => {
  const S = start(three(2)), a = other(S, 0), b = other(S, 1);
  S.word = { text: "Haus", alias: ["Haus"], d: 1 };
  Game.act(S, a, { t: "guess", text: "haus" });
  assert.strictEqual(S.players[a].score, 4);
  assert.strictEqual(Game.view(S, a).word, "Haus", "who solved may see it");
  assert.strictEqual(Game.view(S, b).word, null);
  assert.strictEqual(Game.act(S, a, { t: "guess", text: "haus" }).ok, false);
  S.until = Date.now() + S.total * 0.2; // late
  Game.act(S, b, { t: "guess", text: "Haus" });
  assert.strictEqual(S.players[b].score, 2);
  assert.strictEqual(S.players[S.cur].score, 4);
});

test("the one on cannot guess, and nobody but them may start, swap or give up", () => {
  const S = two(), o = other(S);
  assert.strictEqual(Game.act(S, o, { t: "go" }).ok, false);
  assert.strictEqual(Game.act(S, o, { t: "swap" }).ok, false);
  assert.strictEqual(Game.act(S, o, { t: "giveup" }).ok, false);
  assert.strictEqual(Game.act(S, o, { t: "guess", text: S.word.text }).ok, false, "guessing is for the play phase only");
  const w = S.word.text;
  assert.ok(Game.act(S, S.cur, { t: "swap" }).ok);
  assert.notStrictEqual(S.word.text, w);
  assert.strictEqual(Game.act(S, S.cur, { t: "swap" }).ok, false, "one swap only");
  start(S);
  assert.strictEqual(Game.act(S, S.cur, { t: "guess", text: S.word.text }).ok, false);
  assert.strictEqual(Game.act(S, S.cur, { t: "swap" }).ok, false);
});

test("time runs through prepare, play, hints, reveal and the next turn", () => {
  const S = two(1, 1);
  const first = S.cur;
  assert.ok(Game.nextDeadline(S) > 0 && Game.nextDeadline(S) <= Game.PREP_MS);
  assert.deepStrictEqual(Game.tick(S), []);
  S.until = Date.now() - 1;
  assert.strictEqual(Game.tick(S)[0].t, "go");
  assert.strictEqual(S.phase, "play");
  assert.ok(Game.nextDeadline(S) <= S.total * 0.5 + 50);
  S.startedAt = Date.now() - S.total * 0.55; S.until = S.startedAt + S.total;
  assert.strictEqual(Game.tick(S)[0].t, "hint");
  assert.strictEqual(S.hints, 1);
  const shown = Game.view(S, other(S)).pattern.replace(/[_ ]/g, "");
  assert.strictEqual(shown.length, 1, "one letter revealed");
  S.startedAt = Date.now() - S.total * 0.8; S.until = S.startedAt + S.total;
  Game.tick(S);
  assert.strictEqual(S.hints, 2);
  S.until = Date.now() - 1;
  assert.strictEqual(Game.tick(S)[0].t, "reveal");
  assert.strictEqual(S.phase, "reveal");
  assert.strictEqual(S.lastTurn.reason, "time");
  assert.strictEqual(Game.view(S, other(S)).lastTurn.word, S.word.text);
  S.until = Date.now() - 1;
  const ev = Game.tick(S);
  assert.strictEqual(ev[0].t, "turn");
  assert.strictEqual(S.phase, "prep");
  assert.notStrictEqual(S.cur, first);
});

test("everybody is on equally often, then the game ends with the best score", () => {
  for (const [players, goal] of [[2, 1], [3, 2], [4, 1]]) {
    const S = Game.newGame(Array.from({ length: players }, (_, i) => ({ name: "P" + i })), goal, 7, 1, 2);
    const turns = [];
    let guard = 0;
    while (S.phase !== "roundEnd" && guard++ < 200) {
      turns.push(S.cur);
      Game.act(S, S.cur, { t: "go" });
      const o = S.players.map((p, i) => i).filter((i) => i !== S.cur);
      Game.act(S, o[0], { t: "guess", text: S.word.text });
      Game.act(S, S.cur, { t: "giveup" });
      S.until = Date.now() - 1; Game.tick(S);
    }
    assert.strictEqual(S.phase, "roundEnd");
    assert.strictEqual(turns.length, players * goal);
    for (let i = 0; i < players; i++) assert.strictEqual(turns.filter((x) => x === i).length, goal);
    assert.strictEqual(S.last.over, true);
    assert.ok(S.last.winners.length >= 1);
    for (const w of S.last.winners) assert.strictEqual(S.players[w].score, S.last.top);
    assert.strictEqual(S.hist.length, players * goal);
    assert.strictEqual(S.players.reduce((n, p) => n + p.wins, 0), S.last.winners.length);
    const wins = S.players.map((p) => p.wins);
    assert.ok(Game.act(S, 0, { t: "next" }).ok);
    assert.strictEqual(S.round, 2);
    assert.strictEqual(S.phase, "prep");
    assert.deepStrictEqual(S.players.map((p) => p.wins), wins, "wins stay for the next game");
    assert.ok(S.players.every((p) => p.score === 0));
  }
});

test("nobody scoring ends without a winner", () => {
  const S = two(1, 1);
  let guard = 0;
  while (S.phase !== "roundEnd" && guard++ < 20) {
    Game.act(S, S.cur, { t: "giveup" }); // gives up while preparing
  }
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, []);
});

test("alone with computers the one human is on three times per goal", () => {
  const S = Game.newGame([{ name: "Ich" }, { name: "R", bot: true }, { name: "S", bot: true }], 2, 7, 2, 2);
  assert.strictEqual(S.turns, 6);
  assert.ok(S.order.every((i) => i === 0));
});

test("a computer that took over a seat never performs: its turn is skipped", () => {
  const S = Game.newGame([{ name: "A" }, { name: "B" }, { name: "C" }], 1, 7, 2, 2);
  const next = S.order[1];
  S.players[next].bot = true;
  Game.act(S, S.cur, { t: "giveup" });
  assert.notStrictEqual(S.cur, next);
  assert.ok(S.phase === "prep" || S.phase === "roundEnd");
  // when it is the bot's turn right now, it plans a skip and the skip works
  const S2 = Game.newGame([{ name: "A" }, { name: "B" }], 1, 7, 2, 2);
  S2.players[S2.cur].bot = true;
  const plan = Game.botPlan(S2);
  assert.strictEqual(plan.pi, S2.cur);
  assert.deepStrictEqual(Game.botMove(S2, S2.cur), { t: "skip" });
  assert.ok(Game.act(S2, S2.cur, { t: "skip" }).ok);
  assert.notStrictEqual(S2.phase, "roundEnd");
  const S3 = two();
  assert.strictEqual(Game.act(S3, S3.cur, { t: "skip" }).ok, false, "humans cannot be skipped");
});

test("the computers guess: they plan, move legally and finish a game", () => {
  for (const level of [1, 2, 3]) for (const modes of [1, 2, 4]) {
    const S = Game.newGame([{ name: "Ich" }, { name: "R1", bot: true }, { name: "R2", bot: true }], 1, modes, 1, level);
    let guard = 0, solved = 0;
    while (S.phase !== "roundEnd" && guard++ < 400) {
      if (S.phase === "prep") { Game.act(S, 0, { t: "go" }); continue; }
      if (S.phase === "reveal") { S.until = Date.now() - 1; Game.tick(S); continue; }
      const plan = Game.botPlan(S);
      if (!plan) { S.until = Date.now() - 1; Game.tick(S); continue; } // nobody left to guess: time runs out
      assert.ok(plan.delay >= 250 && plan.key);
      const a = Game.botMove(S, plan.pi);
      assert.ok(a && a.t === "guess" && a.text);
      const res = Game.act(S, plan.pi, a);
      assert.ok(res.ok, res.error);
      solved += res.events.filter((e) => e.t === "solve").length;
    }
    assert.strictEqual(S.phase, "roundEnd");
    assert.ok(solved > 0 || level === 1, "a normal computer solves something in 3 turns");
  }
});

test("the plan key changes with every computer move", () => {
  const S = Game.newGame([{ name: "Ich" }, { name: "R1", bot: true }, { name: "R2", bot: true }], 1, 7, 1, 3);
  Game.act(S, 0, { t: "go" });
  const seen = new Set();
  let guard = 0, plan;
  while ((plan = Game.botPlan(S)) && guard++ < 20) {
    assert.ok(!seen.has(plan.key), "key repeated: " + plan.key);
    seen.add(plan.key);
    if (S.phase !== "play") break;
    Game.act(S, plan.pi, Game.botMove(S, plan.pi));
  }
});

test("drawing: strokes are validated, applied and counted", () => {
  const S = start(two(1, 1));
  const o = other(S);
  assert.strictEqual(Game.draw(S, o, [["x"]]).ok, false, "only the one on draws");
  let r = Game.draw(S, S.cur, [["b", 1, 2, 10.4, 20], ["m", 30, 40, 50, 60]]);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.ops[0], ["b", 1, 2, 10, 20]);
  assert.deepStrictEqual([r.from, r.n], [0, 1]);
  assert.deepStrictEqual(S.draw, [{ c: 1, w: 2, p: [10, 20, 30, 40, 50, 60] }]);
  Game.draw(S, S.cur, [["b", 8, 0, 5000, -5]]);
  assert.deepStrictEqual(S.draw[1].p, [Game.CANVAS_W, 0]);
  r = Game.draw(S, S.cur, [["u"]]);
  assert.strictEqual(S.draw.length, 1);
  assert.strictEqual(S.dn, 3);
  assert.strictEqual(Game.drawFull(S).n, 3);
  Game.draw(S, S.cur, [["x"]]);
  assert.strictEqual(S.draw.length, 0);
  assert.strictEqual(Game.view(S, o).dn, 4);
  const bad = [null, [], "x", [["b"]], [["b", 99, 0, 1, 1]], [["b", 0, 9, 1, 1]], [["b", 0, 0, "1", 1]], [["m", 1, 2]], [["m"]], [["b", 0, 0, 1, 1], ["m", 1]],
    [["constructor"]], [["__proto__", 1]], [[5]], [["b", 0, 0, NaN, 1]], Array(100).fill(["u"]), [["m"].concat(Array(700).fill(5))]];
  for (const ops of bad) {
    const before = JSON.stringify(S);
    assert.strictEqual(Game.draw(S, S.cur, ops).ok, false, JSON.stringify(ops).slice(0, 60));
    assert.strictEqual(JSON.stringify(S), before);
  }
  const E = start(two(1, 2));
  assert.strictEqual(Game.draw(E, E.cur, [["x"]]).ok, false, "no drawing while explaining");
});

test("the drawing page has a size limit", () => {
  const S = start(two(1, 1));
  let n = 0, last;
  for (; n < 2000; n++) { last = Game.draw(S, S.cur, [["b", 0, 0, 1, 1], ["m"].concat(Array(100).fill(7))]); if (!last.ok) break; }
  assert.strictEqual(last.ok, false);
  assert.ok(n >= 40 && n < 450);
  assert.ok(Game.draw(S, S.cur, [["x"]]).ok, "clearing always works");
});

test("a turn ends early when everybody guessed, and giving up ends it too", () => {
  const S = start(three(2));
  S.word = { text: "Haus", alias: ["Haus"], d: 1 };
  Game.act(S, other(S, 0), { t: "guess", text: "Haus" });
  assert.strictEqual(S.phase, "play");
  Game.act(S, other(S, 1), { t: "guess", text: "Haus" });
  assert.strictEqual(S.phase, "reveal");
  const T = start(three(2));
  assert.ok(Game.act(T, T.cur, { t: "giveup" }).ok);
  assert.strictEqual(T.lastTurn.reason, "giveup");
  assert.strictEqual(Game.act(T, T.cur, { t: "giveup" }).ok, false);
  assert.strictEqual(Game.act(T, 0, { t: "next" }).ok, false, "next only at the end of the game");
});

// The engine runs on the server's only thread for every room at once: a rule step, a bot move or
// a whole generated round must never take noticeable time. Keep a check like this for anything heavy.
test("the engine is fast: 100 whole games with computers and a long guess take well under a second", () => {
  const t0 = Date.now();
  for (let k = 0; k < 100; k++) {
    const S = Game.newGame([{ name: "Ich" }, { name: "R1", bot: true }, { name: "R2", bot: true }], 1, 7, 1, 2);
    let guard = 0;
    while (S.phase !== "roundEnd" && guard++ < 400) {
      if (S.phase === "prep") Game.act(S, 0, { t: "go" });
      else if (S.phase === "reveal") { S.until = Date.now() - 1; Game.tick(S); }
      else { const p = Game.botPlan(S); if (p) Game.act(S, p.pi, Game.botMove(S, p.pi)); else { S.until = Date.now() - 1; Game.tick(S); } }
    }
    assert.strictEqual(S.phase, "roundEnd");
  }
  const S = start(two());
  for (let i = 0; i < 2000; i++) Game.act(S, other(S), { t: "guess", text: "x".repeat(40) + i });
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
});

// Every message from a browser reaches Game.act unchecked: nothing hostile may change the state or throw.
// Table lookups by a client value need hasOwnProperty, else "constructor" / "__proto__" slip through.
test("hostile messages are rejected and leave the state untouched", () => {
  const S = start(three());
  const hostile = [null, undefined, 5, "guess", [], {}, { t: null }, { t: "constructor" }, { t: "__proto__" }, { t: "toString" },
    { t: "guess", text: { toString: 1 } }, { t: "guess", text: 5 }, { t: "guess", text: "   " }, { t: "guess", text: ["Haus"] },
    { t: "guess", id: "constructor" }, { t: "swap", n: NaN }, { t: "skip" }, { t: "next" }, { t: "go", i: -1 }];
  for (let pi = -1; pi <= 3; pi++) for (const a of hostile) {
    const before = JSON.stringify(S);
    let res;
    assert.doesNotThrow(() => { res = Game.act(S, pi, a); });
    if (!res.ok) assert.strictEqual(JSON.stringify(S), before, "a rejected action must not change the state: " + JSON.stringify(a));
    Object.assign(S, JSON.parse(before));
  }
  const Q = start(two());
  assert.ok(Game.act(Q, other(Q), { t: "guess", text: "constructor" }).ok, "a guess is just text");
  assert.strictEqual(Q.feed[0].text, "constructor");
  assert.strictEqual(Game.act(Q, other(Q), { t: "guess", text: "y".repeat(500) }).ok, true);
  assert.strictEqual(Q.feed[1].text.length, 40);
});

test("the feed keeps the latest 30 guesses and the view carries what the table needs", () => {
  const S = start(two());
  const o = other(S);
  for (let i = 0; i < 45; i++) Game.act(S, o, { t: "guess", text: "falsch" + i });
  const v = Game.view(S, o);
  assert.strictEqual(v.feed.length, 30);
  assert.strictEqual(v.feed[29].text, "falsch44");
  assert.strictEqual(v.me, o);
  assert.strictEqual(Game.view(S, -1).me, -1);
  assert.ok(v.left > 0 && v.total === S.total);
});
