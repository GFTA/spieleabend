"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

const names = (n) => ["Anna", "Ben", "Cem", "Dora", "Emil", "Fritz", "Gina", "Hugo"].slice(0, n).map((name) => ({ name }));
// a fresh game where Anna begins and the dice come from `rig`
function game(n, rules, goal) {
  const S = G.newGame(names(n || 2), goal || 1, rules);
  S.round = 0; S.starter = 0; G.startRound(S);
  S.rig = [];
  return S;
}
const roll = (S, d) => { S.rig.push(d); return G.act(S, S.cur, { t: "roll" }); };
const move = (S, k) => G.act(S, S.cur, { t: "move", k });
// place pieces by hand: pieces[pi] = [rel, rel, rel, rel]
const setup = (S, pieces) => pieces.forEach((p, i) => { if (p) S.players[i].pieces = p.slice(); });

test("settings are normalised, house rules have defaults", () => {
  assert.deepStrictEqual(G.normRules(null), { three: true, hit: false, safeStart: false, freeSix: false, easyOut: false, rush: false, jumpGoal: false, hitAgain: false, goalAgain: false, sixPenalty: false, teams: false, clock: false });
  assert.strictEqual(G.normRules({ three: false, hit: true, bogus: true }).three, false);
  assert.strictEqual(G.normRules({ hit: "yes" }).hit, false);
  assert.strictEqual(G.normGoal(2), 2);
  assert.strictEqual(G.normGoal(7), 1);
  assert.strictEqual(G.normLevel(9), 2);
});

test("seats: two players sit opposite, teams only with four", () => {
  assert.deepStrictEqual(game(2).players.map((p) => p.seat), [0, 2]);
  assert.deepStrictEqual(game(3).players.map((p) => p.seat), [0, 1, 2]);
  assert.strictEqual(game(3, { teams: true }).rules.teams, false);
  assert.strictEqual(game(4, { teams: true }).rules.teams, true);
});

test("big boards: 5-6 players get 60 fields, 7-8 get 80, everybody has an own start and colour", () => {
  assert.strictEqual(G.MAX_PLAYERS, 8);
  assert.strictEqual(G.COLORS.length, 8);
  for (const [n, arms] of [[2, 4], [4, 4], [5, 6], [6, 6], [7, 8], [8, 8]]) {
    const S = game(n);
    assert.strictEqual(S.arms, arms, n + " players");
    assert.strictEqual(S.track, arms * 10);
    assert.strictEqual(G.armsFor(n), arms);
    assert.strictEqual(new Set(S.players.map((p) => p.seat)).size, n);
    assert.ok(S.players.every((p) => p.seat < arms));
    const v = G.view(S, 0);
    assert.strictEqual(v.arms, arms);
    assert.strictEqual(v.track, arms * 10);
  }
  assert.strictEqual(G.newGame(names(8).concat([{ name: "Extra" }]), 1).players.length, 8);
  assert.strictEqual(game(6, { teams: true }).rules.teams, false);
  assert.strictEqual(G.BOT_NAMES.length, 7);
});

test("on a 60-field board a piece walks all the way round before it enters the goal", () => {
  const S = game(6);
  setup(S, [[57, -1, -1, -1], [30, -1, -1, -1]]);
  roll(S, 3);
  assert.deepStrictEqual(G.view(S, 0).moves.map((m) => [m.k, m.from, m.to]), [[0, 57, 60]], "field 60 is the first goal field");
  move(S, 0);
  assert.strictEqual(S.players[0].pieces[0], 60);
  // a piece on the last track field needs exactly 4 to reach the last goal field, 5 is too far
  setup(S, [[59, -1, -1, -1]]);
  S.cur = 0; S.need = "roll"; S.dice = 0;
  roll(S, 4);
  assert.deepStrictEqual(G.view(S, 0).moves.map((m) => m.to), [63]);
  const T = game(6);
  setup(T, [[59, -1, -1, -1]]);
  roll(T, 5);
  assert.deepStrictEqual(G.view(T, 0).moves, []);
});

