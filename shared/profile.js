// The player profile, shared by every game and the start page: name, avatar, colour, the
// settings that should follow the player into every game (table design, sound, volume,
// less motion, high contrast, turn notifications) and the per-game statistics. It lives in one
// cookie for .cool-kidz.net (so all game subdomains see the same profile) with a localStorage
// copy as fallback; the newer of the two wins.
(function () {
  "use strict";
  const A = window.SAAvatars;
  const COOKIE = "sa_profile", LS = "spieleabend.profile";
  const DOMAIN = /(^|\.)cool-kidz\.net$/.test(location.hostname) ? "; Domain=.cool-kidz.net" : "";
  const listeners = [];
  const int = (x) => Math.max(0, Math.floor(+x) || 0);

  // settings that travel with the player: table design, sound on/off, volume 0-100, less motion,
  // high contrast, turn notifications. A key that is missing means "not chosen yet".
  function cleanPrefs(x) {
    const o = {};
    if (!x || typeof x !== "object") return o;
    if (typeof x.table === "string" && /^[a-z]{2,12}$/.test(x.table)) o.table = x.table;
    if (typeof x.sound === "boolean") o.sound = x.sound;
    if (x.vol != null && Number.isFinite(+x.vol)) o.vol = Math.min(100, Math.max(0, Math.round(+x.vol)));
    if (typeof x.motion === "boolean") o.motion = x.motion;
    if (typeof x.contrast === "boolean") o.contrast = x.contrast;
    if (typeof x.notify === "boolean") o.notify = x.notify;
    return o;
  }

  function clean(p) {
    const o = { v: 1, name: "", av: "", col: "", u: 0, pf: {}, stats: {} };
    if (!p || typeof p !== "object") return o;
    o.pf = cleanPrefs(p.pf);
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
    const a = clean(fromCookie()), b = clean(fromStorage()), win = b.u > a.u ? b : a, other = win === a ? b : a;
    // a cookie that had to drop the result keys to fit: take them back from the copy of the same state
    if (other.u === win.u) for (const g of Object.keys(win.stats)) if (!win.stats[g].k && other.stats[g] && other.stats[g].g === win.stats[g].g) win.stats[g].k = other.stats[g].k;
    return win;
  }
  function save(p) {
    p.u = Date.now();
    const json = JSON.stringify(p);
    try { localStorage.setItem(LS, json); } catch (e) {}
    // a cookie holds about 4 KB: with many games played, leave the result keys and the zeros out of it (clean() fills them in, the localStorage copy keeps the keys)
    let enc = encodeURIComponent(json);
    if (enc.length > 3600) {
      const slim = JSON.parse(json);
      for (const g of Object.keys(slim.stats)) slim.stats[g] = Object.fromEntries(Object.entries(slim.stats[g]).filter(([k, v]) => k !== "k" && v));
      enc = encodeURIComponent(JSON.stringify(slim));
    }
    try { document.cookie = `${COOKIE}=${enc}; Path=/; Max-Age=157680000; SameSite=Lax${DOMAIN}${location.protocol === "https:" ? "; Secure" : ""}`; } catch (e) {}
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
    // the settings that follow the player (see cleanPrefs): only what was chosen
    prefs() { return Object.assign({}, load().pf); },
    // patch: any of { table, sound, vol, motion, contrast, notify }; invalid values are ignored, null forgets a choice
    setPrefs(patch) {
      return update((p) => {
        const ok = cleanPrefs(patch), next = Object.assign({}, p.pf);
        for (const k of Object.keys(patch || {})) { if (patch[k] === null) delete next[k]; else if (k in ok) next[k] = ok[k]; }
        p.pf = cleanPrefs(next);
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
    // name, avatar, colour, settings and statistics
    resetAll() { return update((p) => { p.name = ""; p.av = ""; p.col = ""; p.pf = {}; p.stats = {}; }); }
  };
})();
