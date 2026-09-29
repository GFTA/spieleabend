// @@TITLE@@ engine. Pure state + rules, shared by the browser (single player) and the Node
// server (online). No DOM, no I/O. The sample game is "Pig": on your turn roll as often as you
// dare; a 1 wipes what you collected this turn, "Halten" banks it. First to the target wins the
// round. Replace the rules below, keep the shape (newGame / act / botMove / view) and the rest of
// the game (server, waiting room, menu, tests) keeps working.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.@@GLOBAL@@ = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = @@MAX@@;
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip", "Pixel Paula", "Byte Ben", "Turbo Tina", "Nano Nick", "Zack Zora", "Bit Bruno"];
  const AVATARS = ["🦊", "🐼", "🐸", "🐯", "🦁", "🐨", "🐙", "🦄", "🐵", "🐧", "🦉", "🐢", "🐳", "🦖", "👻", "🤠"];
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi" };
  const TARGETS = { 30: "Bis 30", 50: "Bis 50", 100: "Bis 100" };

  const normGoal = (n) => ([1, 2, 3].includes(+n) ? +n : 1);
  const normTarget = (n) => (TARGETS[+n] ? +n : 50);
  const normLevel = (n) => (LEVELS[+n] ? +n : 2);
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);

  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 60) S.log.shift();
  }

  // players: [{ name, bot, avatar }]; goal: rounds to win; target: points that win a round; level: computer strength
  function newGame(players, goal, target, level) {
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p, i) => ({ name: p.name, bot: !!p.bot, avatar: avatarOf(p, i), wins: 0, score: 0, moves: 0 })),
      goal: normGoal(goal), target: normTarget(target), level: normLevel(level),
      round: 0, starter: 0, log: [], last: null
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
    S.pot = 0;      // points collected this turn, lost on a 1
    S.roll = 0;     // the last die shown (0 = none yet)
    S.turn = 0;
    S.players.forEach((p) => { p.score = 0; p.moves = 0; });
    const first = S.starter % S.players.length;
    S.starter = (S.starter + 1) % S.players.length;
    log(S, `Runde ${S.round}: ${S.players[first].name} beginnt.`);
    beginTurn(S, first);
  }

  function beginTurn(S, pi) {
    S.cur = pi;
    S.turn++;
    S.pot = 0;
    S.roll = 0;
  }

  function endRound(S, winner, events) {
    S.players[winner].wins++;
    const over = S.players[winner].wins >= S.goal;
    S.phase = "roundEnd";
    S.cur = -1;
    S.pot = 0;
    S.last = { winners: [winner], over, moves: S.players.reduce((n, p) => n + p.moves, 0) };
    log(S, `${S.players[winner].name} ${over ? "gewinnt das Spiel" : "gewinnt die Runde"}!`);
    events.push({ t: "end", winners: [winner] });
  }

  // Apply an action by player `pi`. Returns { ok, error?, events }.
  // Actions: {t:"roll"} {t:"hold"} {t:"giveup"} {t:"skip"} {t:"next"}
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
    if (S.phase !== "play") return fail("Gerade ist niemand dran.");
    if (a.t === "skip") { // the host moves on when the current player is away
      log(S, `${S.players[S.cur].name} wird übersprungen.`);
      beginTurn(S, (S.cur + 1) % S.players.length);
      return ok();
    }
    if (a.t === "giveup") { // the best of the others wins the round
      log(S, `${P.name} gibt auf.`);
      events.push({ t: "giveup", pi });
      const rest = S.players.map((p, i) => i).filter((i) => i !== pi).sort((x, y) => S.players[y].score - S.players[x].score);
      endRound(S, rest[0], events);
      return ok();
    }
    if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);

    if (a.t === "roll") {
      const value = 1 + rand(6);
      P.moves++;
      S.roll = value;
      if (value === 1) {
        log(S, `${P.name} würfelt eine 1${S.pot ? ` und verliert ${S.pot} Punkte` : ""}.`);
        events.push({ t: "roll", pi, value, bust: true, lost: S.pot });
        beginTurn(S, (pi + 1) % S.players.length);
        S.roll = 1; // keep showing the 1 until the next player rolls
        return ok();
      }
      S.pot += value;
      log(S, `${P.name} würfelt eine ${value} (${S.pot} in dieser Runde).`);
      events.push({ t: "roll", pi, value, bust: false });
      return ok();
    }
    if (a.t === "hold") {
      if (!S.pot) return fail("Erst würfeln, dann halten.");
      P.score += S.pot;
      log(S, `${P.name} hält und bekommt ${S.pot} Punkte (${P.score}).`);
      events.push({ t: "hold", pi, points: S.pot });
      if (P.score >= S.target) { endRound(S, pi, events); return ok(); }
      beginTurn(S, (pi + 1) % S.players.length);
      return ok();
    }
    return fail("Unbekannte Aktion.");
  }

  // ---------- computer player ----------
  function botMove(S, pi) {
    if (S.phase !== "play" || S.cur !== pi) return null;
    const me = S.players[pi], level = S.level || 2;
    if (!S.pot) return { t: "roll" };
    if (me.score + S.pot >= S.target) return { t: "hold" };
    const limit = level === 1 ? 12 : level === 2 ? 20 : Math.max(...S.players.map((p) => p.score)) > me.score + 15 ? 28 : 20;
    if (level === 1 && Math.random() < 0.3) return { t: "hold" };
    return S.pot >= limit ? { t: "hold" } : { t: "roll" };
  }

  // Everything on the table is public; pi only marks who "me" is.
  function view(S, pi) {
    const me = S.players[pi] ? pi : -1;
    return {
      me, phase: S.phase, cur: S.cur, turn: S.turn, round: S.round, goal: S.goal, target: S.target, level: S.level || 2,
      pot: S.pot, roll: S.roll,
      players: S.players.map((p, i) => ({ name: p.name, bot: p.bot, avatar: avatarOf(p, i), wins: p.wins, score: p.score, moves: p.moves || 0 })),
      log: S.log.slice(), last: S.last, nextStarter: S.starter % S.players.length
    };
  }

  return { MAX_PLAYERS, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, TARGETS, normGoal, normTarget, normLevel, newGame, startRound, act, botMove, view };
});
