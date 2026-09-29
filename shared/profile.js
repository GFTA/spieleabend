// The player profile, shared by every game and the start page: name, avatar, colour and the
// per-game statistics. It lives in one cookie for .cool-kidz.net (so all game subdomains see
// the same profile) with a localStorage copy as fallback; the newer of the two wins.
(function () {
  "use strict";
  const A = window.SAAvatars;
  const COOKIE = "sa_profile", LS = "spieleabend.profile";
  const DOMAIN = /(^|\.)cool-kidz\.net$/.test(location.hostname) ? "; Domain=.cool-kidz.net" : "";
  const listeners = [];
  const int = (x) => Math.max(0, Math.floor(+x) || 0);

  function clean(p) {
    const o = { v: 1, name: "", av: "", col: "", u: 0, stats: {} };
    if (!p || typeof p !== "object") return o;
    o.name = String(p.name || "").slice(0, 18);
    o.av = A.AVATARS.includes(p.av) ? p.av : "";
    o.col = A.isColor(p.col) ? p.col : "";
    o.u = +p.u || 0;
    const st = p.stats && typeof p.stats === "object" ? p.stats : {};
    for (const g of Object.keys(st)) {
      const s = st[g];
      if (!/^[a-z0-9]{2,20}$/.test(g) || !s || typeof s !== "object") continue;
      // g games, w wins, d draws, cs current win streak, bs best streak, og/ow online games/wins, k last result key, i legacy imported
      o.stats[g] = { g: int(s.g), w: int(s.w), d: int(s.d), cs: int(s.cs), bs: int(s.bs), og: int(s.og), ow: int(s.ow), k: String(s.k || "").slice(0, 40), i: s.i ? 1 : 0 };
    }
    return o;
  }
  function fromCookie() {
    try {
      const c = document.cookie.split("; ").find((x) => x.startsWith(COOKIE + "="));
      return c ? JSON.parse(decodeURIComponent(c.slice(COOKIE.length + 1))) : null;
    } catch (e) { return null; }
  }
  function fromStorage() { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { return null; } }
  function load() {
    const a = clean(fromCookie()), b = clean(fromStorage());
    return b.u > a.u ? b : a;
  }
  function save(p) {
    p.u = Date.now();
    const json = JSON.stringify(p);
    try { localStorage.setItem(LS, json); } catch (e) {}
    try { document.cookie = `${COOKIE}=${encodeURIComponent(json)}; Path=/; Max-Age=157680000; SameSite=Lax${DOMAIN}${location.protocol === "https:" ? "; Secure" : ""}`; } catch (e) {}
    for (const f of listeners) try { f(p); } catch (e) {}
  }
  function update(fn) { const p = load(); fn(p); save(p); return p; }

  window.SAProfile = {
    get: load,
    onChange: (f) => listeners.push(f),
    // patch: any of { name, av, col }; invalid values are ignored
    set(patch) {
      return update((p) => {
        if (patch.name != null) p.name = String(patch.name).slice(0, 18);
        if (patch.av != null && A.AVATARS.includes(patch.av)) p.av = patch.av;
        if (patch.col != null && (patch.col === "" || A.isColor(patch.col))) p.col = patch.col;
      });
    },
    // one finished game (or round, as the game counts it); the same key twice is ignored (page reloads)
    result(game, key, { won, draw, online } = {}) {
      if (!/^[a-z0-9]{2,20}$/.test(game)) return false;
      let counted = false;
      update((p) => {
        const s = p.stats[game] || (p.stats[game] = clean({ stats: { [game]: {} } }).stats[game]);
        key = String(key == null ? "" : key).slice(0, 40);
        if (key && s.k === key) return;
        counted = true;
        s.k = key;
        s.g++;
        if (online) s.og++;
        if (won) { s.w++; s.cs++; s.bs = Math.max(s.bs, s.cs); if (online) s.ow++; }
        else if (draw) s.d++;
        else s.cs = 0;
      });
      return counted;
    },
    // old per-game "Bilanz" of this browser: add {rounds, wins} once
    importLegacy(game, { rounds, wins }) {
      const p0 = load();
      if (!/^[a-z0-9]{2,20}$/.test(game) || (p0.stats[game] && p0.stats[game].i) || !(rounds > 0)) return;
      update((p) => {
        const s = p.stats[game] || (p.stats[game] = clean({ stats: { [game]: {} } }).stats[game]);
        s.g += int(rounds); s.w += Math.min(int(wins), int(rounds)); s.i = 1;
      });
    },
    // one game's statistics, or (without argument) all of them
    reset(game) { return update((p) => { if (game) delete p.stats[game]; else p.stats = {}; }); },
    // name, avatar, colour and statistics
    resetAll() { return update((p) => { p.name = ""; p.av = ""; p.col = ""; p.stats = {}; }); }
  };
})();