test("on the 80-field board seats are 10 fields apart and hits find the piece on the other arm", () => {
  const S = game(8);
  // seat 7 stands on rel 5 = field 75; seat 0 reaches field 75 from rel 71 with a 4
  setup(S, [[71, -1, -1, -1], null, null, null, null, null, null, [5, -1, -1, -1]]);
  roll(S, 4);
  const m = G.view(S, 0).moves;
  assert.strictEqual(m.length, 1);
  assert.deepStrictEqual(m[0].hit, { pi: 7, k: 0 });
  move(S, 0);
  assert.strictEqual(S.players[7].pieces[0], -1, "sent back to the yard");
  // the wrap-around: seat 7's rel 9 is field 79, seat 0's next field is 0
  const T = game(8);
  setup(T, [[-1, -1, -1, -1], null, null, null, null, null, null, [9, -1, -1, -1]]);
  T.cur = 7; T.need = "roll"; T.dice = 0;
  roll(T, 2);
  assert.strictEqual(G.view(T, 7).moves[0].to, 11);
  T.players[0].pieces[0] = 1; // field 1 = seat 7's rel 11
  assert.deepStrictEqual(G.view(T, 7).moves[0].hit, { pi: 0, k: 0 });
});

test("a 6 brings a piece out, then roll again; no 6 means three tries", () => {
  const S = game(2);
  assert.strictEqual(S.need, "roll");
  roll(S, 3);
  assert.strictEqual(S.cur, 0, "still Anna: nothing on the board, second try");
  assert.strictEqual(S.tries, 1);
  roll(S, 2);
  roll(S, 4);
  assert.strictEqual(S.cur, 1, "three misses, Ben is on");
  roll(S, 6);
  assert.strictEqual(S.need, "move");
  assert.deepStrictEqual(G.legalMoves(S, 1, 6).map((m) => [m.from, m.to]), [[-1, 0]], "one move for all yard pieces");
  assert.ok(move(S, 0).ok);
  assert.strictEqual(S.players[1].pieces[0], 0);
  assert.strictEqual(S.cur, 1);
  assert.strictEqual(S.need, "roll");
  // with the start field taken the next move has to clear it
  roll(S, 6);
  assert.deepStrictEqual(G.legalMoves(S, 1, 6).map((m) => m.from), [0]);
  move(S, 0);
  assert.strictEqual(S.players[1].pieces[0], 6);
  roll(S, 2);
  move(S, 0);
  assert.strictEqual(S.cur, 0);
  assert.match(move(S, 0).error, /würfeln/);
  assert.match(G.act(S, 1, { t: "roll" }).error, /ist dran/);
});

test("without the three-tries rule one miss ends the turn", () => {
  const S = game(2, { three: false });
  roll(S, 2);
  assert.strictEqual(S.cur, 1);
});

test("hitting sends a piece home; own pieces block; jumping over is fine", () => {
  const S = game(2);
  // Anna (seat 0) on field 5, Ben (seat 2) 20 fields further round: his rel 25 is Anna's field 5
  setup(S, [[5, 8, -1, -1], [25, 41, 42, 43]]);
  roll(S, 3);
  assert.strictEqual(G.legalMoves(S, 0, 3).find((m) => m.k === 0), undefined, "5 + 3 lands on Anna's own piece");
  move(S, 1);
  assert.strictEqual(S.players[0].pieces[1], 11, "8 jumps over nothing and moves on");
  // Ben: 25 + 6 = 31 -> Anna's field 11
  roll(S, 6);
  const r = move(S, 0);
  assert.ok(r.events.some((e) => e.t === "hit" && e.victim === 0));
  assert.strictEqual(S.players[0].pieces[1], -1);
  assert.strictEqual(S.players[1].hits, 1);
  assert.strictEqual(S.players[0].lost, 1);
});

test("goal lane: exact count, no jumping over own pieces unless allowed", () => {
  const S = game(2);
  setup(S, [[38, 41, 43, -1]]);
  roll(S, 3); // 38 + 3 = 41 is taken, 38 + 3 can't go past 41 either
  assert.strictEqual(G.legalMoves(S, 0, 3).length, 0);
  const J = game(2, { jumpGoal: true });
  setup(J, [[38, 41, 43, -1]]);
  assert.deepStrictEqual(G.legalMoves(J, 0, 4).map((m) => m.to), [42], "jumps over 41 into 42");
  assert.deepStrictEqual(G.legalMoves(S, 0, 4).map((m) => m.to), [], "blocked by 41 without the rule");
  assert.deepStrictEqual(G.legalMoves(S, 0, 1).map((m) => [m.k, m.to]), [[0, 39], [1, 42]]);
  assert.deepStrictEqual(G.legalMoves(S, 0, 6).map((m) => m.from), [-1], "43 is the end of the lane, only coming out is left");
});

