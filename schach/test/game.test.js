"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

const two = (bot) => [{ name: "Anna", avatar: "🐙" }, { name: "Ben", avatar: "🦖", bot: !!bot }];
const sqi = (n) => "abcdefgh".indexOf(n[0]) + (n[1] - 1) * 8;
// a fresh game where player 0 plays white
function fresh(rules, bot, level) {
  const S = G.newGame(two(bot), 1, rules || {}, level);
  while (S.col[0] !== 0) G.act(S, S.cur, { t: "giveup" }), G.act(S, 0, { t: "next" });
  return S;
}
const white = (S) => S.col.indexOf(0), black = (S) => S.col.indexOf(1);
// "e2e4" or "e7e8q": the player on turn plays it
function mv(S, text) {
  const promo = { n: 2, b: 3, r: 4, q: 5 }[text[4]];
  return G.act(S, S.cur, { t: "move", from: sqi(text.slice(0, 2)), to: sqi(text.slice(2, 4)), promo });
}
function line(S, text) {
  for (const t of text.split(/\s+/).filter(Boolean)) {
    const r = mv(S, t);
    assert.ok(r.ok, `${t}: ${r.error}`);
  }
}
function setup(S, fen) {
  const p = G.posFromFen(fen);
  S.grid = Array.from(p.g); S.side = p.side; S.castle = p.castle; S.ep = p.ep; S.half = 0;
  S.hist = []; S.keys = []; S.phase = "play"; S.last = null; S.lastMove = null;
  S.cur = S.col.indexOf(p.side);
  return S;
}
const piece = (S, n) => S.grid[sqi(n)];

test("start position: 32 pieces, white begins with 20 legal moves, colours swap every round", () => {
  const S = G.newGame(two(), 3, {}, 2);
  assert.strictEqual(S.grid.filter(Boolean).length, 32);
  assert.strictEqual(S.col[S.cur], 0);
  const v = G.view(S, S.cur);
  assert.strictEqual(v.legal.length, 20);
  assert.strictEqual(v.check, -1);
  const first = S.cur;
  G.act(S, S.cur, { t: "giveup" });
  G.act(S, 0, { t: "next" });
  assert.notStrictEqual(S.cur, first);
  assert.strictEqual(S.col[S.cur], 0);
});

test("scholar's mate: Schachmatt, notation with German piece letters, the winner is counted", () => {
  const S = fresh();
  line(S, "e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7");
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.why, "mate");
  assert.deepStrictEqual(S.last.winners, [white(S)]);
  assert.strictEqual(S.players[white(S)].wins, 1);
  assert.deepStrictEqual(G.view(S, 0).moves, ["e4", "e5", "Dh5", "Sc6", "Lc4", "Sf6", "Dxf7#"]);
  assert.strictEqual(S.lastMove.check, true);
  assert.ok(S.last.over);
});

test("fool's mate: black wins", () => {
  const S = fresh();
  line(S, "f2f3 e7e5 g2g4 d8h4");
  assert.strictEqual(S.last.why, "mate");
  assert.deepStrictEqual(S.last.winners, [black(S)]);
});

test("stalemate is a draw", () => {
  const S = fresh();
  setup(S, "7k/5Q2/8/8/8/8/8/K7 w - -");
  assert.strictEqual(mv(S, "f7f7").ok, false);
  assert.ok(mv(S, "f7g6").ok);
  assert.strictEqual(S.last.why, "stalemate");
  assert.deepStrictEqual(S.last.winners, []);
  assert.strictEqual(S.draws, 1);
});

