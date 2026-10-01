// Dame engine (German draughts). Pure state + rules, shared by the browser (single player)
// and the Node server (online). No DOM, no I/O.
//
// Board: 8x8, square index = row * 8 + col, row 0 is white's home row, dark squares are (row + col) even.
// Pieces are colours, not players: 0 = white (moves up, always begins), 1 = black (moves down).
// grid value: -1 empty, 0 white man, 1 white king, 2 black man, 3 black king  (colour = v >> 1, king = v & 1).
// S.col[pi] is the colour of player pi; it swaps every round so everybody gets to begin.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DameGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 2;
  const COLORS = ["Weiß", "Schwarz"];
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi", 0: "Zufällig" };
  const CLOCK_MS = 30000, GRACE = 600;
  const QUIET_PLIES = 50; // this many moves in a row without a capture or a man moving is a draw

  const RULES = [
    { k: "free", name: "Ohne Schlagzwang", desc: "Schlagen ist erlaubt, aber keine Pflicht. Für Einsteiger und gemütliche Runden." },
    { k: "clock", name: "Zugzeit", desc: "30 Sekunden pro Zug, sonst zieht das Spiel zufällig für dich." }
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
    if (S.log.length > 60) S.log.shift();
  }

  // ---------- board and move generation ----------
  const DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const inb = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const sq = (i) => "abcdefgh"[i & 7] + ((i >> 3) + 1);
  const promoRow = (p) => (p === 0 ? 7 : 0);

  function startGrid() {
    const g = new Array(64).fill(-1);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if ((r + c) % 2) continue;
      if (r < 3) g[r * 8 + c] = 0; else if (r > 4) g[r * 8 + c] = 2;
    }
    return g;
  }

  // Every capture sequence of one piece, as {path, caps}. Jumped pieces stay on the board until the
  // move is over (they still block, none can be jumped twice); the piece's own start square counts
  // as empty. A man that reaches the far row ends its move there. A king that has a choice of
  // landing squares must pick one from which it can keep capturing, if there is one.
  function jumps(grid, p, king, from, origin, path, caps) {
    const res = [];
    const r0 = from >> 3, c0 = from & 7;
    const empty = (i) => grid[i] === -1 || i === origin;
    for (const [dr, dc] of DIRS) {
      let r = r0 + dr, c = c0 + dc;
      if (king) while (inb(r, c) && empty(r * 8 + c)) { r += dr; c += dc; }
      if (!inb(r, c)) continue;
      const j = r * 8 + c;
      if (empty(j) || (grid[j] >> 1) === p || caps.includes(j)) continue;
      const lands = [];
      let lr = r + dr, lc = c + dc;
      while (inb(lr, lc) && empty(lr * 8 + lc)) { lands.push(lr * 8 + lc); if (!king) break; lr += dr; lc += dc; }
      const options = [];
      for (const l of lands) {
        path.push(l); caps.push(j);
        const sub = !king && (l >> 3) === promoRow(p) ? [] : jumps(grid, p, king, l, origin, path, caps);
        options.push({ cont: sub.length > 0, items: sub.length ? sub : [{ path: path.slice(), caps: caps.slice() }] });
        path.pop(); caps.pop();
      }
      const some = options.some((o) => o.cont);
      for (const o of options) if (!some || o.cont) for (const m of o.items) res.push(m);
    }
    return res;
  }

  function legalMoves(grid, p, free) {
    const caps = [], simple = [];
    for (let i = 0; i < 64; i++) {
      const v = grid[i];
      if (v < 0 || (v >> 1) !== p) continue;
      const king = (v & 1) === 1;
      for (const m of jumps(grid, p, king, i, i, [i], [])) caps.push(m);
    }
    if (caps.length && !free) return caps;
    for (let i = 0; i < 64; i++) {
      const v = grid[i];
      if (v < 0 || (v >> 1) !== p) continue;
      const king = (v & 1) === 1, r0 = i >> 3, c0 = i & 7;
      for (const [dr, dc] of DIRS) {
        if (!king && dr !== (p === 0 ? 1 : -1)) continue;
        let r = r0 + dr, c = c0 + dc;
        while (inb(r, c) && grid[r * 8 + c] === -1) {
          simple.push({ path: [i, r * 8 + c], caps: [] });
          if (!king) break;
          r += dr; c += dc;
        }
      }
    }
    return free ? caps.concat(simple) : simple;
  }

  function make(grid, m) {
    const from = m.path[0], to = m.path[m.path.length - 1], piece = grid[from];
    const taken = m.caps.map((j) => [j, grid[j]]);
    grid[from] = -1;
    for (const j of m.caps) grid[j] = -1;
    const promoted = (piece & 1) === 0 && (to >> 3) === promoRow(piece >> 1);
    grid[to] = promoted ? piece + 1 : piece;
    return { from, to, piece, taken, promoted };
  }
  function unmake(grid, u) {
    grid[u.to] = -1;
    for (const [j, v] of u.taken) grid[j] = v;
    grid[u.from] = u.piece;
  }

  const sameMove = (m, path) => m.path.length === path.length && m.path.every((x, i) => x === path[i]);
  const count = (grid, p) => { let men = 0, kings = 0; for (const v of grid) if (v >= 0 && (v >> 1) === p) { if (v & 1) kings++; else men++; } return { men, kings }; };
  const posKey = (grid, p) => grid.map((v) => v + 1).join("") + p;

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
    S.phase = "play";
    S.last = null;
    S.lastMove = null;
    S.log = [];
    S.players.forEach((p) => { p.moves = 0; });
    S.hist = [];
    S.quiet = 0;
    S.turn = 0;
    const first = S.starter % 2;
    S.starter = (S.starter + 1) % 2;
    S.col = first === 0 ? [0, 1] : [1, 0]; // white always begins
    S.keys = [posKey(S.grid, 0)];
    log(S, `Runde ${S.round}: ${S.players[first].name} spielt Weiß und beginnt.`);
    beginTurn(S, first);
  }

  function armClock(S, now) {
    const P = S.players[S.cur];
    S.deadline = S.phase === "play" && P && !P.bot && S.rules.clock ? (now || Date.now()) + CLOCK_MS : 0;
  }
  function beginTurn(S, pi) {
    S.cur = pi;
    S.turn++;
    armClock(S);
  }

  function endRound(S, winners, why, events) {
    for (const i of winners) S.players[i].wins++;
    if (!winners.length) S.draws++;
    const over = winners.some((i) => S.players[i].wins >= S.goal);
    S.phase = "roundEnd";
    S.cur = -1;
    S.deadline = 0;
    S.last = { winners, over, why, moves: S.players.reduce((n, p) => n + p.moves, 0) };
    const text = {
      captured: "alle gegnerischen Steine sind geschlagen", blocked: "der Gegner kann nicht mehr ziehen", giveup: "der Gegner gibt auf",
      repetition: "Unentschieden: dieselbe Stellung zum dritten Mal.", quiet: `Unentschieden: ${QUIET_PLIES / 2} Züge ohne Schlag oder Steinzug.`
    }[why];
    log(S, winners.length ? `${S.players[winners[0]].name} ${S.last.over ? "gewinnt das Spiel" : "gewinnt die Runde"}: ${text}.` : text);
    events.push({ t: "end", winners, why });
  }

  const movesOf = (S, pi) => legalMoves(S.grid, S.col[pi], !!S.rules.free);
  const describe = (m) => `${sq(m.path[0])}${m.caps.length ? "×" : "–"}${m.path.slice(1).map(sq).join(m.caps.length ? "×" : "–")}`;

  // play one legal move for player pi and look at how the round goes on
  function play(S, pi, m, events) {
    const P = S.players[pi], p = S.col[pi];
    const u = make(S.grid, m);
    P.moves++;
    const man = (u.piece & 1) === 0;
    S.quiet = m.caps.length || man ? 0 : S.quiet + 1;
    S.hist.push({ pi, path: m.path.slice(), caps: m.caps.slice(), man, promoted: u.promoted });
    S.lastMove = { pi, path: m.path.slice(), caps: m.caps.slice(), promoted: u.promoted, turn: S.turn };
    events.push({ t: "move", pi, path: m.path.slice(), caps: m.caps.slice(), promoted: u.promoted, king: !man });
    log(S, `${P.name} ${m.caps.length ? "schlägt" : "zieht"} ${describe(m)}${u.promoted ? " und wird Dame" : ""}.`);
    const next = S.players.findIndex((x, i) => i !== pi);
    const key = posKey(S.grid, 1 - p);
    S.keys.push(key);
    const reply = movesOf(S, next);
    if (!reply.length) {
      endRound(S, [pi], count(S.grid, 1 - p).men + count(S.grid, 1 - p).kings ? "blocked" : "captured", events);
    } else if (S.keys.filter((k) => k === key).length >= 3) endRound(S, [], "repetition", events);
    else if (S.quiet >= QUIET_PLIES) endRound(S, [], "quiet", events);
    else beginTurn(S, next);
  }

  // Apply an action by player `pi`. Returns { ok, error?, events }.
  // Actions: {t:"move", path:[squares]} {t:"undo"} {t:"giveup"} {t:"skip"} {t:"next"}
  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events });
    const ok = () => ({ ok: true, events });
    if (!Number.isInteger(pi) || !S.players[pi]) return fail("Unbekannter Spieler.");
    const P = S.players[pi];
    if (!a || typeof a !== "object" || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
      if (S.last && S.last.over) { S.players.forEach((p) => { p.wins = 0; }); S.round = 0; S.draws = 0; }
      startRound(S);
      return ok();
    }
    if (S.phase !== "play") return fail("Gerade ist niemand dran.");
    if (a.t === "skip") { // the host moves on when the current player is away: the computer plays their move
      const list = movesOf(S, S.cur);
      const m = list[rand(list.length)];
      log(S, `${S.players[S.cur].name} wird übersprungen.`);
      events.push({ t: "skip", pi: S.cur });
      play(S, S.cur, m, events);
      return ok();
    }
    if (a.t === "giveup") {
      log(S, `${P.name} gibt auf.`);
      events.push({ t: "giveup", pi });
      endRound(S, [1 - pi], "giveup", events);
      return ok();
    }
    if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);

    if (a.t === "undo") {
      if (!canUndo(S, pi)) return fail("Zurücknehmen geht nur gegen den Computer und nach einem eigenen Zug.");
      while (S.hist.length) if (S.hist.pop().pi === pi) break;
      rebuild(S);
      log(S, `${P.name} nimmt den Zug zurück.`);
      events.push({ t: "undo", pi });
      beginTurn(S, pi);
      return ok();
    }
    if (a.t === "move") {
      const path = a.path;
      if (!Array.isArray(path) || path.length < 2 || path.length > 40 || !path.every((x) => Number.isInteger(x) && x >= 0 && x < 64)) return fail("Dieser Zug ist nicht erlaubt.");
      const list = movesOf(S, pi);
      const m = list.find((x) => sameMove(x, path));
      if (!m) {
        const piece = S.grid[path[0]];
        if (piece < 0 || (piece >> 1) !== S.col[pi]) return fail("Da steht kein eigener Stein.");
        if (!S.rules.free && list.length && list[0].caps.length) return fail("Schlagzwang: du musst schlagen.");
        return fail("Dieser Zug ist nicht erlaubt.");
      }
      play(S, pi, m, events);
      return ok();
    }
    return fail("Unbekannte Aktion.");
  }

  // against the computer you may take back your last move (and the reply to it)
  const canUndo = (S, pi) => S.phase === "play" && S.cur === pi && S.players.length === 2 && !!S.players[1 - pi] && S.players[1 - pi].bot &&
    !!S.hist && S.hist.some((m) => m.pi === pi);
  // the board from the move list
  function rebuild(S) {
    S.grid = startGrid();
    S.players.forEach((p) => { p.moves = 0; });
    S.lastMove = null;
    S.quiet = 0;
    S.keys = [posKey(S.grid, 0)];
    for (const h of S.hist) {
      const u = make(S.grid, h);
      S.players[h.pi].moves++;
      S.quiet = h.caps.length || h.man ? 0 : S.quiet + 1;
      S.keys.push(posKey(S.grid, 1 - (S.grid[h.path[h.path.length - 1]] >> 1)));
      S.lastMove = { pi: h.pi, path: h.path.slice(), caps: h.caps.slice(), promoted: u.promoted, turn: S.turn };
    }
  }

  // Resolve a turn clock that ran out: the game plays a random move for the player.
  function tick(S, now) {
    now = now || Date.now();
    if (S.phase !== "play" || !S.deadline || now <= S.deadline + GRACE) return [];
    const pi = S.cur, list = movesOf(S, pi), events = [{ t: "timeout", pi }];
    log(S, `${S.players[pi].name} war zu langsam, das Spiel zieht zufällig.`);
    play(S, pi, list[rand(list.length)], events);
    return events;
  }
  function nextDeadline(S, now) {
    if (S.phase !== "play" || !S.deadline) return -1;
    return Math.max(0, S.deadline + GRACE - (now || Date.now()));
  }
  const resetClock = (S) => armClock(S);

  // ---------- computer player: iterative deepening, negamax with alpha-beta ----------
  const WIN = 100000;
  function evaluate(grid, p) { // from the point of view of colour p
    let s = 0;
    for (let i = 0; i < 64; i++) {
      const v = grid[i];
      if (v < 0) continue;
      const c = v >> 1, r = i >> 3, col = i & 7;
      const centre = 3.5 - Math.max(Math.abs(r - 3.5), Math.abs(col - 3.5)) * 0.5;
      let val;
      if (v & 1) val = 330 + centre * 3;
      else {
        const adv = c === 0 ? r : 7 - r;
        val = 100 + adv * 5 + centre * 2 + (adv === 0 ? 8 : 0) + (col === 0 || col === 7 ? -2 : 0);
      }
      s += c === p ? val : -val;
    }
    return s;
  }

  // level: override the player's strength (the tip button asks for the best the computer can do)
  function botMove(S, pi, lvl) {
    if (S.phase !== "play" || S.cur !== pi) return null;
    const free = !!(S.rules && S.rules.free), me = S.col[pi], level = lvl || lvOf(S, pi);
    const root = legalMoves(S.grid, me, free);
    if (!root.length) return null;
    const pick = (m) => ({ t: "move", path: m.path.slice() });
    if (root.length === 1) return pick(root[0]);
    if (level === 1 && Math.random() < 0.3) return pick(root[rand(root.length)]);
    const grid = S.grid.slice();
    const maxDepth = level === 1 ? 2 : level === 2 ? 4 : 12;
    const budget = level === 1 ? 2500 : level === 2 ? 20000 : 100000;
    const margin = level === 1 ? 40 : level === 2 ? 25 : 3;
    let nodes = 0, aborted = false;
    const order = (list) => list.sort((a, b) => b.caps.length - a.caps.length);

    function nega(p, depth, alpha, beta, ply) {
      if (++nodes > budget) { aborted = true; return 0; }
      const list = legalMoves(grid, p, free);
      if (!list.length) return -(WIN - ply);
      if (depth <= 0 && (free || !list[0].caps.length || ply > maxDepth + 8)) return evaluate(grid, p);
      let best = -Infinity;
      order(list);
      for (const m of list) {
        const u = make(grid, m);
        const v = -nega(1 - p, depth - 1, -beta, -alpha, ply + 1);
        unmake(grid, u);
        if (aborted) return 0;
        if (v > best) best = v;
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      return best;
    }

    order(root);
    let chosen = root.map((m) => ({ m, v: 0 }));
    for (let d = 1; d <= maxDepth; d++) {
      const scored = [];
      let best = -Infinity, floor = -Infinity;
      for (const m of root) {
        const u = make(grid, m);
        const v = -nega(1 - me, d - 1, -Infinity, -floor, 1);
        unmake(grid, u);
        if (aborted) break;
        scored.push({ m, v });
        if (v > best) { best = v; floor = best - margin; }
      }
      if (aborted) break;
      chosen = scored;
      scored.sort((a, b) => b.v - a.v);
      root.length = 0; scored.forEach((x) => root.push(x.m)); // search the best move first next time
      if (best >= WIN - 100 || best <= -(WIN - 100)) break;
    }
    const best = Math.max(...chosen.map((x) => x.v));
    const ok = chosen.filter((x) => x.v >= best - margin && (best < WIN - 100 || x.v >= WIN - 100));
    return pick((ok.length ? ok : chosen)[rand((ok.length ? ok : chosen).length)].m);
  }

  // Everything on a draughts table is public; pi only marks who "me" is.
  function view(S, pi) {
    const me = S.players[pi] ? pi : -1;
    const legal = S.phase === "play" ? movesOf(S, S.cur).map((m) => ({ path: m.path, caps: m.caps })) : [];
    return {
      me, phase: S.phase, cur: S.cur, turn: S.turn, round: S.round, goal: S.goal, level: S.level == null ? 2 : S.level,
      rules: S.rules, col: S.col.slice(), grid: S.grid.slice(), draws: S.draws || 0, nextStarter: S.starter % 2,
      clockMs: S.rules.clock ? CLOCK_MS : 0, clock: S.deadline ? Math.max(0, S.deadline - Date.now()) : 0,
      players: S.players.map((p, i) => Object.assign({ name: p.name, bot: p.bot, avatar: avatarOf(p, i), wins: p.wins, moves: p.moves || 0 }, count(S.grid, S.col[i]))),
      lastMove: S.lastMove, log: S.log.slice(), last: S.last, legal,
      mustCapture: !S.rules.free && legal.length > 0 && legal[0].caps.length > 0,
      canUndo: canUndo(S, pi)
    };
  }

  // the best move for player pi as the computer sees it (works on a state or on a view)
  const suggest = (S, pi) => botMove(S, pi, 3);

  return {
    MAX_PLAYERS, COLORS, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, RULES, CLOCK_MS, QUIET_PLIES, normRules, normGoal, normLevel,
    startGrid, legalMoves, sq, newGame, startRound, act, tick, nextDeadline, resetClock, botMove, suggest, view
  };
});
