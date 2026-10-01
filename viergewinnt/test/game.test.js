"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

const two = () => [{ name: "Anna", avatar: "🐙" }, { name: "Ben" }];
function game(rules, size) {
  const S = G.newGame(two(), 2, size || 7, rules);
  S.round = 0; S.starter = 0; G.startRound(S); // Anna (red) begins
  return S;
}
const drop = (S, col) => G.act(S, S.cur, { t: "drop", col });
// play a list of columns, alternating players from whoever is on
const play = (S, cols) => cols.map((c) => drop(S, c)).pop();

test("settings are normalised", () => {
  assert.deepStrictEqual(G.normRules({ popout: true, five: "yes", bogus: 1 }), { popout: true, five: false, pie: false, clock: false });
  assert.strictEqual(G.normSize(10), 10);
  assert.strictEqual(G.normSize(9), 7);
  assert.strictEqual(G.normGoal(3), 3);
  assert.strictEqual(G.normLevel(5), 2);
});

test("discs fall to the bottom, full columns are refused, turns alternate", () => {
  const S = game();
  assert.strictEqual(S.cur, 0);
  let r = drop(S, 3);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.events[0], { t: "drop", pi: 0, col: 3, row: 0 });
  assert.strictEqual(S.cur, 1);
  assert.match(G.act(S, 0, { t: "drop", col: 2 }).error, /ist dran/);
  r = drop(S, 3);
  assert.strictEqual(r.events[0].row, 1);
  play(S, [3, 3, 3, 3]);
  assert.match(drop(S, 3).error, /voll/);
  assert.match(drop(S, 9).error, /gibt es nicht/);
});

test("four in a row wins: across, down and both diagonals", () => {
  for (const [name, moves, cells] of [
    ["across", [0, 0, 1, 1, 2, 2, 3], [0, 1, 2, 3]],
    ["down", [0, 1, 0, 1, 0, 1, 0], [0, 7, 14, 21]],
    ["diagonal up", [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3], [0, 8, 16, 24]],
    ["diagonal down", [6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3], [6, 12, 18, 24]]
  ]) {
    const S = game();
    const r = play(S, moves);
    assert.strictEqual(S.phase, "roundEnd", name);
    assert.deepStrictEqual(S.last.winners, [0], name);
    assert.deepStrictEqual([...S.last.cells].sort((a, b) => a - b), cells, name);
    assert.ok(r.events.some((e) => e.t === "end"));
    assert.strictEqual(S.players[0].wins, 1);
  }
});

test("a full board without four is a draw; next round swaps who begins", () => {
  const S = game();
  // fill column pairs so that no line of four forms
  const order = [0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 4, 5, 4, 5, 4, 5, 5, 4, 5, 4, 5, 4, 6, 6, 6, 6, 6, 6];
  for (const c of order) { const r = drop(S, c); assert.ok(r.ok, r.error); if (S.phase !== "play") break; }
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, []);
  assert.strictEqual(S.draws, 1);
  const before = S.starter;
  assert.ok(G.act(S, 0, { t: "next" }).ok);
  assert.strictEqual(S.phase, "play");
  assert.strictEqual(S.cur, before);
  assert.strictEqual(S.round, 2);
});

test("goal: first to two wins ends the game, rematch resets", () => {
  const S = game(null, 7);
  play(S, [0, 1, 0, 1, 0, 1, 0]);
  assert.strictEqual(S.last.over, false);
  G.act(S, 0, { t: "next" });
  const w = S.cur;
  play(S, [0, 1, 0, 1, 0, 1, 0]);
  assert.strictEqual(S.players[w].wins, w === 0 ? 2 : 1);
  if (S.last.over) {
    G.act(S, 0, { t: "next" });
    assert.deepStrictEqual(S.players.map((p) => p.wins), [0, 0]);
    assert.strictEqual(S.round, 1);
  }
});

