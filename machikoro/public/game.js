// Machi Koro engine. Pure state + rules, shared by the browser (single player) and the Node
// server (online). No DOM, no I/O. Roll dice → income activates → build one card or pass.
// First to finish all four landmarks wins. Bots and bot pacing live here (botMove / botPlan).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MachikoroGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 4;
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip", "Pixel Paula", "Byte Ben", "Turbo Tina", "Nano Nick", "Zack Zora", "Bit Bruno"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi" };

  // Establishments: color blue=anyone, green=own turn, red=opponent's turn (take), purple=own turn major.
  // icon: grain/cow/gear/bread/cup/fruit/tower — Shopping Mall boosts bread+cup; factories count icons.
  const CARDS = {
    wheat:       { id: "wheat",       name: "Getreidefeld",        emoji: "🌾", color: "blue",   cost: 1, rolls: [1],       icon: "grain", qty: 6, desc: "+1 Münze von der Bank (jeder Zug)." },
    ranch:       { id: "ranch",       name: "Viehzucht",           emoji: "🐄", color: "blue",   cost: 1, rolls: [2],       icon: "cow",   qty: 6, desc: "+1 Münze von der Bank (jeder Zug)." },
    bakery:      { id: "bakery",      name: "Bäckerei",            emoji: "🍞", color: "green",  cost: 1, rolls: [2, 3],    icon: "bread", qty: 6, desc: "+1 Münze von der Bank (dein Zug)." },
    cafe:        { id: "cafe",        name: "Café",                emoji: "☕", color: "red",    cost: 2, rolls: [3],       icon: "cup",   qty: 6, desc: "Nimm 1 Münze vom aktiven Spieler." },
    convenience: { id: "convenience", name: "Minimarkt",           emoji: "🏪", color: "green",  cost: 2, rolls: [4],       icon: "bread", qty: 6, desc: "+3 Münzen von der Bank (dein Zug)." },
    forest:      { id: "forest",      name: "Wald",                emoji: "🌲", color: "blue",   cost: 3, rolls: [5],       icon: "gear",  qty: 6, desc: "+1 Münze von der Bank (jeder Zug)." },
    stadium:     { id: "stadium",     name: "Stadion",             emoji: "🏟️", color: "purple", cost: 6, rolls: [6],       icon: "tower", qty: 4, desc: "Nimm 2 Münzen von jedem anderen Spieler." },
    tv:          { id: "tv",          name: "Fernsehsender",       emoji: "📺", color: "purple", cost: 7, rolls: [6],       icon: "tower", qty: 4, desc: "Nimm 5 Münzen von einem Spieler deiner Wahl." },
    business:    { id: "business",    name: "Unternehmen",         emoji: "🏢", color: "purple", cost: 8, rolls: [6],       icon: "tower", qty: 4, desc: "Tausche ein Gebäude (kein Wahrzeichen/Lila) mit einem anderen Spieler." },
    cheese:      { id: "cheese",      name: "Käserei",             emoji: "🧀", color: "green",  cost: 5, rolls: [7],       icon: "factory", qty: 6, desc: "+3 Münzen je Viehzucht (dein Zug)." },
    furniture:   { id: "furniture",   name: "Möbelfabrik",         emoji: "🪑", color: "green",  cost: 3, rolls: [8],       icon: "factory", qty: 6, desc: "+3 Münzen je Wald/Bergwerk (dein Zug)." },
    mine:        { id: "mine",        name: "Bergwerk",            emoji: "⛏️", color: "blue",   cost: 6, rolls: [9],       icon: "gear",  qty: 6, desc: "+5 Münzen von der Bank (jeder Zug)." },
    family:      { id: "family",      name: "Familienrestaurant",  emoji: "🍽️", color: "red",    cost: 3, rolls: [9, 10],   icon: "cup",   qty: 6, desc: "Nimm 2 Münzen vom aktiven Spieler." },
    apple:       { id: "apple",       name: "Apfelplantage",       emoji: "🍎", color: "blue",   cost: 3, rolls: [10],      icon: "grain", qty: 6, desc: "+3 Münzen von der Bank (jeder Zug)." },
    fruit:       { id: "fruit",       name: "Obst- und Gemüsemarkt", emoji: "🥬", color: "green", cost: 2, rolls: [11, 12], icon: "fruit", qty: 6, desc: "+2 Münzen je Getreidefeld/Apfelplantage (dein Zug)." }
  };
  const CARD_ORDER = ["wheat", "ranch", "bakery", "cafe", "convenience", "forest", "stadium", "tv", "business", "cheese", "furniture", "mine", "family", "apple", "fruit"];

  const LANDMARKS = {
    station: { id: "station", name: "Bahnhof",          emoji: "🚉", cost: 4,  desc: "Du darfst mit 1 oder 2 Würfeln würfeln." },
    mall:    { id: "mall",    name: "Einkaufszentrum",  emoji: "🛍️", cost: 10, desc: "+1 Münze bei Brot- und Café-Gebäuden." },
    park:    { id: "park",    name: "Freizeitpark",     emoji: "🎢", cost: 16, desc: "Bei einem Pasch bekommst du einen Extra-Zug." },
    tower:   { id: "tower",   name: "Funkturm",         emoji: "📡", cost: 22, desc: "Einmal pro Zug darfst du neu würfeln." }
  };
  const LANDMARK_ORDER = ["station", "mall", "park", "tower"];

  const START_CARDS = ["wheat", "bakery"];
  const START_COINS = 3;

  const normGoal = (n) => ([1, 2, 3].includes(+n) ? +n : 1);
  const normLevel = (n) => (LEVELS[+n] ? +n : 2);
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);
  const rollDie = () => 1 + rand(6);
  const has = (p, id) => !!(p.lm && p.lm[id]);
  const countIcon = (p, icon) => {
    let n = 0;
    for (const id of Object.keys(p.cards || {})) {
      const c = CARDS[id];
      if (c && c.icon === icon) n += p.cards[id];
    }
    return n;
  };
  const cardCount = (p, id) => (p.cards && p.cards[id]) || 0;
  const landmarksDone = (p) => LANDMARK_ORDER.filter((id) => has(p, id)).length;
  const canRollTwo = (p) => has(p, "station");
  const mallBonus = (p, icon) => (has(p, "mall") && (icon === "bread" || icon === "cup") ? 1 : 0);

  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 80) S.log.shift();
  }

  function emptyMarket() {
    const m = {};
    for (const id of CARD_ORDER) m[id] = CARDS[id].qty;
    return m;
  }

  function newPlayer(p, i) {
    const cards = {};
    for (const id of START_CARDS) cards[id] = 1;
    return {
      name: p.name, bot: !!p.bot, avatar: avatarOf(p, i),
      coins: START_COINS, cards, lm: { station: false, mall: false, park: false, tower: false },
      wins: 0, moves: 0
    };
  }

  function newGame(players, goal, level) {
    const list = (players || []).slice(0, MAX_PLAYERS);
    if (!list.length) list.push({ name: "Spieler", bot: false });
    const S = {
      players: list.map(newPlayer),
      goal: normGoal(goal), level: normLevel(level),
      round: 0, starter: rand(list.length), log: [], last: null, market: emptyMarket(),
      seq: 0
    };
    startRound(S);
    return S;
  }

  function startRound(S) {
    S.round++;
    S.phase = "play";
    S.last = null;
    S.log = [];
    S.market = emptyMarket();
    S.turn = 0;
    S.extra = false; // amusement-park extra turn already used this chain
    S.dice = [];
    S.diceN = 1;
    S.doubles = false;
    S.income = null;
    S.pendingTv = false;
    S.pendingTrade = false;
    S.players.forEach((p) => {
      p.coins = START_COINS;
      p.cards = {};
      for (const id of START_CARDS) p.cards[id] = 1;
      p.lm = { station: false, mall: false, park: false, tower: false };
      p.moves = 0;
    });
    const first = S.starter % S.players.length;
    S.starter = (S.starter + 1) % S.players.length;
    log(S, `Runde ${S.round}: ${S.players[first].name} beginnt.`);
    beginTurn(S, first, false);
  }

  function beginTurn(S, pi, isExtra) {
    S.cur = pi;
    S.turn++;
    S.seq++;
    S.step = "roll";
    S.dice = [];
    S.diceN = 1;
    S.doubles = false;
    S.income = null;
    S.pendingTv = false;
    S.pendingTrade = false;
    S.extra = !!isExtra;
    if (isExtra) log(S, `${S.players[pi].name} bekommt einen Extra-Zug (Freizeitpark)!`);
  }

  function endRound(S, winner, events) {
    S.players[winner].wins++;
    const over = S.players[winner].wins >= S.goal;
    S.phase = "roundEnd";
    S.cur = -1;
    S.step = null;
    S.last = { winners: [winner], over, moves: S.players.reduce((n, p) => n + p.moves, 0) };
    log(S, `${S.players[winner].name} ${over ? "gewinnt das Spiel" : "gewinnt die Runde"}!`);
    events.push({ t: "end", winners: [winner] });
  }

  function pay(from, to, amount, events, reason) {
    const got = Math.min(from.coins, amount);
    if (!got) return 0;
    from.coins -= got;
    to.coins += got;
    if (events) events.push({ t: "pay", from: from._i, to: to._i, amount: got, reason });
    return got;
  }

  function bank(p, amount, events, reason) {
    if (amount <= 0) return 0;
    p.coins += amount;
    if (events) events.push({ t: "bank", pi: p._i, amount, reason });
    return amount;
  }

  // Activate income for a finished roll. Mutates coins; may set pendingTv / pendingTrade.
  function resolveIncome(S, events) {
    const total = S.dice.reduce((a, b) => a + b, 0);
    const active = S.cur;
    const n = S.players.length;
    const summary = [];
    // Tag indices for pay/bank events
    S.players.forEach((p, i) => { p._i = i; });

    // 1) Red restaurants — counter-clockwise from the roller (previous seats first)
    for (let k = 1; k < n; k++) {
      const oi = (active - k + n) % n;
      const owner = S.players[oi];
      for (const id of ["cafe", "family"]) {
        const c = CARDS[id];
        if (!c.rolls.includes(total)) continue;
        const copies = cardCount(owner, id);
        if (!copies) continue;
        const each = (id === "cafe" ? 1 : 2) + mallBonus(owner, "cup");
        const want = each * copies;
        const got = pay(S.players[active], owner, want, events, id);
        if (got) summary.push(`${owner.name}: ${c.name} +${got}`);
      }
    }

    // 2) Blue (everyone) + Green (active only)
    for (let i = 0; i < n; i++) {
      const p = S.players[i];
      const ownTurn = i === active;
      for (const id of CARD_ORDER) {
        const c = CARDS[id];
        if (c.color === "red" || c.color === "purple") continue;
        if (!c.rolls.includes(total)) continue;
        if (c.color === "green" && !ownTurn) continue;
        const copies = cardCount(p, id);
        if (!copies) continue;
        let each = 0;
        if (id === "wheat" || id === "ranch" || id === "forest") each = 1;
        else if (id === "bakery") each = 1 + mallBonus(p, "bread");
        else if (id === "convenience") each = 3 + mallBonus(p, "bread");
        else if (id === "mine") each = 5;
        else if (id === "apple") each = 3;
        else if (id === "cheese") each = 3 * countIcon(p, "cow");
        else if (id === "furniture") each = 3 * countIcon(p, "gear");
        else if (id === "fruit") each = 2 * countIcon(p, "grain");
        const gain = each * copies;
        if (gain) {
          bank(p, gain, events, id);
          summary.push(`${p.name}: ${c.name} +${gain}`);
        }
      }
    }

    // 3) Purple majors (active only)
    S.pendingTv = false;
    S.pendingTrade = false;
    if (cardCount(S.players[active], "stadium") && CARDS.stadium.rolls.includes(total)) {
      let got = 0;
      for (let i = 0; i < n; i++) {
        if (i === active) continue;
        got += pay(S.players[i], S.players[active], 2, events, "stadium");
      }
      if (got) summary.push(`${S.players[active].name}: Stadion +${got}`);
    }
    if (cardCount(S.players[active], "tv") && CARDS.tv.rolls.includes(total)) {
      const others = S.players.filter((_, i) => i !== active && S.players[i].coins > 0);
      if (others.length) S.pendingTv = true;
    }
    if (cardCount(S.players[active], "business") && CARDS.business.rolls.includes(total)) {
      S.pendingTrade = true;
    }

    S.income = { total, lines: summary };
    if (summary.length) log(S, `Wurf ${total}: ${summary.join(" · ")}`);
    else log(S, `Wurf ${total}: nichts aktiviert.`);
    events.push({ t: "income", total, lines: summary.slice() });

    // clean temp indices
    S.players.forEach((p) => { delete p._i; });
  }

  function afterIncome(S, events) {
    if (S.pendingTv) { S.step = "tv"; S.seq++; return; }
    if (S.pendingTrade) { S.step = "trade"; S.seq++; return; }
    S.step = "build";
    S.seq++;
  }

  function finishBuild(S, events) {
    // win check
    if (landmarksDone(S.players[S.cur]) >= 4) {
      endRound(S, S.cur, events);
      return;
    }
    // Amusement Park: doubles → one extra turn (not chaining from an extra)
    if (!S.extra && S.doubles && has(S.players[S.cur], "park") && canRollTwo(S.players[S.cur])) {
      beginTurn(S, S.cur, true);
      return;
    }
    beginTurn(S, (S.cur + 1) % S.players.length, false);
  }

  function doRoll(S, n, events) {
    const dice = [];
    for (let i = 0; i < n; i++) dice.push(rollDie());
    S.dice = dice;
    S.diceN = n;
    S.doubles = n === 2 && dice[0] === dice[1];
    S.players[S.cur].moves++;
    S.seq++;
    log(S, `${S.players[S.cur].name} würfelt ${dice.join("+")}${S.doubles ? " (Pasch)" : ""} = ${dice.reduce((a, b) => a + b, 0)}.`);
    events.push({ t: "roll", pi: S.cur, dice: dice.slice(), doubles: S.doubles });
  }

  function affordable(S, pi) {
    const p = S.players[pi], out = { cards: [], landmarks: [] };
    for (const id of CARD_ORDER) {
      const c = CARDS[id];
      if (!S.market[id]) continue;
      if (c.color === "purple" && cardCount(p, id)) continue;
      if (p.coins >= c.cost) out.cards.push(id);
    }
    for (const id of LANDMARK_ORDER) {
      if (!has(p, id) && p.coins >= LANDMARKS[id].cost) out.landmarks.push(id);
    }
    return out;
  }

  function tradeableCards(p) {
    const ids = [];
    for (const id of Object.keys(p.cards || {})) {
      if (CARDS[id] && CARDS[id].color !== "purple" && p.cards[id] > 0) ids.push(id);
    }
    return ids;
  }

  // Apply an action by player `pi`. Returns { ok, error?, events }.
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
    if (a.t === "skip") {
      log(S, `${S.players[S.cur].name} wird übersprungen.`);
      beginTurn(S, (S.cur + 1) % S.players.length, false);
      return ok();
    }
    if (a.t === "giveup") {
      log(S, `${P.name} gibt auf.`);
      events.push({ t: "giveup", pi });
      // best by landmarks then coins
      const rest = S.players.map((p, i) => i).filter((i) => i !== pi)
        .sort((x, y) => landmarksDone(S.players[y]) - landmarksDone(S.players[x]) || S.players[y].coins - S.players[x].coins);
      if (!rest.length) { endRound(S, pi, events); return ok(); }
      endRound(S, rest[0], events);
      return ok();
    }
    if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);

    // ---- roll ----
    if (a.t === "roll") {
      if (S.step !== "roll" && S.step !== "reroll") return fail("Jetzt wird nicht gewürfelt.");
      const n = +a.dice || 1;
      if (n !== 1 && n !== 2) return fail("1 oder 2 Würfel.");
      if (n === 2 && !canRollTwo(P)) return fail("Dafür brauchst du den Bahnhof.");
      doRoll(S, n, events);
      if (S.step === "roll" && has(P, "tower")) {
        S.step = "reroll";
        S.seq++;
        return ok();
      }
      resolveIncome(S, events);
      afterIncome(S, events);
      return ok();
    }

    if (a.t === "keep") {
      if (S.step !== "reroll") return fail("Kein Neuwurf offen.");
      resolveIncome(S, events);
      afterIncome(S, events);
      return ok();
    }

    if (a.t === "reroll") {
      if (S.step !== "reroll") return fail("Kein Neuwurf möglich.");
      if (!has(P, "tower")) return fail("Dafür brauchst du den Funkturm.");
      doRoll(S, S.diceN, events);
      resolveIncome(S, events);
      afterIncome(S, events);
      return ok();
    }

    // ---- TV target ----
    if (a.t === "tv") {
      if (S.step !== "tv") return fail("Kein Fernsehsender aktiv.");
      const ti = +a.target;
      if (!Number.isInteger(ti) || ti < 0 || ti >= S.players.length || ti === pi) return fail("Wen willst du anzapfen?");
      S.players.forEach((p, i) => { p._i = i; });
      const got = pay(S.players[ti], P, 5, events, "tv");
      S.players.forEach((p) => { delete p._i; });
      log(S, `${P.name} zapft ${S.players[ti].name} mit dem Fernsehsender ab (+${got}).`);
      S.pendingTv = false;
      afterIncome(S, events);
      return ok();
    }

    // ---- Business Center trade ----
    if (a.t === "trade") {
      if (S.step !== "trade") return fail("Kein Unternehmen aktiv.");
      if (a.skip) {
        log(S, `${P.name} verzichtet auf den Tausch.`);
        S.pendingTrade = false;
        afterIncome(S, events);
        return ok();
      }
      const mine = a.from, theirs = a.their, oi = +a.with;
      if (!CARDS[mine] || CARDS[mine].color === "purple") return fail("Ungültiges eigenes Gebäude.");
      if (!CARDS[theirs] || CARDS[theirs].color === "purple") return fail("Ungültiges fremdes Gebäude.");
      if (!Number.isInteger(oi) || oi < 0 || oi >= S.players.length || oi === pi) return fail("Mit wem tauschen?");
      if (!cardCount(P, mine) || !cardCount(S.players[oi], theirs)) return fail("Gebäude nicht vorhanden.");
      P.cards[mine]--;
      if (!P.cards[mine]) delete P.cards[mine];
      S.players[oi].cards[theirs]--;
      if (!S.players[oi].cards[theirs]) delete S.players[oi].cards[theirs];
      P.cards[theirs] = (P.cards[theirs] || 0) + 1;
      S.players[oi].cards[mine] = (S.players[oi].cards[mine] || 0) + 1;
      log(S, `${P.name} tauscht ${CARDS[mine].name} gegen ${CARDS[theirs].name} von ${S.players[oi].name}.`);
      events.push({ t: "trade", pi, with: oi, from: mine, their: theirs });
      S.pendingTrade = false;
      afterIncome(S, events);
      return ok();
    }

    // ---- build ----
    if (a.t === "pass") {
      if (S.step !== "build") return fail("Jetzt kannst du nicht passen.");
      log(S, `${P.name} baut nichts.`);
      events.push({ t: "pass", pi });
      finishBuild(S, events);
      return ok();
    }

    if (a.t === "buy") {
      if (S.step !== "build") return fail("Jetzt kannst du nicht kaufen.");
      const id = a.id;
      const c = CARDS[id];
      if (!c) return fail("Unbekanntes Gebäude.");
      if (!S.market[id]) return fail("Ausverkauft.");
      if (c.color === "purple" && cardCount(P, id)) return fail("Davon hast du schon eins.");
      if (P.coins < c.cost) return fail("Zu wenig Münzen.");
      P.coins -= c.cost;
      S.market[id]--;
      P.cards[id] = (P.cards[id] || 0) + 1;
      log(S, `${P.name} kauft ${c.name} (−${c.cost}).`);
      events.push({ t: "buy", pi, id, cost: c.cost });
      finishBuild(S, events);
      return ok();
    }

    if (a.t === "landmark") {
      if (S.step !== "build") return fail("Jetzt kannst du kein Wahrzeichen bauen.");
      const id = a.id;
      const L = LANDMARKS[id];
      if (!L) return fail("Unbekanntes Wahrzeichen.");
      if (has(P, id)) return fail("Schon gebaut.");
      if (P.coins < L.cost) return fail("Zu wenig Münzen.");
      P.coins -= L.cost;
      P.lm[id] = true;
      log(S, `${P.name} vollendet ${L.name} (−${L.cost})!`);
      events.push({ t: "landmark", pi, id, cost: L.cost });
      finishBuild(S, events);
      return ok();
    }

    return fail("Unbekannte Aktion.");
  }

  // ---------- computer player ----------
  function botMove(S, pi) {
    if (S.phase !== "play" || S.cur !== pi) return null;
    const p = S.players[pi], level = S.level || 2;

    if (S.step === "roll") {
      // Prefer 2 dice once station is built and we have some high cards / landmarks mid-game
      if (canRollTwo(p)) {
        const wantTwo = level === 1 ? Math.random() < 0.4
          : landmarksDone(p) >= 1 || p.coins >= 6 || cardCount(p, "fruit") || cardCount(p, "cheese") || cardCount(p, "mine");
        return { t: "roll", dice: wantTwo ? 2 : 1 };
      }
      return { t: "roll", dice: 1 };
    }

    if (S.step === "reroll") {
      const total = S.dice.reduce((a, b) => a + b, 0);
      // Reroll junk rolls (1 alone, or low totals that help nobody we care about)
      const junk = total <= 2 || (level >= 2 && total === 1);
      if (junk || (level === 3 && total <= 3 && Math.random() < 0.5)) return { t: "reroll" };
      return { t: "keep" };
    }

    if (S.step === "tv") {
      // Steal from the richest opponent
      let best = -1, bestCoins = -1;
      S.players.forEach((o, i) => {
        if (i === pi) return;
        if (o.coins > bestCoins) { bestCoins = o.coins; best = i; }
      });
      if (best < 0) best = (pi + 1) % S.players.length;
      return { t: "tv", target: best };
    }

    if (S.step === "trade") {
      if (level === 1 && Math.random() < 0.5) return { t: "trade", skip: true };
      // Try to steal a useful card (mine/apple/fruit/cheese) giving a weak one
      const mine = tradeableCards(p);
      if (!mine.length) return { t: "trade", skip: true };
      const weak = mine.includes("wheat") ? "wheat" : mine.includes("bakery") ? "bakery" : mine[0];
      let best = null;
      for (let i = 0; i < S.players.length; i++) {
        if (i === pi) continue;
        const theirs = tradeableCards(S.players[i]);
        const prefer = ["mine", "apple", "fruit", "cheese", "furniture", "convenience", "forest", "ranch"];
        for (const want of prefer) {
          if (theirs.includes(want) && want !== weak) {
            best = { t: "trade", from: weak, with: i, their: want };
            break;
          }
        }
        if (best) break;
      }
      return best || { t: "trade", skip: true };
    }

    if (S.step === "build") {
      const aff = affordable(S, pi);
      // Always take a landmark we can afford if it finishes us or we have spare money
      const finishers = aff.landmarks.filter((id) => landmarksDone(p) === 3);
      if (finishers.length) return { t: "landmark", id: finishers[0] };

      if (level >= 2) {
        // Prioritize landmarks in order when we can afford them and have a bit of buffer
        for (const id of LANDMARK_ORDER) {
          if (aff.landmarks.includes(id)) {
            const cost = LANDMARKS[id].cost;
            if (p.coins >= cost + (level === 3 && id !== "station" ? 0 : 0)) {
              // Buy station early; mall when we have bread/cup; park/tower when rich
              if (id === "station") return { t: "landmark", id };
              if (id === "mall" && (countIcon(p, "bread") + countIcon(p, "cup") >= 2 || p.coins >= 14)) return { t: "landmark", id };
              if (id === "park" && p.coins >= 18) return { t: "landmark", id };
              if (id === "tower" && p.coins >= 22) return { t: "landmark", id };
              if (level === 3 && p.coins >= cost) return { t: "landmark", id };
            }
          }
        }
      } else if (aff.landmarks.length && Math.random() < 0.35) {
        return { t: "landmark", id: aff.landmarks[rand(aff.landmarks.length)] };
      }

      // Establishments: prefer cheap income, red if others rich, factories if we have icons
      const scored = aff.cards.map((id) => {
        const c = CARDS[id];
        let s = 10 - c.cost;
        if (c.color === "red") {
          const rich = S.players.some((o, i) => i !== pi && o.coins >= 4);
          s += rich ? 6 : 1;
        }
        if (id === "cheese" && countIcon(p, "cow") >= 2) s += 8;
        if (id === "furniture" && countIcon(p, "gear") >= 2) s += 8;
        if (id === "fruit" && countIcon(p, "grain") >= 2) s += 8;
        if (id === "ranch" || id === "forest" || id === "wheat") s += 3;
        if (id === "mine" || id === "apple") s += 4;
        if (c.color === "purple") s += level >= 2 ? 5 : 2;
        if (level === 1) s += rand(5);
        return { id, s };
      }).sort((a, b) => b.s - a.s);

      if (scored.length && (level === 1 || p.coins - CARDS[scored[0].id].cost >= 0)) {
        // Sometimes pass to save for landmark
        const nextLm = LANDMARK_ORDER.find((id) => !has(p, id));
        if (nextLm && level >= 2 && p.coins >= LANDMARKS[nextLm].cost - 2 && p.coins < LANDMARKS[nextLm].cost && Math.random() < 0.6) {
          return { t: "pass" };
        }
        if (scored.length) return { t: "buy", id: scored[0].id };
      }

      if (aff.landmarks.length) return { t: "landmark", id: aff.landmarks[0] };
      return { t: "pass" };
    }

    return null;
  }

  // Human-like pacing for computer turns (shared by server and local UI).
  function botPlan(S) {
    if (!S || S.phase !== "play" || S.cur < 0 || !S.players[S.cur] || !S.players[S.cur].bot) return null;
    const base = { roll: 1300, reroll: 900, tv: 1100, trade: 1300, build: 1500 };
    const delay = (base[S.step] || 1100) + Math.floor(Math.random() * 500);
    return { pi: S.cur, delay, key: `bot:${S.round}:${S.turn}:${S.step}:${S.seq}` };
  }

  function view(S, pi) {
    const me = S.players[pi] ? pi : -1;
    const aff = (S.phase === "play" && S.step === "build" && me === S.cur) ? affordable(S, me) : { cards: [], landmarks: [] };
    return {
      me, phase: S.phase, cur: S.cur, step: S.step, turn: S.turn, round: S.round,
      goal: S.goal, level: S.level || 2, seq: S.seq,
      dice: S.dice.slice(), diceN: S.diceN, doubles: !!S.doubles,
      income: S.income ? { total: S.income.total, lines: S.income.lines.slice() } : null,
      market: Object.assign({}, S.market),
      affordable: aff,
      pendingTv: !!S.pendingTv, pendingTrade: !!S.pendingTrade,
      players: S.players.map((p, i) => ({
        name: p.name, bot: p.bot, avatar: avatarOf(p, i), wins: p.wins, coins: p.coins,
        cards: Object.assign({}, p.cards), lm: Object.assign({}, p.lm),
        landmarks: landmarksDone(p), moves: p.moves || 0
      })),
      log: S.log.slice(), last: S.last, nextStarter: S.starter % S.players.length,
      cards: CARDS, landmarks: LANDMARKS, cardOrder: CARD_ORDER, landmarkOrder: LANDMARK_ORDER
    };
  }

  return {
    MAX_PLAYERS, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, CARDS, CARD_ORDER, LANDMARKS, LANDMARK_ORDER,
    START_CARDS, START_COINS, normGoal, normLevel, landmarksDone, affordable, tradeableCards,
    newGame, startRound, act, botMove, botPlan, view
  };
});
