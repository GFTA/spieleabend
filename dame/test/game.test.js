"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

const two = () => [{ name: "Anna", avatar: "🐙" }, { name: "Ben" }];
// square helper: "c3" -> index
const ix = (s) => "abcdefgh".indexOf(s[0]) + (+s[1] - 1) * 8;
function game(rules) {
  const S = G.newGame(two(), 2, rules);
  S.round = 0; S.starter = 0; G.startRound(S); // Anna plays white and begins
  return S;
}
// hand-made position: { c3: "w", d4: "W", e5: "b", f6: "B" } (lower case man, upper case king)
function setup(S, pieces, cur) {
  S.grid.fill(-1);
  const code = { w: 0, W: 1, b: 2, B: 3 };
  for (const [s, p] of Object.entries(pieces)) S.grid[ix(s)] = code[p];
  S.cur = cur == null ? S.col.indexOf(0) : cur;
  S.hist = []; S.keys = []; S.quiet = 0;
  return S;
}
const mv = (S, ...sqs) => G.act(S, S.cur, { t: "move", path: sqs.map(ix) });
const paths = (S, p) => G.legalMoves(S.grid, p, false).map((m) => m.path.map(G.sq).join("-")).sort();

test("settings are normalised", () => {
  assert.deepStrictEqual(G.normRules({ free: true, clock: "yes", bogus: 1 }), { free: true, clock: false });
  assert.strictEqual(G.normGoal(3), 3);
  assert.strictEqual(G.normGoal(9), 1);
  assert.strictEqual(G.normLevel(5), 2);
  assert.strictEqual(G.normLevel(0), 0);
});

test("start position: 12 men each on the dark squares, white begins", () => {
  const S = game();
  assert.deepStrictEqual(G.view(S, 0).players.map((p) => [p.men, p.kings]), [[12, 0], [12, 0]]);
  assert.strictEqual(S.grid[ix("a1")], 0);
  assert.strictEqual(S.grid[ix("b2")], 0);
  assert.strictEqual(S.grid[ix("a2")], -1);
  assert.strictEqual(S.grid[ix("h8")], 2);
  assert.strictEqual(S.col[S.cur], 0);
  assert.strictEqual(G.legalMoves(S.grid, 0, false).length, 7);
});

test("men step diagonally forward only, turns alternate", () => {
  const S = game();
  const r = mv(S, "c3", "d4");
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.events[0].t, "move");
  assert.strictEqual(S.cur, 1);
  assert.match(G.act(S, 0, { t: "move", path: [ix("e3"), ix("f4")] }).error, /ist dran/);
  assert.ok(!mv(S, "b6", "b5").ok);
  assert.ok(!mv(S, "a7", "a8").ok);
  assert.match(mv(S, "d4", "c5").error, /kein eigener/);
  assert.ok(mv(S, "b6", "a5").ok);
});

test("capture is mandatory, and the error says so", () => {
  const S = setup(game(), { c3: "w", d4: "b", h2: "w" });
  assert.deepStrictEqual(paths(S, 0), ["c3-e5"]);
  assert.match(mv(S, "h2", "g3").error, /Schlagzwang/);
  assert.ok(G.view(S, 0).mustCapture);
  assert.ok(mv(S, "c3", "e5").ok);
  assert.strictEqual(S.grid[ix("d4")], -1);
  const free = setup(game({ free: true }), { c3: "w", d4: "b", h2: "w" });
  assert.ok(mv(free, "h2", "g3").ok, "without Schlagzwang a quiet move is fine");
  assert.ok(!G.view(free, 0).mustCapture);
});

test("men capture backwards as well", () => {
  const S = setup(game(), { d4: "w", c3: "b" });
  assert.deepStrictEqual(paths(S, 0), ["d4-b2"]);
});