test("castling: both sides, rights are lost, not through or out of check", () => {
  let S = fresh();
  setup(S, "r3k2r/8/8/8/8/8/8/R3K2R w KQkq -");
  assert.ok(mv(S, "e1g1").ok);
  assert.strictEqual(piece(S, "f1") & 7, 4);
  assert.strictEqual(piece(S, "g1") & 7, 6);
  assert.ok(mv(S, "e8c8").ok);
  assert.strictEqual(piece(S, "d8") & 7, 4);
  assert.strictEqual(piece(S, "c8") & 7, 6);
  assert.deepStrictEqual(G.view(S, 0).moves, ["0-0", "0-0-0"]);

  // the rook has moved: no castling on that side any more, even after it came back
  S = fresh();
  setup(S, "r3k2r/8/8/8/8/8/8/R3K2R w KQkq -");
  line(S, "h1h2 a8a7 h2h1 a7a8");
  assert.strictEqual(mv(S, "e1g1").ok, false);
  assert.ok(mv(S, "e1c1").ok);

  // a rook attacks f1: the king may not pass it, nor castle while in check
  S = fresh();
  setup(S, "4k3/5r2/8/8/8/8/8/R3K2R w KQ -");
  assert.strictEqual(mv(S, "e1g1").ok, false);
  setup(S, "4k3/4r3/8/8/8/8/8/R3K2R w KQ -");
  assert.strictEqual(mv(S, "e1g1").ok, false);
  assert.strictEqual(mv(S, "e1c1").ok, false);
  // a rook attacks b1 only: long castling is fine
  setup(S, "4k3/1r6/8/8/8/8/8/R3K2R w KQ -");
  assert.ok(mv(S, "e1c1").ok);
});

test("en passant works right after the double step and not later", () => {
  let S = fresh();
  setup(S, "4k3/3p4/8/4P3/8/8/8/4K3 b - -");
  line(S, "d7d5");
  assert.strictEqual(S.ep, sqi("d6"));
  assert.ok(mv(S, "e5d6").ok);
  assert.strictEqual(piece(S, "d5"), 0);
  assert.strictEqual(piece(S, "d6") & 7, 1);
  assert.strictEqual(S.lastMove.capSq, sqi("d5"));
  assert.strictEqual(G.view(S, 0).moves[1], "exd6");

  S = fresh();
  setup(S, "4k3/3p4/8/4P3/8/8/7P/4K3 b - -");
  line(S, "d7d5 h2h3 e8e7");
  assert.strictEqual(mv(S, "e5d6").ok, false);
});

test("promotion: queen by default, other pieces on request, nothing else", () => {
  let S = fresh();
  setup(S, "7k/P7/8/8/8/8/8/K7 w - -");
  assert.strictEqual(G.act(S, S.cur, { t: "move", from: sqi("a7"), to: sqi("a8"), promo: 1 }).ok, false);
  assert.strictEqual(G.act(S, S.cur, { t: "move", from: sqi("a7"), to: sqi("a8"), promo: 6 }).ok, false);
  assert.strictEqual(G.act(S, S.cur, { t: "move", from: sqi("a7"), to: sqi("a8"), promo: "q" }).ok, false);
  assert.ok(G.act(S, S.cur, { t: "move", from: sqi("a7"), to: sqi("a8") }).ok);
  assert.strictEqual(piece(S, "a8"), 5);
  assert.match(S.log[S.log.length - 1], /a8=D\+/);

  S = fresh();
  setup(S, "7k/P7/8/8/8/8/8/K7 w - -");
  assert.ok(mv(S, "a7a8n").ok);
  assert.strictEqual(piece(S, "a8"), 2);
  // the legal list names every choice
  S = fresh();
  setup(S, "1n5k/P7/8/8/8/8/8/K7 w - -");
  const to8 = G.view(S, S.cur).legal.filter((m) => m.from === sqi("a7") && m.to === sqi("b8"));
  assert.deepStrictEqual(to8.map((m) => m.promo).sort(), [2, 3, 4, 5]);
  assert.ok(to8.every((m) => m.cap));
});

