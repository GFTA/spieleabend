"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const win = {};
win.window = win;
vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "achievements.js"), "utf8"), win);
const list = (ctx) => win.SAAch.list(Object.assign({ stats: {}, games: [{ id: "a" }, { id: "b" }], activity: { streak: 0, play: {} } }, ctx));
const get = (l, id) => l.find((a) => a.id === id);
const st = (o) => Object.assign({ g: 0, w: 0, d: 0, cs: 0, bs: 0, og: 0, ow: 0 }, o);

test("ids are unique and stable, nothing is unlocked for an empty profile", () => {
  const l = list();
  assert.strictEqual(new Set(l.map((a) => a.id)).size, l.length);
  assert.ok(l.length >= 17);
  assert.ok(l.every((a) => !a.ok && a.val === 0 && a.goal > 0));
  assert.ok(["first", "win1", "run3", "days7", "hours5", "all"].every((id) => get(l, id)));
});

test("games, wins and streak unlock the matching achievements", () => {
  const l = list({ stats: { a: st({ g: 12, w: 11, bs: 6 }), b: st({ g: 1, w: 0 }) }, activity: { streak: 3, play: { a: 40 } } });
  for (const id of ["first", "win1", "g10", "win10", "run3", "run6", "days3"]) assert.ok(get(l, id).ok, id);
  for (const id of ["g50", "win25", "days7", "hours5", "explorer"]) assert.ok(!get(l, id).ok, id);
  assert.strictEqual(get(l, "g50").val, 13);
  assert.ok(get(l, "all").ok, "both games played");
});

test("playing time counts in minutes and the value never exceeds the goal", () => {
  const l = list({ activity: { streak: 20, play: { a: 200, b: 400 } } });
  assert.ok(get(l, "hours5").ok);
  assert.strictEqual(get(l, "hours5").val, 300);
  assert.strictEqual(get(l, "days7").val, 7);
});

test("'all games' follows the length of the list and never unlocks without games", () => {
  assert.strictEqual(get(list({ games: [] }), "all").ok, false);
  assert.strictEqual(get(list({ games: [{ id: "a" }, { id: "b" }, { id: "c" }], stats: { a: st({ g: 1 }), b: st({ g: 1 }) } }), "all").goal, 3);
});
