// Würfelpoker engine. Pure state + rules, shared by the browser (one-phone mode) and the
// Node server (online rooms). Nothing is secret: every player sees all dice and holds.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DiceGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DICE = 5;
  const MAX_ROLLS = 3;
  const TURN_MS = 30000;
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_NAMES = ["Robo", "Pixel", "Byte", "Turbo", "Nova", "Blitz", "Chip", "Zappy", "Kiwi", "Rocket"];
  const BOT_LEVELS = { easy: "Einfach", normal: "Normal", hard: "Schwer", random: "Zufällig" };
  // "random": every computer seat draws its own strength once per game
  const botLevel = (S, pi, level) => {
    if (level !== "random") return level;
    const a = S.botLvls || (S.botLvls = []);
    return a[pi] || (a[pi] = ["easy", "normal", "hard"][Math.floor(Math.random() * 3)]);
  };

  // House rules; the UI renders one switch per entry.
  const RULES = [
    { k: "firstSets", name: "Der Erste gibt die Würfe vor", desc: "Hört der Erste einer Runde schon nach 1 oder 2 Würfen auf, haben alle anderen auch nur so viele." },
    { k: "straightsHigh", name: "Straße schlägt Full House", desc: "Beide Straßen stehen in der Rangfolge über dem Full House." },
    { k: "turnTimer", name: "Zugzeit 30 Sekunden", desc: "Wer zu lange überlegt, dessen Zug endet automatisch.", onlineOnly: true }
  ];
  function normRules(r) {
    const o = {};
    for (const x of RULES) o[x.k] = !!(r && r[x.k]);
    return o;
  }

  // Hands from worst to best. The index is the rank; straightsHigh swaps the straights
  // above the full house.
  const HANDS = ["Nichts", "Ein Paar", "Zwei Paare", "Drilling", "Kleine Straße", "Große Straße", "Full House", "Vierling", "Fünfling"];
  const NUM = ["", "Einsen", "Zweien", "Dreien", "Vieren", "Fünfen", "Sechsen"];

  // Evaluate five dice. key compares lexicographically: higher is better.
  function evaluate(dice, rules) {
    const count = [0, 0, 0, 0, 0, 0, 0];
    for (const d of dice) count[d]++;
    // groups sorted by size, then by value: [[value, n], ...]
    const groups = [1, 2, 3, 4, 5, 6].filter((v) => count[v]).map((v) => [v, count[v]])
      .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const sizes = groups.map((g) => g[1]).join("");
    const vals = groups.map((g) => g[0]);
    const sorted = dice.slice().sort((a, b) => a - b).join("");
    let cat, label;
    if (sizes === "5") { cat = 8; label = `Fünfling (${NUM[vals[0]]})`; }
    else if (sizes === "41") { cat = 7; label = `Vierling (${NUM[vals[0]]})`; }
    else if (sizes === "32") { cat = 6; label = `Full House (${NUM[vals[0]]} und ${NUM[vals[1]]})`; }
    else if (sorted === "23456") { cat = 5; label = "Große Straße"; }
    else if (sorted === "12345") { cat = 4; label = "Kleine Straße"; }
    else if (sizes === "311") { cat = 3; label = `Drilling (${NUM[vals[0]]})`; }
    else if (sizes === "221") { cat = 2; label = `Zwei Paare (${NUM[vals[0]]} und ${NUM[vals[1]]})`; }
    else if (sizes === "2111") { cat = 1; label = `Ein Paar (${NUM[vals[0]]})`; }
    else { cat = 0; label = `Nichts (höchste ${vals[0]})`; }
    let rank = cat;
    if (rules && rules.straightsHigh) rank = cat === 4 ? 6 : cat === 5 ? 6.5 : cat === 6 ? 5.5 : cat;
    return { cat, rank, name: HANDS[cat], label, key: [rank].concat(vals) };
  }
  function compare(a, b) { // >0 if a wins
    for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
      const d = (a.key[i] || 0) - (b.key[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  const rollDie = () => 1 + Math.floor(Math.random() * 6);
  function log(S, msg) { S.log.push(msg); if (S.log.length > 60) S.log.shift(); }

  function newGame(names, goal, rules) {
    const S = {
      players: names.map((name) => ({ name, score: 0, result: null })),
      rules: normRules(rules), goal: goal == null ? 5 : goal,
      round: 0, turn: 0, seq: 0, starter: Math.floor(Math.random() * names.length),
      cur: 0, order: [], done: 0, phase: "play",
      dice: [1, 1, 1, 1, 1], hold: [false, false, false, false, false], rolls: 0, maxRolls: MAX_ROLLS,
      log: [], last: null, history: []
    };
    startRound(S);
    return S;
  }

  function startRound(S) {
    S.round++;
    S.log = [];
    S.last = null;
    S.maxRolls = MAX_ROLLS;
    const n = S.players.length;
    S.order = Array.from({ length: n }, (_, k) => (S.starter + k) % n);
    S.starter = (S.starter + 1) % n;
    S.done = 0;
    S.players.forEach((p) => { p.result = null; });
    log(S, `Runde ${S.round}: ${S.players[S.order[0]].name} beginnt.`);
    beginTurn(S, S.order[0]);
  }

  function beginTurn(S, pi) {
    S.cur = pi;
    S.phase = "play";
    S.rolls = 0;
    S.hold = [false, false, false, false, false];
    S.turn++; S.seq++;
  }

  function finishTurn(S, pi, events) {
    const p = S.players[pi];
    p.result = S.rolls ? Object.assign(evaluate(S.dice, S.rules), { dice: S.dice.slice(), rolls: S.rolls }) : null;
    log(S, p.result ? `${p.name}: ${p.result.label}${S.rolls < S.maxRolls ? ` nach ${S.rolls} ${S.rolls === 1 ? "Wurf" : "Würfen"}` : ""}.` : `${p.name} hat nicht gewürfelt.`);
    events.push({ t: "done", pi });
    // the first player of the round may limit everyone else's rolls
    if (S.rules.firstSets && S.done === 0 && S.rolls && S.rolls < S.maxRolls) {
      S.maxRolls = S.rolls;
      log(S, `Alle anderen haben diese Runde nur ${S.rolls} ${S.rolls === 1 ? "Wurf" : "Würfe"}.`);
    }
    S.done++;
    if (S.done >= S.order.length) return endRound(S, events);
    beginTurn(S, S.order[S.done]);
  }

  function endRound(S, events) {
    const ranked = S.players.map((p, i) => ({ i, r: p.result })).filter((x) => x.r)
      .sort((a, b) => compare(b.r, a.r));
    const best = ranked[0];
    const winners = best ? ranked.filter((x) => compare(x.r, best.r) === 0).map((x) => x.i) : [];
    winners.forEach((i) => { S.players[i].score++; });
    const over = S.goal > 0 ? S.players.some((p) => p.score >= S.goal) : true;
    S.last = { winners, label: best ? best.r.label : "", over };
    S.history.push({ round: S.round, winners, label: S.last.label });
    S.phase = "roundEnd";
    S.seq++;
    const names = winners.map((i) => S.players[i].name).join(" und ");
    log(S, winners.length ? `${names} ${winners.length > 1 ? "gewinnen" : "gewinnt"} die Runde mit ${S.last.label}.` : "Niemand hat gewürfelt.");
    if (over) log(S, `${S.players.slice().sort((a, b) => b.score - a.score)[0].name} gewinnt das Spiel!`);
    events.push({ t: "roundEnd" });
  }

  // Apply an action by player pi. Returns { ok, error?, events }.
  // Actions: {t:"roll"} {t:"hold", i} or {t:"hold", keep:[5 bools]} {t:"stop"} {t:"next"}
  //          {t:"skip"} (host) {t:"timeout"} (server clock)
  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events });
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
      if (S.last && S.last.over) { S.players.forEach((p) => { p.score = 0; }); S.round = 0; S.history = []; }
      startRound(S);
      return { ok: true, events };
    }
    if (S.phase !== "play") return fail("Gerade ist niemand dran.");
    if (a.t === "skip" || a.t === "timeout") {
      if (a.t === "timeout" && pi !== S.cur) return fail("Nicht dran.");
      const p = S.players[S.cur];
      log(S, a.t === "timeout" ? `${p.name}: Zeit abgelaufen.` : `${p.name} wird übersprungen.`);
      if (!S.rolls) rollFree(S, events); // one throw so there is something to count
      finishTurn(S, S.cur, events);
      return { ok: true, events };
    }
    if (pi !== S.cur) return fail(`${S.players[S.cur].name} ist dran.`);

    if (a.t === "hold") {
      if (!S.rolls) return fail("Erst würfeln, dann Würfel behalten.");
      if (S.rolls >= S.maxRolls) return fail("Keine Würfe mehr übrig.");
      if (Array.isArray(a.keep) && a.keep.length === DICE) S.hold = a.keep.map(Boolean);
      else if (Number.isInteger(a.i) && a.i >= 0 && a.i < DICE) S.hold[a.i] = !S.hold[a.i];
      else return fail("Welcher Würfel?");
      S.seq++;
      events.push({ t: "hold", pi });
      return { ok: true, events };
    }

    if (a.t === "roll") {
      if (S.rolls >= S.maxRolls) return fail("Keine Würfe mehr übrig.");
      if (S.rolls && S.hold.every(Boolean)) return fail("Du behältst alle Würfel. Tippe „Fertig“ oder lass einen los.");
      rollFree(S, events);
      if (S.rolls >= S.maxRolls) finishTurn(S, pi, events);
      return { ok: true, events };
    }

    if (a.t === "stop") {
      if (!S.rolls) return fail("Du musst mindestens einmal würfeln.");
      finishTurn(S, pi, events);
      return { ok: true, events };
    }
    return fail("Unbekannte Aktion.");
  }

  // roll every die that is not held
  function rollFree(S, events) {
    const which = [];
    if (!S.rolls) S.hold = [false, false, false, false, false];
    S.dice = S.dice.map((d, i) => { if (S.hold[i]) return d; which.push(i); return rollDie(); });
    S.rolls++;
    S.seq++;
    events.push({ t: "rolled", pi: S.cur, which, dice: S.dice.slice(), roll: S.rolls });
  }

  // no timers in this game; the server and the one-phone mode call these generically
  const tick = () => [];
  const nextDeadline = () => -1;

  // The computer player, also used for the hint. Works on a view (all public anyway).
  function suggest(v, level) {
    if (!v || v.phase !== "play" || v.cur !== v.me) return null;
    if (!v.rolls) return { t: "roll" };
    const left = v.maxRolls - v.rolls;
    if (left <= 0) return { t: "stop" };
    const now = evaluate(v.dice, v.rules);
    const others = v.players.filter((p, i) => i !== v.me && p.result).map((p) => p.result);
    const best = others.sort((a, b) => compare(b, a))[0];
    const beating = !best || compare(now, best) > 0;
    if (level === "easy") {
      if (Math.random() < 0.3 || now.cat >= 6) return { t: "stop" };
      const keep = v.dice.map(() => Math.random() < 0.4);
      if (keep.every(Boolean)) keep[0] = false;
      if (keep.join() !== v.hold.join()) return { t: "hold", keep };
      return { t: "roll" };
    }
    // stop when the hand is strong, or (hard) when it already beats everyone who played
    if (now.cat >= 6 || (now.cat >= 4 && now.cat <= 5 && level !== "hard")) return { t: "stop" };
    if (level === "hard" && best && beating && now.cat >= 3) return { t: "stop" };
    const keep = wantKeep(v.dice);
    if (keep.every(Boolean)) return { t: "stop" };
    if (keep.join() !== v.hold.join()) return { t: "hold", keep };
    return { t: "roll" };
  }
  // keep pairs and better; with nothing, chase a straight or keep the highest die
  function wantKeep(dice) {
    const count = [0, 0, 0, 0, 0, 0, 0];
    for (const d of dice) count[d]++;
    const multi = new Set([1, 2, 3, 4, 5, 6].filter((v) => count[v] >= 2));
    if (multi.size) return dice.map((d) => multi.has(d));
    for (const run of [[2, 3, 4, 5, 6], [1, 2, 3, 4, 5]]) {
      const have = run.filter((x) => count[x]);
      if (have.length >= 4) { const used = new Set(); return dice.map((d) => (run.includes(d) && !used.has(d) ? (used.add(d), true) : false)); }
    }
    const hi = Math.max(...dice);
    let done = false;
    return dice.map((d) => (d === hi && !done ? (done = true) : false));
  }

  function view(S, pi) {
    return {
      players: S.players.map((p) => ({ name: p.name, score: p.score, bot: !!p.bot, avatar: p.avatar || "", result: p.result })),
      me: pi, cur: S.cur, order: S.order, done: S.done, phase: S.phase,
      dice: S.dice.slice(), hold: S.hold.slice(), rolls: S.rolls, maxRolls: S.maxRolls,
      hand: S.rolls ? evaluate(S.dice, S.rules) : null,
      next: S.order[S.done + 1] != null ? S.order[S.done + 1] : null,
      round: S.round, goal: S.goal, turn: S.turn, seq: S.seq, rules: S.rules,
      log: S.log.slice(-40), last: S.last, history: S.history
    };
  }

  return { DICE, MAX_ROLLS, TURN_MS, AVATARS, BOT_NAMES, BOT_LEVELS, botLevel, RULES, HANDS, normRules, evaluate, compare, newGame, startRound, act, tick, nextDeadline, suggest, view };
});
