// Rummikub engine. Pure state + rules, shared by the browser (single player) and the Node server
// (online). No DOM, no I/O.
//
// 106 tiles: ids 0..103 are the numbers (id = color * 26 + (number - 1) * 2 + copy), 104 and 105 are the jokers.
// The table is a list of sets (arrays of tile ids). A turn is one {t:"commit", table} (the player's rearranged table,
// the rack tiles that moved onto it are the difference) or {t:"draw"}. The engine checks the whole thing, so a client
// can try anything on its own working copy first. Runs and groups are stored in a normal order (see analyze).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RummikubGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 4;
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip", "Pixel Paula", "Byte Ben", "Turbo Tina", "Nano Nick", "Zack Zora", "Bit Bruno"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi" };
  const MELDS = { 30: "Ab 30 Punkten", 20: "Ab 20 Punkten", 0: "Ohne Einstieg" };
  const NTILES = 106, JOKER0 = 104, HAND = 14, MAX_SETS = 35;

  const normGoal = (n) => ([1, 2, 3].includes(+n) ? +n : 1);
  const normMeld = (n) => (Object.prototype.hasOwnProperty.call(MELDS, +n) ? +n : 30);
  const normLevel = (n) => (LEVELS[+n] ? +n : 2);
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);

  // ---------- tiles ----------
  const isJoker = (id) => id >= JOKER0;
  const colorOf = (id) => (id >= JOKER0 ? -1 : Math.floor(id / 26));
  const numOf = (id) => (id >= JOKER0 ? 0 : ((id % 26) >> 1) + 1);
  const pointsOf = (id) => (id >= JOKER0 ? 30 : numOf(id));
  const rackPoints = (rack) => rack.reduce((s, id) => s + pointsOf(id), 0);

  function shuffled() {
    const d = Array.from({ length: NTILES }, (_, i) => i);
    for (let i = d.length - 1; i > 0; i--) { const j = rand(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }

  // Is this a valid set? Returns { kind: "run" | "group", order, value } or null. `order` is the tiles in their
  // proper place (a run counts up, jokers sit where they stand in), `value` the points the set is worth for the
  // first meld. Where a joker could go either way (5 6 joker) it goes on top, which is worth more.
  function analyze(ids) {
    const n = ids.length;
    if (n < 3 || n > 13) return null;
    const real = [], jokers = [];
    for (const id of ids) (isJoker(id) ? jokers : real).push(id);
    if (!real.length) return null;
    let best = null;
    if (n <= 4) {
      const num = numOf(real[0]);
      let seen = 0, ok = true;
      for (const id of real) {
        const bit = 1 << colorOf(id);
        if (numOf(id) !== num || (seen & bit)) { ok = false; break; }
        seen |= bit;
      }
      if (ok) best = { kind: "group", order: real.slice().sort((a, b) => colorOf(a) - colorOf(b)).concat(jokers), value: num * n };
    }
    const col = colorOf(real[0]);
    if (real.every((id) => colorOf(id) === col)) {
      const sorted = real.slice().sort((a, b) => numOf(a) - numOf(b));
      let distinct = true;
      for (let i = 1; i < sorted.length; i++) if (numOf(sorted[i]) === numOf(sorted[i - 1])) distinct = false;
      const lo = numOf(sorted[0]), hi = numOf(sorted[sorted.length - 1]);
      const gaps = hi - lo + 1 - real.length;
      if (distinct && gaps <= jokers.length) {
        const extra = jokers.length - gaps;
        const up = Math.min(extra, 13 - hi), start = lo - (extra - up);
        if (start >= 1) {
          const byNum = new Map(sorted.map((id) => [numOf(id), id]));
          const js = jokers.slice(), order = [];
          let value = 0;
          for (let p = start; p < start + n; p++) { order.push(byNum.has(p) ? byNum.get(p) : js.pop()); value += p; }
          if (!best || value > best.value) best = { kind: "run", order, value };
        }
      }
    }
    return best;
  }

  const setKey = (set) => set.slice().sort((a, b) => a - b).join(",");

  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 60) S.log.shift();
  }

  // players: [{ name, bot, avatar }]; goal: rounds to win; meld: points of the first meld; level: computer strength
  function newGame(players, goal, meld, level) {
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p, i) => ({ name: p.name, bot: !!p.bot, avatar: avatarOf(p, i), wins: 0, score: 0, moves: 0, rack: [], melded: false })),
      goal: normGoal(goal), meld: normMeld(meld), level: normLevel(level),
      round: 0, starter: 0, log: [], last: null, table: [], pool: [], passes: 0
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
    S.table = [];
    S.pool = shuffled();
    S.passes = 0;
    S.turn = 0;
    S.players.forEach((p) => { p.rack = S.pool.splice(0, HAND).sort((a, b) => a - b); p.moves = 0; p.melded = S.meld === 0; });
    const first = S.starter % S.players.length;
    S.starter = (S.starter + 1) % S.players.length;
    log(S, `Runde ${S.round}: ${S.players[first].name} beginnt.`);
    beginTurn(S, first);
  }

  function beginTurn(S, pi) {
    S.cur = pi;
    S.turn++;
  }

  // The round is over: `winner` emptied the rack (or has the fewest points when nobody can move any more).
  // Winner: + the points of all other racks, the others: - their own rack.
  function endRound(S, winner, events, how) {
    const pts = S.players.map((p) => rackPoints(p.rack));
    S.players.forEach((p, i) => { if (i === winner) p.score += pts.reduce((s, v) => s + v, 0) - pts[i]; else p.score -= pts[i]; });
    S.players[winner].wins++;
    const over = S.players[winner].wins >= S.goal;
    S.phase = "roundEnd";
    S.cur = -1;
    S.last = { winners: [winner], over, how: how || "out", racks: S.players.map((p) => p.rack.slice()), pts, moves: S.players.reduce((n, p) => n + p.moves, 0) };
    log(S, `${S.players[winner].name} ${over ? "gewinnt das Spiel" : "gewinnt die Runde"}!`);
    events.push({ t: "end", winners: [winner], how: S.last.how });
  }

  // The table a commit asks for: sets of distinct, valid tile ids. Returns the normalised sets or null.
  function parseTable(t) {
    if (!Array.isArray(t) || t.length > MAX_SETS) return null;
    const seen = new Set(), out = [];
    for (const set of t) {
      if (!Array.isArray(set) || set.length > 13) return null;
      for (const id of set) {
        if (!Number.isInteger(id) || id < 0 || id >= NTILES || seen.has(id)) return null;
        seen.add(id);
      }
      const a = analyze(set);
      if (!a) return null;
      out.push(a);
    }
    return out;
  }

  // Check a whole rearranged table against the rules; { error } or { sets, added, value }.
  function checkCommit(S, P, tableIn) {
    const sets = parseTable(tableIn);
    if (!sets) return { error: "Auf dem Tisch liegt eine ungültige Reihe oder Gruppe." };
    const old = new Set();
    for (const s of S.table) for (const id of s) old.add(id);
    const now = new Set();
    for (const s of sets) for (const id of s.order) now.add(id);
    for (const id of old) if (!now.has(id)) return { error: "Plättchen vom Tisch dürfen nicht in den Ständer zurück." };
    const rack = new Set(P.rack);
    const added = [];
    for (const id of now) if (!old.has(id)) { if (!rack.has(id)) return { error: "Dieses Plättchen gehört dir nicht." }; added.push(id); }
    if (!added.length) return { error: "Lege mindestens ein Plättchen aus deinem Ständer." };
    let value = 0;
    if (!P.melded) {
      // first meld: the table stays as it is, the new sets come from the rack alone and add up to the limit
      const keep = new Map();
      for (const s of S.table) keep.set(setKey(s), (keep.get(setKey(s)) || 0) + 1);
      for (const s of sets) {
        const k = setKey(s.order);
        if (keep.get(k)) { keep.set(k, keep.get(k) - 1); continue; }
        if (s.order.some((id) => old.has(id))) return { error: `Vor dem Einstieg darfst du den Tisch nicht umbauen.` };
        value += s.value;
      }
      for (const left of keep.values()) if (left) return { error: `Vor dem Einstieg darfst du den Tisch nicht umbauen.` };
      if (value < S.meld) return { error: `Zum Einstieg brauchst du mindestens ${S.meld} Punkte aus deinem Ständer (jetzt ${value}).` };
    }
    return { sets, added, value };
  }

  // Apply an action by player `pi`. Returns { ok, error?, events }.
  // Actions: {t:"commit", table:[[id,..],..]} {t:"draw"} {t:"giveup"} {t:"skip"} {t:"next"}
  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events });
    const ok = () => ({ ok: true, events });
    const P = S.players[pi];
    if (!P) return fail("Unbekannter Spieler.");
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
      if (S.last && S.last.over) { S.players.forEach((p) => { p.wins = 0; p.score = 0; }); S.round = 0; }
      startRound(S);
      return ok();
    }
    if (S.phase !== "play") return fail("Gerade ist niemand dran.");
    if (a.t === "skip") { // the host moves on when the current player is away
      log(S, `${S.players[S.cur].name} wird übersprungen.`);
      beginTurn(S, (S.cur + 1) % S.players.length);
      return ok();
    }
    if (a.t === "giveup") { // the one with the fewest points left among the others wins the round
      log(S, `${P.name} gibt auf.`);
      events.push({ t: "giveup", pi });
      const rest = S.players.map((p, i) => i).filter((i) => i !== pi).sort((x, y) => rackPoints(S.players[x].rack) - rackPoints(S.players[y].rack));
      endRound(S, rest[0], events, "giveup");
      return ok();
    }
    if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);

    if (a.t === "draw") {
      P.moves++;
      const empty = !S.pool.length;
      if (empty) {
        S.passes++;
        log(S, `${P.name} setzt aus.`);
      } else {
        S.passes = 0;
        P.rack.push(S.pool.pop());
        log(S, `${P.name} zieht ein Plättchen.`);
      }
      events.push({ t: "draw", pi, empty });
      if (S.passes >= S.players.length) { // the pool is empty and nobody can play any more
        const order = S.players.map((p, i) => i).sort((x, y) => rackPoints(S.players[x].rack) - rackPoints(S.players[y].rack));
        endRound(S, order[0], events, "blocked");
        return ok();
      }
      beginTurn(S, (pi + 1) % S.players.length);
      return ok();
    }
    if (a.t === "commit") {
      const c = checkCommit(S, P, a.table);
      if (c.error) return fail(c.error);
      const first = !P.melded;
      P.melded = true;
      P.moves++;
      const mine = new Set(c.added);
      P.rack = P.rack.filter((id) => !mine.has(id));
      S.table = c.sets.map((s) => s.order);
      S.passes = 0;
      log(S, `${P.name} legt ${c.added.length} Plättchen${first && S.meld ? ` (Einstieg mit ${c.value} Punkten)` : ""}.`);
      events.push({ t: "play", pi, added: c.added, first });
      if (!P.rack.length) { endRound(S, pi, events, "out"); return ok(); }
      beginTurn(S, (pi + 1) % S.players.length);
      return ok();
    }
    return fail("Unbekannte Aktion.");
  }

  // ---------- computer player ----------
  // The search: cover every table tile (mandatory) and as many rack tiles (optional) as possible with valid
  // sets. Tile types are ordered by (number, color); a[i] = units of type i still open, m[i] how many of
  // those must be used. Jokers are a plain count: ja available, jm of them mandatory (already on the table).
  // thr > 0 (first meld): look for the best set of sets worth at least thr points instead of the most tiles.
  const tIdx = (id) => (numOf(id) - 1) * 4 + colorOf(id);

  function solve(a, m, ja, jm, thr, budget) {
    let nodes = 0, best = null, bestScore = -1;
    const path = [];
    const take = (i) => { const was = m[i] > 0; a[i]--; if (was) m[i]--; return was; };
    const put = (i, was) => { a[i]++; if (was) m[i]++; };
    const open = () => { let s = 0; for (let i = 0; i < 52; i++) s += a[i]; return s; };
    function rec(i, jused, units, value) {
      if (++nodes > budget) return;
      while (i < 52 && a[i] === 0) i++;
      if (i >= 52) {
        if (jused < jm) return;
        const score = thr ? (value >= thr ? 1e6 + units * 1000 + value : value) : units;
        if (score > bestScore) { bestScore = score; best = path.slice(); }
        return;
      }
      if (!thr && units + open() + (ja - jused) <= bestScore) return;
      const n = (i >> 2) + 1, c = i & 3;
      // runs: k jokers below this tile, then upwards one tile or joker per number
      for (let k = 0; k <= 2 && jused + k <= ja && n - k >= 1; k++) {
        const cells = new Array(k).fill(-1), taken = [];
        let jl = jused + k, len = k + 1, val = n;
        for (let q = n - k; q < n; q++) val += q;
        taken.push([i, take(i)]); cells.push(i);
        for (let p = n + 1; p <= 13; p++) {
          const ti = (p - 1) * 4 + c;
          if (a[ti] > 0) { taken.push([ti, take(ti)]); cells.push(ti); } else if (jl < ja) { jl++; cells.push(-1); } else break;
          len++; val += p;
          if (len >= 3) {
            path.push(cells.slice());
            rec(i, jl, units + len, value + val);
            path.pop();
            if (nodes > budget) break;
          }
        }
        for (let t = taken.length - 1; t >= 0; t--) put(taken[t][0], taken[t][1]);
        if (nodes > budget) return;
      }
      // groups: this tile plus higher colors of the same number, jokers filling up to 3 or 4
      for (let mask = 0; mask < 8; mask++) {
        const cs = [c];
        for (let b = 0; b < 3; b++) if (mask & (1 << b)) cs.push(c + 1 + b);
        if (cs.some((x) => x > 3 || a[(n - 1) * 4 + x] === 0)) continue;
        const s = cs.length, real = cs.map((x) => (n - 1) * 4 + x);
        for (let j = Math.max(0, 3 - s); s + j <= 4 && jused + j <= ja; j++) {
          const was = real.map(take);
          path.push(real.concat(new Array(j).fill(-1)));
          rec(i, jused + j, units + s + j, value + n * (s + j));
          path.pop();
          for (let t = real.length - 1; t >= 0; t--) put(real[t], was[t]);
          if (nodes > budget) return;
        }
      }
      // leave this (optional) tile unused
      if (a[i] > m[i]) { a[i]--; rec(i, jused, units, value); a[i]++; }
    }
    rec(0, 0, 0, 0);
    return best;
  }

  // Tile ids by type (and jokers), tiles of `first` before those of `second`
  function pools(first, second) {
    const by = Array.from({ length: 52 }, () => []), jk = [];
    for (const id of first.concat(second)) (isJoker(id) ? jk : by[tIdx(id)]).push(id);
    return { by, jk };
  }
  function counts(ids) {
    const a = new Array(52).fill(0);
    let j = 0;
    for (const id of ids) { if (isJoker(id)) j++; else a[tIdx(id)]++; }
    return { a, j };
  }
  // turn a solver result (lists of type cells, -1 = joker) into sets of real tile ids
  function realise(sets, pl) {
    const by = pl.by.map((l) => l.slice()), jk = pl.jk.slice();
    return sets.map((cells) => cells.map((x) => (x < 0 ? jk.shift() : by[x].shift())));
  }

  // The move a computer player makes: a table to commit, or null (draw).
  function planTable(S, P, level) {
    const flat = [].concat(...S.table);
    let table = null;
    if (P.melded && level === 3) {
      const t = counts(flat), r = counts(P.rack);
      const a = t.a.map((v, i) => v + r.a[i]), m = t.a.slice();
      const res = solve(a, m, t.j + r.j, t.j, 0, 20000);
      if (res) table = realise(res, pools(flat, P.rack));
    } else {
      let rack = P.rack, base = S.table.map((s) => s.slice());
      if (P.melded && level === 2) { // add single tiles to what lies on the table
        let again = true;
        while (again) {
          again = false;
          for (const id of rack.filter((x) => !isJoker(x))) {
            const set = base.find((s) => analyze(s.concat([id])));
            if (set) { set.push(id); rack = rack.filter((x) => x !== id); again = true; break; }
          }
        }
      }
      if (P.melded && level === 1 && Math.random() < 0.25) return null;
      const r = counts(rack);
      const res = solve(r.a, new Array(52).fill(0), r.j, 0, P.melded ? 0 : S.meld, 8000);
      const fresh = res ? realise(res, pools(rack, [])) : [];
      table = base.concat(fresh);
    }
    return table;
  }

  function botMove(S, pi) {
    if (S.phase !== "play" || S.cur !== pi) return null;
    const P = S.players[pi];
    const table = planTable(S, P, S.level || 2);
    if (table && !checkCommit(S, P, table).error) return { t: "commit", table };
    return { t: "draw" };
  }

  // a human-paced delay before the computer moves; the key changes only when the plan does
  function botPlan(S) {
    if (S.phase !== "play" || !S.players[S.cur] || !S.players[S.cur].bot) return null;
    return { pi: S.cur, key: `bot:${S.round}:${S.turn}`, delay: 1400 + rand(900) };
  }

  // Everything on the table is public, the racks are private (only the count and, at the end, the rack).
  function view(S, pi) {
    const me = S.players[pi] ? pi : -1;
    return {
      me, phase: S.phase, cur: S.cur, turn: S.turn, round: S.round, goal: S.goal, meld: S.meld, level: S.level || 2,
      pool: S.pool.length, table: S.table.map((s) => s.slice()), rack: me >= 0 ? S.players[me].rack.slice() : [],
      players: S.players.map((p, i) => ({ name: p.name, bot: p.bot, avatar: avatarOf(p, i), wins: p.wins, score: p.score, moves: p.moves || 0, count: p.rack.length, melded: p.melded })),
      log: S.log.slice(), last: S.last, nextStarter: S.starter % S.players.length
    };
  }

  return { MAX_PLAYERS, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, MELDS, HAND, normGoal, normMeld, normLevel, newGame, startRound, act, botMove, botPlan, view, analyze, isJoker, colorOf, numOf, pointsOf, rackPoints };
});
