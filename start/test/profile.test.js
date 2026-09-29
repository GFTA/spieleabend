"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const pub = path.join(__dirname, "..", "public"), shared = path.join(__dirname, "..", "..", "shared");

test("the start page's copies of avatars.js and profile.js match shared/", () => {
  for (const f of ["avatars.js", "profile.js"]) {
    assert.strictEqual(fs.readFileSync(path.join(pub, f), "utf8"), fs.readFileSync(path.join(shared, f), "utf8"), `${f}: cp shared/${f} start/public/`);
  }
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