test("multi-jump: must go on, jumped stones are removed at the end and cannot be jumped twice", () => {
  const S = setup(game(), { a1: "w", b2: "b", d4: "b", f6: "b", h8: "b" });
  assert.deepStrictEqual(paths(S, 0), ["a1-c3-e5-g7"]);
  assert.ok(!mv(S, "a1", "c3").ok, "stopping early is not allowed");
  const r = mv(S, "a1", "c3", "e5", "g7");
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.events[0].caps.map(G.sq), ["b2", "d4", "f6"]);
  assert.deepStrictEqual(S.grid.filter((v) => v === 2).length, 1);
  // a ring of stones: the same stone is never jumped twice
  const R = setup(game(), { a1: "w", b2: "b", b4: "b", d4: "b", d2: "b" }, 0);
  const all = paths(R, 0);
  assert.ok(all.length > 0 && all.every((p) => p.split("-").length <= 5), all.join(" "));
});

test("a man reaching the last row becomes a king and the move ends there", () => {
  const S = setup(game(), { c7: "w", e7: "b", a3: "b" });
  assert.ok(mv(S, "c7", "d8").ok);
  assert.strictEqual(S.grid[ix("d8")], 1);
  assert.strictEqual(S.lastMove.promoted, true);
  // capture onto the last row ends the move even when the new king could go on
  const T = setup(game(), { f6: "w", e7: "b", b6: "b" }, 0);
  assert.deepStrictEqual(paths(T, 0), ["f6-d8"]);
});

test("kings fly, capture from a distance and choose where to land", () => {
  const S = setup(game(), { a1: "W", e5: "b", h8: "b" });
  assert.deepStrictEqual(paths(S, 0), ["a1-f6", "a1-g7"].sort());
  // landing squares from which capturing goes on are mandatory
  const T = setup(game(), { a1: "W", d4: "b", g5: "b" });
  const p = paths(T, 0);
  assert.deepStrictEqual(p, ["a1-f6-h4"]);
  const free = setup(game(), { a1: "W", h8: "w" });
  assert.strictEqual(G.legalMoves(free.grid, 0, false).filter((m) => m.path[0] === ix("a1")).length, 6);
});

test("a king cannot jump over its own stones or two stones in a row", () => {
  const S = setup(game(), { a1: "W", c3: "w", g7: "b", h8: "b" });
  assert.ok(G.legalMoves(S.grid, 0, false).every((m) => m.caps.length === 0));
  const T = setup(game(), { a1: "W", c3: "b", d4: "b" });
  assert.ok(G.legalMoves(T.grid, 0, false).every((m) => m.path[0] !== ix("a1") || m.caps.length === 0 && m.path[1] === ix("b2")));
});

test("no stones, or none that can move, loses; the mover wins the round", () => {
  const S = setup(game(), { c3: "w", d4: "b" });
  const r = mv(S, "c3", "e5");
  assert.ok(r.events.some((e) => e.t === "end" && e.why === "captured"));
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [0]);
  assert.strictEqual(S.players[0].wins, 1);
  const B = setup(game(), { a1: "w", b2: "w", h8: "b", g7: "w", c3: "w" }, 0);
  B.grid[ix("h8")] = 2;
  const q = mv(B, "g7", "f8");
  assert.ok(q.ok, q.error);
});

test("blocked stones lose the round", () => {
  const S = setup(game(), { a8: "b", b7: "w", c6: "w", h1: "w" });
  S.grid[ix("a8")] = 2; // black man on a8 (it moves down)
  S.grid[ix("b7")] = 0; S.grid[ix("c6")] = 0;
  const r = mv(S, "h1", "g2");
  assert.ok(r.ok, r.error);
  assert.ok(r.events.some((e) => e.t === "end"), "black has no move: a8 is blocked by b7, which is protected by c6");
  assert.strictEqual(S.last.why, "blocked");
});

