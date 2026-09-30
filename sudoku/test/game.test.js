"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Game = require("../public/game.js");

const pair = (level = 2) => Game.newGame([{ name: "Anna" }, { name: "Ben" }], 1, level);

test("a new game shares one puzzle and private grids", () => {
  const S = pair(1);
  assert.strictEqual(S.phase, "play");
  assert.strictEqual(S.puzzle.length, 81);
  assert.strictEqual(S.solution.length, 81);
  assert.ok(S.puzzle.every((n, i) => !n || n === S.solution[i]));
  assert.deepStrictEqual(S.players[0].grid, S.puzzle);
  assert.deepStrictEqual(S.players[1].grid, S.puzzle);
  assert.ok(Game.AVATARS.includes(S.players[0].avatar));
});

test("settings are normalised", () => {
  assert.strictEqual(Game.normGoal(9), 1);
  assert.strictEqual(Game.normGoal(2), 2);
  assert.strictEqual(Game.normLevel(3), 3);
  assert.strictEqual(Game.normLevel("x"), 2);
});

test("generated puzzles have a unique solution", () => {
  for (const level of [1, 2, 3]) {
    const { puzzle, solution } = Game.generate(level);
    assert.ok(puzzle.filter(Boolean).length >= 20);
    assert.ok(puzzle.every((n, i) => !n || n === solution[i]));
    // fill the puzzle and ensure it matches the recorded solution
    const board = puzzle.slice();
    for (let i = 0; i < 81; i++) if (!board[i]) board[i] = solution[i];
    assert.deepStrictEqual(board, solution);
  }
});

test("players may fill at the same time; view hides the other grid", () => {
  const S = pair(1);
  const empty = S.puzzle.findIndex((n) => !n);
  assert.ok(empty >= 0);
  assert.ok(Game.act(S, 0, { t: "set", i: empty, n: S.solution[empty] }).ok);
  assert.ok(Game.act(S, 1, { t: "set", i: empty, n: S.solution[empty] }).ok);
  const v0 = Game.view(S, 0), v1 = Game.view(S, 1);
  assert.ok(v0.players[0].grid);
  assert.strictEqual(v0.players[1].grid, null);
  assert.ok(v1.players[1].grid);
  assert.strictEqual(v1.players[0].grid, null);
  assert.strictEqual(Game.view(S, -1).players[0].grid, null);
});

test("wrong submit counts a mistake; correct finish wins", () => {
  const S = pair(1);
  // fill Anna almost correctly but one wrong empty cell
  for (let i = 0; i < 81; i++) if (!S.puzzle[i]) S.players[0].grid[i] = S.solution[i];
  const empty = S.puzzle.findIndex((n) => !n);
  S.players[0].grid[empty] = S.solution[empty] === 9 ? 1 : 9;
  S.players[0].filled = Game.CELLS - S.puzzle.filter(Boolean).length;
  const bad = Game.act(S, 0, { t: "submit" });
  assert.ok(bad.ok);
  assert.strictEqual(S.players[0].mistakes, 1);
  assert.strictEqual(S.phase, "play");
  S.players[0].grid[empty] = S.solution[empty];
  const good = Game.act(S, 0, { t: "submit" });
  assert.ok(good.ok);
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [0]);
  assert.strictEqual(S.players[0].wins, 1);
});

test("filling the last correct cell finishes without an explicit submit", () => {
  const S = Game.newGame([{ name: "Solo", bot: false }], 1, 1);
  const empties = S.puzzle.map((n, i) => (n ? -1 : i)).filter((i) => i >= 0);
  for (let k = 0; k < empties.length - 1; k++) {
    const i = empties[k];
    assert.ok(Game.act(S, 0, { t: "set", i, n: S.solution[i] }).ok);
  }
  assert.strictEqual(S.phase, "play");
  const last = empties[empties.length - 1];
  assert.ok(Game.act(S, 0, { t: "set", i: last, n: S.solution[last] }).ok);
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [0]);
});

test("notes toggle a bit and clear when a digit is set", () => {
  const S = pair(1);
  const i = S.puzzle.findIndex((n) => !n);
  assert.ok(Game.act(S, 0, { t: "note", i, n: 5 }).ok);
  assert.ok(S.players[0].notes[i] & (1 << 4));
  assert.ok(Game.act(S, 0, { t: "set", i, n: S.solution[i] }).ok);
  assert.strictEqual(S.players[0].notes[i], 0);
});

