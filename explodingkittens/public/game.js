// Exploding Kittens engine. Pure state + rules, shared by the browser (single player) and the Node
// server (online). No DOM, no I/O.
//
// A draw pile hides one exploding kitten fewer than there are players. On your turn you may play
// cards, then you end the turn by drawing one. Whoever draws a kitten without a defuse is out; the
// last one left wins the round. Every played card can be cancelled by "Nö!" cards during a short
// window (a Nö can be cancelled by another Nö), so a played card is resolved by tick() once the
// window has run out. Hidden information (the cards seen with "Blick in die Zukunft", the card that
// somebody gives or loses) only ever leaves this file through view(), never through the events.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ExplodingkittensGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 5;
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip", "Pixel Paula", "Byte Ben", "Turbo Tina", "Nano Nick", "Zack Zora", "Bit Bruno"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi" };
  const WINDOW_MS = 3000;  // everybody may play a "Nö!" for this long after a card was played
  const NOPE_MS = 2000;    // ... and after each Nö
  const SETTLE_MS = 600;   // when nobody can or wants to say Nö, the card resolves after this short beat
  const TURN_MS = 45000;   // the server's clock for whoever has to decide something
  const HAND = 7, PEEK = 3;

  // `count` is how many cards of that kind the deck has (kitten and defuse are handled by the deal)
  const CARDS = {
    kitten: { name: "Explodierende Katze", icon: "💣", count: 0, desc: "Explodiert!", info: "Wer sie zieht, fliegt raus, außer er kann sie mit Entschärfen retten." },
    defuse: { name: "Entschärfen", icon: "🧯", count: 0, desc: "Rettet vor der 💣", info: "Rettet dich, wenn du eine Katze ziehst. Du steckst sie danach geheim zurück in den Stapel." },
    nope: { name: "Nö!", icon: "🚫", count: 5, desc: "Stoppt eine Karte", info: "Sag „Nö!“, wenn jemand anderes eine Karte spielt. Die Karte wirkt dann nicht." },
    attack: { name: "Angriff", icon: "⚔️", count: 4, desc: "Nächster: 2 Züge", info: "Dein Zug endet ohne Ziehen. Der Nächste muss 2 Züge machen." },
    skip: { name: "Aussetzen", icon: "⏭️", count: 4, desc: "Zug ohne Ziehen", info: "Beendet deinen Zug, ohne dass du ziehen musst." },
    favor: { name: "Gefallen", icon: "🎁", count: 4, desc: "Du bekommst eine Karte", info: "Eine Person deiner Wahl muss dir eine Karte geben (sie sucht sie aus)." },
    shuffle: { name: "Mischen", icon: "🔀", count: 4, desc: "Stapel mischen", info: "Mischt den Stapel, damit niemand die oberste Karte kennt." },
    future: { name: "Blick in die Zukunft", icon: "🔮", count: 5, desc: "Oberste 3 ansehen", info: "Du schaust dir die obersten 3 Karten des Stapels heimlich an." },
    cat1: { name: "Taco-Katze", icon: "🌮", count: 4, desc: "2 gleiche: Karte klauen", info: "Zwei gleiche Katzen: Du ziehst eine zufällige Karte von jemandem. Drei gleiche: Du nennst eine Karte, die du verlangst." },
    cat2: { name: "Melonen-Katze", icon: "🍉", count: 4, desc: "2 gleiche: Karte klauen", info: "Zwei gleiche Katzen: Du ziehst eine zufällige Karte von jemandem. Drei gleiche: Du nennst eine Karte, die du verlangst." },
    cat3: { name: "Kartoffel-Katze", icon: "🥔", count: 4, desc: "2 gleiche: Karte klauen", info: "Zwei gleiche Katzen: Du ziehst eine zufällige Karte von jemandem. Drei gleiche: Du nennst eine Karte, die du verlangst." },
    cat4: { name: "Regenbogen-Katze", icon: "🌈", count: 4, desc: "2 gleiche: Karte klauen", info: "Zwei gleiche Katzen: Du ziehst eine zufällige Karte von jemandem. Drei gleiche: Du nennst eine Karte, die du verlangst." },
    cat5: { name: "Bart-Katze", icon: "🧔", count: 4, desc: "2 gleiche: Karte klauen", info: "Zwei gleiche Katzen: Du ziehst eine zufällige Karte von jemandem. Drei gleiche: Du nennst eine Karte, die du verlangst." }
  };
  const ORDER = Object.keys(CARDS);
  const ACTIONS = ["attack", "skip", "favor", "shuffle", "future"]; // played alone
  const CATS = ["cat1", "cat2", "cat3", "cat4", "cat5"];            // played as a pair or a triple

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isCard = (c) => typeof c === "string" && has(CARDS, c);
  const isCat = (c) => typeof c === "string" && CATS.includes(c);
  const normGoal = (n) => ([1, 2, 3].includes(+n) ? +n : 1);
  const normLevel = (n) => (LEVELS[+n] ? +n : 2);
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);
  const byOrder = (a, b) => ORDER.indexOf(a) - ORDER.indexOf(b);
  const cardName = (c) => (isCard(c) ? CARDS[c].name : "?");

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 60) S.log.shift();
  }
  const kittensIn = (deck) => deck.filter((c) => c === "kitten").length;
  const alive = (S) => S.players.map((p, i) => i).filter((i) => !S.players[i].out);
  function nextAlive(S, pi) {
    const n = S.players.length;
    for (let k = 1; k <= n; k++) { const i = (pi + k) % n; if (!S.players[i].out) return i; }
    return pi;
  }
  const waitingFor = (S) => (S.phase === "play" ? S.cur : S.phase === "give" && S.give ? S.give.from : S.phase === "place" && S.place ? S.place.pi : -1);

  // players: [{ name, bot, avatar }]; goal: rounds to win; level: computer strength; fast: short Nö windows (tests)
  function newGame(players, goal, level, fast) {
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p, i) => ({ name: p.name, bot: !!p.bot, avatar: avatarOf(p, i), wins: 0, hand: [], out: false })),
      goal: normGoal(goal), level: normLevel(level),
      round: 0, starter: 0, mv: 0, tn: 0, txn: 0, log: [], last: null,
      win: fast ? 800 : WINDOW_MS, nopeWin: fast ? 800 : NOPE_MS, settle: fast ? 150 : SETTLE_MS
    };
    S.starter = rand(S.players.length);
    startRound(S, []);
    return S;
  }

  function startRound(S, events = []) {
    const n = S.players.length;
    S.round++;
    S.phase = "play";
    S.last = null;
    S.log = [];
    S.stack = null; S.give = null; S.place = null; S.peeks = {}; S.txs = [];
    S.disc = []; S.boom = [];
    const pool = [];
    for (const k of ORDER) for (let i = 0; i < CARDS[k].count; i++) pool.push(k);
    shuffle(pool);
    for (const p of S.players) { p.out = false; p.hand = ["defuse"].concat(pool.splice(0, HAND)); p.hand.sort(byOrder); }
    const deck = pool;
    for (let i = 0; i < n - 1; i++) deck.push("kitten");
    for (let i = 0; i < Math.min(2, 6 - n); i++) deck.push("defuse");
    S.deck = shuffle(deck);
    const first = S.starter % n;
    S.starter = (S.starter + 1) % n;
    S.cur = first; S.owed = 1; S.tn = 1;
    log(S, `Runde ${S.round}: ${S.players[first].name} beginnt.`);
    events.push({ t: "start" });
  }

  function endRound(S, winner, events) {
    S.players[winner].wins++;
    const over = S.players[winner].wins >= S.goal;
    S.phase = "roundEnd";
    S.cur = -1; S.stack = null; S.give = null; S.place = null; S.peeks = {};
    S.last = { winners: [winner], over, how: "last", left: S.deck.length };
    log(S, `${S.players[winner].name} ${over ? "gewinnt das Spiel" : "gewinnt die Runde"}!`);
    events.push({ t: "end", winners: [winner] });
  }

  function advance(S, events, owed) {
    S.cur = nextAlive(S, S.cur);
    S.owed = owed || 1;
    S.tn++;
    events.push({ t: "turn", pi: S.cur });
  }
  function turnDone(S, events) { // one of the turns the player owes is over
    S.owed--;
    if (S.owed <= 0) advance(S, events, 1);
  }

  function takeTop(S, events) {
    if (!S.deck.length && S.disc.length) {
      S.deck = shuffle(S.disc); S.disc = []; S.peeks = {};
      events.push({ t: "reshuffle" });
      log(S, "Der Stapel ist leer, der Ablagestapel wird neu gemischt.");
    }
    return S.deck.length ? S.deck.pop() : null;
  }

  function drawFor(S, pi, events) {
    const P = S.players[pi];
    const c = takeTop(S, events);
    S.peeks = {};
    if (c === null) { log(S, "Es gibt keine Karte mehr zu ziehen."); turnDone(S, events); return; }
    if (c !== "kitten") {
      P.hand.push(c); P.hand.sort(byOrder);
      events.push({ t: "draw", pi, kitten: false });
      log(S, `${P.name} zieht eine Karte.`);
      turnDone(S, events);
      return;
    }
    events.push({ t: "draw", pi, kitten: true });
    const d = P.hand.indexOf("defuse");
    if (d >= 0) {
      P.hand.splice(d, 1); S.disc.push("defuse");
      S.phase = "place"; S.place = { pi };
      events.push({ t: "defuse", pi });
      log(S, `${P.name} zieht eine explodierende Katze und entschärft sie!`);
      return;
    }
    P.out = true;
    S.boom.push("kitten");
    S.disc = P.hand.concat(S.disc); P.hand = [];
    events.push({ t: "boom", pi });
    log(S, `${P.name} zieht eine explodierende Katze und ist raus!`);
    const left = alive(S);
    if (left.length === 1) endRound(S, left[0], events);
    else advance(S, events, 1);
  }

  function take(S, from, to, c, events) {
    S.players[from].hand.splice(S.players[from].hand.indexOf(c), 1);
    S.players[to].hand.push(c); S.players[to].hand.sort(byOrder);
    const k = ++S.txn;
    S.txs.push({ k, from, to, c });
    if (S.txs.length > 6) S.txs.shift();
    events.push({ t: "take", from, to, k });
  }

  // the window ran out (or nobody can nope): do what the played card says, or nothing when it was cancelled
  function resolveStack(S, events) {
    const st = S.stack, pi = st.pi, P = S.players[pi];
    S.stack = null; S.phase = "play";
    if (st.nopes % 2 === 1) {
      events.push({ t: "fizzle", pi });
      log(S, `${cardName(st.c)} von ${P.name} wurde abgewehrt.`);
      return;
    }
    const tgt = st.target >= 0 ? S.players[st.target] : null;
    if (st.n === 1) {
      switch (st.c) {
        case "attack": {
          const to = nextAlive(S, pi);
          events.push({ t: "attack", pi, to });
          log(S, `${P.name} greift ${S.players[to].name} an: ${S.owed + 1} Züge in Folge.`);
          advance(S, events, S.owed + 1);
          return;
        }
        case "skip":
          events.push({ t: "skip", pi });
          log(S, `${P.name} setzt aus und zieht nicht.`);
          turnDone(S, events);
          return;
        case "shuffle":
          S.deck = shuffle(S.deck); S.peeks = {};
          events.push({ t: "shuffle", pi });
          log(S, `${P.name} mischt den Stapel.`);
          return;
        case "future":
          S.peeks[pi] = S.deck.slice(-PEEK).reverse();
          events.push({ t: "future", pi });
          log(S, `${P.name} schaut in die Zukunft.`);
          return;
        case "favor":
          if (!tgt || tgt.out || !tgt.hand.length) { log(S, `${P.name} bekommt nichts: ${tgt ? tgt.name : "niemand"} hat keine Karten.`); return; }
          S.phase = "give"; S.give = { from: st.target, to: pi };
          events.push({ t: "favor", pi, target: st.target });
          log(S, `${P.name} bittet ${tgt.name} um einen Gefallen.`);
          return;
      }
      return;
    }
    // cats: a pair steals a card at random, a triple names one
    if (!tgt || tgt.out || !tgt.hand.length) { log(S, `${P.name} geht leer aus: ${tgt ? tgt.name : "niemand"} hat keine Karten.`); return; }
    if (st.n === 2) {
      const c = tgt.hand[rand(tgt.hand.length)];
      events.push({ t: "steal", pi, target: st.target });
      take(S, st.target, pi, c, events);
      log(S, `${P.name} klaut ${tgt.name} eine Karte.`);
    } else if (tgt.hand.includes(st.name)) {
      events.push({ t: "steal", pi, target: st.target, named: true });
      take(S, st.target, pi, st.name, events);
      log(S, `${P.name} verlangt „${cardName(st.name)}“ von ${tgt.name} und bekommt sie.`);
    } else {
      events.push({ t: "steal", pi, target: st.target, named: true, miss: true });
      log(S, `${P.name} verlangt „${cardName(st.name)}“ von ${tgt.name}, aber die hat er nicht.`);
    }
  }

  // Resolve a played card whose window ran out. Returns events; call it on a timer and before every action.
  function tick(S, now) {
    now = now || Date.now();
    const events = [];
    if (S.phase !== "stack" || !S.stack || now < S.stack.until) return events;
    resolveStack(S, events);
    S.mv++;
    return events;
  }
  // Milliseconds until the window closes, or -1.
  function nextDeadline(S, now) {
    if (S.phase !== "stack" || !S.stack) return -1;
    return Math.max(0, S.stack.until - (now || Date.now()));
  }

  const validTarget = (S, pi, t) => Number.isInteger(t) && t !== pi && !!S.players[t] && !S.players[t].out && S.players[t].hand.length > 0;

  // The default move for whoever has to decide when time is up (or the host skips them).
  function forced(S, events) {
    if (S.phase === "play") { drawFor(S, S.cur, events); return true; }
    if (S.phase === "give") {
      const hand = S.players[S.give.from].hand, spare = hand.filter((c) => c !== "defuse"), from = S.give.from, to = S.give.to;
      const pool = spare.length ? spare : hand;
      giveCard(S, from, to, pool[rand(pool.length)], events);
      return true;
    }
    if (S.phase === "place") { placeKitten(S, S.place.pi, rand(S.deck.length + 1), events); return true; }
    return false;
  }
  function giveCard(S, from, to, c, events) {
    take(S, from, to, c, events);
    S.phase = "play"; S.give = null;
    events.push({ t: "give", from, to });
    log(S, `${S.players[from].name} gibt ${S.players[to].name} eine Karte.`);
  }
  function placeKitten(S, pi, pos, events) {
    S.deck.splice(S.deck.length - pos, 0, "kitten");
    S.peeks = {};
    S.phase = "play"; S.place = null;
    events.push({ t: "place", pi });
    log(S, `${S.players[pi].name} schiebt die Katze heimlich zurück in den Stapel.`);
    turnDone(S, events);
  }

  function startStack(S, pi, c, n, target, name, events) {
    S.stack = { pi, c, n, target, name, nopes: 0, last: -1, passed: [], until: Date.now() + S.win };
    S.phase = "stack";
    events.push({ t: n === 1 ? "play" : "combo", pi, c, n, target });
    settle(S);
  }
  // Waiting out the full window only makes sense while somebody might still say Nö: a person with a Nö in
  // hand who has not passed yet, or a computer player that means to. Otherwise cut it short.
  function settle(S) {
    const st = S.stack;
    if (!st) return;
    for (let i = 0; i < S.players.length; i++) {
      const p = S.players[i];
      if (p.out || st.last === i || !p.hand.includes("nope")) continue;
      if (i === st.pi && st.nopes % 2 === 0) continue; // nobody cancels their own card
      if (p.bot ? wantsNope(S, i) : !st.passed.includes(i)) return;
    }
    st.until = Math.min(st.until, Date.now() + S.settle);
    st.short = true;
  }

  // Apply an action by player `pi`. Returns { ok, error?, events }. Actions:
  //   {t:"play", c, target?}            an action card (Gefallen needs a target)
  //   {t:"combo", c, n, target, name?}  2 or 3 equal cats; a pair steals at random, a triple names a card
  //   {t:"nope"}  {t:"pass"} (no Nö from me)  {t:"draw"}  {t:"give", c}  {t:"place", pos}  {t:"next"}  {t:"skip"} (host)  {t:"timeout"} (server clock)
  function act(S, pi, a) {
    const r = doAct(S, pi, a);
    if (r.ok) S.mv++;
    return r;
  }

  function doAct(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events: [] });
    const ok = () => ({ ok: true, events });
    const P = Number.isInteger(pi) ? S.players[pi] : null;
    if (!P) return fail("Unbekannter Spieler.");
    if (!a || typeof a !== "object" || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
      if (S.last && S.last.over) { S.players.forEach((p) => { p.wins = 0; }); S.round = 0; }
      startRound(S, events);
      return ok();
    }
    if (S.phase === "roundEnd") return fail("Die Runde ist vorbei.");

    if (a.t === "timeout") { // the server's clock ran out for whoever has to decide
      const w = waitingFor(S);
      if (w < 0) return fail("Gerade muss niemand entscheiden.");
      log(S, `${S.players[w].name}: Zeit abgelaufen.`);
      events.push({ t: "timeout", pi: w });
      forced(S, events);
      return ok();
    }
    if (a.t === "skip") { // the host moves on when the one who has to decide is away
      const w = waitingFor(S);
      if (w < 0) return fail("Gerade muss niemand entscheiden.");
      if (w === pi) return fail("Du bist selbst dran.");
      log(S, `${S.players[w].name} wird übersprungen.`);
      events.push({ t: "away", pi: w });
      forced(S, events);
      return ok();
    }
    if (P.out) return fail("Du bist in dieser Runde schon raus.");

    if (a.t === "nope") {
      if (S.phase !== "stack" || !S.stack) return fail("Es gibt nichts abzuwehren.");
      if (Date.now() >= S.stack.until) return fail("Zu spät für ein Nö.");
      if (S.stack.last === pi) return fail("Du hast gerade schon „Nö!“ gesagt.");
      if (S.stack.pi === pi && S.stack.nopes % 2 === 0) return fail("Deine eigene Karte kannst du nicht abwehren.");
      const k = P.hand.indexOf("nope");
      if (k < 0) return fail("Du hast kein „Nö!“.");
      P.hand.splice(k, 1); S.disc.push("nope");
      S.stack.nopes++; S.stack.last = pi; S.stack.until = Date.now() + S.nopeWin; S.stack.passed = []; S.stack.short = false;
      events.push({ t: "nope", pi, n: S.stack.nopes });
      log(S, `${P.name}: „Nö!“`);
      settle(S);
      return ok();
    }
    if (a.t === "pass") { // "no Nö from me": once everybody who could has said so, the card resolves right away
      if (S.phase !== "stack" || !S.stack) return fail("Es gibt nichts abzuwehren.");
      if (!S.stack.passed.includes(pi)) S.stack.passed.push(pi);
      settle(S);
      return ok();
    }

    if (S.phase === "stack") return fail("Wartet, ob jemand „Nö!“ sagt.");

    if (S.phase === "give") {
      if (a.t !== "give") return fail(`${S.players[S.give.from].name} muss erst eine Karte geben.`);
      if (S.give.from !== pi) return fail("Du musst nichts geben.");
      if (!isCard(a.c) || !P.hand.includes(a.c)) return fail("Diese Karte hast du nicht.");
      giveCard(S, pi, S.give.to, a.c, events);
      return ok();
    }
    if (S.phase === "place") {
      if (a.t !== "place") return fail(`${S.players[S.place.pi].name} muss die Katze erst zurückstecken.`);
      if (S.place.pi !== pi) return fail("Du hast keine Katze zu verstecken.");
      if (!Number.isInteger(a.pos) || a.pos < 0 || a.pos > S.deck.length) return fail("Dort kann die Katze nicht hin.");
      placeKitten(S, pi, a.pos, events);
      return ok();
    }
    if (S.phase !== "play") return fail("Gerade ist niemand dran.");
    if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);

    if (a.t === "draw") {
      drawFor(S, pi, events);
      return ok();
    }
    if (a.t === "play") {
      if (!isCard(a.c) || !ACTIONS.includes(a.c)) return fail(isCard(a.c) && isCat(a.c) ? "Katzen spielst du zu zweit oder zu dritt." : "Diese Karte kannst du nicht ausspielen.");
      if (!P.hand.includes(a.c)) return fail(`Du hast keine Karte „${cardName(a.c)}“.`);
      let target = -1;
      if (a.c === "favor") {
        if (!validTarget(S, pi, a.target)) return fail("Such dir jemanden mit Karten aus.");
        target = a.target;
      }
      P.hand.splice(P.hand.indexOf(a.c), 1); S.disc.push(a.c);
      startStack(S, pi, a.c, 1, target, "", events);
      log(S, `${P.name} spielt ${cardName(a.c)}${target >= 0 ? ` gegen ${S.players[target].name}` : ""}.`);
      return ok();
    }
    if (a.t === "combo") {
      if (!isCat(a.c)) return fail("Nur gleiche Katzenkarten gehen zusammen.");
      if (a.n !== 2 && a.n !== 3) return fail("Zwei oder drei gleiche Katzen.");
      if (P.hand.filter((c) => c === a.c).length < a.n) return fail(`Du hast keine ${a.n} mal „${cardName(a.c)}“.`);
      if (!validTarget(S, pi, a.target)) return fail("Such dir jemanden mit Karten aus.");
      let name = "";
      if (a.n === 3) {
        if (!isCard(a.name) || a.name === "kitten") return fail("Nenne eine Karte, die du haben willst.");
        name = a.name;
      }
      for (let i = 0; i < a.n; i++) { P.hand.splice(P.hand.indexOf(a.c), 1); S.disc.push(a.c); }
      startStack(S, pi, a.c, a.n, a.target, name, events);
      log(S, `${P.name} spielt ${a.n} mal ${cardName(a.c)} gegen ${S.players[a.target].name}.`);
      return ok();
    }
    return fail("Unbekannte Aktion.");
  }

  // ---------- computer player ----------
  // The same hash for botPlan and botMove, so the plan to say "Nö" and the move itself always agree.
  function roll(S, pi, salt) {
    let h = Math.imul(S.round + 1, 73856093) ^ Math.imul(S.mv + 1, 19349663) ^ Math.imul(pi + 1, 83492791) ^ Math.imul(salt + 1, 40503);
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function wantsNope(S, pi) {
    const st = S.stack, P = S.players[pi];
    if (S.phase !== "stack" || !st || P.out || st.last === pi || !P.hand.includes("nope")) return false;
    const cancelled = st.nopes % 2 === 1;
    const hostile = (st.c === "attack" && nextAlive(S, st.pi) === pi) || st.target === pi;
    let p = 0;
    if (!cancelled && hostile && st.pi !== pi) p = [0, 0.4, 0.8, 0.97][S.level];
    else if (cancelled && st.pi === pi) p = [0, 0.3, 0.6, 0.9][S.level];
    return p > 0 && roll(S, pi, 7) < p;
  }

  function botPlay(S, pi) {
    const P = S.players[pi], level = S.level, hand = P.hand;
    const cnt = (c) => hand.filter((x) => x === c).length;
    const dn = S.deck.length, nk = kittensIn(S.deck), peek = S.peeks[pi] || null;
    const known = peek && peek.length ? peek[0] : null;
    const hasDef = cnt("defuse") > 0;
    const targets = S.players.map((p, i) => i).filter((i) => i !== pi && validTarget(S, pi, i));
    const r = (salt) => roll(S, pi, salt);
    const pick = (list, salt) => list[Math.floor(r(salt) * list.length) % list.length];
    const richest = () => targets.slice().sort((a, b) => S.players[b].hand.length - S.players[a].hand.length || a - b)[0];
    const play = (c, target) => (target == null ? { t: "play", c } : { t: "play", c, target });
    const draw = { t: "draw" };

    if (level === 1) {
      if (r(1) < 0.55) return draw;
      const opts = [];
      for (const c of ["attack", "skip", "shuffle", "future"]) if (cnt(c)) opts.push(play(c));
      if (cnt("favor") && targets.length) opts.push(play("favor", pick(targets, 2)));
      for (const c of CATS) if (cnt(c) >= 2 && targets.length) opts.push({ t: "combo", c, n: 2, target: pick(targets, 3) });
      return opts.length ? pick(opts, 4) : draw;
    }

    const danger = known ? (known === "kitten" ? 1 : 0) : dn ? nk / dn : 0;
    const escape = known === "kitten" ? !hasDef : !known && danger >= (level === 3 ? 0.24 : 0.34) && (!hasDef || danger >= 0.5);
    if (escape) {
      if (cnt("attack")) return play("attack");
      if (cnt("skip")) return play("skip");
      if (known === "kitten" && cnt("shuffle")) return play("shuffle");
    }
    if (!known && dn >= 3 && nk > 0 && cnt("future") && (level === 3 || r(5) < 0.6)) return play("future");
    if (cnt("favor") && targets.length && (level === 3 || r(6) < 0.7)) return play("favor", level === 3 ? richest() : pick(targets, 8));
    for (const c of CATS) {
      if (cnt(c) < 2 || !targets.length || (level < 3 && r(9) >= 0.5)) continue;
      const target = level === 3 ? richest() : pick(targets, 10);
      return cnt(c) >= 3 && level === 3 ? { t: "combo", c, n: 3, target, name: "defuse" } : { t: "combo", c, n: 2, target };
    }
    return draw;
  }

  // what a computer gives away: the cards it needs least
  const KEEP = { cat1: 1, cat2: 1, cat3: 1, cat4: 1, cat5: 1, future: 3, shuffle: 3, favor: 4, skip: 5, attack: 5, nope: 6, defuse: 10, kitten: 0 };
  function botGive(S, pi) {
    const hand = S.players[pi].hand;
    if (S.level === 1) return hand[Math.floor(roll(S, pi, 11) * hand.length) % hand.length];
    const value = (c) => KEEP[c] - (isCat(c) && hand.filter((x) => x === c).length > 1 ? 0.5 : 0);
    return hand.slice().sort((a, b) => value(a) - value(b))[0];
  }
  function botPlace(S, pi) {
    const dn = S.deck.length, uniform = Math.floor(roll(S, pi, 12) * (dn + 1)) % (dn + 1);
    if (S.level === 3 && S.owed === 1 && roll(S, pi, 13) < 0.65) return 0; // the next one draws it
    if (S.level === 2 && roll(S, pi, 13) < 0.3) return 0;
    return uniform;
  }

  function botMove(S, pi) {
    if (!S || !S.players[pi] || S.players[pi].out) return null;
    if (S.phase === "stack") return wantsNope(S, pi) ? { t: "nope" } : null;
    if (S.phase === "give") return S.give.from === pi ? { t: "give", c: botGive(S, pi) } : null;
    if (S.phase === "place") return S.place.pi === pi ? { t: "place", pos: botPlace(S, pi) } : null;
    if (S.phase === "play" && S.cur === pi) return botPlay(S, pi);
    return null;
  }

  // The next computer move, paced like a person. A "Nö" has to land inside the window that is still open.
  function botPlan(S) {
    if (!S || S.phase === "roundEnd") return null;
    if (S.phase === "stack") {
      const st = S.stack, n = S.players.length;
      for (let k = 1; k <= n; k++) {
        const pi = (st.pi + k) % n;
        if (!S.players[pi].bot || !wantsNope(S, pi)) continue;
        const delay = Math.min(650 + Math.random() * 850, st.until - Date.now() - 500);
        return delay < 150 ? null : { key: `nope:${S.round}:${S.mv}:${pi}`, delay, pi };
      }
      return null;
    }
    const w = waitingFor(S);
    if (w < 0 || !S.players[w].bot) return null;
    return { key: `bot:${S.round}:${S.mv}`, delay: 900 + Math.random() * 800, pi: w };
  }

  // What a player may see. Hands of the others stay hidden; the cards seen with "Zukunft" and the cards
  // that changed hands are only in the view of those who saw them.
  function view(S, pi) {
    const me = S.players[pi] ? pi : -1;
    const st = S.stack;
    return {
      me, phase: S.phase, cur: S.cur, owed: S.owed, turn: S.tn, mv: S.mv, round: S.round, goal: S.goal, level: S.level,
      deckN: S.deck.length, kn: kittensIn(S.deck), discN: S.disc.length, discTop: S.disc.length ? S.disc[S.disc.length - 1] : null,
      hand: me >= 0 ? S.players[me].hand.slice() : null,
      peek: me >= 0 && S.peeks[me] ? S.peeks[me].slice() : null,
      stack: st ? { pi: st.pi, c: st.c, n: st.n, target: st.target, name: st.name, nopes: st.nopes, last: st.last, passed: me >= 0 && st.passed.includes(me), pn: st.passed.length, short: !!st.short, left: Math.max(0, st.until - Date.now()) } : null,
      give: S.give ? { from: S.give.from, to: S.give.to } : null,
      place: S.place ? { pi: S.place.pi } : null,
      txs: S.txs.map((x) => ({ k: x.k, from: x.from, to: x.to, c: pi === x.from || pi === x.to ? x.c : null })),
      players: S.players.map((p, i) => ({ name: p.name, bot: p.bot, avatar: avatarOf(p, i), wins: p.wins, handN: p.hand.length, out: p.out })),
      log: S.log.slice(), last: S.last, nextStarter: S.starter % S.players.length
    };
  }

  const needsTarget = (c, n) => (n > 1 ? true : c === "favor");

  return {
    MAX_PLAYERS, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, CARDS, ORDER, ACTIONS, CATS, HAND, PEEK, WINDOW_MS, NOPE_MS, SETTLE_MS, TURN_MS,
    normGoal, normLevel, cardName, isCat, needsTarget, newGame, startRound, act, tick, nextDeadline, waitingFor, botMove, botPlan, view
  };
});
