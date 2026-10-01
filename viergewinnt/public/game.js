// Vier gewinnt engine. Pure state + rules, shared by the browser (one-phone mode)
// and the Node server (online mode). No DOM, no I/O.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VierGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // board key (columns) -> [columns, rows]
  const SIZES = { 7: [7, 6], 8: [8, 7], 10: [10, 8] };
  const MAX_PLAYERS = 2;
  const COLORS = ["Rot", "Gelb"];
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi", 0: "Zufällig" };
  const CLOCK_MS = 15000, GRACE = 600;

  // House rules. Shared with the UI, which renders one switch per entry.
  const RULES = [
    { k: "popout", name: "Pop Out", desc: "Statt einzuwerfen darfst du eine eigene Scheibe aus der untersten Reihe herausziehen, alles darüber rutscht nach. Entstehen dabei zwei Viererreihen, gewinnt, wer gezogen hat." },
    { k: "five", name: "5 gewinnt", desc: "Du brauchst fünf Scheiben in einer Reihe statt vier. Am spannendsten auf den größeren Feldern." },
    { k: "pie", name: "Tauschregel", desc: "Nach dem ersten Zug darf der Zweite statt zu ziehen die gesetzte Scheibe übernehmen (die Farben werden getauscht). Wer beginnt, spielt dann lieber nicht in die Mitte." },
    { k: "clock", name: "Zugzeit", desc: "15 Sekunden pro Zug, sonst wirft das Spiel zufällig für dich ein." }
  ];
  function normRules(r) {
    const o = {};
    for (const x of RULES) o[x.k] = !!(r && r[x.k] === true);
    return o;
  }
  const normSize = (n) => (SIZES[+n] ? +n : 7);
  const normGoal = (n) => ([1, 2, 3].includes(+n) ? +n : 1);
  const normLevel = (n) => (n != null && n !== "" && LEVELS[+n] ? +n : 2);
  // level 0 = random: every computer player got its own strength when the game started
  const lvOf = (S, pi) => S.level || (S.players[pi] && S.players[pi].lvl) || 2;
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);

  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 60) S.log.shift();
  }
  // grid: cols*rows numbers, index c + r*cols, row 0 is the bottom; -1 empty, else player index
  const at = (S, c, r) => S.grid[c + r * S.cols];
  const height = (S, c) => { let r = 0; while (r < S.rows && at(S, c, r) !== -1) r++; return r; };
  const need = (S) => (S.rules.five ? 5 : 4);

  // all lines of `need` for player pi, as lists of cell indices
  function lines(grid, cols, rows, pi, n) {
    const out = [];
    const g = (c, r) => (c >= 0 && c < cols && r >= 0 && r < rows ? grid[c + r * cols] : -2);
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      if (g(c, r) !== pi) continue;
      for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        if (g(c - dc, r - dr) === pi) continue; // only start at the beginning of a run
        const run = [];
        let k = 0;
        while (g(c + dc * k, r + dr * k) === pi) { run.push(c + dc * k + (r + dr * k) * cols); k++; }
        if (run.length >= n) out.push(run);
      }
    }
    return out;
  }

  // players: [{ name, bot, avatar }] (2); goal: wins needed; size: a key of SIZES; level: computer strength
  function newGame(players, goal, size, rules, level) {
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p, i) => ({ name: p.name, bot: !!p.bot, lvl: 1 + Math.floor(Math.random() * 3), avatar: avatarOf(p, i), wins: 0 })),
      size: normSize(size), goal: normGoal(goal), rules: normRules(rules), level: normLevel(level),
      round: 0, turn: 0, starter: rand(2), draws: 0, log: [], last: null, lastMove: null, deadline: 0
    };
    startRound(S);
    return S;
  }

  function startRound(S) {
    S.round++;
    [S.cols, S.rows] = SIZES[S.size];
    S.grid = new Array(S.cols * S.rows).fill(-1);
    S.phase = "play";
    S.last = null;
    S.lastMove = null;
    S.log = [];
    S.players.forEach((p) => { p.moves = 0; });
    S.hist = [];
    S.canSwap = false;
    S.turn = 0;
    const first = S.starter % 2;
    S.starter = (S.starter + 1) % 2;
    log(S, `Runde ${S.round}: ${S.players[first].name} (${COLORS[first]}) beginnt.`);
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

  function endRound(S, winners, cells, events) {
    for (const i of winners) S.players[i].wins++;
    if (!winners.length) S.draws++;
    const over = winners.some((i) => S.players[i].wins >= S.goal);
    S.phase = "roundEnd";
    S.cur = -1;
    S.deadline = 0;
    S.last = { winners, over, cells, moves: S.players.reduce((n, p) => n + p.moves, 0) };
    log(S, winners.length ? `${S.players[winners[0]].name} ${over ? "gewinnt das Spiel" : "gewinnt die Runde"}!` : "Unentschieden, das Brett ist voll.");
    events.push({ t: "end", winners });
  }

  // Apply an action by player `pi`. Returns { ok, error?, events }.
  // Actions: {t:"drop", col} {t:"pop", col} {t:"giveup"} {t:"skip"} {t:"next"}
  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events });
    const ok = () => ({ ok: true, events });
    const P = Number.isInteger(pi) ? S.players[pi] : null;
    if (!P) return fail("Unbekannter Spieler.");
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
      if (S.last && S.last.over) { S.players.forEach((p) => { p.wins = 0; }); S.round = 0; S.draws = 0; }
      startRound(S);
      return ok();
    }
    if (S.phase !== "play") return fail("Gerade ist niemand dran.");
    if (a.t === "skip") { // host moves on when the current player is away
      log(S, `${S.players[S.cur].name} wird übersprungen.`);
      S.canSwap = false;
      beginTurn(S, 1 - S.cur);
      return ok();
    }
    if (a.t === "giveup") {
      log(S, `${P.name} gibt auf.`);
      events.push({ t: "giveup", pi });
      endRound(S, [1 - pi], null, events);
      return ok();
    }
    if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);

    if (a.t === "swap") {
      if (!swapOpen(S, pi)) return fail("Tauschen geht jetzt nicht.");
      const first = S.hist[0];
      for (let i = 0; i < S.grid.length; i++) if (S.grid[i] === 1 - pi) S.grid[i] = pi;
      S.players[1 - pi].moves--; P.moves++;
      S.hist.push({ pi, t: "swap" });
      S.canSwap = false;
      S.lastMove = { pi, col: first.col, row: first.row, pop: false, turn: S.turn };
      events.push({ t: "swap", pi, col: first.col, row: first.row });
      log(S, `${P.name} übernimmt die Scheibe in Spalte ${first.col + 1} (Tauschregel).`);
      beginTurn(S, 1 - pi);
      return ok();
    }
    if (a.t === "undo") {
      if (!canUndo(S, pi)) return fail("Zurücknehmen geht nur gegen den Computer und nach einem eigenen Zug.");
      const gone = [];
      while (S.hist.length) {
        const m = S.hist.pop();
        if (m.t === "drop") gone.push({ idx: m.col + m.row * S.cols, p: m.pi });
        if (m.pi === pi) break;
      }
      rebuild(S);
      log(S, `${P.name} nimmt den Zug zurück.`);
      events.push({ t: "undo", pi, cells: gone });
      beginTurn(S, pi);
      return ok();
    }
    const col = a.col;
    if (!Number.isInteger(col) || col < 0 || col >= S.cols) return fail("Diese Spalte gibt es nicht.");

    if (a.t === "drop") {
      const r = height(S, col);
      if (r >= S.rows) return fail("Diese Spalte ist voll.");
      S.grid[col + r * S.cols] = pi;
      P.moves++;
      (S.hist || (S.hist = [])).push({ pi, t: "drop", col, row: r });
      S.canSwap = !!S.rules.pie && S.hist.length === 1;
      S.lastMove = { pi, col, row: r, pop: false, turn: S.turn };
      events.push({ t: "drop", pi, col, row: r });
      const win = lines(S.grid, S.cols, S.rows, pi, need(S));
      if (win.length) {
        log(S, `${P.name} wirft in Spalte ${col + 1} und hat ${need(S)} in einer Reihe!`);
        endRound(S, [pi], [...new Set(win.flat())], events);
        return ok();
      }
      log(S, `${P.name} wirft in Spalte ${col + 1}.`);
      if (S.grid.every((x) => x !== -1)) { endRound(S, [], null, events); return ok(); }
      beginTurn(S, 1 - pi);
      return ok();
    }

    if (a.t === "pop") {
      if (!S.rules.popout) return fail("Pop Out ist in diesem Spiel aus.");
      if (at(S, col, 0) !== pi) return fail("Unten in dieser Spalte liegt keine eigene Scheibe.");
      for (let r = 0; r < S.rows - 1; r++) S.grid[col + r * S.cols] = S.grid[col + (r + 1) * S.cols];
      S.grid[col + (S.rows - 1) * S.cols] = -1;
      P.moves++;
      (S.hist || (S.hist = [])).push({ pi, t: "pop", col });
      S.canSwap = false;
      S.lastMove = { pi, col, row: 0, pop: true, turn: S.turn };
      events.push({ t: "pop", pi, col });
      const mine = lines(S.grid, S.cols, S.rows, pi, need(S)), theirs = lines(S.grid, S.cols, S.rows, 1 - pi, need(S));
      log(S, `${P.name} zieht unten in Spalte ${col + 1} eine Scheibe heraus.`);
      if (mine.length || theirs.length) {
        const w = mine.length ? pi : 1 - pi;
        endRound(S, [w], [...new Set((mine.length ? mine : theirs).flat())], events);
        return ok();
      }
      beginTurn(S, 1 - pi);
      return ok();
    }
    return fail("Unbekannte Aktion.");
  }

  // the second player may take over the first disc (pie rule)
  const swapOpen = (S, pi) => !!S.canSwap && S.phase === "play" && S.cur === pi && S.hist && S.hist.length === 1 && S.hist[0].pi !== pi;
  // against the computer you may take back your last move (and the reply to it)
  const canUndo = (S, pi) => S.phase === "play" && S.cur === pi && S.players.length === 2 && !!S.players[1 - pi] && S.players[1 - pi].bot &&
    !!S.hist && S.hist.some((m) => m.pi === pi);
  // the board from the move list
  function rebuild(S) {
    S.grid.fill(-1);
    S.players.forEach((p) => { p.moves = 0; });
    S.lastMove = null;
    for (const m of S.hist) {
      const P = S.players[m.pi];
      if (m.t === "drop") { const r = height(S, m.col); S.grid[m.col + r * S.cols] = m.pi; m.row = r; P.moves++; S.lastMove = { pi: m.pi, col: m.col, row: r, pop: false, turn: S.turn }; }
      else if (m.t === "pop") {
        for (let r = 0; r < S.rows - 1; r++) S.grid[m.col + r * S.cols] = S.grid[m.col + (r + 1) * S.cols];
        S.grid[m.col + (S.rows - 1) * S.cols] = -1; P.moves++; S.lastMove = { pi: m.pi, col: m.col, row: 0, pop: true, turn: S.turn };
      } else { for (let i = 0; i < S.grid.length; i++) if (S.grid[i] === 1 - m.pi) S.grid[i] = m.pi; S.players[1 - m.pi].moves--; P.moves++; }
    }
    S.canSwap = !!S.rules.pie && S.hist.length === 1 && S.hist[0].t === "drop";
  }

  // Resolve a turn clock that ran out: the game drops a disc at random for the player.
  function tick(S, now) {
    now = now || Date.now();
    if (S.phase !== "play" || !S.deadline || now <= S.deadline + GRACE) return [];
    const pi = S.cur, free = [];
    for (let c = 0; c < S.cols; c++) if (height(S, c) < S.rows) free.push(c);
    log(S, `${S.players[pi].name} war zu langsam, das Spiel wirft zufällig ein.`);
    const r = act(S, pi, { t: "drop", col: free[rand(free.length)] });
    return [{ t: "timeout", pi }].concat(r.events);
  }
  function nextDeadline(S, now) {
    if (S.phase !== "play" || !S.deadline) return -1;
    return Math.max(0, S.deadline + GRACE - (now || Date.now()));
  }
  const resetClock = (S) => armClock(S);

  // ---------- computer player: minimax with alpha-beta ----------
  function score(grid, cols, rows, pi, n) {
    // count open windows: more own discs in a window that the opponent does not block = better
    const w = [0, 1, 4, 20, 80, 300];
    let s = 0;
    const center = Math.floor(cols / 2);
    for (let r = 0; r < rows; r++) if (grid[center + r * cols] === pi) s += 3;
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const ec = c + dc * (n - 1), er = r + dr * (n - 1);
      if (ec < 0 || ec >= cols || er < 0 || er >= rows) continue;
      let mine = 0, theirs = 0;
      for (let k = 0; k < n; k++) {
        const x = grid[c + dc * k + (r + dr * k) * cols];
        if (x === pi) mine++; else if (x !== -1) theirs++;
      }
      if (mine && !theirs) s += w[Math.min(mine, 5)] * (mine === n - 1 ? 2 : 1);
      if (theirs && !mine) s -= w[Math.min(theirs, 5)] * (theirs === n - 1 ? 3 : 1);
    }
    return s;
  }
  // level: override the player's strength (the tip button asks for the best the computer can do)
  function botMove(S, pi, lvl) {
    if (S.phase !== "play" || S.cur !== pi) return null;
    const { cols, rows } = S, n = need(S), level = lvl || lvOf(S, pi), mid = (cols - 1) / 2;
    if (S.canSwap && S.hist && S.hist.length === 1) { // pie rule: take a strong (central) opening disc over
      const central = Math.abs(S.hist[0].col - mid) <= 1;
      if (Math.random() < (level === 3 ? (central ? 1 : 0) : level === 2 ? (central ? 0.85 : 0.15) : (central ? 0.4 : 0.2))) return { t: "swap" };
    }
    const grid = S.grid.slice();
    const h = new Array(cols).fill(0).map((_, c) => height(S, c));
    const order = [...Array(cols).keys()].sort((a, b) => Math.abs(a - (cols - 1) / 2) - Math.abs(b - (cols - 1) / 2));
    const wins = (p) => lines(grid, cols, rows, p, n).length > 0;
    const depthMax = level === 1 ? 2 : level === 2 ? 4 : cols > 8 ? 5 : 6;
    let nodes = 0;
    function search(depth, alpha, beta, p) {
      nodes++;
      if (depth === 0 || nodes > 60000) return score(grid, cols, rows, pi, n);
      let best = p === pi ? -Infinity : Infinity, any = false;
      for (const c of order) {
        if (h[c] >= rows) continue;
        any = true;
        grid[c + h[c] * cols] = p; h[c]++;
        let v;
        if (wins(p)) v = (p === pi ? 1 : -1) * (100000 + depth);
        else v = search(depth - 1, alpha, beta, 1 - p);
        h[c]--; grid[c + h[c] * cols] = -1;
        if (p === pi) { best = Math.max(best, v); alpha = Math.max(alpha, v); }
        else { best = Math.min(best, v); beta = Math.min(beta, v); }
        if (beta <= alpha) break;
      }
      return any ? best : 0;
    }
    const legal = order.filter((c) => h[c] < rows);
    if (!legal.length) return null;
    if (S.rules.pie && S.hist && !S.hist.length && level > 1) { // the opponent may take over the first disc: open off-centre
      const side = legal.filter((c) => Math.abs(c - mid) >= 1.5 && Math.abs(c - mid) <= 2.5);
      if (side.length) return { t: "drop", col: side[rand(side.length)] };
    }
    if (level === 1 && Math.random() < 0.35) return { t: "drop", col: legal[rand(legal.length)] };
    let bestCol = legal[0], bestV = -Infinity;
    const scored = [];
    for (const c of legal) {
      grid[c + h[c] * cols] = pi; h[c]++;
      const v = wins(pi) ? 1e6 : search(depthMax - 1, -Infinity, Infinity, 1 - pi);
      h[c]--; grid[c + h[c] * cols] = -1;
      scored.push([c, v]);
      if (v > bestV) { bestV = v; bestCol = c; }
    }
    // normal is not a perfect machine: now and then it takes a slightly worse move
    if (level === 2 && Math.random() < 0.2) {
      const ok = scored.filter(([, v]) => v > -50000 && v >= bestV - 40);
      if (ok.length) bestCol = ok[rand(ok.length)][0];
    }
    return { t: "drop", col: bestCol };
  }

  // Everything on a Vier-gewinnt table is public; pi only marks who "me" is.
  function view(S, pi) {
    const me = S.players[pi] ? pi : -1;
    return {
      me, phase: S.phase, cur: S.cur, turn: S.turn, round: S.round, goal: S.goal, size: S.size, level: S.level == null ? 2 : S.level,
      cols: S.cols, rows: S.rows, need: need(S), rules: S.rules, grid: S.grid.slice(), draws: S.draws || 0, nextStarter: S.starter % 2,
      clockMs: S.rules.clock ? CLOCK_MS : 0, clock: S.deadline ? Math.max(0, S.deadline - Date.now()) : 0,
      players: S.players.map((p, i) => ({ name: p.name, bot: p.bot, avatar: avatarOf(p, i), wins: p.wins, moves: p.moves || 0 })),
      lastMove: S.lastMove, log: S.log.slice(), last: S.last,
      hist: (S.hist || []).map((m) => ({ pi: m.pi, t: m.t, col: m.col })),
      canSwap: swapOpen(S, pi), canUndo: canUndo(S, pi)
    };
  }

  // the best move for player pi as the computer sees it (works on a state or on a view)
  const suggest = (S, pi) => botMove(S, pi, 3);

  return {
    SIZES, MAX_PLAYERS, COLORS, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, RULES, normRules, normSize, normGoal, normLevel,
    lines, newGame, startRound, act, tick, nextDeadline, resetClock, botMove, suggest, view
  };
});
