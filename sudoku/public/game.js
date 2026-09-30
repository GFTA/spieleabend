// Sudoku engine. Pure state + rules, shared by the browser (solo / vs computer) and the Node
// server (online race). No DOM, no I/O. Everybody gets the same puzzle; each fills their own
// grid privately; first correct finish wins the round.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SudokuGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 8;
  const N = 9, CELLS = 81;
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip", "Pixel Paula", "Byte Ben", "Turbo Tina", "Nano Nick", "Zack Zora", "Bit Bruno"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  // difficulty = puzzle hardness and how fast computer opponents fill cells
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Schwer" };
  const CLUES = { 1: 42, 2: 32, 3: 26 }; // how many given digits (more = easier)
  const BOT_DELAY = { 1: 1600, 2: 900, 3: 500 }; // ms between computer cell fills

  const normGoal = (n) => ([1, 2, 3].includes(+n) ? +n : 1);
  const normLevel = (n) => (LEVELS[+n] ? +n : 2);
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const rc = (i) => [i / N | 0, i % N];
  const idx = (r, c) => r * N + c;
  const bit = (n) => 1 << (n - 1);
  const filledCount = (grid, givens) => {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (!givens[i] && grid[i]) n++;
    return n;
  };
  const emptyCount = (grid, givens) => {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (!givens[i] && !grid[i]) n++;
    return n;
  };
  const isFull = (grid) => grid.every((v) => v >= 1 && v <= 9);
  const matches = (a, b) => a.every((v, i) => v === b[i]);

  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 60) S.log.shift();
  }

  // ---------- generator: full valid board, then dig holes keeping a unique solution ----------
  function canPlace(board, i, n) {
    const [r, c] = rc(i);
    for (let k = 0; k < N; k++) {
      if (board[idx(r, k)] === n || board[idx(k, c)] === n) return false;
    }
    const br = (r / 3 | 0) * 3, bc = (c / 3 | 0) * 3;
    for (let rr = br; rr < br + 3; rr++) for (let cc = bc; cc < bc + 3; cc++) if (board[idx(rr, cc)] === n) return false;
    return true;
  }

  function fillBoard(board, from) {
    for (let i = from; i < CELLS; i++) {
      if (board[i]) continue;
      for (const n of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
        if (!canPlace(board, i, n)) continue;
        board[i] = n;
        if (fillBoard(board, i + 1)) return true;
        board[i] = 0;
      }
      return false;
    }
    return true;
  }

  // count solutions up to `limit` (2 is enough to prove uniqueness)
  function countSolutions(board, limit) {
    let found = 0;
    function dfs(from) {
      if (found >= limit) return;
      let i = from;
      while (i < CELLS && board[i]) i++;
      if (i === CELLS) { found++; return; }
      for (let n = 1; n <= 9; n++) {
        if (!canPlace(board, i, n)) continue;
        board[i] = n;
        dfs(i + 1);
        board[i] = 0;
        if (found >= limit) return;
      }
    }
    dfs(0);
    return found;
  }

  function generate(level) {
    const solution = new Array(CELLS).fill(0);
    // seed the three diagonal boxes first (independent), then fill the rest
    for (let b = 0; b < 3; b++) {
      const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      let k = 0;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) solution[idx(b * 3 + r, b * 3 + c)] = nums[k++];
    }
    fillBoard(solution, 0);
    const puzzle = solution.slice();
    const order = shuffle([...Array(CELLS).keys()]);
    const target = CLUES[level] || CLUES[2];
    let left = CELLS;
    for (const i of order) {
      if (left <= target) break;
      const keep = puzzle[i];
      puzzle[i] = 0;
      const probe = puzzle.slice();
      if (countSolutions(probe, 2) !== 1) puzzle[i] = keep;
      else left--;
    }
    return { puzzle, solution };
  }

  function playerState(p, i, givens) {
    return {
      name: p.name, bot: !!p.bot, avatar: avatarOf(p, i),
      wins: 0, grid: givens.slice(), notes: new Array(CELLS).fill(0),
      filled: 0, mistakes: 0, done: false, out: false, timeMs: 0
    };
  }

  // players: [{ name, bot, avatar }]; goal: rounds to win; level: difficulty + bot speed
  function newGame(players, goal, level) {
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p, i) => ({ name: p.name, bot: !!p.bot, avatar: avatarOf(p, i), wins: 0 })),
      goal: normGoal(goal), level: normLevel(level),
      round: 0, log: [], last: null, puzzle: null, solution: null, startedAt: 0
    };
    startRound(S);
    return S;
  }

  function startRound(S) {
    S.round++;
    S.phase = "play";
    S.last = null;
    S.log = [];
    S.cur = -1; // everybody plays at once (race)
    const gen = generate(S.level);
    S.puzzle = gen.puzzle;
    S.solution = gen.solution;
    S.startedAt = Date.now();
    S.players = S.players.map((p, i) => Object.assign(playerState(p, i, S.puzzle), { wins: p.wins || 0 }));
    log(S, `Runde ${S.round}: ${LEVELS[S.level]} · ${S.players.length === 1 ? "Löse das Rätsel." : "Gleiches Rätsel für alle — wer zuerst fertig ist, gewinnt."}`);
  }

  function elapsed(S) {
    return Math.max(0, Date.now() - (S.startedAt || Date.now()));
  }

  function finish(S, pi, events) {
    const P = S.players[pi];
    P.done = true;
    P.timeMs = elapsed(S);
    P.grid = S.solution.slice();
    P.filled = filledCount(P.grid, S.puzzle);
    P.wins++;
    const over = P.wins >= S.goal;
    S.phase = "roundEnd";
    S.cur = -1;
    S.last = {
      winners: [pi], over, timeMs: P.timeMs,
      times: S.players.map((p) => (p.done ? p.timeMs : null)),
      solution: S.solution.slice()
    };
    log(S, `${P.name} ist fertig in ${fmtTime(P.timeMs)}${over ? " und gewinnt das Spiel" : ""}!`);
    events.push({ t: "end", winners: [pi], timeMs: P.timeMs, over });
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), r = s % 60;
    return m ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
  }

  function stillRacing(S) {
    return S.players.some((p) => !p.done && !p.out);
  }

  function endNobody(S, events) {
    S.phase = "roundEnd";
    S.cur = -1;
    S.last = { winners: [], over: false, timeMs: elapsed(S), times: S.players.map(() => null), solution: S.solution.slice() };
    log(S, "Niemand hat das Rätsel gelöst.");
    events.push({ t: "end", winners: [], over: false });
  }

  // Apply an action by player `pi`. Returns { ok, error?, events }.
  // Actions: {t:"set",i,n} {t:"clear",i} {t:"note",i,n} {t:"submit"} {t:"giveup"} {t:"skip"} {t:"next"}
  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events });
    const ok = () => ({ ok: true, events });
    const P = S.players[pi];
    if (!P) return fail("Unbekannter Spieler.");
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
      if (S.last && S.last.over) { S.players.forEach((p) => { p.wins = 0; }); S.round = 0; }
      startRound(S);
      return ok();
    }
    if (S.phase !== "play") return fail("Die Runde ist vorbei.");

    if (a.t === "skip") { // host marks an away player as out of this race
      const ti = a.pi != null ? +a.pi : -1;
      const T = S.players[ti];
      if (!T || T.done || T.out) return fail("Den Spieler gibt es nicht oder er ist schon fertig.");
      T.out = true;
      log(S, `${T.name} wird übersprungen.`);
      events.push({ t: "skip", pi: ti });
      if (!stillRacing(S)) endNobody(S, events);
      return ok();
    }

    if (a.t === "giveup") {
      if (P.done) return fail("Du bist schon fertig.");
      if (P.out) return fail("Du bist schon raus.");
      P.out = true;
      log(S, `${P.name} gibt auf.`);
      events.push({ t: "giveup", pi });
      if (!stillRacing(S)) endNobody(S, events);
      return ok();
    }

    if (P.out) return fail("Du bist in dieser Runde raus.");
    if (P.done) return fail("Du bist schon fertig.");

    if (a.t === "set") {
      const i = +a.i, n = +a.n;
      if (!(i >= 0 && i < CELLS)) return fail("Ungültiges Feld.");
      if (!(n >= 1 && n <= 9)) return fail("Nur Zahlen von 1 bis 9.");
      if (S.puzzle[i]) return fail("Diese Zahl ist vorgegeben.");
      P.grid[i] = n;
      P.notes[i] = 0;
      P.filled = filledCount(P.grid, S.puzzle);
      events.push({ t: "set", pi, i, n });
      if (isFull(P.grid)) {
        if (matches(P.grid, S.solution)) { finish(S, pi, events); return ok(); }
        // full but wrong: leave it, player can still edit / submit
      }
      return ok();
    }

    if (a.t === "clear") {
      const i = +a.i;
      if (!(i >= 0 && i < CELLS)) return fail("Ungültiges Feld.");
      if (S.puzzle[i]) return fail("Diese Zahl ist vorgegeben.");
      P.grid[i] = 0;
      P.notes[i] = 0;
      P.filled = filledCount(P.grid, S.puzzle);
      events.push({ t: "clear", pi, i });
      return ok();
    }

    if (a.t === "note") {
      const i = +a.i, n = +a.n;
      if (!(i >= 0 && i < CELLS)) return fail("Ungültiges Feld.");
      if (!(n >= 1 && n <= 9)) return fail("Nur Zahlen von 1 bis 9.");
      if (S.puzzle[i]) return fail("Diese Zahl ist vorgegeben.");
      if (P.grid[i]) return fail("Feld ist schon belegt.");
      P.notes[i] ^= bit(n);
      events.push({ t: "note", pi, i, n, notes: P.notes[i] });
      return ok();
    }

    if (a.t === "submit") {
      if (!isFull(P.grid)) return fail("Noch nicht alle Felder ausgefüllt.");
      if (matches(P.grid, S.solution)) { finish(S, pi, events); return ok(); }
      P.mistakes++;
      events.push({ t: "wrong", pi, mistakes: P.mistakes });
      log(S, `${P.name} hat eine falsche Lösung abgegeben (${P.mistakes}. Fehlversuch).`);
      return ok();
    }

    return fail("Unbekannte Aktion.");
  }

  // Computer: fills one correct empty cell, or submits when the grid is complete.
  function botMove(S, pi) {
    const P = S.players[pi];
    if (S.phase !== "play" || !P || !P.bot || P.done || P.out) return null;
    if (isFull(P.grid)) return { t: "submit" };
    const open = [];
    for (let i = 0; i < CELLS; i++) if (!S.puzzle[i] && !P.grid[i]) open.push(i);
    if (!open.length) return { t: "submit" };
    const i = open[rand(open.length)];
    return { t: "set", i, n: S.solution[i] };
  }

  function botDelayMs(level) {
    return BOT_DELAY[normLevel(level)] || BOT_DELAY[2];
  }

  // Privacy: each player sees only their own grid/notes; others show progress only.
  function view(S, pi) {
    const me = S.players[pi] ? pi : -1;
    const reveal = S.phase === "roundEnd";
    const now = elapsed(S);
    const total = CELLS - S.puzzle.filter(Boolean).length;
    return {
      me, phase: S.phase, cur: S.cur, round: S.round, goal: S.goal, level: S.level || 2,
      puzzle: S.puzzle.slice(),
      solution: reveal ? S.solution.slice() : null,
      startedAt: S.startedAt, elapsed: S.phase === "play" ? now : (S.last && S.last.timeMs) || now,
      players: S.players.map((p, i) => {
        const mine = i === me;
        const showGrid = mine || reveal;
        return {
          name: p.name, bot: p.bot, avatar: avatarOf(p, i), wins: p.wins,
          filled: p.filled, empty: emptyCount(p.grid, S.puzzle), mistakes: p.mistakes,
          done: !!p.done, out: !!p.out, timeMs: p.done ? p.timeMs : (mine && S.phase === "play" ? now : 0),
          grid: showGrid ? p.grid.slice() : null,
          notes: mine ? p.notes.slice() : null,
          progress: total ? Math.min(100, Math.round(p.filled / total * 100)) : 100
        };
      }),
      log: S.log.slice(), last: S.last ? Object.assign({}, S.last) : null
    };
  }

  return {
    MAX_PLAYERS, N, CELLS, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, CLUES, BOT_DELAY,
    normGoal, normLevel, generate, fmtTime, botDelayMs,
    newGame, startRound, act, botMove, view
  };
});