test("finishing wins the game, or plays on for places", () => {
  const S = game(3);
  setup(S, [[43, 42, 41, 39]]);
  roll(S, 1);
  const r = move(S, 3);
  assert.ok(r.events.some((e) => e.t === "finish" && e.place === 1));
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [0]);
  assert.strictEqual(S.last.places[0], 0);
  assert.strictEqual(S.players[0].wins, 1);

  const P = game(3, null, 2);
  setup(P, [[43, 42, 41, 39]]);
  roll(P, 1); move(P, 3);
  assert.strictEqual(P.phase, "play");
  assert.strictEqual(P.cur, 1, "Anna is done, the others play on");
  setup(P, [null, [43, 42, 41, 38]]);
  roll(P, 2); move(P, 3);
  assert.strictEqual(P.phase, "roundEnd", "only one left");
  assert.deepStrictEqual(P.last.places, [0, 1, 2]);
  assert.ok(G.act(P, 0, { t: "next" }).ok);
  assert.strictEqual(P.round, 2);
  assert.deepStrictEqual(P.players.map((p) => p.wins), [1, 0, 0]);
});

test("house rules: hit duty, safe start, free six, out with 1, quick start", () => {
  const H = game(2, { hit: true });
  setup(H, [[5, 10, -1, -1], [27, -1, -1, -1]]); // Ben at 27 = Anna's 7
  assert.deepStrictEqual(G.legalMoves(H, 0, 2).map((m) => m.k), [0], "must hit");
  const N = game(2);
  setup(N, [[5, 10, -1, -1], [27, -1, -1, -1]]);
  assert.strictEqual(G.legalMoves(N, 0, 2).length, 2);

  const safe = game(2, { safeStart: true });
  setup(safe, [[17, -1, -1, -1], [0, -1, -1, -1]]); // Ben on his start = Anna's 20
  assert.strictEqual(G.legalMoves(safe, 0, 3).length, 0);
  const unsafe = game(2);
  setup(unsafe, [[17, -1, -1, -1], [0, -1, -1, -1]]);
  assert.ok(G.legalMoves(unsafe, 0, 3)[0].hit);

  const free = game(2, { freeSix: true });
  setup(free, [[10, -1, -1, -1]]);
  assert.deepStrictEqual(G.legalMoves(free, 0, 6).map((m) => m.from).sort(), [-1, 10]);
  const must = game(2);
  setup(must, [[10, -1, -1, -1]]);
  assert.deepStrictEqual(G.legalMoves(must, 0, 6).map((m) => m.from), [-1]);

  const one = game(2, { easyOut: true });
  assert.deepStrictEqual(G.legalMoves(one, 0, 1).map((m) => m.from), [-1]);
  assert.deepStrictEqual(game(2).players[0].pieces, [-1, -1, -1, -1]);
  assert.deepStrictEqual(game(2, { rush: true }).players[1].pieces, [0, -1, -1, -1]);
});

test("house rules: extra roll after a hit, the third six is lost", () => {
  const S = game(2, { hitAgain: true });
  setup(S, [[5, -1, -1, -1], [27, -1, -1, -1]]);
  roll(S, 2); move(S, 0);
  assert.strictEqual(S.cur, 0, "hit, roll again");
  const P = game(2, { sixPenalty: true });
  setup(P, [[5, 20, -1, -1]]);
  P.rules.freeSix = true;
  roll(P, 6); move(P, 0);
  roll(P, 6); move(P, 0);
  const r = roll(P, 6);
  assert.ok(r.events.some((e) => e.t === "penalty"));
  assert.strictEqual(P.cur, 1);
});

test("house rule goalAgain: bringing a piece home earns another roll", () => {
  const S = game(2, { goalAgain: true });
  setup(S, [[39, -1, -1, -1], [27, -1, -1, -1]]);
  roll(S, 1); move(S, 0);
  assert.strictEqual(S.cur, 0, "home, roll again");
  const N = game(2);
  setup(N, [[39, -1, -1, -1], [27, -1, -1, -1]]);
  roll(N, 1); move(N, 0);
  assert.strictEqual(N.cur, 1, "without the rule the turn passes");
});

