// Schach engine. Pure state + rules, shared by the browser (single player) and the Node server (online).
// No DOM, no I/O.
//
// Board: 8x8, square index = rank * 8 + file, rank 0 is white's home row (a1 = 0, h8 = 63).
// Piece value: 0 empty, else type | colour << 3 with type 1 pawn, 2 knight, 3 bishop, 4 rook, 5 queen, 6 king
// and colour 0 white / 1 black. S.col[pi] is the colour of player pi; it swaps every round so everybody gets to begin.
// A move is a packed int: from | to << 6 | promo << 12 | flags << 16 (1 en passant, 2 castle short, 4 castle long,
// 8 double pawn push, 16 capture).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SchachGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 2;
  const COLORS = ["Weiß", "Schwarz"];
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi", 0: "Zufällig" };
  const CLOCK_MS = 300000, INC_MS = 3000, GRACE = 600; // 5 minutes per player, plus 3 seconds per move
  const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  const LETTER = ["", "", "S", "L", "T", "D", "K"]; // German piece letters in move notation (Springer, Läufer, Turm, Dame, König)
  const NAMES = ["", "Bauer", "Springer", "Läufer", "Turm", "Dame", "König"];
  const VALUE = [0, 100, 320, 330, 500, 900, 0];

  const RULES = [
    { k: "clock", name: "Schachuhr", desc: "5 Minuten pro Spieler plus 3 Sekunden pro Zug. Wer keine Zeit mehr hat, verliert." }
  ];
  function normRules(r) {
    const o = {};
    for (const x of RULES) o[x.k] = !!(r && r[x.k] === true);
    return o;
  }
  const normGoal = (n) => ([1, 2, 3].includes(+n) ? +n : 1);
  const normLevel = (n) => (n != null && n !== "" && LEVELS[+n] ? +n : 2);
  // level 0 = random: every computer player got its own strength when the game started
  const lvOf = (S, pi) => S.level || (S.players && S.players[pi] && S.players[pi].lvl) || 2;
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);

  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 80) S.log.shift();
  }

  // ---------- board tables ----------
  const sq = (i) => "abcdefgh"[i & 7] + ((i >> 3) + 1);
  const colour = (v) => v >> 3, type = (v) => v & 7;
  const KNIGHT = [], KING = [], RAYS = []; // RAYS[s][0..3] straight, [4..7] diagonal
  (function () {
    const kn = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
    const ki = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let s = 0; s < 64; s++) {
      const r = s >> 3, c = s & 7;
      KNIGHT[s] = []; KING[s] = []; RAYS[s] = [];
      for (const [dr, dc] of kn) if (r + dr >= 0 && r + dr < 8 && c + dc >= 0 && c + dc < 8) KNIGHT[s].push((r + dr) * 8 + c + dc);
      for (const [dr, dc] of ki) {
        if (r + dr >= 0 && r + dr < 8 && c + dc >= 0 && c + dc < 8) KING[s].push((r + dr) * 8 + c + dc);
        const ray = [];
        for (let rr = r + dr, cc = c + dc; rr >= 0 && rr < 8 && cc >= 0 && cc < 8; rr += dr, cc += dc) ray.push(rr * 8 + cc);
        RAYS[s].push(ray);
      }
    }
  })();
  // castling rights bits: 1 white short, 2 white long, 4 black short, 8 black long
  const MASK = new Array(64).fill(15);
  MASK[4] = 12; MASK[0] = 13; MASK[7] = 14; MASK[60] = 3; MASK[56] = 7; MASK[63] = 11;

  const BACK = [R, N, B, Q, K, B, N, R];
  function startGrid() {
    const g = new Array(64).fill(0);
    for (let c = 0; c < 8; c++) { g[c] = BACK[c]; g[8 + c] = P; g[48 + c] = P | 8; g[56 + c] = BACK[c] | 8; }
    return g;
  }

  // ---------- position, move generation ----------
  function newPos(grid, side, castle, ep, half) {
    const g = Int8Array.from(grid);
    const pos = { g, side, castle, ep, half, k: [-1, -1], st: [], ply: 0 };
    for (let i = 0; i < 64; i++) if (type(g[i]) === K) pos.k[colour(g[i])] = i;
    for (let i = 0; i < 160; i++) pos.st.push({ m: 0, cap: 0, castle: 0, ep: -1, half: 0 });
    return pos;
  }
  const posOf = (S) => newPos(S.grid, S.side, S.castle, S.ep, S.half);

  function attacked(pos, s, by) {
    const g = pos.g, r = s >> 3, c = s & 7;
    const pr = by ? r + 1 : r - 1; // an attacking pawn stands one rank behind the target, seen from its own side
    if (pr >= 0 && pr < 8) {
      if (c > 0 && g[pr * 8 + c - 1] === (P | by << 3)) return true;
      if (c < 7 && g[pr * 8 + c + 1] === (P | by << 3)) return true;
    }
    const kn = N | by << 3, ki = K | by << 3;
    for (const t of KNIGHT[s]) if (g[t] === kn) return true;
    for (const t of KING[s]) if (g[t] === ki) return true;
    const rook = R | by << 3, bishop = B | by << 3, queen = Q | by << 3, rays = RAYS[s];
    for (let d = 0; d < 8; d++) {
      const ray = rays[d];
      for (let i = 0; i < ray.length; i++) {
        const v = g[ray[i]];
        if (!v) continue;
        if (v === queen || v === (d < 4 ? rook : bishop)) return true;
        break;
      }
    }
    return false;
  }
  const inCheck = (pos) => attacked(pos, pos.k[pos.side], pos.side ^ 1);

  // pseudo-legal moves; caps: only captures and promotions (for the quiescence search)
  function gen(pos, caps) {
    const g = pos.g, side = pos.side, out = [], base = side ? 56 : 0;
    for (let s = 0; s < 64; s++) {
      const v = g[s];
      if (!v || colour(v) !== side) continue;
      const t = type(v), r = s >> 3, c = s & 7;
      if (t === P) {
        const dr = side ? -1 : 1, r1 = r + dr, last = side ? 0 : 7;
        for (let dc = -1; dc <= 1; dc += 2) {
          const c1 = c + dc;
          if (c1 < 0 || c1 > 7) continue;
          const to = r1 * 8 + c1, tv = g[to];
          if (tv && colour(tv) !== side) {
            if (r1 === last) for (let p = Q; p >= N; p--) out.push(s | to << 6 | p << 12 | 16 << 16);
            else out.push(s | to << 6 | 16 << 16);
          } else if (!tv && to === pos.ep) out.push(s | to << 6 | 17 << 16);
        }
        const to = r1 * 8 + c;
        if (!g[to] && (!caps || r1 === last)) {
          if (r1 === last) for (let p = Q; p >= N; p--) out.push(s | to << 6 | p << 12);
          else {
            out.push(s | to << 6);
            if (r === (side ? 6 : 1) && !g[to + dr * 8]) out.push(s | (to + dr * 8) << 6 | 8 << 16);
          }
        }
      } else if (t === N || t === K) {
        for (const to of t === N ? KNIGHT[s] : KING[s]) {
          const tv = g[to];
          if (!tv) { if (!caps) out.push(s | to << 6); } else if (colour(tv) !== side) out.push(s | to << 6 | 16 << 16);
        }
      } else {
        const rays = RAYS[s];
        for (let d = t === B ? 4 : 0; d < (t === R ? 4 : 8); d++) {
          const ray = rays[d];
          for (let i = 0; i < ray.length; i++) {
            const to = ray[i], tv = g[to];
            if (!tv) { if (!caps) out.push(s | to << 6); continue; }
            if (colour(tv) !== side) out.push(s | to << 6 | 16 << 16);
            break;
          }
        }
      }
    }
    if (!caps && g[base + 4] === (K | side << 3) && pos.castle & (side ? 12 : 3)) {
      const rook = R | side << 3, foe = side ^ 1;
      if (pos.castle & (side ? 4 : 1) && g[base + 7] === rook && !g[base + 5] && !g[base + 6] && !attacked(pos, base + 4, foe) && !attacked(pos, base + 5, foe))
        out.push((base + 4) | (base + 6) << 6 | 2 << 16);
      if (pos.castle & (side ? 8 : 2) && g[base] === rook && !g[base + 1] && !g[base + 2] && !g[base + 3] && !attacked(pos, base + 4, foe) && !attacked(pos, base + 3, foe))
        out.push((base + 4) | (base + 2) << 6 | 4 << 16);
    }
    return out;
  }

  function make(pos, m) {
    const from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 15, fl = m >> 16, g = pos.g, side = pos.side;
    const u = pos.st[pos.ply++];
    u.m = m; u.castle = pos.castle; u.ep = pos.ep; u.half = pos.half;
    const v = g[from];
    let cap = g[to];
    if (fl & 1) { const cs = to + (side ? 8 : -8); cap = g[cs]; g[cs] = 0; }
    u.cap = cap;
    g[from] = 0;
    g[to] = promo ? promo | side << 3 : v;
    if (fl & 2) { const b = side ? 56 : 0; g[b + 5] = g[b + 7]; g[b + 7] = 0; }
    if (fl & 4) { const b = side ? 56 : 0; g[b + 3] = g[b]; g[b] = 0; }
    if (type(v) === K) pos.k[side] = to;
    pos.castle &= MASK[from] & MASK[to];
    pos.ep = fl & 8 ? (from + to) >> 1 : -1;
    pos.half = type(v) === P || cap ? 0 : pos.half + 1;
    pos.side = side ^ 1;
    return u;
  }
  function unmake(pos) {
    const u = pos.st[--pos.ply], m = u.m, from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 15, fl = m >> 16, g = pos.g;
    const side = pos.side ^ 1;
    pos.side = side;
    const v = promo ? P | side << 3 : g[to];
    g[from] = v;
    g[to] = 0;
    if (fl & 1) g[to + (side ? 8 : -8)] = u.cap; else g[to] = u.cap;
    if (fl & 2) { const b = side ? 56 : 0; g[b + 7] = g[b + 5]; g[b + 5] = 0; }
    if (fl & 4) { const b = side ? 56 : 0; g[b] = g[b + 3]; g[b + 3] = 0; }
    if (type(v) === K) pos.k[side] = from;
    pos.castle = u.castle; pos.ep = u.ep; pos.half = u.half;
  }

  function legal(pos) {
    const list = gen(pos, false), out = [], me = pos.side;
    for (const m of list) {
      make(pos, m);
      if (!attacked(pos, pos.k[me], me ^ 1)) out.push(m);
      unmake(pos);
    }
    return out;
  }
  const hasMove = (pos) => legal(pos).length > 0;

  // standard algebraic notation with German piece letters: Sf3, Dxd5+, 0-0, e8=D#
  function san(pos, m, list) {
    const from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 15, fl = m >> 16, t = type(pos.g[from]);
    let s;
    if (fl & 2) s = "0-0";
    else if (fl & 4) s = "0-0-0";
    else {
      s = LETTER[t];
      if (t === P) { if (fl & 16) s += "abcdefgh"[from & 7]; } else {
        const rivals = list.filter((x) => (x & 63) !== from && ((x >> 6) & 63) === to && type(pos.g[x & 63]) === t);
        if (rivals.length) {
          if (!rivals.some((x) => (x & 7) === (from & 7))) s += "abcdefgh"[from & 7];
          else if (!rivals.some((x) => (x & 63) >> 3 === from >> 3)) s += (from >> 3) + 1;
          else s += sq(from);
        }
      }
      if (fl & 16) s += "x";
      s += sq(to);
      if (promo) s += "=" + LETTER[promo];
    }
    make(pos, m);
    if (inCheck(pos)) s += hasMove(pos) ? "+" : "#";
    unmake(pos);
    return s;
  }

  const keyOf = (pos) => {
    let s = "";
    for (let i = 0; i < 64; i++) s += String.fromCharCode(48 + pos.g[i]);
    // the en passant square only counts when a pawn could really take
    let ep = -1;
    if (pos.ep >= 0) {
      const pr = pos.ep >> 3, pc = pos.ep & 7, mine = P | pos.side << 3, row = pos.side ? pr + 1 : pr - 1;
      if ((pc > 0 && pos.g[row * 8 + pc - 1] === mine) || (pc < 7 && pos.g[row * 8 + pc + 1] === mine)) ep = pos.ep;
    }
    return s + pos.side + pos.castle + ep;
  };

  // can `col` still win on material? (a pawn, rook, queen or two minor pieces)
  function canMate(g, col) {
    let minors = 0;
    for (let i = 0; i < 64; i++) {
      const v = g[i];
      if (!v || colour(v) !== col) continue;
      const t = type(v);
      if (t === P || t === R || t === Q) return true;
      if (t === N || t === B) minors++;
    }
    return minors >= 2;
  }
  // neither side can ever mate: K v K, K+minor v K, K+B v K+B on the same colour
  function deadPosition(g) {
    const list = [[], []];
    for (let i = 0; i < 64; i++) {
      const v = g[i];
      if (v && type(v) !== K) list[colour(v)].push([type(v), i]);
    }
    if (list.some((l) => l.some(([t]) => t === P || t === R || t === Q))) return false;
    const a = list[0], b = list[1];
    if (a.length + b.length <= 1) return true;
    if (a.length === 1 && b.length === 1 && a[0][0] === B && b[0][0] === B) {
      const sh = (x) => ((x[1] >> 3) + (x[1] & 7)) % 2;
      return sh(a[0]) === sh(b[0]);
    }
    return false;
  }

  // ---------- game flow ----------
  // players: [{ name, bot, avatar }] (2); goal: wins needed; rules: see RULES; level: computer strength
  function newGame(players, goal, rules, level) {
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p, i) => ({ name: p.name, bot: !!p.bot, lvl: 1 + Math.floor(Math.random() * 3), avatar: avatarOf(p, i), wins: 0 })),
      goal: normGoal(goal), rules: normRules(rules), level: normLevel(level),
      round: 0, turn: 0, starter: rand(2), draws: 0, log: [], last: null, lastMove: null, deadline: 0
    };
    startRound(S);
    return S;
  }

  function startRound(S) {
    S.round++;
    S.grid = startGrid();
    S.side = 0; S.castle = 15; S.ep = -1; S.half = 0;
    S.phase = "play";
    S.last = null;
    S.lastMove = null;
    S.log = [];
    S.players.forEach((p) => { p.moves = 0; });
    S.hist = [];
    S.turn = 0;
    S.times = [CLOCK_MS, CLOCK_MS];
    const first = S.starter % 2;
    S.starter = (S.starter + 1) % 2;
    S.col = first === 0 ? [0, 1] : [1, 0]; // white always begins
    S.keys = [keyOf(posOf(S))];
    log(S, `Runde ${S.round}: ${S.players[first].name} spielt Weiß und beginnt.`);
    beginTurn(S, first);
  }

  // the clock of a human player runs while it is their turn; the computer does not use up time
  function armClock(S, now) {
    now = now || Date.now();
    const P = S.players[S.cur];
    S.stamp = now;
    S.deadline = S.phase === "play" && P && !P.bot && S.rules.clock ? now + S.times[S.cur] : 0;
  }
  function beginTurn(S, pi) {
    S.cur = pi;
    S.turn++;
    armClock(S);
  }

  const REASON = {
    mate: "Schachmatt", stalemate: "Patt: der Spieler am Zug kann nicht ziehen, steht aber nicht im Schach.", giveup: "der Gegner gibt auf",
    timeout: "die Zeit des Gegners ist abgelaufen", repetition: "Unentschieden: dieselbe Stellung zum dritten Mal.",
    fifty: "Unentschieden: 50 Züge ohne Bauernzug oder Schlag.", material: "Unentschieden: zu wenig Material für ein Matt."
  };
  function endRound(S, winners, why, events) {
    for (const i of winners) S.players[i].wins++;
    if (!winners.length) S.draws++;
    const over = winners.some((i) => S.players[i].wins >= S.goal);
    S.phase = "roundEnd";
    S.cur = -1;
    S.deadline = 0;
    S.last = { winners, over, why, moves: S.hist.length };
    log(S, winners.length ? `${S.players[winners[0]].name} ${over ? "gewinnt das Spiel" : "gewinnt die Runde"}: ${REASON[why]}${why === "mate" ? "!" : "."}` : REASON[why]);
    events.push({ t: "end", winners, why });
  }

  const typeOfCaptured = (v) => type(v);
  // play one legal move (packed int) for player pi and look at how the round goes on
  function play(S, pi, m, events, now) {
    now = now || Date.now();
    const P0 = S.players[pi], pos = posOf(S), list = legal(pos), text = san(pos, m, list);
    const from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 15, fl = m >> 16, piece = pos.g[from];
    const side = pos.side;
    if (S.rules.clock && !P0.bot) S.times[pi] = Math.max(0, S.times[pi] - (now - (S.stamp || now))) + INC_MS;
    const u = make(pos, m);
    const capSq = fl & 1 ? to + (side ? 8 : -8) : fl & 16 ? to : -1;
    const castle = fl & 2 ? [from + 3, from + 1] : fl & 4 ? [from - 4, from - 1] : null;
    const check = inCheck(pos);
    S.grid = Array.from(pos.g); S.side = pos.side; S.castle = pos.castle; S.ep = pos.ep; S.half = pos.half;
    P0.moves++;
    S.hist.push({ pi, m, san: text, cap: u.cap ? typeOfCaptured(u.cap) : 0 });
    S.lastMove = { pi, from, to, piece: type(piece), cap: u.cap ? type(u.cap) : 0, capSq, promo, castle, check, san: text, turn: S.turn };
    events.push({ t: "move", pi, from, to, piece: type(piece), cap: S.lastMove.cap, capSq, promo, castle, check, san: text });
    log(S, `${P0.name} zieht ${text}.`);
    const key = keyOf(pos);
    S.keys.push(key);
    const next = S.players.findIndex((x, i) => i !== pi);
    if (!hasMove(pos)) endRound(S, check ? [pi] : [], check ? "mate" : "stalemate", events);
    else if (deadPosition(pos.g)) endRound(S, [], "material", events);
    else if (S.keys.filter((k) => k === key).length >= 3) endRound(S, [], "repetition", events);
    else if (S.half >= 100) endRound(S, [], "fifty", events);
    else beginTurn(S, next);
  }

  const movesOf = (S) => legal(posOf(S));
  const find = (list, from, to, promo) => list.find((x) => (x & 63) === from && ((x >> 6) & 63) === to && ((x >> 12) & 15) === promo);

  // Apply an action by player `pi`. Returns { ok, error?, events }.
  // Actions: {t:"move", from, to, promo?} {t:"undo"} {t:"giveup"} {t:"skip"} {t:"next"}
  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events });
    const ok = () => ({ ok: true, events });
    if (!Number.isInteger(pi) || !S.players[pi]) return fail("Unbekannter Spieler.");
    const P0 = S.players[pi];
    if (!a || typeof a !== "object" || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
      if (S.last && S.last.over) { S.players.forEach((p) => { p.wins = 0; }); S.round = 0; S.draws = 0; }
      startRound(S);
      return ok();
    }
    if (S.phase !== "play") return fail("Gerade ist niemand dran.");
    if (a.t === "skip") { // the host moves on when the current player is away: the computer plays their move
      const m = botMove(S, S.cur, 1) || null;
      const list = movesOf(S);
      const pick = m ? find(list, m.from, m.to, m.promo || 0) : list[rand(list.length)];
      log(S, `${S.players[S.cur].name} wird übersprungen.`);
      events.push({ t: "skip", pi: S.cur });
      play(S, S.cur, pick, events);
      return ok();
    }
    if (a.t === "giveup") {
      log(S, `${P0.name} gibt auf.`);
      events.push({ t: "giveup", pi });
      endRound(S, [1 - pi], "giveup", events);
      return ok();
    }
    if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);

    if (a.t === "undo") {
      if (!canUndo(S, pi)) return fail("Zurücknehmen geht nur gegen den Computer und nach einem eigenen Zug.");
      while (S.hist.length) if (S.hist.pop().pi === pi) break;
      rebuild(S);
      log(S, `${P0.name} nimmt den Zug zurück.`);
      events.push({ t: "undo", pi });
      beginTurn(S, pi);
      return ok();
    }
    if (a.t === "move") {
      const { from, to } = a;
      if (![from, to].every((x) => Number.isInteger(x) && x >= 0 && x < 64)) return fail("Dieser Zug ist nicht erlaubt.");
      const list = movesOf(S);
      const pv = S.grid[from];
      const promoting = pv && type(pv) === P && (to >> 3) === (S.side ? 0 : 7);
      let promo = 0;
      if (promoting) promo = a.promo == null ? Q : a.promo;
      if (promoting && ![N, B, R, Q].includes(promo)) return fail("Dieser Zug ist nicht erlaubt.");
      const m = find(list, from, to, promo);
      if (!m) {
        if (!pv || colour(pv) !== S.side) return fail("Da steht keine eigene Figur.");
        if (inCheck(posOf(S))) return fail("Dein König steht im Schach.");
        return fail("Dieser Zug ist nicht erlaubt.");
      }
      play(S, pi, m, events);
      return ok();
    }
    return fail("Unbekannte Aktion.");
  }

  // against the computer you may take back your last move (and the reply to it)
  const canUndo = (S, pi) => S.phase === "play" && S.cur === pi && S.players.length === 2 && !!S.players[1 - pi] && S.players[1 - pi].bot &&
    !!S.hist && S.hist.some((h) => h.pi === pi);
  // the board from the move list
  function rebuild(S) {
    const pos = newPos(startGrid(), 0, 15, -1, 0);
    S.players.forEach((p) => { p.moves = 0; });
    S.lastMove = null;
    S.keys = [keyOf(pos)];
    for (const h of S.hist) {
      const from = h.m & 63, to = (h.m >> 6) & 63, fl = h.m >> 16, side = pos.side, piece = pos.g[from];
      const u = make(pos, h.m);
      S.players[h.pi].moves++;
      S.keys.push(keyOf(pos));
      S.lastMove = {
        pi: h.pi, from, to, piece: type(piece), cap: u.cap ? type(u.cap) : 0, capSq: fl & 1 ? to + (side ? 8 : -8) : fl & 16 ? to : -1,
        promo: (h.m >> 12) & 15, castle: fl & 2 ? [from + 3, from + 1] : fl & 4 ? [from - 4, from - 1] : null, check: inCheck(pos), san: h.san, turn: S.turn
      };
    }
    S.grid = Array.from(pos.g); S.side = pos.side; S.castle = pos.castle; S.ep = pos.ep; S.half = pos.half;
  }

  // Resolve a turn clock that ran out: the player who is out of time loses, unless the other side cannot mate.
  function tick(S, now) {
    now = now || Date.now();
    if (S.phase !== "play" || !S.deadline || now <= S.deadline + GRACE) return [];
    const pi = S.cur, events = [{ t: "timeout", pi }];
    S.times[pi] = 0;
    log(S, `${S.players[pi].name} hat keine Zeit mehr.`);
    endRound(S, canMate(S.grid, S.col[1 - pi]) ? [1 - pi] : [], canMate(S.grid, S.col[1 - pi]) ? "timeout" : "material", events);
    return events;
  }
  function nextDeadline(S, now) {
    if (S.phase !== "play" || !S.deadline) return -1;
    return Math.max(0, S.deadline + GRACE - (now || Date.now()));
  }
  const resetClock = (S) => armClock(S);

  // ---------- computer player: iterative deepening, negamax with alpha-beta and quiescence ----------
  const MATE = 100000;
  const PST = {
    1: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    2: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    3: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    4: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    5: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    6: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20]
  };
  const KING_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];
  // tables are written for white from rank 8 down to rank 1
  const pstIdx = (col, s) => (col === 0 ? ((7 - (s >> 3)) << 3) | (s & 7) : s);

  function evaluate(pos) { // from the point of view of the side to move
    const g = pos.g;
    let score = 0, npm = 0, bishops = [0, 0];
    const kings = [0, 0];
    for (let s = 0; s < 64; s++) {
      const v = g[s];
      if (!v) continue;
      const t = v & 7, c = v >> 3, i = pstIdx(c, s);
      let val = 0;
      if (t === K) kings[c] = s; else {
        val = VALUE[t] + PST[t][i];
        if (t !== P) npm += VALUE[t];
        if (t === B) bishops[c]++;
      }
      score += c === 0 ? val : -val;
    }
    score += (bishops[0] > 1 ? 30 : 0) - (bishops[1] > 1 ? 30 : 0);
    const mg = Math.min(1, npm / 5000);
    for (let c = 0; c < 2; c++) {
      const i = pstIdx(c, kings[c]), val = PST[6][i] * mg + KING_END[i] * (1 - mg);
      score += c === 0 ? val : -val;
    }
    return pos.side === 0 ? score : -score;
  }

  // level: override the player's strength (the tip button asks for the best the computer can do)
  function botMove(S, pi, lvl) {
    if (S.phase !== "play" || S.cur !== pi) return null;
    const level = lvl || lvOf(S, pi);
    const pos = posOf(S), root = legal(pos);
    if (!root.length) return null;
    const out = (m) => {
      const o = { t: "move", from: m & 63, to: (m >> 6) & 63 };
      const promo = (m >> 12) & 15;
      if (promo) o.promo = promo;
      return o;
    };
    if (root.length === 1) return out(root[0]);
    if (level === 1 && Math.random() < 0.15) return out(root[rand(root.length)]);
    const maxDepth = level === 1 ? 2 : level === 2 ? 4 : 9;
    const budget = level === 1 ? 2500 : level === 2 ? 30000 : 260000;
    const timeMs = level === 1 ? 300 : level === 2 ? 700 : 1500;
    const margin = level === 1 ? 120 : level === 2 ? 20 : 2;
    const t0 = Date.now();
    let nodes = 0, aborted = false;
    const killers = [];

    const order = (list, ply, first) => {
      const sc = list.map((m) => {
        if (m === first) return 1e6;
        const fl = m >> 16, promo = (m >> 12) & 15;
        let s = 0;
        if (fl & 16) s = 10000 + VALUE[type(pos.g[(m >> 6) & 63]) || P] * 10 - VALUE[type(pos.g[m & 63])];
        if (promo) s += 9000 + VALUE[promo];
        if (!(fl & 16) && killers[ply] && (killers[ply][0] === m || killers[ply][1] === m)) s = 5000;
        return s;
      });
      const idx = list.map((_, i) => i).sort((a, b) => sc[b] - sc[a]);
      return idx.map((i) => list[i]);
    };

    function quiesce(alpha, beta, ply) {
      if (++nodes > budget || ((nodes & 255) === 0 && Date.now() - t0 > timeMs)) { aborted = true; return 0; }
      const me = pos.side;
      const check = attacked(pos, pos.k[me], me ^ 1);
      let best = -Infinity;
      if (!check) {
        best = evaluate(pos);
        if (best >= beta) return best;
        if (best > alpha) alpha = best;
      }
      if (ply > 24) return best === -Infinity ? evaluate(pos) : best;
      const list = order(check ? gen(pos, false) : gen(pos, true), ply, 0);
      let any = false;
      for (const m of list) {
        make(pos, m);
        if (attacked(pos, pos.k[me], me ^ 1)) { unmake(pos); continue; }
        any = true;
        const v = -quiesce(-beta, -alpha, ply + 1);
        unmake(pos);
        if (aborted) return 0;
        if (v > best) best = v;
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      if (check && !any) return -(MATE - ply);
      return best;
    }

    function nega(depth, alpha, beta, ply) {
      if (++nodes > budget || ((nodes & 255) === 0 && Date.now() - t0 > timeMs)) { aborted = true; return 0; }
      if (pos.half >= 100) return 0;
      const me = pos.side;
      const check = attacked(pos, pos.k[me], me ^ 1);
      if (check && ply < 40) depth++;
      if (depth <= 0) return quiesce(alpha, beta, ply);
      let best = -Infinity, any = false;
      for (const m of order(gen(pos, false), ply, 0)) {
        make(pos, m);
        if (attacked(pos, pos.k[me], me ^ 1)) { unmake(pos); continue; }
        any = true;
        const v = -nega(depth - 1, -beta, -alpha, ply + 1);
        unmake(pos);
        if (aborted) return 0;
        if (v > best) best = v;
        if (v > alpha) alpha = v;
        if (alpha >= beta) {
          if (!(m >> 16 & 16)) { const k = killers[ply] || (killers[ply] = [0, 0]); if (k[0] !== m) { k[1] = k[0]; k[0] = m; } }
          break;
        }
      }
      if (!any) return check ? -(MATE - ply) : 0;
      return best;
    }

    let list = order(root, 0, 0);
    let chosen = list.map((m) => ({ m, v: 0 }));
    for (let d = 1; d <= maxDepth; d++) {
      const scored = [];
      let best = -Infinity, floor = -Infinity;
      for (const m of list) {
        make(pos, m);
        const v = -nega(d - 1, -Infinity, -floor, 1);
        unmake(pos);
        if (aborted) break;
        scored.push({ m, v });
        if (v > best) { best = v; floor = best - margin; }
      }
      if (aborted) break;
      chosen = scored;
      scored.sort((a, b) => b.v - a.v);
      list = scored.map((x) => x.m); // search the best move first next time
      if (best >= MATE - 100 || best <= -(MATE - 100)) break;
    }
    const best = Math.max(...chosen.map((x) => x.v));
    let ok = chosen.filter((x) => x.v >= best - margin && (best < MATE - 100 || x.v >= MATE - 100));
    if (!ok.length) ok = chosen;
    // winning on points but about to repeat the position a third time: take another move if there is one
    if (best > 150 && ok.length > 1) {
      const fresh = ok.filter((x) => {
        make(pos, x.m);
        const n = (S.keys || []).filter((k) => k === keyOf(pos)).length;
        unmake(pos);
        return n < 2;
      });
      if (fresh.length) ok = fresh;
    }
    return out(ok[rand(ok.length)].m);
  }

  // Everything on a chess table is public; pi only marks who "me" is.
  function view(S, pi) {
    const me = S.players[pi] ? pi : -1;
    const pos = posOf(S);
    const legalList = S.phase === "play" ? legal(pos) : [];
    const now = Date.now();
    const taken = [[], []];
    for (const h of S.hist) if (h.cap) taken[h.pi].push(h.cap);
    const times = S.times.slice();
    if (S.rules.clock && S.phase === "play" && S.deadline) times[S.cur] = Math.max(0, S.deadline - now);
    return {
      me, phase: S.phase, cur: S.cur, turn: S.turn, round: S.round, goal: S.goal, level: S.level == null ? 2 : S.level,
      rules: S.rules, col: S.col.slice(), grid: S.grid.slice(), side: S.side, castle: S.castle, ep: S.ep, half: S.half, draws: S.draws || 0, nextStarter: S.starter % 2,
      clockOn: !!S.rules.clock, times, running: S.rules.clock && S.deadline ? S.cur : -1,
      check: S.phase === "play" && inCheck(pos) ? pos.k[S.side] : -1,
      players: S.players.map((p, i) => ({ name: p.name, bot: p.bot, avatar: avatarOf(p, i), wins: p.wins, moves: p.moves || 0, taken: taken[i] })),
      lastMove: S.lastMove, log: S.log.slice(), moves: S.hist.map((h) => h.san), last: S.last,
      legal: legalList.map((m) => ({ from: m & 63, to: (m >> 6) & 63, promo: (m >> 12) & 15, cap: !!((m >> 16) & 17), castle: !!((m >> 16) & 6) })),
      canUndo: canUndo(S, pi)
    };
  }

  // the best move for player pi as the computer sees it (works on a state or on a view)
  const suggest = (S, pi) => botMove(S, pi, 3);

  // ---------- helpers for tests and tools ----------
  function posFromFen(fen) {
    const [rows, side, castle, ep] = fen.split(" ");
    const g = new Array(64).fill(0);
    rows.split("/").forEach((row, i) => {
      let c = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { c += +ch; continue; }
        const t = "pnbrqk".indexOf(ch.toLowerCase()) + 1;
        g[(7 - i) * 8 + c++] = t | (ch === ch.toLowerCase() ? 8 : 0);
      }
    });
    let cr = 0;
    if (castle.includes("K")) cr |= 1;
    if (castle.includes("Q")) cr |= 2;
    if (castle.includes("k")) cr |= 4;
    if (castle.includes("q")) cr |= 8;
    return newPos(g, side === "b" ? 1 : 0, cr, ep && ep !== "-" ? "abcdefgh".indexOf(ep[0]) + (ep[1] - 1) * 8 : -1, 0);
  }
  function perft(pos, depth) {
    if (depth === 0) return 1;
    let n = 0;
    for (const m of legal(pos)) {
      make(pos, m);
      n += perft(pos, depth - 1);
      unmake(pos);
    }
    return n;
  }

  return {
    MAX_PLAYERS, COLORS, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, RULES, CLOCK_MS, INC_MS, NAMES, LETTER, normRules, normGoal, normLevel,
    startGrid, sq, newGame, startRound, act, tick, nextDeadline, resetClock, botMove, suggest, view,
    posFromFen, perft, newPos, legal, deadPosition, canMate
  };
});