test("goal, giving up and rematch", () => {
  const S = game();
  assert.ok(G.act(S, 1, { t: "giveup" }).ok);
  assert.deepStrictEqual(S.last.winners, [0]);
  assert.strictEqual(S.last.over, false);
  assert.ok(G.act(S, 0, { t: "next" }).ok);
  assert.strictEqual(S.round, 2);
  assert.strictEqual(S.col[S.cur], 0);
  assert.strictEqual(S.cur, 1, "the other player has white in round two");
  G.act(S, 1, { t: "giveup" });
  assert.strictEqual(S.last.over, true);
  assert.deepStrictEqual(S.players.map((p) => p.wins), [2, 0]);
  G.act(S, 0, { t: "next" });
  assert.strictEqual(S.round, 1);
  assert.deepStrictEqual(S.players.map((p) => p.wins), [0, 0]);
});

test("every round has its own id, also after a rematch (confetti and statistics key)", () => {
  const S = game();
  const ids = [G.view(S, 0).rid];
  for (let k = 0; k < 3; k++) { G.act(S, S.cur, { t: "giveup" }); G.act(S, 0, { t: "next" }); ids.push(G.view(S, 0).rid); }
  assert.strictEqual(new Set(ids).size, 4);
});

test("draws: threefold repetition and long quiet phases", () => {
  const S = setup(game(), { a1: "W", h2: "B" });
  S.keys = [`${S.grid.map((v) => v + 1).join("")}0`];
  const cycle = [["a1", "b2"], ["h2", "g1"], ["b2", "a1"], ["g1", "h2"]];
  let r;
  for (let k = 0; k < 8 && S.phase === "play"; k++) r = mv(S, ...cycle[k % 4]);
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.why, "repetition");
  assert.deepStrictEqual(S.last.winners, []);
  assert.strictEqual(S.draws, 1);
  const Q = setup(game(), { a1: "W", h8: "B" });
  Q.quiet = G.QUIET_PLIES - 1;
  Q.keys = [];
  mv(Q, "a1", "c3");
  assert.strictEqual(Q.last.why, "quiet");
});

test("hostile input is refused without touching the game", () => {
  const S = game();
  const before = JSON.stringify(S);
  const bad = [
    null, undefined, 5, "move", [], {}, { t: null }, { t: "constructor" }, { t: "__proto__" }, { t: "toString" },
    { t: "move" }, { t: "move", path: null }, { t: "move", path: "c3d4" }, { t: "move", path: [] }, { t: "move", path: [ix("c3")] },
    { t: "move", path: ["18", "27"] }, { t: "move", path: [18.5, 27] }, { t: "move", path: [-1, 3] }, { t: "move", path: [18, 99] },
    { t: "move", path: { length: 2, 0: 18, 1: 27 } }, { t: "move", path: new Array(50).fill(18) }, { t: "move", path: [NaN, 3] },
    { t: "move", path: [ix("c3"), ix("d4"), ix("e5"), ix("f6")] }, { t: "undo" }, { t: "next" }
  ];
  for (const a of bad) {
    const r = G.act(S, 0, a);
    assert.strictEqual(r.ok, false, JSON.stringify(a));
    assert.ok(typeof r.error === "string");
  }
  for (const pi of [null, undefined, -1, 2, "0", "constructor", "__proto__", 0.5, NaN]) assert.strictEqual(G.act(S, pi, { t: "giveup" }).ok, false, String(pi));
  assert.strictEqual(JSON.stringify(S), before);
});

test("giving up, skipping and the turn clock", () => {
  const S = game({ clock: true });
  assert.ok(S.deadline > Date.now());
  assert.deepStrictEqual(G.tick(S), []);
  const ev = G.tick(S, S.deadline + 5000);
  assert.strictEqual(ev[0].t, "timeout");
  assert.ok(ev.some((e) => e.t === "move" && e.pi === 0));
  assert.strictEqual(S.cur, 1);
  const r = G.act(S, 1, { t: "skip" });
  assert.ok(r.ok);
  assert.ok(r.events.some((e) => e.t === "move" && e.pi === 1));
  assert.strictEqual(S.cur, 0);
});