test("view: moves carry their risk and a tip names the best one", () => {
  const S = game(2);
  setup(S, [[5, 20, -1, -1], [12, -1, -1, -1]]);
  S.need = "move"; S.dice = 3;
  const v = G.view(S, 0);
  assert.ok(v.moves.length >= 2);
  for (const m of v.moves) assert.strictEqual(typeof m.risk, "number");
  assert.ok(v.moves.some((m) => m.k === v.tip), "the tip is a legal move");
  assert.strictEqual(G.suggest(S, 0), v.tip);
  const R = game(2);
  assert.strictEqual(G.view(R, 0).tip, null, "no tip before the roll");
});

test("teams: partners never hit each other, a finished player moves the partner's pieces", () => {
  const S = game(4, { teams: true });
  // Anna (seat 0) and Cem (seat 2) are a team; Cem at rel 27 = Anna's field 7
  setup(S, [[5, -1, -1, -1], null, [27, -1, -1, -1]]);
  assert.strictEqual(G.legalMoves(S, 0, 2).length, 0);
  // Anna done, her turn moves Cem
  setup(S, [[40, 41, 42, 43], null, [3, -1, -1, -1]]);
  S.players[0].done = true; S.places = [0];
  assert.deepStrictEqual(G.legalMoves(S, 0, 2).map((m) => m.to), [5]);
  roll(S, 2); move(S, 0);
  assert.strictEqual(S.players[2].pieces[0], 5);
  // team wins once both are home
  S.cur = 2; S.need = "roll";
  setup(S, [null, null, [43, 42, 41, 38]]);
  roll(S, 2); move(S, 3);
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [0, 2]);
});

test("giving up, skipping and the turn clock", () => {
  const S = game(3, { clock: true });
  assert.ok(S.deadline > Date.now());
  assert.deepStrictEqual(G.tick(S), []);
  S.rig.push(6);
  const ev = G.tick(S, S.deadline + 5000);
  assert.strictEqual(ev[0].t, "timeout");
  assert.ok(ev.some((e) => e.t === "roll"));
  assert.strictEqual(S.need, "move");
  const ev2 = G.tick(S, S.deadline + 5000);
  assert.ok(ev2.some((e) => e.t === "move"), "the game also moves for a sleeper");
  assert.ok(G.act(S, 0, { t: "skip" }).ok);
  assert.strictEqual(S.cur, 1);
  G.act(S, 1, { t: "giveup" });
  assert.strictEqual(S.cur, 2);
  assert.deepStrictEqual(S.players[1].pieces, [-2, -2, -2, -2]);
  G.act(S, 2, { t: "giveup" });
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [0]);
});

test("avatars and views", () => {
  const S = G.newGame([{ name: "A", avatar: "🐙" }, { name: "C", bot: true, avatar: "🐙" }], 1);
  const v = G.view(S, 0);
  assert.deepStrictEqual(v.players.map((p) => p.avatar), ["🐙", "🤖"]);
  assert.deepStrictEqual(v.players.map((p) => p.seat), [0, 2]);
  assert.strictEqual(v.need, "roll");
  assert.strictEqual(G.view(S, -1).me, -1);
});

test("the computer prefers hitting and coming out; games between computers always end", () => {
  const S = game(2);
  setup(S, [[5, 10, -1, -1], [27, -1, -1, -1]]);
  S.level = 3; roll(S, 2);
  assert.deepStrictEqual(G.botMove(S, 0), { t: "move", k: 0 });
  for (const n of [2, 3, 4, 5, 6, 7, 8]) for (const level of [1, 2, 3]) for (const rules of [null, { hit: true, teams: true, rush: true }]) {
    const B = G.newGame(names(n).map((p) => ({ ...p, bot: true })), 2, rules, level);
    let k = 0;
    while (B.phase === "play" && k++ < 400000) assert.ok(G.act(B, B.cur, G.botMove(B, B.cur)).ok);
    assert.strictEqual(B.phase, "roundEnd");
  }
});