test("disambiguation in the notation", () => {
  const play = (fen, m) => { const S = fresh(); setup(S, fen); line(S, m); return S.hist[0].san; };
  assert.strictEqual(play("4k3/8/8/8/8/8/4K3/R6R w - -", "a1d1"), "Tad1");
  assert.strictEqual(play("4k3/8/8/8/8/8/4K3/R6R w - -", "h1f1"), "Thf1");
  assert.strictEqual(play("4k3/8/8/R7/8/8/4K3/R7 w - -", "a1a3"), "T1a3");
  assert.strictEqual(play("4k3/8/8/R7/8/8/4K3/R7 w - -", "a5a3"), "T5a3");
  assert.strictEqual(play("4k3/8/8/8/8/8/4K3/R7 w - -", "a1a3"), "Ta3");
  assert.strictEqual(play("4k3/8/8/8/8/2N3N1/8/4K3 w - -", "c3e4"), "Sce4");
  assert.strictEqual(play("4k3/8/8/8/8/2N3N1/8/4K3 w - -", "g3e4"), "Sge4");
  assert.strictEqual(play("4k3/8/8/8/8/2N3N1/8/4K3 w - -", "c3d5"), "Sd5");
});

test("moves that leave the king in check, wrong turns, hostile input", () => {
  const S = fresh();
  const snap = () => JSON.stringify(S);
  const before = snap();
  const bad = [
    { t: "move", from: sqi("e2"), to: sqi("e5") }, { t: "move", from: sqi("e7"), to: sqi("e5") }, { t: "move", from: sqi("e4"), to: sqi("e5") },
    { t: "move", from: sqi("a1"), to: sqi("a3") }, { t: "move", from: sqi("b1"), to: sqi("b3") }, { t: "move", from: -1, to: 8 }, { t: "move", from: 64, to: 8 },
    { t: "move", from: 1.5, to: 8 }, { t: "move", from: "e2", to: "e4" }, { t: "move" }, { t: "move", from: null, to: null }, { t: "move", from: [], to: {} },
    { t: "move", from: 1e9, to: 0 }, { t: "undo" }, { t: "skipp" }, { t: 5 }, null, "move", [], { }
  ];
  for (const a of bad) assert.strictEqual(G.act(S, S.cur, a).ok, false, JSON.stringify(a));
  assert.strictEqual(G.act(S, 1 - S.cur, { t: "move", from: sqi("e7"), to: sqi("e5") }).ok, false);
  assert.strictEqual(G.act(S, 7, { t: "move", from: sqi("e2"), to: sqi("e4") }).ok, false);
  assert.strictEqual(G.act(S, -1, { t: "move", from: sqi("e2"), to: sqi("e4") }).ok, false);
  assert.strictEqual(G.act(S, S.cur, { t: "next" }).ok, false);
  assert.strictEqual(snap(), before);

  // pinned piece and king into attack
  setup(S, "4r1k1/8/8/8/8/8/4B3/4K3 w - -");
  assert.match(G.act(S, S.cur, { t: "move", from: sqi("e2"), to: sqi("d3") }).error, /nicht erlaubt|Schach/);
  assert.strictEqual(piece(S, "e2") & 7, 3);
  assert.strictEqual(G.act(S, S.cur, { t: "move", from: sqi("e1"), to: sqi("e2") }).ok, false);
  assert.strictEqual(G.act(S, S.cur, { t: "move", from: sqi("e1"), to: sqi("d1") }).ok, true);
});

test("check: only moves that answer it are legal", () => {
  const S = fresh();
  setup(S, "4r1k1/8/8/8/8/8/3P4/R3K3 w - -");
  assert.strictEqual(G.view(S, S.cur).check, sqi("e1"));
  const list = G.view(S, S.cur).legal;
  assert.ok(list.every((m) => m.from === sqi("e1")), "only the king can move");
  assert.ok(!list.some((m) => m.to === sqi("e2")));
  assert.match(G.act(S, S.cur, { t: "move", from: sqi("d2"), to: sqi("d4") }).error, /Schach/);
});

