// Mensch ärgere dich nicht engine. Pure state + rules, shared by the browser
// (one-device mode) and the Node server (online mode). No DOM, no I/O.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MaednGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 8;
  const COLORS = ["Rot", "Blau", "Grün", "Gelb", "Lila", "Türkis", "Orange", "Rosa"]; // by seat, clockwise around the board
  // up to 4 players sit at a 4-arm board (two opposite each other), 5-6 at 6 arms, 7-8 at 8 arms
  const SEATS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6], 8: [0, 1, 2, 3, 4, 5, 6, 7] };
  const armsFor = (n) => (n <= 4 ? 4 : n <= 6 ? 6 : 8);
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip", "Bit-Berta", "Dr. Würfel", "Turbo-Tina", "Sir Sechs", "Kicker Kalle"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi", 0: "Zufällig" };
  const GOALS = { 1: "Wer zuerst fertig ist", 2: "Alle Plätze ausspielen" };
  const CLOCK_MS = 20000, GRACE = 600;
  const OUT = -2; // piece: -1 in the yard, 0..track-1 steps from its start, track..track+3 goal, -2 gave up (the track has 10 fields per arm: 40, 60 or 80)
  const trk = (S) => S.track || 40;

  // House rules. Shared with the UI, which renders one switch per entry.
  const RULES = [
    { k: "three", name: "Dreimal würfeln", desc: "Wer keine Figur auf dem Feld hat, darf bis zu dreimal würfeln, um eine 6 zu bekommen." },
    { k: "hit", name: "Schlagpflicht", desc: "Wer eine fremde Figur schlagen kann, muss das auch tun." },
    { k: "safeStart", name: "Startfeld ist sicher", desc: "Wer auf dem eigenen Startfeld steht, kann dort nicht geschlagen werden." },
    { k: "freeSix", name: "Freie Wahl bei der 6", desc: "Mit einer 6 musst du nicht rauskommen und das Startfeld nicht räumen, du darfst auch eine andere Figur ziehen." },
    { k: "easyOut", name: "Raus mit 1 oder 6", desc: "Aus dem Haus kommst du auch mit einer 1 heraus." },
    { k: "rush", name: "Schnellstart", desc: "Jeder beginnt mit einer Figur auf dem Startfeld." },
    { k: "jumpGoal", name: "Im Ziel überspringen", desc: "Im Zielfeld dürfen Figuren über eigene Figuren hinweg springen." },
    { k: "hitAgain", name: "Nach dem Schlagen nochmal", desc: "Wer eine Figur schlägt, darf noch einmal würfeln." },
    { k: "goalAgain", name: "Ziel = nochmal", desc: "Wer eine Figur ins Ziel bringt, darf noch einmal würfeln." },
    { k: "sixPenalty", name: "Drei Sechsen", desc: "Die dritte 6 hintereinander verfällt, der Zug ist vorbei." },
    { k: "teams", name: "Teams", desc: "Nur zu viert: Wer sich gegenübersitzt, spielt zusammen. Wer fertig ist, würfelt für den Partner weiter." },
    { k: "clock", name: "Zugzeit", desc: "20 Sekunden zum Würfeln und Ziehen, sonst übernimmt das Spiel." }
  ];
  const DEFAULT_RULES = { three: true };
  function normRules(r) {
    const src = r && typeof r === "object" ? r : DEFAULT_RULES, o = {};
    for (const x of RULES) o[x.k] = src[x.k] === true;
    return o;
  }
  const normGoal = (n) => (GOALS[+n] ? +n : 1);
  const normLevel = (n) => (n != null && n !== "" && LEVELS[+n] ? +n : 2);
  // level 0 = random: every computer player got its own strength when the game started
  const lvOf = (S, pi) => S.level || (S.players[pi] && S.players[pi].lvl) || 2;
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);

  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 80) S.log.shift();
  }
  const partner = (S, i) => (S.rules.teams ? (i + 2) % 4 : -1);
  // whose pieces player pi moves: in teams a finished player plays for the partner
  const owner = (S, pi) => (S.rules.teams && S.players[pi].done ? partner(S, pi) : pi);
  // absolute track field of a piece that is on the track
  const abs = (S, o, rel) => (S.players[o].seat * 10 + rel) % trk(S);
  const color = (S, i) => COLORS[S.players[i].seat];

  function occupant(S, field) {
    for (let i = 0; i < S.players.length; i++) {
      const P = S.players[i];
      for (let k = 0; k < 4; k++) if (P.pieces[k] >= 0 && P.pieces[k] < trk(S) && abs(S, i, P.pieces[k]) === field) return { pi: i, k };
    }
    return null;
  }

  const outNumber = (S, d) => d === 6 || (S.rules.easyOut && d === 1);

  // where piece k of player o lands with d, or null
  function target(S, o, k, d) {
    const P = S.players[o], rel = P.pieces[k], HOME = trk(S);
    if (rel === OUT) return null;
    let to;
    if (rel === -1) {
      if (!outNumber(S, d)) return null;
      to = 0;
    } else {
      to = rel + d;
      if (to > HOME + 3) return null;
      if (to >= HOME) {
        if (P.pieces.includes(to)) return null;
        if (!S.rules.jumpGoal) for (let g = Math.max(rel + 1, HOME); g < to; g++) if (P.pieces.includes(g)) return null;
        return to;
      }
    }
    if (P.pieces.some((r, j) => j !== k && r === to)) return null;
    const occ = occupant(S, abs(S, o, to));
    if (occ && occ.pi !== o) {
      if (occ.pi === partner(S, o)) return null; // never on the partner's piece
      if (S.rules.safeStart && S.players[occ.pi].pieces[occ.k] === 0) return null;
    }
    return to;
  }

  // legal moves for the player on turn with the die d: [{ k, from, to, hit }]
  function legalMoves(S, pi, d) {
    const o = owner(S, pi), P = S.players[o];
    let ms = [], yard = false;
    for (let k = 0; k < 4; k++) {
      const to = target(S, o, k, d);
      if (to == null) continue;
      if (P.pieces[k] === -1) { if (yard) continue; yard = true; } // every piece in the yard does the same
      let hit = null;
      if (to < trk(S)) { const occ = occupant(S, abs(S, o, to)); if (occ && occ.pi !== o) hit = occ; }
      ms.push({ k, from: P.pieces[k], to, hit });
    }
    if (!S.rules.freeSix) {
      const outs = ms.filter((m) => m.from === -1);
      if (outs.length) ms = outs; // coming out is a must
      else if (P.pieces.includes(0) && P.pieces.includes(-1)) { // so is clearing the start field
        const st = ms.filter((m) => m.from === 0);
        if (st.length) ms = st;
      }
    }
    if (S.rules.hit) { const h = ms.filter((m) => m.hit); if (h.length) ms = h; }
    return ms;
  }
  // nothing on the track and nothing in the goal that could still move up
  function stuck(S, o) {
    const P = S.players[o];
    const HOME = trk(S);
    return P.pieces.every((r, k) => r < 0 || (r >= HOME && [1, 2, 3].every((d) => target(S, o, k, d) == null)));
  }
  const canAct = (S, i) => {
    const P = S.players[i];
    if (P.out) return false;
    if (!P.done) return true;
    const q = partner(S, i);
    return q >= 0 && !S.players[q].done && !S.players[q].out;
  };

  // players: [{ name, bot, avatar }] (2-8); goal: 1 first finisher wins, 2 play out all places
  function newGame(players, goal, rules, level) {
    const list = players.slice(0, MAX_PLAYERS);
    const S = {
      players: list.map((p, i) => ({ name: p.name, bot: !!p.bot, lvl: 1 + Math.floor(Math.random() * 3), avatar: avatarOf(p, i), wins: 0 })),
      goal: normGoal(goal), rules: normRules(rules), level: normLevel(level),
      arms: armsFor(list.length), track: armsFor(list.length) * 10,
      round: 0, turn: 0, starter: rand(list.length), log: [], last: null, lastMove: null, deadline: 0
    };
    if (S.players.length !== 4) S.rules.teams = false;
    startRound(S);
    return S;
  }

  function startRound(S) {
    S.round++;
    const seats = SEATS[S.players.length];
    S.players.forEach((p, i) => {
      Object.assign(p, { seat: seats[i], pieces: [S.rules.rush ? 0 : -1, -1, -1, -1], done: false, out: false, place: 0, hits: 0, lost: 0, sixes: 0, rolls: 0 });
    });
    S.places = [];
    S.phase = "play";
    S.last = null;
    S.lastMove = null;
    S.lastRoll = null;
    S.log = [];
    S.turn = 0;
    const first = S.starter % S.players.length;
    S.starter = (first + 1) % S.players.length;
    log(S, `Runde ${S.round}: ${S.players[first].name} (${color(S, first)}) beginnt.`);
    beginTurn(S, first);
  }

  function armClock(S, now) {
    const P = S.players[S.cur];
    S.deadline = S.phase === "play" && P && !P.bot && S.rules.clock ? (now || Date.now()) + CLOCK_MS : 0;
  }
  function beginTurn(S, pi) {
    S.cur = pi;
    S.turn++;
    S.need = "roll";
    S.dice = 0;
    S.tries = 0;
    S.streak = 0;
    armClock(S);
  }
  function advance(S, events) {
    const n = S.players.length;
    for (let s = 1; s <= n; s++) {
      const j = (S.cur + s) % n;
      if (canAct(S, j)) { beginTurn(S, j); return; }
    }
    endRound(S, S.places.slice(0, 1), events);
  }

  function endRound(S, winners, events) {
    for (const i of winners) S.players[i].wins++;
    S.phase = "roundEnd";
    S.cur = -1;
    S.need = null;
    S.deadline = 0;
    // everybody still on the board gets the remaining places, most pieces in the goal first
    const rest = S.players.map((_, i) => i).filter((i) => !S.places.includes(i))
      .sort((a, b) => progress(S, b) - progress(S, a));
    S.last = { winners, over: true, places: S.places.concat(rest), turns: S.turn };
    const names = winners.map((i) => S.players[i].name).join(" und ");
    log(S, winners.length ? `${names} ${winners.length > 1 ? "gewinnen" : "gewinnt"}!` : "Das Spiel ist vorbei.");
    events.push({ t: "end", winners });
  }
  // how far a player got: steps of all pieces together (for places and the computer)
  const progress = (S, i) => S.players[i].out ? -1 : S.players[i].pieces.reduce((n, r) => n + (r < 0 ? 0 : r + 1), 0);

  function checkEnd(S, events) {
    if (S.rules.teams) {
      for (const t of [0, 1]) {
        const a = S.players[t], b = S.players[t + 2];
        if (a.done && b.done) { endRound(S, [t, t + 2], events); return true; }
        if (a.out || b.out) { endRound(S, [1 - t, 3 - t], events); return true; }
      }
      return false;
    }
    const alive = S.players.map((_, i) => i).filter((i) => !S.players[i].done && !S.players[i].out);
    if (S.goal === 1 && S.places.length) { endRound(S, [S.places[0]], events); return true; }
    if (alive.length <= 1) { endRound(S, S.places.length ? [S.places[0]] : alive, events); return true; }
    return false;
  }

  // Apply an action by player `pi`. Returns { ok, error?, events }.
  // Actions: {t:"roll"} {t:"move", k} {t:"giveup"} {t:"skip"} {t:"next"}
  function act(S, pi, a) {
    const events = [], HOME = trk(S);
    const fail = (error) => ({ ok: false, error, events });
    const ok = () => ({ ok: true, events });
    const P = S.players[pi];
    if (!P) return fail("Unbekannter Spieler.");
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Das Spiel läuft noch.");
      startRound(S);
      return ok();
    }
    if (S.phase !== "play") return fail("Gerade ist niemand dran.");
    if (a.t === "skip") { // host moves on when the current player is away
      log(S, `${S.players[S.cur].name} wird übersprungen.`);
      advance(S, events);
      return ok();
    }
    if (a.t === "giveup") {
      if (P.out) return fail("Du hast schon aufgegeben.");
      P.out = true;
      if (!P.done) P.pieces = P.pieces.map(() => OUT);
      log(S, `${P.name} gibt auf.`);
      events.push({ t: "giveup", pi });
      if (checkEnd(S, events)) return ok();
      if (S.cur === pi || !canAct(S, S.cur)) advance(S, events);
      return ok();
    }
    if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);

    if (a.t === "roll") {
      if (S.need !== "roll") return fail("Du hast schon gewürfelt, jetzt ziehen.");
      const d = S.rig && S.rig.length ? S.rig.shift() : 1 + rand(6);
      S.dice = d;
      P.rolls++;
      S.lastRoll = { pi, d, turn: S.turn };
      events.push({ t: "roll", pi, d });
      if (d === 6) { S.streak++; P.sixes++; }
      if (d === 6 && S.rules.sixPenalty && S.streak >= 3) {
        log(S, `${P.name} würfelt die dritte 6 hintereinander, die verfällt.`);
        events.push({ t: "penalty", pi });
        advance(S, events);
        return ok();
      }
      const ms = legalMoves(S, pi, d);
      if (ms.length) {
        S.need = "move";
        armClock(S);
        return ok();
      }
      S.tries++;
      if (S.rules.three && stuck(S, owner(S, pi)) && S.tries < 3 && d !== 6) {
        log(S, `${P.name} würfelt eine ${d}, noch ${3 - S.tries}× würfeln.`);
        armClock(S);
        return ok();
      }
      if (d === 6) { log(S, `${P.name} würfelt eine 6, kann nicht ziehen, darf aber nochmal.`); S.tries = 0; armClock(S); return ok(); }
      log(S, `${P.name} würfelt eine ${d} und kann nicht ziehen.`);
      events.push({ t: "pass", pi, d });
      advance(S, events);
      return ok();
    }

    if (a.t === "move") {
      if (S.need !== "move") return fail("Erst würfeln.");
      const m = legalMoves(S, pi, S.dice).find((x) => x.k === +a.k);
      if (!m) return fail("Diese Figur darf gerade nicht ziehen.");
      const o = owner(S, pi), O = S.players[o];
      if (m.hit) {
        const V = S.players[m.hit.pi];
        V.pieces[m.hit.k] = -1;
        V.lost++;
        P.hits++;
      }
      O.pieces[m.k] = m.to;
      S.lastMove = { pi, o, k: m.k, from: m.from, to: m.to, hit: m.hit, turn: S.turn };
      events.push({ t: "move", pi, o, k: m.k, from: m.from, to: m.to, hit: m.hit, d: S.dice });
      const whose = o === pi ? "" : ` (für ${O.name})`;
      if (m.from === -1) log(S, `${P.name}${whose} kommt mit einer ${S.dice} raus${m.hit ? ` und wirft ${S.players[m.hit.pi].name} raus` : ""}.`);
      else if (m.to >= HOME && m.from < HOME) log(S, `${P.name}${whose} zieht ${S.dice} ins Ziel.`);
      else log(S, `${P.name}${whose} zieht ${S.dice}${m.hit ? ` und wirft ${S.players[m.hit.pi].name} raus` : ""}.`);
      if (m.hit) events.push({ t: "hit", pi, victim: m.hit.pi });
      if (m.to >= HOME && m.from < HOME) events.push({ t: "goal", pi: o });
      if (O.pieces.every((r) => r >= HOME)) {
        O.done = true;
        O.place = S.places.push(o);
        log(S, `${O.name} hat alle Figuren im Ziel${S.rules.teams || S.goal === 2 ? ` (Platz ${O.place})` : ""}!`);
        events.push({ t: "finish", pi: o, place: O.place });
        if (checkEnd(S, events)) return ok();
      }
      const again = S.dice === 6 || (S.rules.hitAgain && !!m.hit) || (S.rules.goalAgain && m.to >= HOME && m.from < HOME);
      if (again && canAct(S, pi)) {
        S.need = "roll";
        S.tries = 0;
        log(S, `${P.name} darf nochmal würfeln.`);
        armClock(S);
      } else advance(S, events);
      return ok();
    }
    return fail("Unbekannte Aktion.");
  }

  // Resolve a turn clock that ran out: the game rolls or moves for the player.
  function tick(S, now) {
    now = now || Date.now();
    if (S.phase !== "play" || !S.deadline || now <= S.deadline + GRACE) return [];
    const pi = S.cur;
    log(S, `${S.players[pi].name} war zu langsam, das Spiel ${S.need === "roll" ? "würfelt" : "zieht"}.`);
    const r = act(S, pi, S.need === "roll" ? { t: "roll" } : pickMove(S, pi, 2));
    return [{ t: "timeout", pi }].concat(r.events);
  }
  function nextDeadline(S, now) {
    if (S.phase !== "play" || !S.deadline) return -1;
    return Math.max(0, S.deadline + GRACE - (now || Date.now()));
  }
  const resetClock = (S) => armClock(S);

  // ---------- computer player: weighs every legal move ----------
  // how many opposing pieces could reach field `rel` of player o with one roll
  function danger(S, o, rel, ignore) {
    const TRACK = trk(S);
    if (rel < 0 || rel >= TRACK) return 0;
    if (S.rules.safeStart && rel === 0) return 0;
    const f = abs(S, o, rel);
    let n = 0;
    S.players.forEach((P, i) => {
      if (i === o || i === partner(S, o) || P.out) return;
      P.pieces.forEach((r, k) => {
        if (ignore && ignore.pi === i && ignore.k === k) return;
        if (r === -1) { if (P.seat * 10 === f) n += 0.5; return; }
        if (r < 0 || r >= TRACK) return;
        const dist = (f - abs(S, i, r) + TRACK) % TRACK;
        if (dist >= 1 && dist <= 6 && r + dist < TRACK) n++;
      });
    });
    return n;
  }
  function score(S, pi, m, level) {
    const o = owner(S, pi), HOME = trk(S), TRACK = HOME;
    let s = (m.to - Math.max(m.from, 0)) * 0.6;
    if (m.from === -1) s += 45;
    if (m.hit) s += 35 + S.players[m.hit.pi].pieces[m.hit.k] * 0.8;
    if (m.to >= HOME && m.from < HOME) s += 40;
    if (m.to >= HOME) s += (m.to - HOME) * 3;
    if (m.from === 0 && S.players[o].pieces.includes(-1)) s += 10; // free the start field
    if (level >= 2) {
      const w = level === 3 ? 22 : 6;
      s -= danger(S, o, m.to, m.hit) * w;
      if (m.from >= 0 && m.from < TRACK) s += danger(S, o, m.from) * (level === 3 ? 18 : 4);
      if (level === 3 && m.to < TRACK && m.to > TRACK - 7) s += 4; // close to home
    }
    return s;
  }
  function pickMove(S, pi, level) {
    const ms = legalMoves(S, pi, S.dice);
    if (!ms.length) return null;
    if (Math.random() < (level === 1 ? 0.4 : level === 2 ? 0.1 : 0)) return { t: "move", k: ms[rand(ms.length)].k };
    let best = ms[0], bv = -Infinity;
    for (const m of ms) { const v = score(S, pi, m, level) + Math.random() * 0.01; if (v > bv) { bv = v; best = m; } }
    return { t: "move", k: best.k };
  }
  // the best move for the player on turn, by the pro computer's weighing (deterministic), or null
  function suggest(S, pi) {
    const ms = legalMoves(S, pi, S.dice);
    if (ms.length < 2) return ms.length ? ms[0].k : null;
    let best = ms[0], bv = -Infinity;
    for (const m of ms) { const v = score(S, pi, m, 3); if (v > bv) { bv = v; best = m; } }
    return best.k;
  }
  // how many opposing pieces could hit the piece after the move, and whether it stands in danger now
  function annotate(S, o, ms) {
    return ms.map((m) => ({ k: m.k, from: m.from, to: m.to, hit: m.hit, risk: danger(S, o, m.to, m.hit), flee: m.from >= 0 && m.from < trk(S) && danger(S, o, m.from) > 0 }));
  }
  function botMove(S, pi) {
    if (S.phase !== "play" || S.cur !== pi) return null;
    return S.need === "roll" ? { t: "roll" } : pickMove(S, pi, lvOf(S, pi));
  }

  // Everything on the board is public; pi only marks who "me" is.
  function view(S, pi) {
    const me = S.players[pi] ? pi : -1, play = S.phase === "play";
    return {
      me, arms: S.arms || 4, track: trk(S), phase: S.phase, cur: S.cur, turn: S.turn, round: S.round, goal: S.goal, level: S.level == null ? 2 : S.level, rules: S.rules,
      need: S.need, dice: S.dice, tries: S.tries || 0, streak: S.streak || 0, nextStarter: S.starter % S.players.length,
      owner: play ? owner(S, S.cur) : -1, moves: play && S.need === "move" ? annotate(S, owner(S, S.cur), legalMoves(S, S.cur, S.dice)) : [],
      tip: play && S.need === "move" ? suggest(S, S.cur) : null,
      three: play && S.need === "roll" && S.rules.three && stuck(S, owner(S, S.cur)),
      clockMs: S.rules.clock ? CLOCK_MS : 0, clock: S.deadline ? Math.max(0, S.deadline - Date.now()) : 0,
      players: S.players.map((p, i) => ({
        name: p.name, bot: p.bot, avatar: avatarOf(p, i), wins: p.wins, seat: p.seat, pieces: p.pieces.slice(),
        done: p.done, out: p.out, place: p.place, hits: p.hits, lost: p.lost, sixes: p.sixes, rolls: p.rolls
      })),
      places: S.places.slice(), lastMove: S.lastMove, lastRoll: S.lastRoll, log: S.log.slice(), last: S.last
    };
  }

  return {
    MAX_PLAYERS, COLORS, SEATS, armsFor, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, GOALS, RULES, DEFAULT_RULES,
    normRules, normGoal, normLevel, newGame, startRound, act, legalMoves, suggest, tick, nextDeadline, resetClock, botMove, view
  };
});