test("the computer always makes a legal move and finishes a race", () => {
  for (const level of [1, 2, 3]) {
    const S = Game.newGame([{ name: "R1", bot: true }, { name: "R2", bot: true }], 1, level);
    let guard = 0;
    while (S.phase === "play" && guard++ < 500) {
      const bots = S.players.map((p, i) => i).filter((i) => !S.players[i].done && !S.players[i].out);
      const pi = bots[0];
      const a = Game.botMove(S, pi);
      assert.ok(a, `no move at step ${guard}`);
      assert.ok(Game.act(S, pi, a).ok);
    }
    assert.strictEqual(S.phase, "roundEnd");
    assert.ok(S.last.winners.length === 1);
  }
});

test("giving up with nobody left ends the round without a winner", () => {
  const S = pair(1);
  Game.act(S, 0, { t: "giveup" });
  Game.act(S, 1, { t: "giveup" });
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, []);
});

test("every generated puzzle has exactly one solution, and drawing one is fast", () => {
  const t0 = Date.now();
  for (const level of [1, 2, 3]) {
    for (let k = 0; k < 10; k++) {
      const { puzzle, solution } = Game.generate(level);
      assert.strictEqual(Game.countSolutions(puzzle, 2), 1);
      // the clue count is a target: a puzzle that cannot lose another digit and stay unique stops a little above it
      const clues = puzzle.filter(Boolean).length;
      assert.ok(clues >= Game.CLUES[level] && clues <= Game.CLUES[level] + 4, `level ${level} gave ${clues} clues`);
      // the stored solution is a valid grid: every row, column and box holds 1-9 once
      for (let g = 0; g < 9; g++) {
        const row = new Set(), col = new Set(), box = new Set();
        for (let k2 = 0; k2 < 9; k2++) {
          row.add(solution[g * 9 + k2]); col.add(solution[k2 * 9 + g]);
          box.add(solution[((g / 3 | 0) * 3 + (k2 / 3 | 0)) * 9 + (g % 3) * 3 + (k2 % 3)]);
        }
        assert.ok(row.size === 9 && col.size === 9 && box.size === 9);
      }
    }
  }
  // the generator runs on the server's only thread: 30 puzzles must not take seconds
  assert.ok(Date.now() - t0 < 4000, `30 puzzles took ${Date.now() - t0} ms`);
});

test("a computer needs minutes for a puzzle, and each one keeps its own pace", () => {
  const solo = Game.newGame([{ name: "Me" }, { name: "R1", bot: true }], 1, 2);
  const duo = Game.newGame([{ name: "Me" }, { name: "R1", bot: true }, { name: "R2", bot: true }], 1, 2);
  const mean = (S) => { let sum = 0; for (let k = 0; k < 400; k++) sum += Game.botPlan(S).delay; return sum / 400; };
  const empty = solo.puzzle.filter((n) => !n).length;
  const total = mean(solo) * empty;
  assert.ok(total > 8 * 60000 && total < 16 * 60000, `one computer would need ${Math.round(total / 1000)} s`);
  assert.ok(Math.abs(mean(duo) * 2 - mean(solo)) < mean(solo) * 0.15, "two computers share the pause");
  const plan = Game.botPlan(duo);
  assert.ok(duo.players[plan.pi].bot);
  Game.act(duo, plan.pi, Game.botMove(duo, plan.pi));
  assert.notStrictEqual(Game.botPlan(duo).pi, plan.pi, "the slower computer moves next");
  assert.strictEqual(Game.botPlan(Game.newGame([{ name: "Me" }], 1, 1)), null, "nobody to plan when playing alone");
});

test("playing alone without any computer works start to finish", () => {
  const S = Game.newGame([{ name: "Solo" }], 2, 1);
  for (let round = 1; round <= 2; round++) {
    assert.strictEqual(S.phase, "play");
    S.puzzle.forEach((n, i) => { if (!n) Game.act(S, 0, { t: "set", i, n: S.solution[i] }); });
    assert.strictEqual(S.phase, "roundEnd");
    assert.strictEqual(Game.view(S, 0).last.over, round === 2);
    if (round === 1) assert.ok(Game.act(S, 0, { t: "next" }).ok);
  }
});