test("draws: threefold repetition, 50 moves, dead position", () => {
  let S = fresh();
  line(S, "g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1");
  assert.strictEqual(S.phase, "play");
  line(S, "f6g8");
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.why, "repetition");
  assert.deepStrictEqual(S.last.winners, []);

  S = fresh();
  setup(S, "4k3/8/8/8/8/8/8/R3K3 w - -");
  S.half = 99;
  line(S, "a1a2");
  assert.strictEqual(S.last.why, "fifty");

  S = fresh();
  setup(S, "4k3/3b4/8/8/8/8/8/R3K3 w - -");
  S.half = 0;
  line(S, "a1a2");
  assert.strictEqual(S.phase, "play");
  S = fresh();
  setup(S, "4k3/8/8/8/8/8/3n4/3K4 w - -");
  line(S, "d1d2");
  assert.strictEqual(S.last.why, "material");
  assert.ok(G.deadPosition(G.posFromFen("4k3/8/8/8/8/8/8/4K3 w - -").g));
  assert.ok(G.deadPosition(G.posFromFen("4k3/8/8/8/8/8/8/4KB2 w - -").g));
  assert.ok(G.deadPosition(G.posFromFen("4k3/8/8/8/8/8/8/4KN2 w - -").g));
  assert.ok(G.deadPosition(G.posFromFen("2b1k3/8/8/8/8/8/8/4KB2 w - -").g), "bishops on the same colour");
  assert.ok(!G.deadPosition(G.posFromFen("4kb2/8/8/8/8/8/8/4KB2 w - -").g), "bishops on different colours can mate");
  assert.ok(!G.deadPosition(G.posFromFen("4k3/8/8/8/8/8/P7/4K3 w - -").g));
  assert.ok(!G.deadPosition(G.posFromFen("4k3/8/8/8/8/8/8/3RK3 w - -").g));
});

test("give up, skip, undo against the computer, rematch", () => {
  const S = fresh({}, true);
  const me = white(S);
  assert.strictEqual(G.act(S, me, { t: "undo" }).ok, false, "nothing to take back yet");
  line(S, "e2e4");
  const bot = G.botMove(S, S.cur);
  assert.ok(bot && bot.t === "move");
  assert.ok(G.act(S, S.cur, bot).ok);
  assert.strictEqual(S.cur, me);
  assert.ok(G.view(S, me).canUndo);
  const r = G.act(S, me, { t: "undo" });
  assert.ok(r.ok);
  assert.strictEqual(S.hist.length, 0);
  assert.deepStrictEqual(S.grid, G.startGrid());
  assert.strictEqual(S.castle, 15);
  assert.strictEqual(S.cur, me);
  assert.strictEqual(S.players[me].moves, 0);
  assert.strictEqual(S.lastMove, null);
  line(S, "g1f3");
  G.act(S, S.cur, G.botMove(S, S.cur));
  assert.strictEqual(G.act(S, black(S), { t: "undo" }).ok, false, "not their turn");

  const T = fresh();
  const r2 = G.act(T, 0, { t: "skip" });
  assert.ok(r2.ok);
  assert.ok(r2.events.some((e) => e.t === "skip"));
  assert.strictEqual(T.hist.length, 1);
  assert.strictEqual(G.act(T, T.cur === 0 ? 1 : 0, { t: "giveup" }).ok, true);
  assert.strictEqual(T.last.why, "giveup");
  assert.strictEqual(G.act(T, 0, { t: "move", from: 8, to: 16 }).ok, false);
  assert.ok(G.act(T, 0, { t: "next" }).ok);
});

