// Phase 10 engine. Pure state + rules, shared by the browser (one-phone mode) and the
// Node server (online mode). No DOM, no I/O.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Phase10Game = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 6;
  const HAND = 10;
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip", "Ada Algo", "Bit Bert", "Byte Bea", "Kalle Kabel"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi" };
  const GOALS = [10, 5];                       // play all 10 phases, or a short game up to phase 5
  const COLORS = ["r", "y", "g", "b"];
  const CNAME = { r: "Rot", y: "Gelb", g: "Grün", b: "Blau" };
  const CLOCK_MS = 45000, GRACE = 600;

  // the ten phases: groups of sets (same number), runs (numbers in a row) and colours
  const PHASES = [
    null,
    [{ k: "set", n: 3 }, { k: "set", n: 3 }],
    [{ k: "set", n: 3 }, { k: "run", n: 4 }],
    [{ k: "set", n: 4 }, { k: "run", n: 4 }],
    [{ k: "run", n: 7 }],
    [{ k: "run", n: 8 }],
    [{ k: "run", n: 9 }],
    [{ k: "set", n: 4 }, { k: "set", n: 4 }],
    [{ k: "color", n: 7 }],
    [{ k: "set", n: 5 }, { k: "set", n: 2 }],
    [{ k: "set", n: 5 }, { k: "set", n: 3 }]
  ];
  const SETNAME = { 2: "Zwilling", 3: "Drilling", 4: "Vierling", 5: "Fünfling" };
  const groupName = (g) => (g.k === "set" ? SETNAME[g.n] : g.k === "run" ? `${g.n}er-Folge` : `${g.n} einer Farbe`);
  const phaseName = (p) => {
    const gs = PHASES[p];
    if (!gs) return "";
    if (gs.length === 2 && gs[0].k === gs[1].k && gs[0].n === gs[1].n) return `2 ${gs[0].k === "set" ? SETNAME[gs[0].n].replace(/ling$/, "linge") : groupName(gs[0])}`;
    return gs.map(groupName).join(" + ");
  };

  // House rules. Shared with the UI, which renders one switch per entry.
  const RULES = [
    { k: "skipChoose", name: "Aussetzen frei wählen", desc: "Ab drei Spielern suchst du aus, wer aussetzen muss, statt immer den Nächsten zu treffen." },
    { k: "clock", name: "Zugzeit", desc: "45 Sekunden pro Zug, sonst zieht und wirft das Spiel für dich." }
  ];
  function normRules(r) {
    const o = {};
    for (const x of RULES) o[x.k] = !!(r && r[x.k] === true);
    return o;
  }
  const normGoal = (n) => (GOALS.includes(+n) ? +n : 10);
  const normLevel = (n) => (LEVELS[+n] ? +n : 2);
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);

  // cards: { id, c: "r"|"y"|"g"|"b"|"w" (joker)|"s" (aussetzen), v: 1..12 (0 for w/s) }
  function buildDeck() {
    const d = [];
    let id = 0;
    for (const c of COLORS) for (let v = 1; v <= 12; v++) for (let k = 0; k < 2; k++) d.push({ id: id++, c, v });
    for (let k = 0; k < 8; k++) d.push({ id: id++, c: "w", v: 0 });
    for (let k = 0; k < 4; k++) d.push({ id: id++, c: "s", v: 0 });
    return d;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const isWild = (c) => c.c === "w";
  const isSkip = (c) => c.c === "s";
  const points = (c) => (isWild(c) ? 25 : isSkip(c) ? 15 : c.v >= 10 ? 10 : 5);
  const cardName = (c) => (isWild(c) ? "Joker" : isSkip(c) ? "Aussetzen" : `${CNAME[c.c]} ${c.v}`);

  // ---------- groups: does a set of cards make a set / run / colour group? ----------
  // Returns a meld { k, n, cards, value | start+len | color } or null. At least one real card.
  function makeGroup(cards, g) {
    if (cards.length < g.n || cards.some(isSkip)) return null;
    const nat = cards.filter((c) => !isWild(c));
    if (!nat.length) return null;
    if (g.k === "set") {
      if (nat.some((c) => c.v !== nat[0].v)) return null;
      return { k: "set", n: g.n, cards, value: nat[0].v };
    }
    if (g.k === "color") {
      if (nat.some((c) => c.c !== nat[0].c)) return null;
      return { k: "color", n: g.n, cards, color: nat[0].c };
    }
    // run: the real numbers all different, the jokers fill the gaps and extend upwards first
    const vals = nat.map((c) => c.v);
    if (new Set(vals).size !== vals.length) return null;
    const len = cards.length, lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo + 1 > len || len > 12) return null;
    const start = Math.min(lo, 12 - len + 1);
    if (start < 1 || start > lo || start + len - 1 < hi) return null;
    return { k: "run", n: g.n, cards: runOrder(cards, start), start, len };
  }
  // the run's cards in order, jokers where the numbers are missing
  function runOrder(cards, start) {
    const nat = cards.filter((c) => !isWild(c)), wild = cards.filter(isWild), out = [];
    for (let v = start; v < start + cards.length; v++) out.push(nat.find((c) => c.v === v) || wild.shift());
    return out;
  }
  // can card go onto meld m? returns the updated meld or null
  function fitOnto(m, card) {
    if (isSkip(card)) return null;
    if (m.k === "set") return isWild(card) || card.v === m.value ? Object.assign({}, m, { cards: m.cards.concat(card) }) : null;
    if (m.k === "color") return isWild(card) || card.c === m.color ? Object.assign({}, m, { cards: m.cards.concat(card) }) : null;
    const top = m.start + m.len;
    if (isWild(card)) {
      if (top <= 12) return Object.assign({}, m, { cards: m.cards.concat(card), len: m.len + 1 });
      if (m.start > 1) return Object.assign({}, m, { cards: [card].concat(m.cards), start: m.start - 1, len: m.len + 1 });
      return null;
    }
    if (card.v === top && top <= 12) return Object.assign({}, m, { cards: m.cards.concat(card), len: m.len + 1 });
    if (card.v === m.start - 1 && m.start > 1) return Object.assign({}, m, { cards: [card].concat(m.cards), start: m.start - 1, len: m.len + 1 });
    return null;
  }

  // ---------- finding a phase in a hand (the computer, and the "Vorschlag" button) ----------
  // every way to fill one group with exactly n cards, real cards first, fewest jokers
  function groupOptions(hand, g) {
    const wild = hand.filter(isWild), nat = hand.filter((c) => !isWild(c) && !isSkip(c)), out = [];
    const fill = (picked) => {
      const need = g.n - picked.length;
      if (need < 0 || need > wild.length || !picked.length) return;
      out.push(picked.concat(wild.slice(0, need)));
    };
    if (g.k === "set") for (let v = 1; v <= 12; v++) fill(nat.filter((c) => c.v === v).slice(0, g.n));
    if (g.k === "color") for (const col of COLORS) fill(nat.filter((c) => c.c === col).slice(0, g.n));
    if (g.k === "run") for (let s = 1; s + g.n - 1 <= 12; s++) {
      const picked = [];
      for (let v = s; v < s + g.n; v++) { const c = nat.find((x) => x.v === v); if (c) picked.push(c); }
      fill(picked);
    }
    return out.sort((a, b) => a.filter(isWild).length - b.filter(isWild).length);
  }
  // a way to lay the whole phase from this hand: [[cards], [cards]] or null
  function findPhase(hand, p) {
    const gs = PHASES[p];
    if (!gs) return null;
    function rec(i, left) {
      if (i === gs.length) return [];
      for (const opt of groupOptions(left, gs[i])) {
        const ids = new Set(opt.map((c) => c.id));
        const rest = rec(i + 1, left.filter((c) => !ids.has(c.id)));
        if (rest) return [opt].concat(rest);
      }
      return null;
    }
    return rec(0, hand);
  }
  // how many cards are still missing for the phase (0 = it can be laid)
  function missing(hand, p) {
    const gs = PHASES[p];
    const wild = hand.filter(isWild).length, nat = hand.filter((c) => !isWild(c) && !isSkip(c));
    const targets = (g) => g.k === "set" ? [...Array(12)].map((_, i) => ({ g, v: i + 1 }))
      : g.k === "color" ? COLORS.map((c) => ({ g, c })) : [...Array(12 - g.n + 1)].map((_, i) => ({ g, s: i + 1 }));
    // real cards a target uses from what is left
    const take = (t, left) => {
      const used = [];
      if (t.v) used.push(...left.filter((c) => c.v === t.v).slice(0, t.g.n));
      else if (t.c) used.push(...left.filter((c) => c.c === t.c).slice(0, t.g.n));
      else for (let v = t.s; v < t.s + t.g.n; v++) { const c = left.find((x) => x.v === v); if (c) used.push(c); }
      return used;
    };
    let best = Infinity;
    const walk = (i, left, have) => {
      if (i === gs.length) {
        const need = gs.reduce((n, g) => n + g.n, 0) - have;
        best = Math.min(best, Math.max(0, need - wild));
        return;
      }
      for (const t of targets(gs[i])) {
        const used = take(t, left);
        if (!used.length && have + wild === 0 && i === 0) continue;
        const ids = new Set(used.map((c) => c.id));
        walk(i + 1, left.filter((c) => !ids.has(c.id)), have + used.length);
      }
    };
    walk(0, nat, 0);
    return best;
  }

  // ---------- game flow ----------
  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 60) S.log.shift();
  }
  // players: [{ name, bot, avatar }] (2-6); goal: last phase (10 or 5); level: computer strength
  function newGame(players, goal, rules, level) {
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p, i) => ({ name: p.name, bot: !!p.bot, avatar: avatarOf(p, i), phase: 1, score: 0, hand: [], laid: false, skipped: false })),
      goal: normGoal(goal), rules: normRules(rules), level: normLevel(level),
      round: 0, turn: 0, dealer: rand(players.length), log: [], last: null, deadline: 0, history: []
    };
    startRound(S);
    return S;
  }

  function startRound(S) {
    S.round++;
    S.deck = shuffle(buildDeck());
    S.discard = [];
    S.melds = [];
    S.last = null; S.lastMove = null; S.log = [];
    S.dealer = (S.dealer + 1) % S.players.length;
    S.players.forEach((p) => { p.hand = S.deck.splice(0, HAND); p.laid = false; p.skipped = false; p.phaseAtStart = p.phase; });
    S.discard.push(S.deck.pop());
    S.phase = "play";
    const first = (S.dealer + 1) % S.players.length;
    log(S, `Runde ${S.round}: ${S.players[S.dealer].name} gibt, ${S.players[first].name} beginnt.`);
    if (isSkip(S.discard[0])) { S.players[first].skipped = true; log(S, `Oben liegt ein Aussetzen, ${S.players[first].name} setzt aus.`); }
    beginTurn(S, first);
  }

  function armClock(S, now) {
    const P = S.players[S.cur];
    S.deadline = S.phase === "play" && P && !P.bot && S.rules.clock ? (now || Date.now()) + CLOCK_MS : 0;
  }
  // the turn goes to pi, or past everyone who has to sit this one out
  function beginTurn(S, pi) {
    for (let k = 0; k < S.players.length && S.players[pi].skipped; k++) {
      S.players[pi].skipped = false;
      log(S, `${S.players[pi].name} setzt aus.`);
      pi = (pi + 1) % S.players.length;
    }
    S.cur = pi;
    S.step = "draw";
    S.turn++;
    armClock(S);
  }
  function refill(S) {
    if (S.deck.length) return;
    const top = S.discard.pop();
    S.deck = shuffle(S.discard);
    S.discard = [top];
  }
  const cardOf = (P, id) => P.hand.find((c) => c.id === +id);
  const take = (P, id) => { const i = P.hand.findIndex((c) => c.id === +id); return i < 0 ? null : P.hand.splice(i, 1)[0]; };

  function endRound(S, outPi, events) {
    const res = S.players.map((p, i) => {
      const pen = p.hand.reduce((n, c) => n + points(c), 0);
      p.score += pen;
      const done = p.laid;
      if (done) p.phase++;
      return { pen, done, phase: p.phaseAtStart };
    });
    const finished = S.players.map((_, i) => i).filter((i) => S.players[i].phase > S.goal);
    const over = finished.length > 0;
    let winners = [];
    if (over) {
      const low = Math.min(...finished.map((i) => S.players[i].score));
      winners = finished.filter((i) => S.players[i].score === low);
    }
    S.phase = "roundEnd";
    S.cur = -1; S.step = null; S.deadline = 0;
    S.last = { out: outPi, res, over, winners, hands: S.players.map((p) => p.hand.slice()) };
    S.history.push({ round: S.round, pens: res.map((r) => r.pen), done: res.map((r) => r.done) });
    log(S, `${S.players[outPi].name} ist raus, die Runde ist vorbei.`);
    if (over) log(S, `${winners.map((i) => S.players[i].name).join(" & ")} ${winners.length > 1 ? "gewinnen" : "gewinnt"} das Spiel!`);
    events.push({ t: "end", out: outPi, over });
  }

  // after a card left the hand: going out ends the round
  function checkOut(S, pi, events) {
    if (S.players[pi].hand.length) return false;
    endRound(S, pi, events);
    return true;
  }

  // Apply an action by player `pi`. Returns { ok, error?, events }.
  // Actions: {t:"draw", from:"deck"|"discard"} {t:"lay", groups:[[ids],[ids]]} {t:"hit", id, meld}
  //          {t:"discard", id, target?} {t:"skip"} {t:"next"}
  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events });
    const ok = () => ({ ok: true, events });
    const P = S.players[pi];
    if (!P) return fail("Unbekannter Spieler.");
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
      if (S.last && S.last.over) { S.players.forEach((p) => { p.phase = 1; p.score = 0; }); S.round = 0; S.history = []; }
      startRound(S);
      return ok();
    }
    if (S.phase !== "play") return fail("Gerade ist niemand dran.");
    if (a.t === "skip") { // host moves on when the current player is away: draw and throw for them
      log(S, `${S.players[S.cur].name} wird übersprungen.`);
      autoTurn(S, S.cur, events);
      return ok();
    }
    if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);

    if (a.t === "draw") {
      if (S.step !== "draw") return fail("Du hast schon gezogen.");
      if (a.from === "discard") {
        const top = S.discard[S.discard.length - 1];
        if (!top) return fail("Die Ablage ist leer.");
        if (isSkip(top)) return fail("Ein Aussetzen darf man nicht aufnehmen.");
        P.hand.push(S.discard.pop());
        S.lastMove = { pi, t: "draw", from: "discard", card: top, turn: S.turn };
        log(S, `${P.name} nimmt ${cardName(top)} von der Ablage.`);
        events.push({ t: "draw", pi, from: "discard", id: top.id });
      } else {
        refill(S);
        const c = S.deck.pop();
        P.hand.push(c);
        S.lastMove = { pi, t: "draw", from: "deck", turn: S.turn };
        log(S, `${P.name} zieht vom Stapel.`);
        events.push({ t: "draw", pi, from: "deck", id: c.id });
      }
      S.step = "act";
      return ok();
    }
    if (S.step !== "act") return fail("Zieh zuerst eine Karte.");

    if (a.t === "lay") {
      if (P.laid) return fail("Deine Phase liegt schon.");
      const gs = PHASES[P.phase], groups = Array.isArray(a.groups) ? a.groups : [];
      if (groups.length !== gs.length) return fail(`Phase ${P.phase} hat ${gs.length === 1 ? "eine Gruppe" : "zwei Gruppen"}: ${phaseName(P.phase)}.`);
      const all = groups.flat().map((x) => +x);
      if (new Set(all).size !== all.length || all.some((id) => !cardOf(P, id))) return fail("Diese Karten hast du nicht.");
      if (all.length > P.hand.length - 1) return fail("Eine Karte musst du noch abwerfen können.");
      // the groups may come in any order
      const cards = groups.map((ids) => ids.map((id) => cardOf(P, id)));
      const orders = gs.length === 2 ? [[0, 1], [1, 0]] : [[0]];
      let made = null;
      for (const o of orders) {
        const ms = o.map((gi, k) => makeGroup(cards[k], gs[gi]));
        if (ms.every(Boolean)) { made = ms; break; }
      }
      if (!made) return fail(`Das ergibt nicht ${phaseName(P.phase)}.`);
      for (const id of all) take(P, id);
      for (const m of made) S.melds.push(Object.assign(m, { owner: pi }));
      P.laid = true;
      S.lastMove = { pi, t: "lay", turn: S.turn };
      log(S, `${P.name} legt Phase ${P.phase} aus: ${phaseName(P.phase)}.`);
      events.push({ t: "lay", pi, phase: P.phase });
      return ok();
    }

    if (a.t === "hit") {
      if (!P.laid) return fail("Anlegen geht erst, wenn deine eigene Phase liegt.");
      const c = cardOf(P, a.id), m = S.melds[+a.meld];
      if (!c || !m) return fail("Das geht nicht.");
      const nm = fitOnto(m, c);
      if (!nm) return fail(`${cardName(c)} passt da nicht.`);
      take(P, c.id);
      S.melds[+a.meld] = nm;
      S.lastMove = { pi, t: "hit", meld: +a.meld, card: c, turn: S.turn };
      log(S, `${P.name} legt ${cardName(c)} bei ${S.players[m.owner].name} an.`);
      events.push({ t: "hit", pi, id: c.id, meld: +a.meld });
      checkOut(S, pi, events);
      return ok();
    }

    if (a.t === "discard") {
      const c = cardOf(P, a.id);
      if (!c) return fail("Diese Karte hast du nicht.");
      let target = null;
      if (isSkip(c)) {
        const others = S.players.map((_, i) => i).filter((i) => i !== pi);
        const choose = S.rules.skipChoose && S.players.length > 2;
        target = choose && a.target != null ? +a.target : (pi + 1) % S.players.length;
        if (!others.includes(target)) return fail("Wen soll es treffen?");
        if (S.players[target].skipped) return fail(`${S.players[target].name} setzt schon aus.`);
      }
      take(P, c.id);
      S.discard.push(c);
      S.lastMove = { pi, t: "discard", card: c, target, turn: S.turn };
      log(S, `${P.name} wirft ${cardName(c)} ab${target != null ? `, ${S.players[target].name} muss aussetzen` : ""}.`);
      events.push({ t: "discard", pi, id: c.id, target });
      if (target != null) S.players[target].skipped = true;
      if (checkOut(S, pi, events)) return ok();
      beginTurn(S, (pi + 1) % S.players.length);
      return ok();
    }
    return fail("Unbekannte Aktion.");
  }

  // a turn played for someone (clock ran out, host skipped them): draw and throw the least useful card
  function autoTurn(S, pi, events) {
    if (S.step === "draw") act(S, pi, { t: "draw", from: "deck" });
    const P = S.players[pi];
    const c = worstCard(S, P, 1);
    const r = act(S, pi, { t: "discard", id: c.id, target: isSkip(c) ? skipTarget(S, pi) : null });
    events.push(...r.events);
  }
  function tick(S, now) {
    now = now || Date.now();
    if (S.phase !== "play" || !S.deadline || now <= S.deadline + GRACE) return [];
    const pi = S.cur, events = [{ t: "timeout", pi }];
    log(S, `${S.players[pi].name} war zu langsam, das Spiel zieht und wirft ab.`);
    autoTurn(S, pi, events);
    return events;
  }
  function nextDeadline(S, now) {
    if (S.phase !== "play" || !S.deadline) return -1;
    return Math.max(0, S.deadline + GRACE - (now || Date.now()));
  }
  const resetClock = (S) => armClock(S);

  // ---------- computer player ----------
  // who an Aussetzen should hit: the next player, or (free choice) whoever is furthest ahead
  function skipTarget(S, pi) {
    const others = S.players.map((_, i) => i).filter((i) => i !== pi && !S.players[i].skipped);
    if (!others.length) return (pi + 1) % S.players.length;
    if (!(S.rules.skipChoose && S.players.length > 2)) return (pi + 1) % S.players.length;
    return others.sort((a, b) => S.players[b].phase - S.players[a].phase || (S.players[b].laid - S.players[a].laid) || S.players[a].hand.length - S.players[b].hand.length)[0];
  }
  const canHit = (S, c) => S.melds.some((m) => fitOnto(m, c));
  // the card that helps least: skips first, then what doesn't bring the phase closer, high numbers first
  function worstCard(S, P, level) {
    const hand = P.hand;
    const skip = hand.find(isSkip);
    if (skip) return skip;
    const pool = hand.filter((c) => !isWild(c));
    if (!pool.length) return hand[0];
    if (level === 1 && Math.random() < 0.3) return pool[rand(pool.length)];
    let best = null, bestScore = -Infinity;
    for (const c of pool) {
      const rest = hand.filter((x) => x.id !== c.id);
      const need = P.laid ? (canHit(S, c) ? -5 : 0) : -missing(rest, P.phase);
      const s = need * 100 + points(c) + (level === 3 && !P.laid && hand.filter((x) => x.v === c.v).length > 1 ? -20 : 0);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best;
  }
  function botMove(S, pi) {
    if (S.phase !== "play" || S.cur !== pi) return null;
    const P = S.players[pi], level = S.level || 2;
    if (S.step === "draw") {
      const top = S.discard[S.discard.length - 1];
      let want = false;
      if (top && !isSkip(top)) {
        if (isWild(top)) want = level > 1 || Math.random() < 0.5;
        else if (P.laid) want = canHit(S, top);
        else if (level > 1) want = missing(P.hand.concat(top), P.phase) < missing(P.hand, P.phase);
      }
      return { t: "draw", from: want ? "discard" : "deck" };
    }
    if (!P.laid) {
      const f = findPhase(P.hand, P.phase);
      if (f && f.flat().length < P.hand.length) return { t: "lay", groups: f.map((g) => g.map((c) => c.id)) };
    } else {
      for (const c of P.hand) {
        if (P.hand.length === 1) break; // the last card is thrown, that ends the round too
        const mi = S.melds.findIndex((m) => fitOnto(m, c));
        if (mi >= 0 && (level > 1 || Math.random() < 0.7)) return { t: "hit", id: c.id, meld: mi };
      }
    }
    const c = worstCard(S, P, level);
    return { t: "discard", id: c.id, target: isSkip(c) ? skipTarget(S, pi) : null };
  }

  // Your own hand is private; everything else on the table is public.
  function view(S, pi) {
    const me = S.players[pi] ? pi : -1, end = S.phase === "roundEnd";
    return {
      me, phase: S.phase, step: S.step, cur: S.cur, turn: S.turn, round: S.round, goal: S.goal, level: S.level || 2, rules: S.rules, dealer: S.dealer,
      hand: me >= 0 ? S.players[me].hand.slice() : [],
      top: S.discard[S.discard.length - 1] || null, pile: S.discard.slice(-4), discardCount: S.discard.length, deckCount: S.deck.length,
      melds: S.melds.map((m) => ({ k: m.k, n: m.n, owner: m.owner, cards: m.cards.slice(), value: m.value, color: m.color, start: m.start, len: m.len })),
      clockMs: S.rules.clock ? CLOCK_MS : 0, clock: S.deadline ? Math.max(0, S.deadline - Date.now()) : 0,
      players: S.players.map((p, i) => ({ name: p.name, bot: p.bot, avatar: avatarOf(p, i), phase: p.phase, score: p.score, laid: p.laid, skipped: p.skipped, count: p.hand.length })),
      lastMove: S.lastMove, log: S.log.slice(), last: end ? S.last : null, history: S.history.slice()
    };
  }

  return {
    MAX_PLAYERS, HAND, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, GOALS, COLORS, CNAME, PHASES, RULES,
    normRules, normGoal, normLevel, phaseName, groupName, cardName, points, isWild, isSkip, buildDeck,
    makeGroup, fitOnto, groupOptions, findPhase, missing,
    newGame, startRound, act, tick, nextDeadline, resetClock, botMove, view
  };
});