test("views carry colours, counts and the legal moves of the player on turn", () => {
  const S = G.newGame([{ name: "A", avatar: "🐙" }, { name: "C", bot: true, avatar: "🐙" }], 1);
  const v = G.view(S, 0);
  assert.deepStrictEqual(v.players.map((p) => p.avatar), ["🐙", "🤖"]);
  assert.strictEqual(v.grid.length, 64);
  assert.strictEqual(v.legal.length, 7);
  assert.strictEqual(G.view(S, -1).me, -1);
  assert.deepStrictEqual(v.col.slice().sort(), [0, 1]);
  assert.ok(G.view(S, 0).players.every((p) => p.men === 12));
});

test("undo: only against the computer, takes back the reply too", () => {
  const S = G.newGame([{ name: "Anna" }, { name: "Robo", bot: true }], 1);
  S.round = 0; S.starter = 0; G.startRound(S);
  assert.ok(!G.view(S, 0).canUndo);
  mv(S, "c3", "d4");
  mv(S, ...G.botMove(S, 1).path.map(G.sq));
  assert.ok(G.view(S, 0).canUndo);
  const r = G.act(S, 0, { t: "undo" });
  assert.ok(r.ok);
  assert.strictEqual(r.events[0].t, "undo");
  assert.deepStrictEqual(S.grid, G.startGrid());
  assert.strictEqual(S.cur, 0);
  assert.deepStrictEqual(S.players.map((p) => p.moves), [0, 0]);
  const H = game();
  mv(H, "c3", "d4");
  assert.ok(!G.act(H, 1, { t: "undo" }).ok);
  assert.ok(!G.act(H, 0, { t: "undo" }).ok);
});

test("computers take a capture, avoid hanging a stone and always finish a game", () => {
  for (const level of [1, 2, 3]) {
    const S = game();
    S.level = level;
    setup(S, { c3: "w", d4: "b", f2: "w", g3: "b" }, 0);
    assert.ok(["e5", "h4"].includes(G.sq(G.botMove(S, 0, level).path[1])), "a capture is mandatory");
  }
  for (const level of [0, 1, 2, 3]) for (const rules of [{}, { free: true }]) {
    const S = G.newGame([{ name: "A", bot: true }, { name: "B", bot: true }], 1, rules, level);
    let k = 0;
    while (S.phase === "play" && k++ < 500) { const r = G.act(S, S.cur, G.botMove(S, S.cur)); assert.ok(r.ok, r.error); }
    assert.strictEqual(S.phase, "roundEnd", `level ${level}`);
  }
});

test("the computer is fast even at the strongest level, and tips work on views", () => {
  const S = G.newGame([{ name: "A", bot: true }, { name: "B", bot: true }], 1, {}, 3);
  let worst = 0, k = 0;
  while (S.phase === "play" && k++ < 60) {
    const t = Date.now();
    const m = G.botMove(S, S.cur);
    worst = Math.max(worst, Date.now() - t);
    G.act(S, S.cur, m);
  }
  assert.ok(worst < 1500, `slowest move ${worst} ms`);
  const T = game();
  const tip = G.suggest(G.view(T, 0), 0);
  assert.strictEqual(tip.t, "move");
  assert.ok(G.act(T, 0, tip).ok);
});

test("stronger beats weaker", () => {
  let strong = 0, weak = 0;
  for (let g = 0; g < 8; g++) {
    const S = G.newGame([{ name: "A", bot: true }, { name: "B", bot: true }], 1, {}, 0);
    S.level = 0; S.players[0].lvl = 2; S.players[1].lvl = 1; S.starter = g % 2; G.startRound(S); S.round = 0;
    let k = 0;
    while (S.phase === "play" && k++ < 400) G.act(S, S.cur, G.botMove(S, S.cur));
    if (S.last.winners[0] === 0) strong++; else if (S.last.winners[0] === 1) weak++;
  }
  assert.ok(strong >= 4 && strong > weak, `${strong}:${weak}`);
});
