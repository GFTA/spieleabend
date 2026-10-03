// Catan engine. Pure state + rules, shared by the browser (single player) and the Node server (online).
// No DOM, no I/O. The island has 19 hexes; vertices (54) and edges (72) are numbered once (GEO) and
// the same helpers run on the full state and on a player's view (both carry hexes, vert, edge, ports, robber).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CatanGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 4;
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip", "Pixel Paula", "Byte Ben", "Turbo Tina", "Nano Nick", "Zack Zora", "Bit Bruno"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi" };
  const TARGETS = { 8: "8 Punkte", 10: "10 Punkte", 12: "12 Punkte" };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  const normGoal = (n) => ([1, 2, 3].includes(+n) ? +n : 1);
  const normTarget = (n) => (has(TARGETS, +n) ? +n : 10);
  const normLevel = (n) => (has(LEVELS, +n) ? +n : 2);
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (a) => a[rand(a.length)];
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // ---------- rules tables ----------
  const RES = ["wood", "brick", "sheep", "wheat", "ore"];
  const RES_NAMES = { wood: "Holz", brick: "Lehm", sheep: "Wolle", wheat: "Getreide", ore: "Erz" };
  const COST = {
    road: { wood: 1, brick: 1 },
    settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
    city: { wheat: 2, ore: 3 },
    dev: { sheep: 1, wheat: 1, ore: 1 }
  };
  const PIECES = { road: 15, settlement: 5, city: 4 };
  const DEV_DECK = { knight: 14, vp: 5, road: 2, yop: 2, mono: 2 };
  const DEV_NAMES = { knight: "Ritter", vp: "Siegpunkt", road: "Straßenbau", yop: "Erfindung", mono: "Monopol" };
  const TERRAIN = [["wood", 4], ["brick", 3], ["sheep", 4], ["wheat", 4], ["ore", 3], ["desert", 1]];
  const NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
  const PORT_TYPES = ["any", "any", "any", "any", "wood", "brick", "sheep", "wheat", "ore"];
  const HAND_LIMIT = 7;
  const TRADE_MS = 25000;
  const BANK_START = 19;
  const pips = (n) => (n ? 6 - Math.abs(7 - n) : 0);

  // ---------- geometry: numbered once, the same on the server and in the browser ----------
  const GEO = (() => {
    const hexes = [];
    for (let r = -2; r <= 2; r++) for (let q = Math.max(-2, -2 - r); q <= Math.min(2, 2 - r); q++) hexes.push({ q, r, x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r, v: [] });
    const key = (x, y) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
    const vmap = new Map(), pts = [];
    for (const h of hexes) {
      for (let k = 0; k < 6; k++) {
        const a = ((60 * k - 30) * Math.PI) / 180, x = h.x + Math.cos(a), y = h.y + Math.sin(a), id = key(x, y);
        if (!vmap.has(id)) { vmap.set(id, pts.length); pts.push({ x, y }); }
        h.v.push(vmap.get(id));
      }
    }
    // stable numbering: top to bottom, left to right
    const order = pts.map((p, i) => i).sort((a, b) => pts[a].y - pts[b].y || pts[a].x - pts[b].x);
    const renum = new Array(pts.length);
    order.forEach((old, n) => { renum[old] = n; });
    const verts = order.map((old) => ({ x: pts[old].x, y: pts[old].y, h: [], n: [], e: [] }));
    for (const h of hexes) h.v = h.v.map((i) => renum[i]);
    hexes.forEach((h, hi) => h.v.forEach((v) => verts[v].h.push(hi)));
    const emap = new Map(), edges = [];
    for (const h of hexes) {
      for (let k = 0; k < 6; k++) {
        const a = h.v[k], b = h.v[(k + 1) % 6], lo = Math.min(a, b), hi = Math.max(a, b), id = lo * 100 + hi;
        if (!emap.has(id)) { emap.set(id, edges.length); edges.push({ a: lo, b: hi, h: [] }); }
        edges[emap.get(id)].h.push(hexes.indexOf(h));
      }
    }
    // renumber edges by their endpoints so ids are stable too
    const eorder = edges.map((e, i) => i).sort((x, y) => edges[x].a - edges[y].a || edges[x].b - edges[y].b);
    const sorted = eorder.map((i) => edges[i]);
    sorted.forEach((e, id) => { verts[e.a].n.push(e.b); verts[e.b].n.push(e.a); verts[e.a].e.push(id); verts[e.b].e.push(id); });
    // ports sit on the coast, evenly spread around the island
    const coast = sorted.map((e, id) => ({ e, id })).filter((c) => c.e.h.length === 1).map((c) => {
      const mx = (verts[c.e.a].x + verts[c.e.b].x) / 2, my = (verts[c.e.a].y + verts[c.e.b].y) / 2;
      return { id: c.id, mx, my, ang: Math.atan2(my, mx) };
    }).sort((p, q) => p.ang - q.ang);
    const ports = [];
    for (let i = 0; i < 9; i++) {
      const c = coast[Math.round((i * coast.length) / 9) % coast.length], e = sorted[c.id];
      const len = Math.hypot(c.mx, c.my) || 1;
      ports.push({ e: c.id, v: [e.a, e.b], x: c.mx, y: c.my, ox: c.mx / len, oy: c.my / len });
    }
    return { hexes, verts, edges: sorted, ports };
  })();
  const HEX_N = GEO.hexes.length, VERT_N = GEO.verts.length, EDGE_N = GEO.edges.length;
  const hexAdj = GEO.hexes.map((h, i) => GEO.hexes.map((g, j) => j).filter((j) => j !== i && GEO.hexes[j].v.filter((v) => h.v.includes(v)).length === 2));

  function makeLayout() {
    for (let tries = 0; tries < 300; tries++) {
      const terr = [];
      for (const [r, n] of TERRAIN) for (let i = 0; i < n; i++) terr.push(r);
      shuffle(terr);
      const nums = shuffle(NUMBERS.slice());
      const hexes = terr.map((res) => ({ res, num: res === "desert" ? 0 : nums.pop() }));
      const hot = (i) => hexes[i].num === 6 || hexes[i].num === 8;
      if (hexes.some((h, i) => hot(i) && hexAdj[i].some((j) => j > i && hot(j)))) continue; // no red numbers side by side
      return hexes;
    }
    const terr = []; for (const [r, n] of TERRAIN) for (let i = 0; i < n; i++) terr.push(r);
    const nums = NUMBERS.slice();
    return shuffle(terr).map((res) => ({ res, num: res === "desert" ? 0 : nums.pop() }));
  }

  // ---------- helpers that work on the state and on a view ----------
  const emptyHand = () => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  const total = (h) => RES.reduce((n, r) => n + h[r], 0);
  const canPay = (hand, cost) => RES.every((r) => (cost[r] || 0) <= hand[r]);
  function cleanHand(o) { // a hostile object becomes five clean counts, or null
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const h = emptyHand();
    for (const r of RES) {
      const n = has(o, r) ? o[r] : 0;
      if (!Number.isInteger(n) || n < 0 || n > 99) return null;
      h[r] = n;
    }
    return h;
  }
  const hexesOfVert = (v) => GEO.verts[v].h;

  function settleOk(B, pi, v, setup) {
    if (!Number.isInteger(v) || v < 0 || v >= VERT_N || B.vert[v]) return false;
    if (GEO.verts[v].n.some((n) => B.vert[n])) return false; // distance rule
    if (setup) return true;
    return GEO.verts[v].e.some((e) => B.edge[e] === pi);
  }
  function roadOk(B, pi, e, setupVert) {
    if (!Number.isInteger(e) || e < 0 || e >= EDGE_N || B.edge[e] !== -1) return false;
    const E = GEO.edges[e];
    if (setupVert != null && setupVert >= 0) return E.a === setupVert || E.b === setupVert;
    return [E.a, E.b].some((v) => {
      const b = B.vert[v];
      if (b) return b.o === pi;
      return GEO.verts[v].e.some((x) => x !== e && B.edge[x] === pi);
    });
  }
  const cityOk = (B, pi, v) => Number.isInteger(v) && v >= 0 && v < VERT_N && !!B.vert[v] && B.vert[v].o === pi && !B.vert[v].c;
  const spots = (B, pi, kind, setupVert) => {
    const out = [];
    if (kind === "settlement") for (let v = 0; v < VERT_N; v++) { if (settleOk(B, pi, v, setupVert === "setup")) out.push(v); }
    else if (kind === "city") for (let v = 0; v < VERT_N; v++) { if (cityOk(B, pi, v)) out.push(v); }
    else for (let e = 0; e < EDGE_N; e++) { if (roadOk(B, pi, e, typeof setupVert === "number" ? setupVert : null)) out.push(e); }
    return out;
  };
  // trade ratio with the bank for a resource: 4, 3 (any port) or 2 (its own port)
  function portRate(B, pi, res) {
    let rate = 4;
    GEO.ports.forEach((p, i) => {
      if (!p.v.some((v) => B.vert[v] && B.vert[v].o === pi)) return;
      const t = B.ports[i];
      if (t === res) rate = Math.min(rate, 2); else if (t === "any") rate = Math.min(rate, 3);
    });
    return rate;
  }
  function roadLength(B, pi) {
    const own = [];
    for (let e = 0; e < EDGE_N; e++) if (B.edge[e] === pi) own.push(e);
    if (!own.length) return 0;
    let best = 0;
    const used = new Set();
    function dfs(v, len) {
      if (len > best) best = len;
      const blocked = B.vert[v] && B.vert[v].o !== pi;
      if (blocked) return;
      for (const e of GEO.verts[v].e) {
        if (B.edge[e] !== pi || used.has(e)) continue;
        const E = GEO.edges[e];
        used.add(e);
        dfs(E.a === v ? E.b : E.a, len + 1);
        used.delete(e);
      }
    }
    for (const e of own) {
      const E = GEO.edges[e];
      used.add(e);
      dfs(E.a, 1); dfs(E.b, 1);
      used.delete(e);
    }
    return best;
  }
  function victimsAt(B, hex, pi) { // opponents with a building on this hex
    const out = [];
    for (const v of GEO.hexes[hex].v) { const b = B.vert[v]; if (b && b.o !== pi && !out.includes(b.o)) out.push(b.o); }
    return out;
  }

  function log(S, msg) { S.log.push(msg); if (S.log.length > 80) S.log.shift(); }

  // players: [{ name, bot, avatar }]; goal: wins that end the match; target: points that win a round; level: computer strength
  function newGame(players, goal, target, level) {
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p, i) => ({ name: p.name, bot: !!p.bot, avatar: avatarOf(p, i), wins: 0 })),
      goal: normGoal(goal), target: normTarget(target), level: normLevel(level),
      round: 0, starter: 0, log: [], last: null, seq: 0, pace: 0
    };
    S.starter = rand(S.players.length);
    startRound(S);
    return S;
  }

  function startRound(S) {
    S.round++;
    S.phase = "play";
    S.last = null;
    S.log = [];
    S.hexes = makeLayout();
    S.ports = shuffle(PORT_TYPES.slice());
    S.vert = new Array(VERT_N).fill(null);
    S.edge = new Array(EDGE_N).fill(-1);
    S.robber = S.hexes.findIndex((h) => h.res === "desert");
    S.bank = {}; for (const r of RES) S.bank[r] = BANK_START;
    S.deck = []; for (const k of Object.keys(DEV_DECK)) for (let i = 0; i < DEV_DECK[k]; i++) S.deck.push(k);
    shuffle(S.deck);
    S.players.forEach((p) => {
      p.hand = emptyHand(); p.devs = []; p.knights = 0; p.left = { ...PIECES }; p.len = 0;
    });
    S.lr = -1; S.la = -1;
    S.dice = null; S.devPlayed = false; S.trade = null; S.disc = {}; S.offers = 0; S.back = "main";
    S.turn = 0; S.setupK = 0; S.setupV = -1;
    const n = S.players.length, first = S.starter % n;
    S.first = first;
    S.starter = (S.starter + 1) % n;
    S.step = "settle";
    S.cur = first;
    log(S, `Runde ${S.round}: ${S.players[first].name} setzt zuerst. Jeder baut zwei Siedlungen mit je einer Straße.`);
  }

  const setupSeat = (S, k) => { const n = S.players.length; return (S.first + (k < n ? k : 2 * n - 1 - k)) % n; };
  // the seats that have to act right now (the player on turn, or the ones who must discard / answer an offer)
  function actors(S) {
    if (S.phase !== "play") return [];
    if (S.step === "discard") return Object.keys(S.disc).map(Number).filter((i) => S.disc[i] > 0);
    if (S.trade) {
      const T = S.trade, wait = [];
      for (let i = 0; i < S.players.length; i++) if (i !== T.from && (T.to == null || T.to === i) && !T.acc.includes(i) && !T.dec.includes(i)) wait.push(i);
      return wait.length ? wait : [T.from];
    }
    return [S.cur];
  }
  const actorOf = (S) => { const a = actors(S); return a.length ? a[0] : -1; };

  const vpOf = (S, pi, hidden) => {
    let n = 0;
    for (const b of S.vert) if (b && b.o === pi) n += b.c ? 2 : 1;
    if (S.lr === pi) n += 2;
    if (S.la === pi) n += 2;
    if (hidden) n += S.players[pi].devs.filter((d) => d.k === "vp").length;
    return n;
  };

  function updateAwards(S, events) {
    S.players.forEach((p, i) => { p.len = roadLength(S, i); });
    const best = Math.max(...S.players.map((p) => p.len));
    let lr = S.lr;
    if (best < 5) lr = -1;
    else if (lr < 0 || S.players[lr].len < best) {
      const top = S.players.map((p, i) => i).filter((i) => S.players[i].len === best);
      lr = top.length === 1 ? top[0] : (lr >= 0 && S.players[lr].len === best ? lr : -1);
    }
    if (lr !== S.lr) {
      S.lr = lr;
      if (lr >= 0) { log(S, `${S.players[lr].name} hat jetzt die längste Handelsstraße (${S.players[lr].len}).`); events.push({ t: "award", kind: "road", pi: lr }); }
      else log(S, "Niemand hat mehr die längste Handelsstraße.");
    }
    const most = Math.max(...S.players.map((p) => p.knights));
    if (most >= 3 && (S.la < 0 || S.players[S.la].knights < most)) {
      const top = S.players.map((p, i) => i).filter((i) => S.players[i].knights === most);
      if (top.length === 1 && top[0] !== S.la) {
        S.la = top[0];
        log(S, `${S.players[S.la].name} hat jetzt die größte Rittermacht (${most}).`);
        events.push({ t: "award", kind: "army", pi: S.la });
      }
    }
  }

  function checkWin(S, events) {
    const pi = S.cur;
    if (S.phase !== "play" || pi < 0) return false;
    if (vpOf(S, pi, true) < S.target) return false;
    S.players[pi].wins++;
    const over = S.players[pi].wins >= S.goal;
    S.phase = "roundEnd";
    S.step = "over";
    S.trade = null; S.disc = {};
    S.last = { winners: [pi], over, turns: S.turn, vp: S.players.map((p, i) => vpOf(S, i, true)) };
    log(S, `${S.players[pi].name} ${over ? "gewinnt das Spiel" : "gewinnt die Runde"}!`);
    events.push({ t: "end", winners: [pi] });
    return true;
  }

  function give(S, pi, res, n) { S.players[pi].hand[res] += n; S.bank[res] -= n; }
  function take(S, pi, res, n) { S.players[pi].hand[res] -= n; S.bank[res] += n; }
  function payCost(S, pi, cost) { for (const r of RES) if (cost[r]) take(S, pi, r, cost[r]); }

  function startTurn(S, pi) {
    S.cur = pi; S.turn++; S.step = "roll"; S.dice = null; S.devPlayed = false; S.trade = null; S.offers = 0; S.bankN = 0; S.back = "main";
  }

  // resources for a roll (or the second settlement); the bank may run short
  function produce(S, sum, events) {
    const want = {}; // res -> pi -> n
    S.hexes.forEach((h, hi) => {
      if (h.num !== sum || hi === S.robber) return;
      for (const v of GEO.hexes[hi].v) {
        const b = S.vert[v]; if (!b) continue;
        want[h.res] = want[h.res] || {};
        want[h.res][b.o] = (want[h.res][b.o] || { n: 0, hex: hi });
        want[h.res][b.o].n += b.c ? 2 : 1;
      }
    });
    const gains = [], short = [];
    for (const res of Object.keys(want)) {
      const ps = Object.keys(want[res]).map(Number), need = ps.reduce((n, p) => n + want[res][p].n, 0);
      if (need <= S.bank[res]) { for (const p of ps) { give(S, p, res, want[res][p].n); gains.push({ pi: p, res, n: want[res][p].n, hex: want[res][p].hex }); } }
      else if (ps.length === 1) { const n = S.bank[res]; if (n > 0) { give(S, ps[0], res, n); gains.push({ pi: ps[0], res, n, hex: want[res][ps[0]].hex }); } short.push(res); }
      else short.push(res);
    }
    return { gains, short };
  }

  const need = (cond, msg) => (cond ? null : msg);

  // ---------- actions ----------
  const ACTIONS = {
    build(S, pi, a, events) {
      if (a.k !== "road" && a.k !== "settlement" && a.k !== "city") return "Unbekannter Bau.";
      const P = S.players[pi], id = a.id;
      if (S.step === "settle" || S.step === "sroad") {
        if (S.cur !== pi) return `${S.players[S.cur].name} ist dran.`;
        if (S.step === "settle") {
          if (a.k !== "settlement") return "Setze zuerst eine Siedlung.";
          if (!settleOk(S, pi, id, true)) return "Hier darf keine Siedlung stehen (Abstand zu anderen Siedlungen).";
          S.vert[id] = { o: pi, c: false }; P.left.settlement--;
          S.setupV = id; S.step = "sroad";
          log(S, `${P.name} setzt eine Siedlung.`);
          events.push({ t: "build", pi, k: "settlement", id });
          if (S.setupK >= S.players.length) { // the second settlement pays out its neighbours
            const gains = [];
            for (const hi of GEO.verts[id].h) { const r = S.hexes[hi].res; if (r !== "desert" && S.bank[r] > 0) { give(S, pi, r, 1); gains.push({ pi, res: r, n: 1, hex: hi }); } }
            if (gains.length) events.push({ t: "gain", gains });
          }
          return null;
        }
        if (a.k !== "road") return "Setze jetzt eine Straße.";
        if (!roadOk(S, pi, id, S.setupV)) return "Die Straße muss an deine neue Siedlung grenzen.";
        S.edge[id] = pi; P.left.road--;
        log(S, `${P.name} baut eine Straße.`);
        events.push({ t: "build", pi, k: "road", id });
        S.setupK++; S.setupV = -1;
        if (S.setupK >= S.players.length * 2) { updateAwards(S, events); startTurn(S, S.first); log(S, `Los geht's: ${S.players[S.cur].name} würfelt.`); }
        else { S.cur = setupSeat(S, S.setupK); S.step = "settle"; }
        return null;
      }
      if (S.cur !== pi) return `${S.players[S.cur].name} ist dran.`;
      if (S.step !== "main") return "Gerade nicht möglich.";
      if (S.trade) return "Schließe erst den Handel ab.";
      const kind = a.k;
      if (!canPay(P.hand, COST[kind])) return "Dir fehlen Rohstoffe dafür.";
      if (P.left[kind] <= 0) return kind === "road" ? "Du hast keine Straßen mehr." : kind === "settlement" ? "Du hast keine Siedlungen mehr." : "Du hast keine Städte mehr.";
      if (kind === "road" && !roadOk(S, pi, id, null)) return "Hier kann keine Straße gebaut werden.";
      if (kind === "settlement" && !settleOk(S, pi, id, false)) return "Hier kann keine Siedlung gebaut werden (an eine eigene Straße, mit Abstand).";
      if (kind === "city" && !cityOk(S, pi, id)) return "Eine Stadt braucht eine eigene Siedlung.";
      payCost(S, pi, COST[kind]);
      if (kind === "road") { S.edge[id] = pi; P.left.road--; }
      else if (kind === "settlement") { S.vert[id] = { o: pi, c: false }; P.left.settlement--; }
      else { S.vert[id].c = true; P.left.city--; P.left.settlement++; }
      log(S, `${P.name} baut ${kind === "road" ? "eine Straße" : kind === "settlement" ? "eine Siedlung" : "eine Stadt"}.`);
      events.push({ t: "build", pi, k: kind, id });
      if (kind !== "city") updateAwards(S, events);
      return null;
    },

    roll(S, pi, a, events) {
      if (S.cur !== pi) return `${S.players[S.cur].name} ist dran.`;
      if (S.step !== "roll") return "Du hast schon gewürfelt.";
      const d = [1 + rand(6), 1 + rand(6)], sum = d[0] + d[1];
      S.dice = d;
      if (sum === 7) {
        log(S, `${S.players[pi].name} würfelt eine 7.`);
        events.push({ t: "roll", pi, d, sum, gains: [], short: [] });
        S.disc = {};
        S.players.forEach((p, i) => { const n = total(p.hand); if (n > HAND_LIMIT) S.disc[i] = Math.floor(n / 2); });
        S.back = "main";
        S.step = Object.keys(S.disc).length ? "discard" : "robber";
        return null;
      }
      const { gains, short } = produce(S, sum, events);
      const txt = gains.length ? gains.map((g) => `${S.players[g.pi].name} +${g.n} ${RES_NAMES[g.res]}`).join(", ") : "Keiner bekommt etwas";
      log(S, `${S.players[pi].name} würfelt ${sum}: ${txt}${short.length ? ` (Bank leer: ${short.map((r) => RES_NAMES[r]).join(", ")})` : ""}.`);
      events.push({ t: "roll", pi, d, sum, gains, short });
      S.step = "main";
      return null;
    },

    discard(S, pi, a, events) {
      if (S.step !== "discard" || !(S.disc[pi] > 0)) return "Du musst nichts abwerfen.";
      const h = cleanHand(a.res);
      if (!h) return "Ungültige Auswahl.";
      if (total(h) !== S.disc[pi]) return `Wirf genau ${S.disc[pi]} Karten ab.`;
      if (!canPay(S.players[pi].hand, h)) return "Du hast diese Karten nicht.";
      for (const r of RES) if (h[r]) take(S, pi, r, h[r]);
      log(S, `${S.players[pi].name} wirft ${S.disc[pi]} Karten ab.`);
      events.push({ t: "discard", pi, n: S.disc[pi] });
      delete S.disc[pi];
      if (!Object.keys(S.disc).length) S.step = "robber";
      return null;
    },

    robber(S, pi, a, events) {
      if (S.cur !== pi) return `${S.players[S.cur].name} ist dran.`;
      if (S.step !== "robber") return "Der Räuber ist gerade nicht dran.";
      const hex = a.hex;
      if (!Number.isInteger(hex) || hex < 0 || hex >= HEX_N) return "Unbekanntes Feld.";
      if (hex === S.robber) return "Der Räuber muss auf ein anderes Feld.";
      const cands = victimsAt(S, hex, pi).filter((o) => total(S.players[o].hand) > 0);
      let victim = -1;
      if (cands.length === 1) victim = cands[0];
      else if (cands.length > 1) {
        if (!Number.isInteger(a.victim) || !cands.includes(a.victim)) return "Wähle, wem du eine Karte klaust.";
        victim = a.victim;
      }
      S.robber = hex;
      events.push({ t: "robber", pi, hex });
      log(S, `${S.players[pi].name} versetzt den Räuber.`);
      if (victim >= 0) {
        const V = S.players[victim], pool = [];
        for (const r of RES) for (let i = 0; i < V.hand[r]; i++) pool.push(r);
        const res = pick(pool);
        V.hand[res]--; S.players[pi].hand[res]++;
        log(S, `${S.players[pi].name} klaut ${V.name} eine Karte.`);
        events.push({ t: "steal", from: victim, to: pi });
      }
      S.step = S.back === "roll" ? "roll" : "main";
      return null;
    },

    bank(S, pi, a, events) {
      if (S.cur !== pi) return `${S.players[S.cur].name} ist dran.`;
      if (S.step !== "main" || S.trade) return "Gerade nicht möglich.";
      if (!RES.includes(a.give) || !RES.includes(a.get) || a.give === a.get) return "Wähle zwei verschiedene Rohstoffe.";
      const P = S.players[pi], rate = portRate(S, pi, a.give);
      if (P.hand[a.give] < rate) return `Dafür brauchst du ${rate} × ${RES_NAMES[a.give]}.`;
      if (S.bank[a.get] < 1) return `Die Bank hat kein ${RES_NAMES[a.get]} mehr.`;
      take(S, pi, a.give, rate); give(S, pi, a.get, 1); S.bankN++;
      log(S, `${P.name} tauscht ${rate} ${RES_NAMES[a.give]} gegen 1 ${RES_NAMES[a.get]} (Bank).`);
      events.push({ t: "bank", pi, give: a.give, n: rate, get: a.get });
      return null;
    },

    buyDev(S, pi, a, events) {
      if (S.cur !== pi) return `${S.players[S.cur].name} ist dran.`;
      if (S.step !== "main" || S.trade) return "Gerade nicht möglich.";
      if (!S.deck.length) return "Es gibt keine Entwicklungskarten mehr.";
      if (!canPay(S.players[pi].hand, COST.dev)) return "Dir fehlen Rohstoffe dafür.";
      payCost(S, pi, COST.dev);
      const k = S.deck.pop();
      S.players[pi].devs.push({ k, t: S.turn });
      log(S, `${S.players[pi].name} kauft eine Entwicklungskarte.`);
      events.push({ t: "buyDev", pi });
      return null;
    },

    play(S, pi, a, events) {
      if (S.cur !== pi) return `${S.players[S.cur].name} ist dran.`;
      if (S.step !== "roll" && S.step !== "main") return "Gerade nicht möglich.";
      if (S.trade) return "Schließe erst den Handel ab.";
      const k = a.card, P = S.players[pi];
      if (!has(DEV_DECK, k) || k === "vp") return "Diese Karte kann man nicht ausspielen.";
      if (S.devPlayed) return "Pro Zug nur eine Entwicklungskarte.";
      if (S.step === "roll" && k !== "knight") return "Vor dem Würfeln geht nur der Ritter.";
      const idx = P.devs.findIndex((d) => d.k === k && d.t !== S.turn);
      if (idx < 0) return P.devs.some((d) => d.k === k) ? "Diese Karte hast du gerade erst gekauft." : "Du hast diese Karte nicht.";
      if (k === "road") {
        const list = Array.isArray(a.edges) ? a.edges.slice(0, 2) : null;
        if (!list || !list.length) return "Wähle die Straßen.";
        const free = Math.min(2, P.left.road);
        if (!free) return "Du hast keine Straßen mehr.";
        if (list.length > free || !list.every((e) => Number.isInteger(e))) return "Ungültige Straßen.";
        // all must be buildable one after the other; check on a copy so nothing is half done
        const probe = { vert: S.vert, edge: S.edge.slice() };
        for (const e of list) { if (!roadOk(probe, pi, e, null)) return "Hier kann keine Straße gebaut werden."; probe.edge[e] = pi; }
        // a second road is only optional when no spot is left for it
        if (list.length < free && spots(probe, pi, "road").length) return "Baue beide Straßen.";
        P.devs.splice(idx, 1); S.devPlayed = true;
        for (const e of list) { S.edge[e] = pi; P.left.road--; }
        log(S, `${P.name} spielt Straßenbau.`);
        events.push({ t: "play", pi, card: k, edges: list });
        updateAwards(S, events);
        return null;
      }
      if (k === "yop") {
        if (!Array.isArray(a.res) || a.res.length !== 2 || !a.res.every((r) => typeof r === "string" && RES.includes(r))) return "Wähle zwei Rohstoffe.";
        const want = emptyHand(); a.res.forEach((r) => want[r]++);
        const lack = RES.filter((r) => want[r] > S.bank[r]);
        if (lack.length) return `Die Bank hat nicht genug ${RES_NAMES[lack[0]]}.`;
        P.devs.splice(idx, 1); S.devPlayed = true;
        for (const r of a.res) give(S, pi, r, 1);
        log(S, `${P.name} spielt Erfindung: ${a.res.map((r) => RES_NAMES[r]).join(" und ")}.`);
        events.push({ t: "play", pi, card: k, res: a.res.slice() });
        return null;
      }
      if (k === "mono") {
        if (typeof a.res !== "string" || !RES.includes(a.res)) return "Wähle einen Rohstoff.";
        P.devs.splice(idx, 1); S.devPlayed = true;
        const from = [];
        S.players.forEach((p, i) => { if (i !== pi && p.hand[a.res] > 0) { from.push({ pi: i, n: p.hand[a.res] }); P.hand[a.res] += p.hand[a.res]; p.hand[a.res] = 0; } });
        const sum = from.reduce((n, f) => n + f.n, 0);
        log(S, `${P.name} spielt Monopol auf ${RES_NAMES[a.res]} und bekommt ${sum} Karten.`);
        events.push({ t: "play", pi, card: k, res: a.res, from });
        return null;
      }
      // knight
      P.devs.splice(idx, 1); S.devPlayed = true; P.knights++;
      S.back = S.step === "roll" ? "roll" : "main";
      S.step = "robber";
      log(S, `${P.name} spielt einen Ritter.`);
      events.push({ t: "play", pi, card: k });
      updateAwards(S, events);
      return null;
    },

    offer(S, pi, a, events) {
      if (S.cur !== pi) return `${S.players[S.cur].name} ist dran.`;
      if (S.step !== "main") return "Gerade nicht möglich.";
      if (S.trade) return "Es läuft schon ein Angebot.";
      if (S.players.length < 2) return "Niemand zum Handeln.";
      const g = cleanHand(a.give), w = cleanHand(a.want);
      if (!g || !w || !total(g) || !total(w)) return "Gib etwas und wünsche dir etwas.";
      if (RES.some((r) => g[r] && w[r])) return "Du kannst nicht denselben Rohstoff anbieten und wünschen.";
      if (!canPay(S.players[pi].hand, g)) return "Du hast diese Karten nicht.";
      let to = null;
      if (a.to != null) {
        if (!Number.isInteger(a.to) || a.to === pi || !S.players[a.to]) return "Unbekannter Mitspieler.";
        to = a.to;
      }
      S.trade = { from: pi, give: g, want: w, to, acc: [], dec: [], until: Date.now() + TRADE_MS };
      S.offers++;
      log(S, `${S.players[pi].name} bietet ${handText(g)} gegen ${handText(w)}.`);
      events.push({ t: "offer", pi, give: g, want: w, to });
      return null;
    },
    accept(S, pi, a, events) {
      const T = S.trade;
      if (!T || S.step !== "main") return "Es gibt gerade kein Angebot.";
      if (pi === T.from || (T.to != null && T.to !== pi)) return "Das Angebot gilt nicht für dich.";
      if (T.acc.includes(pi) || T.dec.includes(pi)) return "Du hast schon geantwortet.";
      if (!canPay(S.players[pi].hand, T.want)) return "Dir fehlen die gewünschten Karten.";
      T.acc.push(pi);
      events.push({ t: "answer", pi, yes: true });
      settleOffer(S, events);
      return null;
    },
    decline(S, pi, a, events) {
      const T = S.trade;
      if (!T || S.step !== "main") return "Es gibt gerade kein Angebot.";
      if (pi === T.from || (T.to != null && T.to !== pi)) return "Das Angebot gilt nicht für dich.";
      if (T.acc.includes(pi) || T.dec.includes(pi)) return "Du hast schon geantwortet.";
      T.dec.push(pi);
      events.push({ t: "answer", pi, yes: false });
      settleOffer(S, events);
      return null;
    },
    confirm(S, pi, a, events) {
      const T = S.trade;
      if (!T || T.from !== pi) return "Du hast kein Angebot offen.";
      if (!Number.isInteger(a.with) || !T.acc.includes(a.with)) return "Dieser Spieler hat nicht zugesagt.";
      const A = S.players[pi], B = S.players[a.with];
      if (!canPay(A.hand, T.give) || !canPay(B.hand, T.want)) { T.acc = T.acc.filter((x) => x !== a.with); return "Einem von euch fehlen jetzt Karten."; }
      for (const r of RES) { A.hand[r] += T.want[r] - T.give[r]; B.hand[r] += T.give[r] - T.want[r]; }
      log(S, `${A.name} tauscht mit ${B.name}: ${handText(T.give)} gegen ${handText(T.want)}.`);
      events.push({ t: "trade", a: pi, b: a.with, give: T.give, want: T.want });
      S.trade = null;
      return null;
    },
    cancel(S, pi, a, events) {
      const T = S.trade;
      if (!T || T.from !== pi) return "Du hast kein Angebot offen.";
      log(S, `${S.players[pi].name} zieht das Angebot zurück.`);
      events.push({ t: "offerEnd", pi });
      S.trade = null;
      return null;
    },

    end(S, pi, a, events) {
      if (S.cur !== pi) return `${S.players[S.cur].name} ist dran.`;
      if (S.step === "roll") return "Würfle zuerst.";
      if (S.step !== "main") return "Gerade nicht möglich.";
      if (S.trade) return "Schließe erst den Handel ab.";
      events.push({ t: "turn", pi });
      startTurn(S, (pi + 1) % S.players.length);
      return null;
    }
  };

  function handText(h) { return RES.filter((r) => h[r]).map((r) => `${h[r]} ${RES_NAMES[r]}`).join(", "); }

  // everybody answered: nobody wants it ends the offer, otherwise the offerer chooses
  function settleOffer(S, events) {
    const T = S.trade;
    if (!T) return;
    const open = S.players.some((p, i) => i !== T.from && (T.to == null || T.to === i) && !T.acc.includes(i) && !T.dec.includes(i));
    if (open) return;
    T.until = 0;
    if (!T.acc.length) {
      log(S, "Niemand will tauschen.");
      events.push({ t: "offerEnd", pi: T.from, none: true });
      S.trade = null;
    }
  }

  // Apply an action by player `pi`. Returns { ok, error?, events }.
  // Actions: build{k,id} roll discard{res} robber{hex,victim} bank{give,get} buyDev play{card,...}
  //          offer{give,want,to} accept decline confirm{with} cancel end skip next
  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events: [] });
    const P = Number.isInteger(pi) ? S.players[pi] : null;
    if (!P) return fail("Unbekannter Spieler.");
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
      if (S.last && S.last.over) { S.players.forEach((p) => { p.wins = 0; }); S.round = 0; }
      startRound(S);
      S.seq++; S.pace = 0;
      return { ok: true, events };
    }
    if (S.phase !== "play") return fail("Gerade ist niemand dran.");
    if (a.t === "skip") { // the host moves on when the one who has to act is away: the computer plays their move
      const who = actorOf(S), m = who >= 0 ? botMove(S, who) : null;
      if (!m) return fail("Gerade nicht möglich.");
      const res = act(S, who, m);
      if (res.ok) log(S, `${S.players[who].name} wurde übersprungen.`);
      return res;
    }
    if (!has(ACTIONS, a.t)) return fail("Unbekannte Aktion.");
    const err = ACTIONS[a.t](S, pi, a, events);
    if (err) return fail(err);
    checkWin(S, events);
    S.seq++;
    S.pace = paceOf(events);
    return { ok: true, events };
  }

  // an open offer runs out: people who did not answer count as "no"
  function tick(S) {
    const events = [];
    const T = S && S.phase === "play" ? S.trade : null;
    if (!T || !(T.until > 0) || Date.now() < T.until) return events;
    for (let i = 0; i < S.players.length; i++) {
      if (i === T.from || (T.to != null && T.to !== i) || T.acc.includes(i) || T.dec.includes(i)) continue;
      T.dec.push(i);
    }
    settleOffer(S, events);
    if (S.trade) S.trade.until = 0;
    S.seq++;
    return events;
  }
  function nextDeadline(S) {
    const T = S && S.phase === "play" ? S.trade : null;
    return T && T.until > 0 ? Math.max(0, T.until - Date.now()) : -1;
  }

  function paceOf(events) {
    let ms = 0;
    for (const e of events) {
      if (e.t === "roll") ms += 1500;
      else if (e.t === "build" || e.t === "play") ms += 800;
      else if (e.t === "robber" || e.t === "steal") ms += 700;
      else if (e.t === "trade" || e.t === "bank") ms += 900;
      else ms += 400;
    }
    return ms;
  }

  // ---------- computer player ----------
  const vertPips = (S, v) => GEO.verts[v].h.reduce((n, h) => n + pips(S.hexes[h].num), 0);
  const producing = (S, pi) => {
    const set = new Set();
    for (let v = 0; v < VERT_N; v++) if (S.vert[v] && S.vert[v].o === pi) for (const h of GEO.verts[v].h) if (S.hexes[h].res !== "desert") set.add(S.hexes[h].res);
    return set;
  };
  function vertScore(S, pi, v, lv, second) {
    let s = vertPips(S, v);
    const kinds = new Set(GEO.verts[v].h.map((h) => S.hexes[h].res).filter((r) => r !== "desert"));
    s += kinds.size * 1.5;
    if (second) { const have = producing(S, pi); for (const r of kinds) if (!have.has(r)) s += 2.5; }
    if (lv >= 2) for (const r of kinds) if (r === "ore" || r === "wheat") s += 0.6;
    if (lv >= 3) GEO.ports.forEach((p, i) => { if (p.v.includes(v)) s += S.ports[i] === "any" ? 1.5 : kinds.has(S.ports[i]) ? 3 : 0.5; });
    return s;
  }
  function botSettle(S, pi, setup) {
    const lv = S.level || 2, list = spots(S, pi, "settlement", setup ? "setup" : null);
    if (!list.length) return null;
    const second = setup && S.setupK >= S.players.length;
    const ranked = list.map((v) => ({ v, s: vertScore(S, pi, v, lv, second) + (lv === 1 ? Math.random() * 6 : Math.random() * 0.4) })).sort((a, b) => b.s - a.s);
    return ranked[0].v;
  }
  // a road whose far end reaches the best free spot
  function botRoad(S, pi, setupV) {
    const lv = S.level || 2, list = spots(S, pi, "road", setupV != null && setupV >= 0 ? setupV : null);
    if (!list.length) return null;
    let best = list[0], bs = -1;
    for (const e of list) {
      const E = GEO.edges[e];
      let s = Math.random() * (lv === 1 ? 8 : 0.5);
      for (const v of [E.a, E.b]) {
        if (S.vert[v] && S.vert[v].o === pi) continue;
        if (!S.vert[v] && !GEO.verts[v].n.some((n) => S.vert[n])) s += vertScore(S, pi, v, lv, false) * 1.0;
        for (const n of GEO.verts[v].n) if (!S.vert[n] && !GEO.verts[n].n.some((m) => S.vert[m])) s += vertScore(S, pi, n, lv, false) * 0.35;
      }
      if (s > bs) { bs = s; best = e; }
    }
    return best;
  }
  function botRobber(S, pi) {
    const lv = S.level || 2;
    let bestHex = -1, bs = -1e9;
    for (let h = 0; h < HEX_N; h++) {
      if (h === S.robber) continue;
      let s = Math.random() * (lv === 1 ? 20 : 1);
      const p = pips(S.hexes[h].num);
      for (const v of GEO.hexes[h].v) {
        const b = S.vert[v]; if (!b) continue;
        const w = b.c ? 2 : 1;
        if (b.o === pi) s -= p * w * 3;
        else s += p * w * (lv >= 3 ? 1 + vpOf(S, b.o, false) / 5 : 1) * (lv === 1 ? 0.2 : 1);
      }
      if (S.hexes[h].res === "desert") s -= 1;
      if (s > bs) { bs = s; bestHex = h; }
    }
    const cands = victimsAt(S, bestHex, pi).filter((o) => total(S.players[o].hand) > 0);
    const victim = cands.length ? cands.sort((x, y) => vpOf(S, y, false) - vpOf(S, x, false) || total(S.players[y].hand) - total(S.players[x].hand))[0] : undefined;
    return { t: "robber", hex: bestHex, victim };
  }
  // what the computer is saving for: the cheapest thing that is possible at all
  function botGoal(S, pi) {
    const P = S.players[pi], lv = S.level || 2;
    const goals = [];
    if (P.left.city > 0 && spots(S, pi, "city").length) goals.push({ k: "city", cost: COST.city, w: 0 });
    if (P.left.settlement > 0 && spots(S, pi, "settlement").length) goals.push({ k: "settlement", cost: COST.settlement, w: 0.5 });
    if (S.deck.length) goals.push({ k: "dev", cost: COST.dev, w: 1.2 });
    if (P.left.road > 0 && S.edge.filter((e) => e === pi).length < 14 && !spots(S, pi, "settlement").length) goals.push({ k: "road", cost: COST.road, w: 0.8 });
    if (!goals.length && P.left.road > 0) goals.push({ k: "road", cost: COST.road, w: 2 });
    for (const g of goals) { g.miss = RES.reduce((n, r) => n + Math.max(0, (g.cost[r] || 0) - P.hand[r]), 0); g.score = g.miss + g.w; }
    goals.sort((a, b) => a.score - b.score);
    return goals[0] || null;
  }
  function botDiscard(S, pi) {
    const P = S.players[pi], n = S.disc[pi], keep = botGoal(S, pi), h = { ...P.hand }, out = emptyHand();
    for (let i = 0; i < n; i++) {
      let best = null, bs = -1e9;
      for (const r of RES) {
        if (h[r] <= 0) continue;
        const useful = keep ? Math.min(h[r], keep.cost[r] || 0) : 0;
        const s = h[r] - useful * 2.5 + Math.random() * 0.3;
        if (s > bs) { bs = s; best = r; }
      }
      h[best]--; out[best]++;
    }
    return out;
  }
  function botOffersFor(S, pi, goal) {
    const P = S.players[pi];
    const missing = RES.filter((r) => (goal.cost[r] || 0) > P.hand[r]);
    const spare = RES.filter((r) => P.hand[r] > (goal.cost[r] || 0));
    if (missing.length !== 1 || !spare.length) return null;
    const want = missing[0];
    const g = spare.sort((x, y) => P.hand[y] - P.hand[x])[0];
    if (!S.players.some((p, i) => i !== pi && p.hand[want] > 0)) return null;
    return { t: "offer", give: { ...emptyHand(), [g]: 1 }, want: { ...emptyHand(), [want]: 1 }, to: null };
  }
  function botBankTrade(S, pi, goal) {
    const P = S.players[pi];
    const missing = RES.filter((r) => (goal.cost[r] || 0) > P.hand[r]);
    if (!missing.length) return null;
    for (const g of RES.slice().sort((x, y) => P.hand[y] - P.hand[x])) {
      const spare = P.hand[g] - (goal.cost[g] || 0), rate = portRate(S, pi, g);
      if (spare >= rate && S.bank[missing[0]] > 0) return { t: "bank", give: g, get: missing[0] };
    }
    return null;
  }
  function botAnswer(S, pi) {
    const T = S.trade, P = S.players[pi], lv = S.level || 2;
    if (!canPay(P.hand, T.want) || lv === 1 && Math.random() < 0.5) return { t: "decline" };
    const goal = botGoal(S, pi);
    // good for us: we get something we miss and give something we do not need
    const gets = RES.reduce((n, r) => n + (goal && T.give[r] && (goal.cost[r] || 0) > P.hand[r] ? T.give[r] : 0), 0);
    const loses = RES.reduce((n, r) => n + (goal ? Math.max(0, Math.min(T.want[r], (goal.cost[r] || 0) - (P.hand[r] - T.want[r]))) : 0), 0);
    if (S.players[T.from] && vpOf(S, T.from, false) >= S.target - 2 && lv >= 2) return { t: "decline" };
    const ok = gets > 0 && loses === 0 && total(T.want) <= total(T.give) + (lv === 1 ? 1 : 0);
    return { t: ok ? "accept" : "decline" };
  }
  function botTrade(S, pi) {
    const T = S.trade;
    if (T.from !== pi) return botAnswer(S, pi);
    // our own offer: every answer is in, take the first friend, or give up
    const goodOnes = T.acc.filter((i) => canPay(S.players[i].hand, T.want));
    return goodOnes.length ? { t: "confirm", with: goodOnes[0] } : { t: "cancel" };
  }
  function botMain(S, pi) {
    const P = S.players[pi], lv = S.level || 2;
    // development cards first: they cost nothing
    const playable = (k) => !S.devPlayed && P.devs.some((d) => d.k === k && d.t !== S.turn);
    if (playable("mono") && lv >= 2) {
      const best = RES.map((r) => ({ r, n: S.players.reduce((n, p, i) => n + (i === pi ? 0 : p.hand[r]), 0) })).sort((a, b) => b.n - a.n)[0];
      if (best.n >= 3) return { t: "play", card: "mono", res: best.r };
    }
    if (playable("yop")) {
      const g = botGoal(S, pi);
      if (g) {
        const miss = []; for (const r of RES) for (let i = Math.max(0, (g.cost[r] || 0) - P.hand[r]); i > 0; i--) miss.push(r);
        if (miss.length >= 1 && miss.length <= 2) { while (miss.length < 2) miss.push(miss[0]); if (RES.every((r) => miss.filter((m) => m === r).length <= S.bank[r])) return { t: "play", card: "yop", res: miss }; }
      }
    }
    if (playable("road") && P.left.road >= 1 && lv >= 2) {
      const probe = { ...S, edge: S.edge.slice() }, list = [];
      for (let i = 0; i < Math.min(2, P.left.road); i++) { const e = botRoad(probe, pi, null); if (e == null) break; list.push(e); probe.edge[e] = pi; }
      if (list.length) return { t: "play", card: "road", edges: list };
    }
    const knightHere = playable("knight") && S.hexes[S.robber] && victimsAt(S, S.robber, -1).includes(pi);
    if (playable("knight") && (knightHere || (lv >= 3 && P.knights === 2 && S.la !== pi))) return { t: "play", card: "knight" };
    // build what we can
    const goal = botGoal(S, pi);
    if (goal && RES.every((r) => (goal.cost[r] || 0) <= P.hand[r])) {
      if (goal.k === "dev") return { t: "buyDev" };
      if (goal.k === "city") {
        const list = spots(S, pi, "city").sort((a, b) => vertPips(S, b) - vertPips(S, a));
        return { t: "build", k: "city", id: list[0] };
      }
      if (goal.k === "settlement") return { t: "build", k: "settlement", id: botSettle(S, pi, false) };
      const e = botRoad(S, pi, null);
      if (e != null) return { t: "build", k: "road", id: e };
    }
    // trade towards the goal
    if (goal && lv >= 2) {
      const b = S.bankN < 6 ? botBankTrade(S, pi, goal) : null;
      if (b) return b;
      if (S.offers < (lv >= 3 ? 2 : 1) && S.players.some((p, i) => i !== pi)) { const o = botOffersFor(S, pi, goal); if (o) return o; }
    }
    return { t: "end" };
  }
  // The computer's next move for `pi` when it has to act (also discards, answers to offers), or null.
  function botMove(S, pi) {
    if (!Number.isInteger(pi) || S.phase !== "play" || !actors(S).includes(pi)) return null;
    switch (S.step) {
      case "settle": { const v = botSettle(S, pi, true); return v == null ? null : { t: "build", k: "settlement", id: v }; }
      case "sroad": { const e = botRoad(S, pi, S.setupV); return e == null ? null : { t: "build", k: "road", id: e }; }
      case "discard": return { t: "discard", res: botDiscard(S, pi) };
      case "robber": return botRobber(S, pi);
      default: break;
    }
    if (S.trade) return botTrade(S, pi);
    if (S.step === "roll") {
      const P = S.players[pi];
      if (!S.devPlayed && P.devs.some((d) => d.k === "knight" && d.t !== S.turn) && (S.level || 2) >= 2 && victimsAt(S, S.robber, -1).includes(pi)) return { t: "play", card: "knight" };
      return { t: "roll" };
    }
    return botMain(S, pi);
  }
  // When and who: the server and the single-player page both ask this, `key` changes whenever the plan does.
  function botPlan(S) {
    const list = actors(S), who = list.find((i) => S.players[i].bot);
    if (who == null) return null;
    return { pi: who, delay: Math.max(900, S.pace || 0), key: `c${S.seq}:${who}` };
  }

  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
  // The board and the counts are public; hands and development cards are only sent to their owner.
  function view(S, pi) {
    const me = S.players[pi] ? pi : -1, over = S.phase === "roundEnd";
    const T = S.trade;
    return {
      me, phase: S.phase, step: S.step, cur: S.cur, actor: actorOf(S), turn: S.turn, round: S.round, goal: S.goal, target: S.target, level: S.level || 2,
      hexes: S.hexes.map((h) => ({ res: h.res, num: h.num })), ports: S.ports.slice(), vert: S.vert.map((b) => b && { o: b.o, c: b.c }), edge: S.edge.slice(),
      robber: S.robber, dice: S.dice ? S.dice.slice() : null, bank: { ...S.bank }, deck: S.deck.length, devPlayed: S.devPlayed, setupV: S.setupV,
      lr: S.lr, la: S.la, disc: { ...S.disc }, offers: S.offers,
      trade: T && { from: T.from, give: { ...T.give }, want: { ...T.want }, to: T.to, acc: T.acc.slice(), dec: T.dec.slice(), left: T.until > 0 ? Math.max(0, T.until - Date.now()) : 0 },
      hand: me >= 0 ? { ...S.players[me].hand } : null,
      devs: me >= 0 ? S.players[me].devs.map((d) => ({ k: d.k, ok: d.t !== S.turn })) : [],
      players: S.players.map((p, i) => ({
        name: p.name, bot: p.bot, avatar: avatarOf(p, i), wins: p.wins, n: total(p.hand), dev: p.devs.length, knights: p.knights, len: p.len, left: { ...p.left },
        vp: vpOf(S, i, false), vpCards: over || i === me ? p.devs.filter((d) => d.k === "vp").length : 0
      })),
      log: S.log.slice(), last: clone(S.last), nextStarter: S.starter % S.players.length
    };
  }

  return {
    MAX_PLAYERS, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, TARGETS, RES, RES_NAMES, COST, PIECES, DEV_DECK, DEV_NAMES, HAND_LIMIT, TRADE_MS,
    GEO, HEX_N, VERT_N, EDGE_N, pips,
    normGoal, normTarget, normLevel, newGame, startRound, act, tick, nextDeadline, botMove, botPlan, view,
    actors, actorOf, vpOf, total, canPay, settleOk, roadOk, cityOk, spots, portRate, roadLength, victimsAt, emptyHand, cleanHand, handText
  };
});