test("pop out: pull your own disc from the bottom, the column slides down", () => {
  const S = game({ popout: true });
  play(S, [3, 3, 4]); // red 3, yellow 3 (on top), red 4
  assert.match(G.act(S, 1, { t: "pop", col: 4 }).error, /keine eigene/);
  const r = G.act(S, 1, { t: "pop", col: 3 });
  assert.match(r.error, /keine eigene/); // bottom of 3 is red
  G.act(S, 1, { t: "drop", col: 0 });
  const p = G.act(S, 0, { t: "pop", col: 3 });
  assert.ok(p.ok, p.error);
  assert.strictEqual(S.grid[3], 1); // yellow slid down
  assert.strictEqual(S.grid[3 + 7], -1);
  const off = game();
  drop(off, 3); drop(off, 2);
  assert.match(G.act(off, 0, { t: "pop", col: 3 }).error, /aus/);
});

test("pop out that makes four for both: the one who pulled wins", () => {
  const S = game({ popout: true });
  // hand-made position: red row of three above a yellow row of three on row 1/0
  S.grid.fill(-1);
  const set = (c, r, p) => { S.grid[c + r * 7] = p; };
  [[0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 0]].forEach(([c, r, p]) => set(c, r, p)); // bottom: Y Y Y R
  [[0, 1, 0], [1, 1, 0], [2, 1, 0], [3, 1, 1]].forEach(([c, r, p]) => set(c, r, p)); // above:  R R R Y
  set(3, 2, 0);
  S.cur = 0;
  const r = G.act(S, 0, { t: "pop", col: 3 }); // column 3 slides: Y R -> bottom Y makes YYYY, R makes RRRR
  assert.ok(r.ok, r.error);
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [0]);
});

test("five in a row on the big board", () => {
  const S = game({ five: true }, 10);
  play(S, [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.strictEqual(S.phase, "play"); // four is not enough
  drop(S, 4);
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.cells.length, 5);
  assert.strictEqual(G.view(S, 0).need, 5);
});

test("giving up, skipping and the turn clock", () => {
  const S = game({ clock: true });
  assert.ok(S.deadline > Date.now());
  assert.deepStrictEqual(G.tick(S), []);
  const ev = G.tick(S, S.deadline + 5000);
  assert.strictEqual(ev[0].t, "timeout");
  assert.ok(ev.some((e) => e.t === "drop" && e.pi === 0));
  assert.strictEqual(S.cur, 1);
  assert.ok(G.act(S, 0, { t: "skip" }).ok);
  assert.strictEqual(S.cur, 0);
  const r = G.act(S, 1, { t: "giveup" });
  assert.ok(r.events.some((e) => e.t === "giveup"));
  assert.deepStrictEqual(S.last.winners, [0]);
});

test("avatars and views", () => {
  const S = G.newGame([{ name: "A", avatar: "🐙" }, { name: "C", bot: true, avatar: "🐙" }], 1, 8);
  const v = G.view(S, 0);
  assert.deepStrictEqual(v.players.map((p) => p.avatar), ["🐙", "🤖"]);
  assert.strictEqual(v.cols, 8); assert.strictEqual(v.rows, 7);
  assert.strictEqual(v.grid.length, 56);
  assert.strictEqual(G.view(S, -1).me, -1);
});

test("the computer takes a win and blocks one", () => {
  for (const level of [2, 3]) {
    const S = game(null, 7);
    S.level = level;
    play(S, [0, 6, 1, 6, 2]); // red threatens 3; yellow to move must block
    assert.strictEqual(G.botMove(S, S.cur).col, 3, `blocks at level ${level}`);
    const W = game(null, 7);
    W.level = level;
    play(W, [0, 6, 1, 6, 2, 6]); // red to move can win at 3
    assert.strictEqual(G.botMove(W, W.cur).col, 3, `wins at level ${level}`);
  }
  // whole games between computers always end
  for (const size of [7, 8, 10]) for (const level of [1, 2, 3]) {
    const S = G.newGame([{ name: "A", bot: true }, { name: "B", bot: true }], 1, size, { five: size === 10 }, level);
    let k = 0;
    while (S.phase === "play" && k++ < 200) assert.ok(G.act(S, S.cur, G.botMove(S, S.cur)).ok);
    assert.strictEqual(S.phase, "roundEnd");
  }
});

test("pie rule: the second player may take over the first disc, only right then", () => {
  const S = game({ pie: true });
  assert.ok(!G.view(S, 1).canSwap);
  drop(S, 3);
  assert.ok(G.view(S, 1).canSwap);
  assert.ok(!G.view(S, 0).canSwap);
  const r = G.act(S, 1, { t: "swap" });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.events[0], { t: "swap", pi: 1, col: 3, row: 0 });
  assert.strictEqual(S.grid[3], 1);
  assert.strictEqual(S.cur, 0);
  assert.deepStrictEqual(S.players.map((p) => p.moves), [0, 1]);
  assert.ok(!G.act(S, 0, { t: "swap" }).ok);
  const T = game({ pie: true });
  drop(T, 3); drop(T, 4);
  assert.ok(!G.act(T, T.cur, { t: "swap" }).ok);
  const N = game({});
  drop(N, 3);
  assert.ok(!G.act(N, 1, { t: "swap" }).ok);
});

