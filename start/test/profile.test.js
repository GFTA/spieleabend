"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const pub = path.join(__dirname, "..", "public"), shared = path.join(__dirname, "..", "..", "shared");

test("avatars.js and profile.js have one source: shared/, not a copy in public/", () => {
  for (const f of ["avatars.js", "profile.js"]) assert.ok(!fs.existsSync(path.join(pub, f)), `start/public/${f} must not exist; the server serves shared/${f}`);
});

// profile.js in a fake browser: cookie jar + localStorage
function browser(host = "vier.cool-kidz.net", cookies = {}) {
  const ls = {};
  const win = {
    location: { hostname: host, protocol: "https:" },
    localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } },
    document: {
      get cookie() { return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "); },
      set cookie(s) { const [kv] = s.split(";"); const i = kv.indexOf("="); cookies[kv.slice(0, i)] = kv.slice(i + 1); win.lastCookie = s; }
    }
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(shared, "avatars.js"), "utf8"), win);
  vm.runInContext("window.SAAvatars = SAAvatars;", win);
  vm.runInContext(fs.readFileSync(path.join(shared, "profile.js"), "utf8"), win);
  return { P: vm.runInContext("SAProfile", win), win, cookies, ls };
}

test("profile: cookie on the shared domain, name/avatar/colour validated", () => {
  const { P, win } = browser();
  P.set({ name: "  Anna  ".trim(), av: "🦊", col: "#e0393e" });
  assert.match(win.lastCookie, /Domain=\.cool-kidz\.net/);
  assert.match(win.lastCookie, /Secure/);
  P.set({ av: "not-an-avatar", col: "red" });
  const p = P.get();
  assert.deepStrictEqual([p.name, p.av, p.col], ["Anna", "🦊", "#e0393e"]);
  assert.strictEqual(P.set({ col: "" }).col, "");
});

test("profile: another game (same cookie) sees the profile; stale storage does not override a newer cookie", () => {
  const a = browser();
  a.P.set({ name: "Ben", av: "🐼" });
  const b = browser("uno.cool-kidz.net", a.cookies);
  assert.strictEqual(b.P.get().name, "Ben");
  b.P.set({ name: "Bernd" });
  assert.strictEqual(a.P.get().name, "Bernd");
});

test("profile: results, streaks, duplicate keys, reset", () => {
  const { P } = browser("192.168.1.5");
  assert.ok(P.result("uno", "k1", { won: true, online: true }));
  assert.ok(!P.result("uno", "k1", { won: true }), "the same key counts once");
  P.result("uno", "k2", { won: true });
  P.result("uno", "k3", { won: false });
  P.result("uno", "k4", { draw: true });
  P.result("uno", "k5", { won: true });
  P.result("kniffel", "x", { won: false });
  let s = P.get().stats;
  assert.deepStrictEqual([s.uno.g, s.uno.w, s.uno.d, s.uno.bs, s.uno.cs, s.uno.og, s.uno.ow], [5, 3, 1, 2, 1, 1, 1]);
  assert.strictEqual(s.kniffel.g, 1);
  P.reset("uno");
  assert.ok(!P.get().stats.uno && P.get().stats.kniffel);
  P.set({ name: "Cleo" });
  P.reset();
  assert.strictEqual(Object.keys(P.get().stats).length, 0);
  assert.strictEqual(P.get().name, "Cleo");
  P.resetAll();
  assert.strictEqual(P.get().name, "");
});

test("profile: old per-game Bilanz is imported once", () => {
  const { P } = browser();
  P.importLegacy("hangman", { rounds: 10, wins: 4 });
  P.importLegacy("hangman", { rounds: 10, wins: 4 });
  assert.deepStrictEqual([P.get().stats.hangman.g, P.get().stats.hangman.w], [10, 4]);
});

const plain = (x) => JSON.parse(JSON.stringify(x)); // objects from the vm context have another prototype
test("profile: settings that follow the player are validated, can be forgotten and travel with the cookie", () => {
  const a = browser();
  assert.deepStrictEqual(plain(a.P.prefs()), {});
  a.P.setPrefs({ table: "felt", sound: false, vol: 140, motion: false, contrast: true, notify: true, hack: 1 });
  assert.deepStrictEqual(plain(a.P.prefs()), { table: "felt", sound: false, vol: 100, motion: false, contrast: true, notify: true });
  a.P.setPrefs({ table: "NOT A TABLE!", vol: "loud", sound: "yes", contrast: null });
  assert.deepStrictEqual(plain(a.P.prefs()), { table: "felt", sound: false, vol: 100, motion: false, notify: true }, "invalid values are ignored, null forgets");
  const b = browser("uno.cool-kidz.net", a.cookies);
  assert.strictEqual(b.P.prefs().table, "felt");
  a.P.set({ name: "Ben" });
  assert.strictEqual(a.P.prefs().vol, 100, "other profile changes keep the settings");
  a.P.resetAll();
  assert.deepStrictEqual(plain(a.P.prefs()), {});
});

test("profile: with many games the cookie stays small and the result keys survive in localStorage", () => {
  const { P, win, cookies } = browser();
  for (let i = 0; i < 22; i++) P.result("game" + String(i).padStart(2, "0"), "k".repeat(30) + i, { won: i % 2 === 0, online: true });
  assert.ok(win.lastCookie.length < 3000, `cookie is ${win.lastCookie.length} bytes`);
  assert.strictEqual(P.get().stats.game05.k, "k".repeat(30) + 5, "the key is still known, a reload does not count the round twice");
  assert.strictEqual(P.result("game05", "k".repeat(30) + 5, { won: false }), false);
  assert.ok(Object.keys(cookies).length === 1);
});
