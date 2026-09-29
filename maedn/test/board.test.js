"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { geometry } = require("../public/board.js");

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const near = (a, b) => Math.abs(a - b) < 1e-4;

test("the classic 4-arm board is the familiar 11×11 cross", () => {
  const g = geometry(4);
  assert.deepStrictEqual([g.w, g.h], [11, 11]);
  assert.deepStrictEqual(g.track.slice(0, 12), [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0], [5, 0], [6, 0], [6, 1]]);
  assert.deepStrictEqual(g.goal[0], [[1, 5], [2, 5], [3, 5], [4, 5]]);
  assert.deepStrictEqual(g.goal[1], [[5, 1], [5, 2], [5, 3], [5, 4]]);
  assert.deepStrictEqual(g.goal[2], [[9, 5], [8, 5], [7, 5], [6, 5]]);
  assert.deepStrictEqual(g.goal[3], [[5, 9], [5, 8], [5, 7], [5, 6]]);
  assert.deepStrictEqual(g.yard.map((y) => y[0]), [[0, 0], [9, 0], [9, 9], [0, 9]]);
  assert.deepStrictEqual(geometry(5), g, "anything but 6 or 8 arms is the classic board");
});

for (const arms of [4, 6, 8]) {
  test(`${arms} arms: a closed track of ${arms * 10} fields, one step apart, goal lanes lead from the tips`, () => {
    const g = geometry(arms);
    assert.strictEqual(g.track.length, arms * 10);
    assert.strictEqual(g.goal.length, arms);
    assert.strictEqual(g.yard.length, arms);
    for (let i = 0; i < g.track.length; i++) assert.ok(near(dist(g.track[i], g.track[(i + 1) % g.track.length]), 1), "step " + i);
    for (let s = 0; s < arms; s++) {
      // the field before a start is the tip of the arm; the goal lane starts right behind it
      const tip = g.track[(s * 10 + g.track.length - 1) % g.track.length];
      assert.ok(near(dist(tip, g.goal[s][0]), 1), "goal of seat " + s);
      for (let i = 1; i < 4; i++) assert.ok(near(dist(g.goal[s][i - 1], g.goal[s][i]), 1));
    }
  });

  test(`${arms} arms: no two fields overlap, everything lies on the board, yards hold four pieces`, () => {
    const g = geometry(arms);
    const cells = [];
    g.track.forEach((p, i) => cells.push({ p, n: "track " + i }));
    g.goal.forEach((l, s) => l.forEach((p, i) => cells.push({ p, n: `goal ${s}.${i}` })));
    g.yard.forEach((l, s) => { assert.strictEqual(l.length, 4); l.forEach((p, i) => cells.push({ p, n: `yard ${s}.${i}` })); });
    for (let i = 0; i < cells.length; i++) {
      const [x, y] = cells[i].p;
      assert.ok(x >= -1e-9 && y >= -1e-9 && x + 1 <= g.w + 1e-9 && y + 1 <= g.h + 1e-9, cells[i].n + " is off the board");
      for (let j = i + 1; j < cells.length; j++) {
        // circles of 80% of a field must not overlap (a hair of tolerance at the corners of the 8-arm star)
        assert.ok(dist(cells[i].p, cells[j].p) >= 0.75, `${cells[i].n} and ${cells[j].n} overlap`);
      }
    }
  });
}
