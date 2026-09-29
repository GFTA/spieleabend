// Kniffel engine. Pure state + rules, shared by the browser (one-phone mode) and the Node
// server (online rooms). Nothing is secret: every player sees all dice, holds and score sheets.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KniffelGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DICE = 5;
  const MAX_ROLLS = 3;
  const TURN_MS = 30000;
  const BONUS_AT = 63, BONUS = 35, EXTRA_KNIFFEL = 100;
  const AVATARS = ["🦊", "🐼", "🐸", "🐯", "🦁", "🐨", "🐙", "🦄", "🐵", "🐧", "🦉", "🐢", "🐳", "🦖", "👻", "🤠"];
  const BOT_NAMES = ["Robo", "Pixel", "Byte", "Turbo", "Nova", "Blitz", "Chip", "Zappy", "Kiwi", "Rocket"];
  const BOT_LEVELS = { easy: "Einfach", normal: "Normal", hard: "Schwer" };

  // House rules; the UI renders one switch per entry.
  const RULES = [
    { k: "joker", name: "Kniffel-Bonus und Joker", desc: "Jeder weitere Kniffel gibt 100 Punkte, wenn das Kniffel-Feld 50 hat. Er zählt außerdem als Joker: Full House und Straßen gibt es dann in voller Höhe." },
    { k: "turnTimer", name: "Zugzeit 30 Sekunden", desc: "Wer zu lange überlegt, dessen Zug endet automatisch mit dem besten freien Feld.", onlineOnly: true }
  ];
  function normRules(r) {
    const o = {};
    for (const x of RULES) o[x.k] = !!(r && r[x.k]);
    return o;
  }

  // The 13 boxes of the sheet, in the order they are printed. up = upper section.
  const CATS = [
    { k: "ones", name: "Einser", short: "1er", up: true, n: 1, avg: 2.1 },
    { k: "twos", name: "Zweier", short: "2er", up: true, n: 2, avg: 5.3 },
    { k: "threes", name: "Dreier", short: "3er", up: true, n: 3, avg: 8.6 },
    { k: "fours", name: "Vierer", short: "4er", up: true, n: 4, avg: 12.2 },
    { k: "fives", name: "Fünfer", short: "5er", up: true, n: 5, avg: 15.7 },
    { k: "sixes", name: "Sechser", short: "6er", up: true, n: 6, avg: 19.2 },
    { k: "three", name: "Dreierpasch", short: "3er-P.", avg: 21.7 },
    { k: "four", name: "Viererpasch", short: "4er-P.", avg: 13.1 },
    { k: "house", name: "Full House", short: "Full H.", avg: 22.6, note: "25" },
    { k: "small", name: "Kleine Straße", short: "Kl. Str.", avg: 29.5, note: "30" },
    { k: "large", name: "Große Straße", short: "Gr. Str.", avg: 32.7, note: "40" },
    { k: "kniffel", name: "Kniffel", short: "Kniffel", avg: 16.8, note: "50" },
    { k: "chance", name: "Chance", short: "Chance", avg: 22 }
  ];
  const CAT = Object.fromEntries(CATS.map((c) => [c.k, c]));
  const ROUNDS = CATS.length;

  const counts = (dice) => { const c = [0, 0, 0, 0, 0, 0, 0]; for (const d of dice) c[d]++; return c; };
  const sum = (dice) => dice.reduce((a, b) => a + b, 0);
  const isKniffel = (dice) => dice.every((d) => d === dice[0]);
  function hasRun(dice, len) {
    const c = counts(dice);
    for (let s = 1; s + len - 1 <= 6; s++) { let ok = true; for (let v = s; v < s + len; v++) if (!c[v]) ok = false; if (ok) return true; }
    return false;
  }
  // points for these dice in this box; joker = a Kniffel is used as a wildcard (fixed values)
  function points(k, dice, joker) {
    const c = counts(dice), max = Math.max(...c);
    switch (k) {
      case "three": return max >= 3 ? sum(dice) : 0;
      case "four": return max >= 4 ? sum(dice) : 0;
      case "house": return joker || (max === 3 && c.includes(2)) ? 25 : 0;
      case "small": return joker || hasRun(dice, 4) ? 30 : 0;
      case "large": return joker || hasRun(dice, 5) ? 40 : 0;
      case "kniffel": return isKniffel(dice) ? 50 : 0;
      case "chance": return sum(dice);
      default: return c[CAT[k].n] * CAT[k].n;
    }
  }

  const emptySheet = () => Object.fromEntries(CATS.map((c) => [c.k, null]));
  function totals(p) {
    let up = 0, low = 0;
    for (const c of CATS) { const v = p.sheet[c.k]; if (v != null) { if (c.up) up += v; else low += v; } }
    const bonus = up >= BONUS_AT ? BONUS : 0, extra = (p.extra || 0) * EXTRA_KNIFFEL;
    return { up, bonus, low, extra, total: up + bonus + low + extra, filled: CATS.filter((c) => p.sheet[c.k] != null).length };
  }

  // What the current dice are worth in every box, and which boxes may be filled now.
  // With the joker rule a second Kniffel must go to its number first, then to a lower box,
  // and only if nothing else is left to any upper box (as zero).
  function options(S) {
    const p = S.players[S.cur], out = {};
    if (!S.rolls) return out;
    const joker = !!(S.rules.joker && isKniffel(S.dice) && p.sheet.kniffel != null);
    let open = CATS.filter((c) => p.sheet[c.k] == null);
    if (joker) {
      const top = CAT[["", "ones", "twos", "threes", "fours", "fives", "sixes"][S.dice[0]]];
      if (p.sheet[top.k] == null) open = [top];
      else {
        const low = open.filter((c) => !c.up);
        if (low.length) open = low;
      }
    }
    for (const c of open) out[c.k] = points(c.k, S.dice, joker && !c.up);
    return out;
  }

  const rollDie = () => 1 + Math.floor(Math.random() * 6);
  function log(S, msg) { S.log.push(msg); if (S.log.length > 60) S.log.shift(); }

  function newGame(names, rules) {
    const S = {
      players: names.map((name) => ({ name, sheet: emptySheet(), extra: 0 })),
      rules: normRules(rules), rounds: ROUNDS, round: 1, turn: 0, seq: 0, t: 0,
      order: names.map((_, i) => i), cur: 0, phase: "play",
      dice: [1, 1, 1, 1, 1], hold: [false, false, false, false, false], rolls: 0, maxRolls: MAX_ROLLS,
      log: [], last: null
    };
    log(S, `${names[0]} beginnt.`);
    beginTurn(S, 0);
    return S;
  }
  // a rematch with the same table
  function restart(S) {
    S.players.forEach((p) => { p.sheet = emptySheet(); p.extra = 0; });
    S.t = 0; S.round = 1; S.last = null; S.log = [];
    S.order = S.players.map((_, i) => (i + S.turn) % S.players.length); // somebody else opens
    log(S, `Neues Spiel: ${S.players[S.order[0]].name} beginnt.`);
    beginTurn(S, S.order[0]);
  }

  function beginTurn(S, pi) {
    S.cur = pi;
    S.phase = "play";
    S.rolls = 0;
    S.hold = [false, false, false, false, false];
    S.turn++; S.seq++;
  }

  function score(S, pi, k, events) {
    const p = S.players[pi], opts = options(S);
    const pts = opts[k];
    const joker = !!(S.rules.joker && isKniffel(S.dice) && p.sheet.kniffel != null);
    const bonus = joker && p.sheet.kniffel === 50;
    p.sheet[k] = pts;
    if (bonus) p.extra++;
    log(S, `${p.name}: ${CAT[k].name} ${pts}${bonus ? " + 100 (Kniffel-Bonus)" : ""}.`);
    events.push({ t: "scored", pi, c: k, points: pts, bonus, dice: S.dice.slice(), rolls: S.rolls });
    S.t++;
    if (S.t >= S.players.length * ROUNDS) return endGame(S, events);
    S.round = Math.floor(S.t / S.players.length) + 1;
    beginTurn(S, S.order[S.t % S.players.length]);
  }

  function endGame(S, events) {
    const tot = S.players.map((p) => totals(p).total), best = Math.max(...tot);
    const winners = tot.map((t, i) => (t === best ? i : -1)).filter((i) => i >= 0);
    S.last = { winners, label: `${best} Punkten`, over: true };
    S.phase = "roundEnd";
    S.seq++;
    const names = winners.map((i) => S.players[i].name).join(" und ");
    log(S, `${names} ${winners.length > 1 ? "gewinnen" : "gewinnt"} mit ${best} Punkten!`);
    events.push({ t: "roundEnd" });
  }

  // the box a computer (or the clock) takes when it has to choose
  function bestBox(S, level) {
    const opts = options(S), keys = Object.keys(opts);
    if (!keys.length) return null;
    const p = S.players[S.cur];
    // value of writing this many points there, against what the box is worth on average
    const worth = (k) => {
      const c = CAT[k], pts = opts[k];
      let v = level === "easy" ? pts : pts - c.avg;
      if (level !== "easy" && c.up && pts >= 3 * c.n) v += 4;       // on the way to the bonus
      if (level !== "easy" && c.up && pts < 3 * c.n && pts > 0) v -= 2;
      if (k === "kniffel" && pts === 50) v += 20;
      return v;
    };
    return keys.sort((a, b) => worth(b) - worth(a) || CATS.indexOf(CAT[b]) - CATS.indexOf(CAT[a]))[0];
  }

  // Apply an action by player pi. Returns { ok, error?, events }.
  // Actions: {t:"roll"} {t:"hold", i} or {t:"hold", keep:[5 bools]} {t:"score", c} {t:"next"}
  //          {t:"skip"} (host) {t:"timeout"} (server clock)
  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events });
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Das Spiel läuft noch.");
      restart(S);
      return { ok: true, events };
    }
    if (S.phase !== "play") return fail("Gerade ist niemand dran.");
    if (a.t === "skip" || a.t === "timeout") {
      if (a.t === "timeout" && pi !== S.cur) return fail("Nicht dran.");
      const p = S.players[S.cur];
      log(S, a.t === "timeout" ? `${p.name}: Zeit abgelaufen.` : `${p.name} wird übersprungen.`);
      if (!S.rolls) rollFree(S, events); // one throw so there is something to write down
      score(S, S.cur, bestBox(S, "normal"), events);
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
      if (S.rolls >= S.maxRolls) return fail("Keine Würfe mehr übrig. Trage jetzt ein Feld ein.");
      if (S.rolls && S.hold.every(Boolean)) return fail("Du behältst alle Würfel. Trage ein Feld ein oder lass einen Würfel los.");
      rollFree(S, events);
      return { ok: true, events };
    }

    if (a.t === "score") {
      if (!S.rolls) return fail("Du musst mindestens einmal würfeln.");
      const opts = options(S);
      if (!CAT[a.c]) return fail("Welches Feld?");
      if (S.players[pi].sheet[a.c] != null) return fail("Dieses Feld ist schon belegt.");
      if (opts[a.c] == null) return fail("Mit dem Joker musst du ein anderes Feld nehmen.");
      score(S, pi, a.c, events);
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

  // ---------- computer player (also the hint) ----------
  // Works on a view (all public anyway). The view carries the sheet of the player on turn.
  function suggest(v, level) {
    if (!v || v.phase !== "play" || v.cur !== v.me) return null;
    if (!v.rolls) return { t: "roll" };
    const S = { players: v.players, cur: v.cur, dice: v.dice, rolls: v.rolls, rules: v.rules };
    const sheet = v.players[v.cur].sheet, left = v.maxRolls - v.rolls;
    const box = () => ({ t: "score", c: bestBox(S, level) });
    if (left <= 0) return box();
    const openKeys = CATS.filter((c) => sheet[c.k] == null).map((c) => c.k);
    if (level === "easy") {
      const c = counts(v.dice);
      if (isKniffel(v.dice) || Math.random() < 0.25) return box();
      const most = c.indexOf(Math.max(...c.slice(1)), 1);
      const keep = v.dice.map((d) => d === most);
      if (keep.every(Boolean)) return box();
      if (keep.join() !== v.hold.join()) return { t: "hold", keep };
      return { t: "roll" };
    }
    const keep = level === "hard" ? bestKeep(v.dice, left, sheet, openKeys, v.rules) : wantKeep(v.dice, openKeys);
    if (keep === "score") return box();
    if (keep.every(Boolean)) return box();
    if (keep.join() !== v.hold.join()) return { t: "hold", keep };
    return { t: "roll" };
  }

  // normal: stop on a finished big hand, otherwise keep the most frequent value (higher wins),
  // or four of a run when straights are still open
  function wantKeep(dice, open) {
    const c = counts(dice), max = Math.max(...c.slice(1));
    const has = (k) => open.includes(k);
    const all = dice.map(() => true);
    if ((has("large") && hasRun(dice, 5)) || (has("kniffel") && max === 5)) return all;
    if (has("house") && max === 3 && c.includes(2)) return all;
    if (has("small") && !has("large") && hasRun(dice, 4)) return all;
    if (max < 3 && (has("large") || has("small"))) {
      for (const run of [[2, 3, 4, 5, 6], [1, 2, 3, 4, 5], [3, 4, 5, 6], [1, 2, 3, 4], [2, 3, 4, 5]]) {
        if (run.filter((x) => c[x]).length >= 4) {
          const used = new Set();
          return dice.map((d) => (run.includes(d) && !used.has(d) ? (used.add(d), true) : false));
        }
      }
    }
    let val = 6;
    while (c[val] !== max) val--;
    return dice.map((d) => d === val);
  }

  // hard: try all 32 ways to keep dice and average the best box of what could come out
  function bestKeep(dice, left, sheet, open, rules) {
    let best = null, bestV = -Infinity;
    const S = { players: [{ sheet }], cur: 0, rolls: 1, rules, dice: [] };
    const valueOf = (d) => {
      S.dice = d;
      const opts = options(S);
      let top = -Infinity;
      for (const k of Object.keys(opts)) {
        const c = CAT[k];
        let v = opts[k] - c.avg;
        if (c.up && opts[k] >= 3 * c.n) v += 4;
        if (k === "kniffel" && opts[k] === 50) v += 20;
        if (v > top) top = v;
      }
      return top;
    };
    const stay = valueOf(dice);
    for (let mask = 0; mask < 32; mask++) {
      const keep = dice.map((_, i) => !!(mask & (1 << i)));
      const free = keep.filter((k) => !k).length;
      if (!free) continue;
      let tot = 0, n = 0;
      const d = dice.slice();
      const rec = (idx) => {
        if (idx === DICE) { tot += valueOf(d); n++; return; }
        if (keep[idx]) return rec(idx + 1);
        for (let v = 1; v <= 6; v++) { d[idx] = v; rec(idx + 1); }
      };
      rec(0);
      const ev = tot / n;
      if (ev > bestV + 1e-9) { bestV = ev; best = keep; }
    }
    return !best || stay >= bestV ? "score" : best;
  }

  function view(S, pi) {
    return {
      players: S.players.map((p) => Object.assign({ name: p.name, bot: !!p.bot, avatar: p.avatar || "", sheet: Object.assign({}, p.sheet), extra: p.extra || 0 }, { tot: totals(p) })),
      me: pi, cur: S.cur, order: S.order, phase: S.phase,
      dice: S.dice.slice(), hold: S.hold.slice(), rolls: S.rolls, maxRolls: S.maxRolls,
      options: options(S),
      round: S.round, rounds: S.rounds, turn: S.turn, seq: S.seq, rules: S.rules,
      log: S.log.slice(-40), last: S.last
    };
  }

  return { DICE, MAX_ROLLS, TURN_MS, ROUNDS, BONUS_AT, BONUS, EXTRA_KNIFFEL, AVATARS, BOT_NAMES, BOT_LEVELS, RULES, CATS, CAT, normRules, points, totals, options, newGame, act, tick, nextDeadline, suggest, view };
});