test("undo: only against the computer, takes back the reply too", () => {
  const S = G.newGame([{ name: "Anna" }, { name: "Robo", bot: true }], 1, 7, { popout: true });
  S.round = 0; S.starter = 0; G.startRound(S);
  assert.ok(!G.view(S, 0).canUndo);
  drop(S, 0); drop(S, 1);
  assert.ok(G.view(S, 0).canUndo);
  drop(S, 0); drop(S, 1);
  assert.ok(G.act(S, 0, { t: "pop", col: 0 }).ok);
  drop(S, 2);
  assert.strictEqual(S.grid[0 + 0 * 7], 0);
  const r = G.act(S, 0, { t: "undo" });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.events[0].t, "undo");
  assert.strictEqual(S.cur, 0);
  const at = (c, row) => S.grid[c + row * 7];
  assert.deepStrictEqual([at(0, 0), at(0, 1), at(1, 0), at(1, 1), at(2, 0)], [0, 0, 1, 1, -1]);
  assert.deepStrictEqual(S.players.map((p) => p.moves), [2, 2]);
  const H = game({});
  drop(H, 3);
  assert.ok(!G.act(H, 1, { t: "undo" }).ok);
  assert.ok(!G.act(H, 0, { t: "undo" }).ok);
});

test("tip: takes a win, blocks a threat, takes over a central opening with the pie rule", () => {
  const S = game({});
  play(S, [0, 0, 1, 1, 2]); // red has 0,1,2 on the bottom row, yellow to move
  assert.deepStrictEqual(G.suggest(S, 1), { t: "drop", col: 3 });
  const W = game({});
  play(W, [0, 0, 1, 1, 2, 2]); // red to move and wins in column 3
  assert.deepStrictEqual(G.suggest(W, 0), { t: "drop", col: 3 });
  const P = game({ pie: true });
  drop(P, 3);
  assert.deepStrictEqual(G.suggest(P, 1), { t: "swap" });
  assert.deepStrictEqual(G.suggest(G.view(S, 1), 1), { t: "drop", col: 3 }); // a view works as well
});

test("hostile input is refused without touching the game", () => {
  const S = game({ popout: true });
  const snap = () => JSON.stringify(S);
  const before = snap();
  const cur = S.cur;
  for (const a of [null, undefined, 5, "drop", [], {}, { t: 7 }, { t: "constructor" }, { t: "__proto__" }, { t: "drop" }, { t: "pop" }, { t: "undo" }, { t: "swap" }]) {
    assert.strictEqual(G.act(S, cur, a).ok, false, JSON.stringify(a));
  }
  for (const t of ["drop", "pop"]) {
    for (const col of [-1, 7, 1e9, 0.5, "3", null, undefined, [3], [], {}, NaN, Infinity, "constructor", true, false]) {
      assert.strictEqual(G.act(S, cur, { t, col }).ok, false, `${t} col ${String(col)}`);
    }
    assert.strictEqual(G.act(S, 1 - cur, { t, col: 3 }).ok, false, `${t} out of turn`);
  }
  for (const pi of [-1, 2, 1.5, NaN, null, undefined, "0", "1", "constructor", "__proto__"]) {
    assert.strictEqual(G.act(S, pi, { t: "drop", col: 3 }).ok, false, String(pi));
  }
  assert.strictEqual(snap(), before);
});
