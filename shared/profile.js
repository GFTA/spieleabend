// The player profile, shared by every game and the start page: name, avatar, colour, the
// settings that should follow the player into every game (table design, sound, volume,
// less motion, high contrast, vibration, notifications) and the per-game statistics. It lives in one
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
  // high contrast, vibration, notifications. A key that is missing means "not chosen yet".
  function cleanPrefs(x) {
    const o = {};
    if (!x || typeof x !== "object") return o;
    if (typeof x.table === "string" && /^[a-z]{2,12}$/.test(x.table)) o.table = x.table;
    if (typeof x.sound === "boolean") o.sound = x.sound;
    if (x.vol != null && Number.isFinite(+x.vol)) o.vol = Math.min(100, Math.max(0, Math.round(+x.vol)));
    if (typeof x.motion === "boolean") o.motion = x.motion;
    if (typeof x.contrast === "boolean") o.contrast = x.contrast;
    if (typeof x.notify === "boolean") o.notify = x.notify;
    if (typeof x.haptic === "boolean") o.haptic = x.haptic;
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

  // What was played lately (separate from the profile so its backup code stays small): the last
  // results, minutes played per game and the days with a game. One short cookie string
  // "history_minutes_days": history entries "game.w|l|d.minute36" joined by "~".
  const ACT = "sa_act", ACT_LS = "spieleabend.act", HIST_MAX = 40, DAYS_MAX = 60;
  const dayNo = (t = Date.now()) => Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / 864e5);
  function readAct() {
    let raw = "";
    try { const c = document.cookie.split("; ").find((x) => x.startsWith(ACT + "=")); if (c) raw = decodeURIComponent(c.slice(ACT.length + 1)); } catch (e) {}
    if (!raw) try { raw = localStorage.getItem(ACT_LS) || ""; } catch (e) {}
    const [h = "", p = "", d = ""] = raw.split("_"), o = { h: [], p: {}, d: [] };
    for (const e of h.split("~")) {
      const m = /^([a-z0-9]{2,20})\.([wld])\.([0-9a-z]{1,8})$/.exec(e);
      if (m) o.h.push({ game: m[1], res: m[2], at: parseInt(m[3], 36) * 60000 });
    }
    for (const e of p.split("~")) { const m = /^([a-z0-9]{2,20})\.(\d{1,7})$/.exec(e); if (m) o.p[m[1]] = +m[2]; }
    for (const e of d.split("~")) { const n = parseInt(e, 36); if (n > 0) o.d.push(n); }
    return o;
  }
  function writeAct(o) {
    o.h = o.h.slice(-HIST_MAX); o.d = [...new Set(o.d)].sort((a, b) => a - b).slice(-DAYS_MAX);
    const raw = [o.h.map((e) => `${e.game}.${e.res}.${Math.floor(e.at / 60000).toString(36)}`).join("~"), Object.entries(o.p).map(([g, m]) => `${g}.${m}`).join("~"), o.d.map((n) => n.toString(36)).join("~")].join("_");
    try { localStorage.setItem(ACT_LS, raw); } catch (e) {}
    try { document.cookie = `${ACT}=${encodeURIComponent(raw)}; Path=/; Max-Age=157680000; SameSite=Lax${DOMAIN}${location.protocol === "https:" ? "; Secure" : ""}`; } catch (e) {}
  }
  function activity() {
    const o = readAct(), today = dayNo(), have = new Set(o.d);
    let streak = 0;
    for (let n = have.has(today) ? today : today - 1; have.has(n); n--) streak++;
    return { history: o.h.slice().reverse(), play: o.p, days: o.d, playedToday: have.has(today), streak };
  }
  // the rooms this browser sits in, for the start page's "back to your game": cookie "game.CODE.minute36" joined by "~"
  const ROOMS = "sa_rooms", ROOM_TTL = 6 * 3600 * 1000;
  function readRooms() {
    let raw = "";
    try { const c = document.cookie.split("; ").find((x) => x.startsWith(ROOMS + "=")); if (c) raw = decodeURIComponent(c.slice(ROOMS.length + 1)); } catch (e) {}
    const out = {};
    for (const e of raw.split("~")) {
      const m = /^([a-z0-9]{2,20})\.([A-Z]{4})\.([0-9a-z]{1,8})$/.exec(e), at = m ? parseInt(m[3], 36) * 60000 : 0;
      if (m && Date.now() - at < ROOM_TTL) out[m[1]] = { code: m[2], at };
    }
    return out;
  }
  function setRoom(game, code) {
    if (!/^[a-z0-9]{2,20}$/.test(game)) return;
    const o = readRooms();
    if (code && /^[A-Z]{4}$/.test(code)) { if (o[game] && o[game].code === code && Date.now() - o[game].at < 600000) return; o[game] = { code, at: Date.now() }; }
    else if (o[game]) delete o[game]; else return;
    const raw = Object.entries(o).map(([g, r]) => `${g}.${r.code}.${Math.floor(r.at / 60000).toString(36)}`).join("~");
    try { document.cookie = `${ROOMS}=${encodeURIComponent(raw)}; Path=/; Max-Age=${raw ? 21600 : 0}; SameSite=Lax${DOMAIN}${location.protocol === "https:" ? "; Secure" : ""}`; } catch (e) {}
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
    // patch: any of { table, sound, vol, motion, contrast, notify, haptic }; invalid values are ignored, null forgets a choice
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
      if (counted) { const a = readAct(); a.h.push({ game, res: won ? "w" : draw ? "d" : "l", at: Date.now() }); a.d.push(dayNo()); writeAct(a); }
      return counted;
    },
    activity,
    rooms: readRooms,
    setRoom,
    // minutes spent in a game (the kit counts the visible time of a game page)
    addPlay(game, minutes) {
      if (!/^[a-z0-9]{2,20}$/.test(game) || !(minutes > 0)) return;
      const a = readAct();
      a.p[game] = Math.min(9999999, (a.p[game] || 0) + Math.round(minutes));
      a.d.push(dayNo());
      writeAct(a);
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
    reset(game) { if (!game) writeAct({ h: [], p: {}, d: [] }); return update((p) => { if (game) delete p.stats[game]; else p.stats = {}; }); },
    // a profile taken from a backup code (see profile.html): everything is validated again; returns the new profile or null
    importAll(obj) {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
      const c = clean(obj);
      if (!c.name && !c.av && !Object.keys(c.stats).length && !Object.keys(c.pf).length) return null;
      return update((p) => { Object.assign(p, c); });
    },
    // name, avatar, colour, settings and statistics
    resetAll() { writeAct({ h: [], p: {}, d: [] }); return update((p) => { p.name = ""; p.av = ""; p.col = ""; p.pf = {}; p.stats = {}; }); }
  };
})();
