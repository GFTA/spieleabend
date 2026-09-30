// Texas Hold'em engine (No Limit, tournament: play until one player has all the chips).
// Pure state + rules, shared by the browser (one-phone mode) and the Node server (online
// rooms). The hole cards are private: view(S, pi) only shows your own, and everybody's
// once they are turned over (showdown, or all-in with no more betting).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PokerGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 8;
  const TURN_MS = 30000;
  const RUNOUT_MS = 1700;   // pause between the streets when nobody can bet any more
  const HAND_MS = 11000;     // online: how long a finished hand stays on the table
  const BLIND_HANDS = 8;    // house rule: blinds double after this many hands
  const CHIPS = [1000, 2000, 5000];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_NAMES = ["Robo", "Pixel", "Byte", "Turbo", "Nova", "Blitz", "Chip", "Zappy", "Kiwi", "Rocket"];
  const BOT_LEVELS = { easy: "Einfach", normal: "Normal", hard: "Schwer", random: "Zufällig" };
  // "random": every computer seat draws its own strength once per game
  const botLevel = (S, pi, level) => {
    if (level !== "random") return level;
    const a = S.botLvls || (S.botLvls = []);
    return a[pi] || (a[pi] = ["easy", "normal", "hard"][Math.floor(Math.random() * 3)]);
  };
  const SUITS = ["♠", "♥", "♦", "♣"];

  // House rules; the UI renders one switch per entry.
  const RULES = [
    { k: "blindsUp", name: "Blinds steigen", desc: `Alle ${BLIND_HANDS} Hände verdoppeln sich die Blinds, damit das Spiel ein Ende findet.` },
    { k: "ante", name: "Ante", desc: "Vor jeder Hand zahlt jeder einen kleinen Einsatz (ein Zehntel vom Big Blind) in den Pot. Das macht mehr Druck, und Passen wird teurer." },
    { k: "turnTimer", name: "Zugzeit 30 Sekunden", desc: "Wer zu lange überlegt, checkt automatisch oder passt.", onlineOnly: true }
  ];
  function normRules(r) {
    const o = {};
    for (const x of RULES) o[x.k] = !!(r && r[x.k]);
    return o;
  }
  const normChips = (n) => (CHIPS.includes(+n) ? +n : 1000);

  // ---------- cards and hands ----------
  // a card is 0..51: rank 2..14 (14 = ace) = 2 + id % 13, suit 0..3 = floor(id / 13)
  const rankOf = (id) => 2 + (id % 13);
  const suitOf = (id) => Math.floor(id / 13);
  const HANDS = ["Hohe Karte", "Ein Paar", "Zwei Paare", "Drilling", "Straße", "Flush", "Full House", "Vierling", "Straight Flush"];
  const SG = ["", "", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht", "Neun", "Zehn", "Bube", "Dame", "König", "Ass"];
  const PL = ["", "", "Zweier", "Dreier", "Vierer", "Fünfer", "Sechser", "Siebener", "Achter", "Neuner", "Zehner", "Buben", "Damen", "Könige", "Asse"];

  // five cards -> comparable key [category, tie-breaks...]; higher is better
  function eval5(ids) {
    const r = ids.map(rankOf).sort((a, b) => b - a);
    const flush = ids.every((id) => suitOf(id) === suitOf(ids[0]));
    let straight = 0;
    if (new Set(r).size === 5) {
      if (r[0] - r[4] === 4) straight = r[0];
      else if (r[0] === 14 && r[1] === 5) straight = 5; // the wheel: A-2-3-4-5
    }
    const cnt = {};
    for (const x of r) cnt[x] = (cnt[x] || 0) + 1;
    const groups = Object.keys(cnt).map((k) => [+k, cnt[k]]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const shape = groups.map((g) => g[1]).join("");
    const vals = groups.map((g) => g[0]);
    if (straight && flush) return [8, straight];
    if (shape === "41") return [7].concat(vals);
    if (shape === "32") return [6].concat(vals);
    if (flush) return [5].concat(r);
    if (straight) return [4, straight];
    if (shape === "311") return [3].concat(vals);
    if (shape === "221") return [2].concat(vals);
    if (shape === "2111") return [1].concat(vals);
    return [0].concat(r);
  }
  function cmpKey(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d) return d;
    }
    return 0;
  }
  // best five of five to seven cards
  function best(ids) {
    const n = ids.length;
    if (n === 5) return eval5(ids);
    let top = null;
    const pick = [];
    (function rec(start) {
      if (pick.length === 5) { const k = eval5(pick.map((i) => ids[i])); if (!top || cmpKey(k, top) > 0) top = k; return; }
      for (let i = start; i < n; i++) { pick.push(i); rec(i + 1); pick.pop(); }
    })(0);
    return top;
  }
  function label(key) {
    const c = key[0];
    switch (c) {
      case 8: return key[1] === 14 ? "Royal Flush" : `Straight Flush bis ${SG[key[1]]}`;
      case 7: return `Vierling (${PL[key[1]]})`;
      case 6: return `Full House (${PL[key[1]]} und ${PL[key[2]]})`;
      case 5: return `Flush (${SG[key[1]]} hoch)`;
      case 4: return `Straße bis ${SG[key[1]]}`;
      case 3: return `Drilling (${PL[key[1]]})`;
      case 2: return `Zwei Paare (${PL[key[1]]} und ${PL[key[2]]})`;
      case 1: return `Ein Paar (${PL[key[1]]})`;
      default: return `${SG[key[1]]} hoch`;
    }
  }
  const handName = (key) => HANDS[key[0]];

  // ---------- game state ----------
  const rand = (n) => Math.floor(Math.random() * n);
  function shuffled() {
    const d = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 51; i > 0; i--) { const j = rand(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }
  function log(S, msg) { S.log.push(msg); if (S.log.length > 80) S.log.shift(); }
  const money = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  // list: [{ name, bot, avatar }]
  function newGame(list, chips, rules, auto) {
    chips = normChips(chips);
    const S = {
      players: list.map((p) => ({ name: p.name, bot: !!p.bot, avatar: p.avatar || "", chips, bet: 0, total: 0, folded: false, allin: false, out: false, acted: false, locked: false, hole: [], shown: false, act: "", place: 0 })),
      startChips: chips, baseSb: Math.max(1, Math.round(chips / 100)), rules: normRules(rules), auto: auto !== false,
      hand: 0, dealer: rand(list.length), sb: 0, bb: 0, deck: [], board: [], street: "pre",
      cur: 0, cbet: 0, minRaise: 0, raises: 0, phase: "play", nextAt: 0, turn: 0, seq: 0, log: [], last: null
    };
    startHand(S);
    return S;
  }
  // rematch with the same table: everybody starts over
  function restart(S) {
    S.players.forEach((p) => { p.chips = S.startChips; p.out = false; p.place = 0; });
    S.hand = 0; S.log = []; S.last = null; S.dealer = rand(S.players.length);
    startHand(S);
  }

  const live = (S) => S.players.map((p, i) => i).filter((i) => !S.players[i].out);
  function seatAfter(S, from, ok) {
    const n = S.players.length;
    for (let k = 1; k <= n; k++) { const s = (((from + k) % n) + n) % n; if (ok(S.players[s], s)) return s; }
    return -1;
  }
  function post(S, seat, amount) {
    const p = S.players[seat], a = Math.min(amount, p.chips);
    p.chips -= a; p.bet += a; p.total += a;
    if (!p.chips) p.allin = true;
    return a;
  }

  function startHand(S, events) {
    events = events || [];
    const P = S.players;
    S.hand++; S.phase = "play"; S.street = "pre"; S.board = []; S.last = null; S.nextAt = 0;
    P.forEach((p) => { p.bet = 0; p.total = 0; p.folded = !!p.out; p.allin = false; p.acted = false; p.locked = false; p.hole = []; p.shown = false; p.act = ""; });
    S.dealer = seatAfter(S, S.dealer, (p) => !p.out);
    const lvl = S.rules.blindsUp ? Math.floor((S.hand - 1) / BLIND_HANDS) : 0;
    S.sb = S.baseSb * Math.pow(2, lvl); S.bb = S.sb * 2;
    S.ante = S.rules.ante ? Math.max(1, Math.round(S.bb / 10)) : 0;
    const headsUp = live(S).length === 2;
    const sbSeat = headsUp ? S.dealer : seatAfter(S, S.dealer, (p) => !p.out);
    const bbSeat = seatAfter(S, sbSeat, (p) => !p.out);
    S.deck = shuffled();
    for (let r = 0; r < 2; r++) {
      let s = sbSeat;
      for (let k = 0; k < live(S).length; k++) { P[s].hole.push(S.deck.pop()); s = seatAfter(S, s, (p) => !p.out); }
    }
    S.sbSeat = sbSeat; S.bbSeat = bbSeat;
    if (S.ante) { // dead money: in the pot, but not part of anybody's bet
      P.forEach((p) => { if (p.out) return; const a = Math.min(S.ante, p.chips); p.chips -= a; p.total += a; if (!p.chips) p.allin = true; });
    }
    post(S, sbSeat, S.sb); post(S, bbSeat, S.bb);
    P[sbSeat].act = P[sbSeat].allin ? "allin" : "sb"; P[bbSeat].act = P[bbSeat].allin ? "allin" : "bb";
    S.cbet = S.bb; S.minRaise = S.bb; S.raises = 0;
    log(S, `Hand ${S.hand}: ${P[S.dealer].name} gibt. Blinds ${money(S.sb)}/${money(S.bb)}${lvl ? " (gestiegen)" : ""}${S.ante ? `, Ante ${money(S.ante)}` : ""}.`);
    events.push({ t: "deal", ante: S.ante });
    S.turn++; S.seq++;
    const nx = pickActor(S, bbSeat);
    if (nx < 0) beginRunout(S, events); else S.cur = nx;
    return events;
  }

  // who must act next after `from`; -1 if betting is over
  function pickActor(S, from) {
    const P = S.players;
    const able = P.filter((p) => !p.folded && !p.allin && !p.out);
    const top = Math.max(0, ...P.filter((p) => !p.folded && !p.out).map((p) => p.bet));
    if (able.length === 0 || (able.length === 1 && able[0].bet >= top)) return -1;
    return seatAfter(S, from, (p) => !p.folded && !p.allin && !p.out && (!p.acted || p.bet < S.cbet));
  }

  function advance(S, events) {
    const alive = S.players.filter((p) => !p.folded && !p.out);
    if (alive.length === 1) return endByFold(S, S.players.indexOf(alive[0]), events);
    const nx = pickActor(S, S.cur);
    if (nx >= 0) { S.cur = nx; S.turn++; S.seq++; return; }
    endStreet(S, events);
  }

  function endStreet(S, events) {
    const P = S.players;
    P.forEach((p) => { p.bet = 0; p.acted = false; p.locked = false; if (!p.folded && !p.allin) p.act = ""; });
    S.cbet = 0; S.minRaise = S.bb; S.raises = 0;
    if (S.street === "river") return showdown(S, events);
    if (P.filter((p) => !p.folded && !p.out && !p.allin).length <= 1) return beginRunout(S, events);
    dealStreet(S, events);
    S.cur = pickActor(S, S.dealer);
    S.turn++; S.seq++;
  }

  function dealStreet(S, events) {
    const n = S.street === "pre" ? 3 : 1;
    for (let i = 0; i < n; i++) S.board.push(S.deck.pop());
    S.street = S.board.length === 3 ? "flop" : S.board.length === 4 ? "turn" : "river";
    log(S, `${{ flop: "Flop", turn: "Turn", river: "River" }[S.street]}: ${S.board.slice(-n).map(cardText).join(" ")}`);
    events.push({ t: "board", n });
    S.seq++;
  }
  const cardText = (id) => `${{ 11: "B", 12: "D", 13: "K", 14: "A" }[rankOf(id)] || rankOf(id)}${SUITS[suitOf(id)]}`;

  // nobody can bet any more: turn the cards over and deal the rest one street at a time
  function beginRunout(S, events) {
    S.players.forEach((p) => { if (!p.folded && !p.out) p.shown = true; if (!p.folded && !p.allin) p.act = ""; });
    if (S.street === "river") return showdown(S, events);
    S.phase = "runout"; S.nextAt = Date.now() + RUNOUT_MS;
    log(S, "Niemand kann mehr setzen: Die Karten werden aufgedeckt.");
    events.push({ t: "runout" });
    S.seq++;
  }

  function endByFold(S, w, events) {
    const P = S.players, pot = P.reduce((s, p) => s + p.total, 0);
    P[w].chips += pot;
    log(S, `${P[w].name} gewinnt ${money(pot)}, alle anderen haben gepasst.`);
    S.last = { kind: "fold", winners: [w], pots: [{ amount: pot, winners: [w], label: "alle anderen haben gepasst" }], hands: [], over: false, pot };
    finishHand(S, events);
  }

  function buildPots(S) {
    const P = S.players, pots = [];
    const levels = Array.from(new Set(P.filter((p) => !p.folded && p.total > 0).map((p) => p.total))).sort((a, b) => a - b);
    let prev = 0, done = 0;
    for (const L of levels) {
      let amount = 0;
      P.forEach((p) => { amount += Math.max(0, Math.min(p.total, L) - prev); });
      pots.push({ amount, elig: P.map((p, i) => i).filter((i) => !P[i].folded && P[i].total >= L) });
      done += amount; prev = L;
    }
    const rest = P.reduce((s, p) => s + p.total, 0) - done; // chips of folded players above the last level
    if (rest > 0 && pots.length) pots[pots.length - 1].amount += rest;
    return pots;
  }

  function showdown(S, events) {
    const P = S.players;
    const contenders = P.map((p, i) => i).filter((i) => !P[i].folded && !P[i].out);
    contenders.forEach((i) => { P[i].shown = true; });
    const keys = {};
    for (const i of contenders) keys[i] = best(P[i].hole.concat(S.board));
    const won = {}, results = [];
    const order = (arr) => arr.slice().sort((a, b) => ((a - S.dealer + 100) % P.length) - ((b - S.dealer + 100) % P.length));
    for (const pot of buildPots(S)) {
      let top = null;
      for (const i of pot.elig) if (!top || cmpKey(keys[i], top) > 0) top = keys[i];
      const winners = order(pot.elig.filter((i) => cmpKey(keys[i], top) === 0));
      const base = Math.floor(pot.amount / winners.length), extra = pot.amount % winners.length;
      winners.forEach((i, k) => { const share = base + (k < extra ? 1 : 0); P[i].chips += share; won[i] = (won[i] || 0) + share; });
      results.push({ amount: pot.amount, winners, label: pot.elig.length === 1 ? "nicht mitgegangen, zurück" : label(top) });
    }
    const winners = Object.keys(won).map(Number).sort((a, b) => won[b] - won[a]);
    S.last = {
      kind: "show", winners, pots: results, over: false, pot: P.reduce((s, p) => s + p.total, 0),
      hands: contenders.map((i) => ({ i, hole: P[i].hole.slice(), label: label(keys[i]), cat: keys[i][0], won: won[i] || 0 }))
    };
    for (const r of results) log(S, `${r.winners.map((i) => P[i].name).join(" und ")} ${r.winners.length > 1 ? "teilen" : "gewinnt"} ${money(r.amount)}: ${r.label}.`);
    finishHand(S, events);
  }

  function finishHand(S, events) {
    const P = S.players;
    S.phase = "roundEnd"; S.seq++;
    P.forEach((p) => { p.bet = 0; });
    const busted = P.filter((p) => !p.out && p.chips === 0);
    busted.forEach((p) => { p.out = true; });
    const left = live(S);
    busted.forEach((p) => { p.place = left.length + 1; log(S, `${p.name} ist ausgeschieden (Platz ${p.place}).`); });
    if (left.length === 1) {
      const c = left[0];
      P[c].place = 1;
      S.last.over = true; S.last.champ = c; S.nextAt = 0;
      log(S, `${P[c].name} gewinnt das Turnier!`);
    } else {
      S.nextAt = S.auto ? Date.now() + HAND_MS : 0;
    }
    events.push({ t: "handEnd" });
  }

  // ---------- actions ----------
  // What the player on turn may do.
  function options(S) {
    const p = S.players[S.cur];
    if (S.phase !== "play" || !p) return null;
    const need = Math.max(0, S.cbet - p.bet), maxTo = p.bet + p.chips;
    return {
      call: Math.min(need, p.chips), canCheck: need === 0,
      canRaise: !p.locked && p.chips > need, minTo: Math.min(S.cbet + S.minRaise, maxTo), maxTo
    };
  }

  // Apply an action by player pi. Returns { ok, error?, events }.
  // Actions: {t:"fold"} {t:"check"} {t:"call"} {t:"raise", to} {t:"allin"} {t:"next"}
  //          {t:"skip"} (host) {t:"timeout"} (server clock)
  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events });
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");
    const P = S.players;

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return { ok: true, events };
      if (S.last && S.last.over) restart(S); else startHand(S, events);
      return { ok: true, events };
    }
    if (a.t === "show") { // after a hand that ended by folding, anybody may turn their cards over
      const q = P[pi];
      if (S.phase !== "roundEnd" || !S.last || S.last.kind !== "fold") return fail("Jetzt kann niemand Karten zeigen.");
      if (!q || q.out || !q.hole.length) return fail("Du hast keine Karten.");
      if (q.shown) return fail("Deine Karten sind schon offen.");
      q.shown = true; S.seq++;
      log(S, `${q.name} zeigt ${q.hole.map(cardText).join(" ")}.`);
      events.push({ t: "show", pi });
      return { ok: true, events };
    }
    if (S.phase === "runout") return fail("Die Karten werden gerade aufgedeckt.");
    if (S.phase !== "play") return fail("Die Hand ist vorbei.");
    if (a.t === "skip" || a.t === "timeout") {
      if (a.t === "timeout" && pi !== S.cur) return fail("Nicht dran.");
      const o = options(S);
      log(S, a.t === "timeout" ? `${P[S.cur].name}: Zeit abgelaufen.` : `${P[S.cur].name} wird übersprungen.`);
      pi = S.cur;
      a = { t: o.canCheck ? "check" : "fold" };
    }
    if (pi !== S.cur) return fail(`${P[S.cur].name} ist dran.`);
    const p = P[pi], o = options(S);
    const name = p.name;

    const call = () => {
      const pay = o.call;
      p.chips -= pay; p.bet += pay; p.total += pay; p.acted = true;
      if (!p.chips) p.allin = true;
      p.act = p.allin ? "allin" : "call";
      log(S, p.allin ? `${name} geht mit ${money(pay)} All-in.` : `${name} geht mit (${money(pay)}).`);
      events.push({ t: "bet", pi, kind: p.act, amount: pay });
    };
    const raise = (to) => {
      const opening = S.cbet === 0, full = to - S.cbet >= S.minRaise;
      const pay = to - p.bet;
      p.chips -= pay; p.bet = to; p.total += pay; p.acted = true;
      if (!p.chips) p.allin = true;
      if (full) {
        S.minRaise = to - S.cbet;
        P.forEach((q, i) => { if (i !== pi && !q.folded && !q.out && !q.allin) { q.acted = false; q.locked = false; } });
      } else {
        P.forEach((q, i) => { if (i !== pi && q.acted && !q.folded && !q.allin) q.locked = true; }); // a short all-in does not reopen the betting
      }
      S.cbet = to; S.raises++;
      p.act = p.allin ? "allin" : opening ? "bet" : "raise"; p.actTo = to;
      log(S, p.allin ? `${name} geht mit ${money(to)} All-in.` : `${name} ${opening ? "setzt" : "erhöht auf"} ${money(to)}.`);
      events.push({ t: "bet", pi, kind: p.act, amount: pay });
    };

    if (a.t === "fold") {
      p.folded = true; p.act = "fold";
      log(S, `${name} passt.`);
      events.push({ t: "bet", pi, kind: "fold", amount: 0 });
    } else if (a.t === "check") {
      if (!o.canCheck) return fail(`Du musst ${money(o.call)} mitgehen oder passen.`);
      p.acted = true; p.act = "check";
      log(S, `${name} checkt.`);
      events.push({ t: "bet", pi, kind: "check", amount: 0 });
    } else if (a.t === "call") {
      if (o.canCheck) return fail("Es gibt nichts mitzugehen, du kannst checken.");
      call();
    } else if (a.t === "raise" || a.t === "allin") {
      let to = a.t === "allin" ? o.maxTo : Math.floor(+a.to);
      if (!Number.isFinite(to)) return fail("Auf wie viel?");
      to = Math.min(to, o.maxTo);
      if (to <= S.cbet) { // all-in for less than the bet is just a call
        if (a.t === "allin" && !o.canCheck) call(); else return fail(`Erhöhe auf mehr als ${money(S.cbet)}.`);
      } else {
        if (p.locked) return fail("Die letzte Erhöhung war zu klein, um noch einmal zu erhöhen. Geh mit oder pass.");
        if (to < o.minTo && to < o.maxTo) return fail(`Mindestens auf ${money(o.minTo)}.`);
        raise(to);
      }
    } else return fail("Unbekannte Aktion.");
    advance(S, events);
    return { ok: true, events };
  }

  // time-based steps: the next street when nobody can bet, and the next hand online
  function nextDeadline(S) {
    if (!S.nextAt || (S.phase !== "runout" && !(S.phase === "roundEnd" && S.auto && !(S.last && S.last.over)))) return -1;
    return Math.max(0, S.nextAt - Date.now());
  }
  function tick(S) {
    const events = [];
    if (nextDeadline(S) !== 0) return events;
    if (S.phase === "runout") {
      if (S.board.length < 5) { dealStreet(S, events); S.nextAt = Date.now() + RUNOUT_MS; }
      else showdown(S, events);
    } else startHand(S, events);
    return events;
  }

  // ---------- computer player (also the hint) ----------
  // chance to win against `opp` random hands, as 0..1 (ties count half)
  function equity(hole, board, opp, samples) {
    const known = new Set(hole.concat(board)), rest = [];
    for (let i = 0; i < 52; i++) if (!known.has(i)) rest.push(i);
    const need = 5 - board.length + 2 * opp;
    let score = 0;
    for (let s = 0; s < samples; s++) {
      const d = rest.slice();
      for (let i = 0; i < need; i++) { const j = i + rand(d.length - i); const t = d[i]; d[i] = d[j]; d[j] = t; }
      const b = board.concat(d.slice(0, 5 - board.length));
      const mine = best(hole.concat(b));
      let lost = false, ties = 0, k = 5 - board.length;
      for (let o = 0; o < opp && !lost; o++, k += 2) {
        const c = cmpKey(best([d[k], d[k + 1]].concat(b)), mine);
        if (c > 0) lost = true; else if (c === 0) ties++;
      }
      if (!lost) score += 1 / (1 + ties);
    }
    return score / samples;
  }
  // share of the pot I must win to break even when calling: call / (pot + call)
  const potOdds = (call, pot) => (call > 0 ? call / (pot + call) : 0);
  const SAMPLES = { easy: 50, normal: 160, hard: 320 };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // rough preflop chart strength 0..1: pairs and broadway high, low offsuit junk low
  function preflopStrength(hole) {
    const a = rankOf(hole[0]), b = rankOf(hole[1]);
    const hi = Math.max(a, b), lo = Math.min(a, b);
    const suited = suitOf(hole[0]) === suitOf(hole[1]);
    if (a === b) return 0.52 + (hi - 2) * 0.032; // 22≈0.52 … AA≈0.90
    if (hi === 14 && lo >= 10) return suited ? 0.74 : 0.66; // AK–AT
    if (hi === 14 && lo >= 7) return suited ? 0.56 : 0.44;
    if (hi >= 12 && lo >= 10) return suited ? 0.60 : 0.50; // KQ KJ QJ
    if (hi - lo <= 2 && hi >= 9) return suited ? 0.50 : 0.38;
    if (suited && hi >= 12 && lo >= 7) return 0.46;
    if (suited && hi - lo === 1 && lo >= 5) return 0.40;
    return (hi + lo) / 42 + (suited ? 0.05 : 0); // 72o≈0.21
  }

  function suggest(v, level) {
    if (!v || v.phase !== "play" || v.cur !== v.me || !v.opts || !v.hole || v.hole.length < 2) return null;
    level = SAMPLES[level] ? level : "normal";
    const o = v.opts, me = v.players[v.me];
    const opp = Math.max(1, v.players.filter((p, i) => i !== v.me && !p.folded && !p.out).length);
    const fair = 1 / (opp + 1);
    const noise = level === "easy" ? (Math.random() - 0.5) * 0.24 : level === "normal" ? (Math.random() - 0.5) * 0.06 : 0;
    const facing = o.call > 0;
    const e = clamp(equity(v.hole, v.board, opp, SAMPLES[level]) + noise, 0, 1) * (facing ? 0.94 : 1);
    const strong = Math.min(0.72, fair * 1.35 + 0.12);
    const odds = facing ? o.call / (v.pot + o.call) : 0;
    const bluff = level === "hard" ? 0.1 : level === "normal" ? 0.03 : 0;
    const canRaise = o.canRaise && o.maxTo > v.cbet && v.raises < (level === "hard" ? 5 : 4);
    const raiseBy = (frac) => {
      const step = v.blinds.sb || 1;
      let to = v.cbet + Math.max(v.blinds.bb, Math.round((frac * (v.pot + o.call)) / step) * step);
      to = clamp(to, o.minTo, o.maxTo);
      if (o.maxTo - to < 0.35 * (to - me.bet)) to = o.maxTo; // committed anyway
      return to >= o.maxTo ? { t: "allin" } : { t: "raise", to };
    };
    const frac = 0.5 + Math.random() * 0.5;

    // preflop: chart + pot odds; easy stays call-happy, normal/hard fold trash to big raises
    if (v.street === "pre") {
      const hand = preflopStrength(v.hole);
      const bb = Math.max(1, v.blinds.bb || 1);
      const toCallBB = facing ? o.call / bb : 0;
      const bigRaise = facing && (o.call > v.pot * (level === "hard" ? 0.45 : 0.6) || toCallBB >= (level === "hard" ? 4 : 7));
      const foldBar = level === "easy" ? 0.20 : level === "hard" ? 0.40 : 0.30;
      const callBar = level === "easy" ? 0.24 : level === "hard" ? 0.44 : 0.34;
      const raiseBar = level === "easy" ? 0.58 : level === "hard" ? 0.50 : 0.54;
      if (!facing) {
        if (canRaise && hand >= raiseBar) return raiseBy(frac);
        return { t: "check" };
      }
      if (canRaise && hand >= raiseBar + 0.08 && Math.random() < 0.75) return raiseBy(frac + 0.15);
      if (hand < foldBar && bigRaise) return { t: "fold" };
      if (hand < foldBar && hand < odds + (level === "hard" ? 0.06 : level === "normal" ? 0.02 : -0.06)) return { t: "fold" };
      if (hand >= callBar || hand > odds + (level === "easy" ? -0.08 : 0)) return { t: "call" };
      if (level === "easy") return { t: "call" }; // easy almost never folds pre
      return { t: "fold" };
    }

    if (!facing) {
      if (canRaise && (e >= strong || (e > fair * 1.15 + 0.05 && Math.random() < 0.45) || Math.random() < bluff)) return raiseBy(frac);
      return { t: "check" };
    }
    // hard: stack-to-pot and facing size — call when pot-committed, fold more to huge bets with weak equity
    if (level === "hard") {
      const spr = me.chips / Math.max(1, v.pot);
      if (spr <= 2.5 && e > odds - 0.03) return { t: "call" };
      if (o.call > Math.max(v.pot * 0.7, me.chips * 0.35) && e < strong - 0.05) return { t: "fold" };
    }
    if (canRaise && e > Math.min(0.85, strong + 0.12) && Math.random() < 0.8) return raiseBy(frac + 0.2);
    if (canRaise && Math.random() < bluff * 0.5 && e > odds * 0.6) return raiseBy(0.75);
    if (e > odds + (level === "easy" ? -0.04 : 0.02)) return { t: "call" };
    if (level === "hard" && Math.random() < bluff && o.call <= v.pot * 0.35) return { t: "call" };
    return { t: "fold" };
  }

  // ---------- how good is my hand? ----------
  // category of what the board alone shows (pairs, trips, quads, full house), by counting ranks
  function boardCat(board) {
    const cnt = {};
    for (const id of board) cnt[rankOf(id)] = (cnt[rankOf(id)] || 0) + 1;
    const v = Object.keys(cnt).map((k) => cnt[k]).sort((a, b) => b - a);
    if (v[0] === 4) return 7;
    if (v[0] === 3) return v[1] >= 2 ? 6 : 3;
    if (v[0] === 2) return v[1] === 2 ? 2 : 1;
    return 0;
  }
  // The hand of a player from the hole cards and what lies on the table (nothing yet before the flop).
  // power is 1..5 (1-2 weak, 3 medium, 4-5 strong); tableOnly means the table makes this hand on its own.
  function handInfo(hole, board) {
    if (!hole || hole.length < 2) return null;
    if (!board.length) {
      const a = rankOf(hole[0]), b = rankOf(hole[1]);
      const key = a === b ? [1, a] : [0, Math.max(a, b), Math.min(a, b)];
      return { key, power: a === b ? 2 : 1, tableOnly: false };
    }
    const key = best(hole.concat(board)), cat = key[0];
    let tableOnly = false;
    if (cat === 1 || cat === 2 || cat === 3 || cat === 6 || cat === 7) tableOnly = cat <= boardCat(board);
    else if (board.length === 5) tableOnly = cmpKey(best(board), key) === 0;
    return { key, power: tableOnly ? 1 : [1, 2, 3, 3, 4, 4, 5, 5, 5][cat], tableOnly };
  }

  // chance of winning for each known hand ({ hole } list) with the board so far: exact when at most two
  // cards are missing, simulated otherwise. Returns shares that add up to 1.
  function equities(holes, board, samples) {
    const known = new Set(board);
    holes.forEach((h) => h.forEach((c) => known.add(c)));
    const rest = [];
    for (let i = 0; i < 52; i++) if (!known.has(i)) rest.push(i);
    const miss = 5 - board.length, share = holes.map(() => 0);
    let total = 0;
    const score = (extra) => {
      const b = board.concat(extra), keys = holes.map((h) => best(h.concat(b)));
      let top = keys[0];
      for (const k of keys) if (cmpKey(k, top) > 0) top = k;
      const w = keys.map((k) => cmpKey(k, top) === 0);
      const n = w.filter(Boolean).length;
      w.forEach((x, i) => { if (x) share[i] += 1 / n; });
      total++;
    };
    if (miss === 0) score([]);
    else if (miss === 1) rest.forEach((c) => score([c]));
    else if (miss === 2) { for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) score([rest[i], rest[j]]); }
    else {
      for (let s = 0; s < (samples || 400); s++) {
        const d = rest.slice();
        for (let i = 0; i < miss; i++) { const j = i + rand(d.length - i); const t = d[i]; d[i] = d[j]; d[j] = t; }
        score(d.slice(0, miss));
      }
    }
    return share.map((x) => x / total);
  }

  // ---------- what a player gets to see ----------
  function view(S, pi) {
    const P = S.players, me = P[pi];
    const inHand = S.phase === "play" || S.phase === "runout";
    return {
      players: P.map((p, i) => ({
        name: p.name, bot: p.bot, avatar: p.avatar, chips: p.chips, bet: p.bet, total: p.total,
        folded: p.folded, allin: p.allin, out: p.out, shown: !!p.shown, act: p.act, actTo: p.actTo || 0, place: p.place,
        hole: i === pi || p.shown ? p.hole.slice() : p.hole.length && !p.folded ? [null, null] : []
      })),
      me: pi, hole: me ? me.hole.slice() : [], cur: S.cur, dealer: S.dealer, sbSeat: S.sbSeat, bbSeat: S.bbSeat,
      board: S.board.slice(), street: S.street, phase: S.phase, hand: S.hand,
      pot: inHand ? P.reduce((s, p) => s + p.total, 0) : 0, cbet: S.cbet, minRaise: S.minRaise, raises: S.raises,
      blinds: { sb: S.sb, bb: S.bb }, ante: S.ante || 0, nextBlinds: S.rules.blindsUp ? BLIND_HANDS - ((S.hand - 1) % BLIND_HANDS) : 0,
      opts: pi === S.cur && S.phase === "play" ? options(S) : null,
      handNow: me && !me.folded && !me.out ? handInfo(me.hole, S.board) : null,
      nextIn: S.nextAt ? Math.max(0, S.nextAt - Date.now()) : 0, auto: S.auto,
      turn: S.turn, seq: S.seq, rules: S.rules, startChips: S.startChips,
      log: S.log.slice(-40), last: S.last
    };
  }

  return {
    MAX_PLAYERS, TURN_MS, RUNOUT_MS, HAND_MS, BLIND_HANDS, CHIPS, AVATARS, BOT_NAMES, BOT_LEVELS, botLevel, RULES, HANDS, SUITS,
    normRules, normChips, potOdds, rankOf, suitOf, best, cmpKey, label, handName, cardText, money, equity, equities, handInfo,
    newGame, act, tick, nextDeadline, suggest, preflopStrength, view, options
  };
});