test("clock: increment, flag fall wins, flag fall against a bare king is a draw", () => {
  const S = fresh({ clock: true });
  const t0 = Date.now();
  G.resetClock(S);
  const w = white(S);
  assert.ok(S.deadline > t0);
  const v = G.view(S, w);
  assert.strictEqual(v.running, w);
  assert.ok(v.times[w] <= G.CLOCK_MS && v.times[w] > G.CLOCK_MS - 2000);
  S.stamp = Date.now() - 10000;
  line(S, "e2e4");
  assert.ok(S.times[w] < G.CLOCK_MS - 6000 && S.times[w] > G.CLOCK_MS - 12000 + G.INC_MS, "10 s used, 3 s back");
  assert.strictEqual(G.tick(S, Date.now()).length, 0);
  const late = S.deadline + 5000;
  const ev = G.tick(S, late);
  assert.strictEqual(ev[0].t, "timeout");
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.why, "timeout");
  assert.deepStrictEqual(S.last.winners, [w]);

  const T = fresh({ clock: true });
  setup(T, "4k3/8/8/8/8/8/8/4K2R b - -");
  G.resetClock(T);
  T.deadline = Date.now() - 5000;
  G.tick(T, Date.now());
  assert.strictEqual(T.last.why, "timeout", "black ran out against a rook");
  const U = fresh({ clock: true });
  setup(U, "4k3/8/8/8/8/8/8/4KB2 b - -");
  G.resetClock(U);
  U.deadline = Date.now() - 5000;
  G.tick(U, Date.now());
  assert.strictEqual(U.last.why, "material", "white cannot mate with a lone bishop");
  assert.ok(G.nextDeadline(fresh({ clock: true })) > 0);
  assert.strictEqual(G.nextDeadline(fresh()), -1);
  // the computer never uses up a clock
  const B = fresh({ clock: true }, true);
  line(B, "e2e4");
  assert.strictEqual(B.deadline, 0);
});

test("rules and settings are normalised", () => {
  assert.deepStrictEqual(G.normRules({ clock: true, free: true, x: 1 }), { clock: true });
  assert.deepStrictEqual(G.normRules(null), { clock: false });
  assert.strictEqual(G.normGoal(7), 1);
  assert.strictEqual(G.normGoal("3"), 3);
  assert.strictEqual(G.normLevel(0), 0);
  assert.strictEqual(G.normLevel(9), 2);
  assert.strictEqual(G.normLevel(""), 2);
});

test("view: captured pieces, notation list, last move, JSON safe", () => {
  const S = fresh();
  line(S, "e2e4 d7d5 e4d5");
  const v = G.view(S, 0);
  assert.deepStrictEqual(v.players[white(S)].taken, [1]);
  assert.deepStrictEqual(v.players[black(S)].taken, []);
  assert.strictEqual(v.lastMove.cap, 1);
  assert.strictEqual(v.lastMove.capSq, sqi("d5"));
  assert.strictEqual(v.lastMove.san, "exd5");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(v)), v);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(S)), S);
  assert.strictEqual(G.view(S, 5).me, -1);
});

// ---------- computer player ----------
test("the computer plays legal moves, finds mate in one, takes a hanging queen", () => {
  for (const level of [1, 2, 3]) {
    const S = fresh({}, true, level);
    S.players[black(S)].bot = false; S.players[white(S)].bot = true; // let it play white
    const m = G.botMove(S, white(S), level);
    assert.ok(G.act(S, white(S), m).ok, `level ${level} start move`);

    const M = fresh({}, true, level);
    setup(M, "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - -");
    M.players[white(M)].bot = true; M.players[black(M)].bot = false;
    const mate = G.botMove(M, white(M), level);
    if (level > 1) assert.deepStrictEqual([mate.from, mate.to], [sqi("a1"), sqi("a8")], `level ${level} mate in one`); // level 1 may blunder on purpose
    else assert.ok(G.act(M, white(M), mate).ok);

    const Qn = fresh({}, true, level);
    setup(Qn, "4k3/8/8/3q4/8/8/8/3RK3 w - -");
    Qn.players[white(Qn)].bot = true; Qn.players[black(Qn)].bot = false;
    if (level > 1) {
      const take = G.botMove(Qn, white(Qn), level);
      assert.deepStrictEqual([take.from, take.to], [sqi("d1"), sqi("d5")], `level ${level} wins the queen`);
    }
  }
});

test("the computer finds a mate in two and avoids a stalemate trap", () => {
  const S = fresh({}, true, 3);
  setup(S, "7k/8/5K2/8/8/8/8/6R1 w - -");
  S.players[white(S)].bot = true; S.players[black(S)].bot = false;
  const first = G.botMove(S, white(S), 3);
  assert.ok(G.act(S, white(S), first).ok);
  const reply = G.view(S, black(S)).legal[0];
  assert.ok(G.act(S, black(S), { t: "move", from: reply.from, to: reply.to }).ok);
  const second = G.botMove(S, white(S), 3);
  assert.ok(G.act(S, white(S), second).ok);
  assert.strictEqual(S.last && S.last.why, "mate");

  const T = fresh({}, true, 3);
  setup(T, "7k/8/6K1/8/8/8/8/6Q1 w - -");
  T.players[white(T)].bot = true; T.players[black(T)].bot = false;
  const m = G.botMove(T, white(T), 3);
  assert.ok(G.act(T, white(T), m).ok);
  assert.notStrictEqual(T.last && T.last.why, "stalemate");
});

test("the computer answers quickly at every level", () => {
  for (const level of [1, 2, 3]) {
    const S = fresh({}, true, level);
    line(S, "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6");
    S.players[white(S)].bot = true;
    const t0 = Date.now();
    const m = G.botMove(S, white(S), level);
    const ms = Date.now() - t0;
    assert.ok(G.act(S, white(S), m).ok);
    assert.ok(ms < 2500, `level ${level} took ${ms} ms`);
  }
});

test("two computers play a whole game to the end without breaking the rules", () => {
  const S = G.newGame([{ name: "A", bot: true }, { name: "B", bot: true }], 1, {}, 1);
  let plies = 0;
  while (S.phase === "play" && plies < 400) {
    const m = G.botMove(S, S.cur);
    const r = G.act(S, S.cur, m);
    assert.ok(r.ok, JSON.stringify(m) + " " + r.error);
    plies++;
    assert.strictEqual(S.grid.filter((v) => (v & 7) === 6).length, 2, "both kings stay");
  }
  assert.ok(S.hist.length === plies);
});

test("the tip is a legal move for whoever is on turn", () => {
  const S = fresh();
  line(S, "e2e4 e7e5");
  const tip = G.suggest(G.view(S, S.cur), S.cur);
  assert.ok(G.act(S, S.cur, tip).ok);
});

test("hostile input is refused without touching the game", () => {
  const S = fresh();
  const before = JSON.stringify(S);
  const bad = [
    null, undefined, 5, "move", [], {}, { t: null }, { t: "constructor" }, { t: "__proto__" }, { t: "toString" }, { t: "buy", id: "constructor" },
    { t: "move" }, { t: "move", from: "e2", to: "e4" }, { t: "move", from: 12, to: 99 }, { t: "move", from: -1, to: 28 }, { t: "move", from: 12.5, to: 28 },
    { t: "move", from: NaN, to: 28 }, { t: "move", from: "12", to: "28" }, { t: "move", from: [12], to: [28] }, { t: "move", from: {}, to: {} },
    { t: "move", from: sqi("e2"), to: sqi("e5") }, { t: "move", from: sqi("e7"), to: sqi("e5") }, { t: "move", from: sqi("e2"), to: sqi("e2") },
    { t: "undo" }, { t: "next" }
  ];
  for (const a of bad) {
    const r = G.act(S, S.cur, a);
    assert.strictEqual(r.ok, false, JSON.stringify(a));
    assert.ok(typeof r.error === "string");
  }
  assert.strictEqual(G.act(S, 1 - S.cur, { t: "move", from: sqi("e7"), to: sqi("e5") }).ok, false);
  for (const pi of [null, undefined, -1, 2, "0", "constructor", "__proto__", 0.5, NaN]) assert.strictEqual(G.act(S, pi, { t: "giveup" }).ok, false, String(pi));
  assert.strictEqual(JSON.stringify(S), before);
});

test("a promotion needs a valid piece", () => {
  const S = fresh();
  setup(S, "8/4P1k1/8/8/8/8/8/4K3 w - -");
  const before = JSON.stringify(S);
  for (const promo of [1, 6, 7, 9, "q", NaN, {}, [5]]) {
    assert.strictEqual(G.act(S, S.cur, { t: "move", from: sqi("e7"), to: sqi("e8"), promo }).ok, false, String(promo));
  }
  assert.strictEqual(JSON.stringify(S), before);
  assert.ok(mv(S, "e7e8n").ok);
  assert.strictEqual(S.grid[sqi("e8")] & 7, 2);
});
