// Skip-Bo engine. Pure state + rules, shared by the browser (single player) and the Node server
// (online). No DOM, no I/O.
//
// 162 cards: 12 each of 1..12 and 18 Skip-Bo jokers (value 0, any number). Everybody has a stock
// pile (top card visible), four own discard piles and up to five hand cards. Four build piles in the
// middle grow 1, 2, 3 … 12 (a joker stands for the next number); a pile that reaches 12 is cleared
// and reshuffled into the draw pile later. On your turn you draw up to five cards, play any number of
// cards (hand, stock top, discard tops) onto the build piles and end the turn by discarding one hand
// card. Emptying your hand draws five new ones at once. Whoever empties the stock pile wins the round.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SkipboGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 6;
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip", "Pixel Paula", "Byte Ben", "Turbo Tina", "Nano Nick", "Zack Zora", "Bit Bruno"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi" };
  const STOCKS = { 0: "Standard", 10: "Kurz", 20: "Mittel" }; // Standard: 30 cards, 20 from five players on
  const HAND = 5, PILES = 4, TOP = 12, WILD = 0;

  const normGoal = (n) => ([1, 2, 3].includes(+n) ? +n : 1);
  const normStock = (n) => (Object.prototype.hasOwnProperty.call(STOCKS, String(n)) ? +n : 0);
  const normLevel = (n) => (LEVELS[+n] ? +n : 2);
  const stockSize = (players, opt) => (opt ? opt : players <= 4 ? 30 : 20);
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);
  const cardName = (c) => (c === WILD ? "Skip-Bo" : String(c));
  const byValue = (a, b) => a - b; // jokers (0) first

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function makeDeck() {
    const d = [];
    for (let v = 1; v <= TOP; v++) for (let k = 0; k < 12; k++) d.push(v);
    for (let k = 0; k < 18; k++) d.push(WILD);
    return shuffle(d);
  }
  const fits = (card, pile) => card === WILD || card === pile.length + 1;
  const top = (arr) => arr[arr.length - 1];

  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 60) S.log.shift();
  }

  // players: [{ name, bot, avatar }]; goal: rounds to win; stock: 0 = standard, 10 / 20 = shorter; level: computer strength
  function newGame(players, goal, stock, level) {
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p, i) => ({ name: p.name, bot: !!p.bot, avatar: avatarOf(p, i), wins: 0, moves: 0, hand: [], stock: [], disc: [[], [], [], []] })),
      goal: normGoal(goal), stockOpt: normStock(stock), level: normLevel(level),
      round: 0, starter: 0, mv: 0, log: [], last: null
    };
    S.starter = rand(S.players.length);
    startRound(S, []);
    return S;
  }

  function startRound(S, events = []) {
    S.round++;
    S.phase = "play";
    S.last = null;
    S.log = [];
    S.deck = makeDeck();
    S.build = [[], [], [], []];
    S.done = [];
    S.turn = 0;
    S.tm = 0;
    S.stall = 0;
    const size = stockSize(S.players.length, S.stockOpt);
    for (const p of S.players) {
      p.moves = 0; p.hand = []; p.disc = [[], [], [], []];
      p.stock = S.deck.splice(S.deck.length - size, size);
    }
    const first = S.starter % S.players.length;
    S.starter = (S.starter + 1) % S.players.length;
    log(S, `Runde ${S.round}: ${S.players[first].name} beginnt.`);
    beginTurn(S, first, events);
  }

  function drawUp(S, pi, events) {
    const P = S.players[pi];
    let n = 0;
    while (P.hand.length < HAND) {
      if (!S.deck.length) {
        if (!S.done.length) break;
        S.deck = shuffle(S.done); S.done = [];
        events.push({ t: "reshuffle" });
        log(S, "Der Nachziehstapel ist leer und wird neu gemischt.");
      }
      P.hand.push(S.deck.pop()); n++;
    }
    P.hand.sort(byValue);
    if (n) events.push({ t: "draw", pi, n });
  }

  function beginTurn(S, pi, events) {
    S.cur = pi;
    S.turn++;
    S.tm = 0;
    drawUp(S, pi, events);
  }
  const nextPlayer = (S, pi) => (pi + 1) % S.players.length;

  function endRound(S, winner, events, how) {
    S.players[winner].wins++;
    const over = S.players[winner].wins >= S.goal;
    S.phase = "roundEnd";
    S.cur = -1;
    S.last = { winners: [winner], over, how: how || "stock", moves: S.players.reduce((n, p) => n + p.moves, 0), left: S.players.map((p) => p.stock.length) };
    log(S, `${S.players[winner].name} ${over ? "gewinnt das Spiel" : "gewinnt die Runde"}!`);
    events.push({ t: "end", winners: [winner] });
  }

  const fewestStock = (S, skip) => {
    const rest = S.players.map((p, i) => i).filter((i) => i !== skip);
    return rest.sort((x, y) => S.players[x].stock.length - S.players[y].stock.length)[0];
  };

  // Apply an action by player `pi`. Returns { ok, error?, events }. Actions:
  //   {t:"play", from:"hand"|"stock"|"disc", c:card, i:discard pile (disc only), to:build pile}
  //   {t:"discard", c:card, to:discard pile}   ends the turn
  //   {t:"pass"} (only with an empty hand)  {t:"skip"} (host)  {t:"giveup"}  {t:"next"}
  // The card value `c` is part of every move so a stale message can never play a different card.
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
    if (S.phase !== "play") return fail("Gerade ist niemand dran.");
    if (a.t === "skip") { // the host moves on when the current player is away
      if (S.cur === pi) return fail("Du bist selbst dran.");
      log(S, `${S.players[S.cur].name} wird übersprungen.`);
      events.push({ t: "skip", pi: S.cur });
      beginTurn(S, nextPlayer(S, S.cur), events);
      return ok();
    }
    if (a.t === "giveup") { // the one with the smallest stock among the others wins the round
      log(S, `${P.name} gibt auf.`);
      events.push({ t: "giveup", pi });
      endRound(S, fewestStock(S, pi), events, "giveup");
      return ok();
    }
    if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);

    if (a.t === "pass") {
      if (P.hand.length) return fail("Du musst eine Karte ablegen.");
      log(S, `${P.name} kann nichts mehr tun.`);
      events.push({ t: "pass", pi });
      S.stall++;
      if (S.stall >= S.players.length * 2) { endRound(S, fewestStock(S, -1), events, "stall"); return ok(); }
      beginTurn(S, nextPlayer(S, pi), events);
      return ok();
    }

    if (a.t === "play") {
      const from = a.from;
      if (from !== "hand" && from !== "stock" && from !== "disc") return fail("Unbekannte Quelle.");
      if (!Number.isInteger(a.to) || a.to < 0 || a.to >= PILES) return fail("Unbekannter Haufen.");
      if (!Number.isInteger(a.c) || a.c < 0 || a.c > TOP) return fail("Unbekannte Karte.");
      const card = a.c;
      let pile = null, k = -1;
      if (from === "hand") {
        k = P.hand.indexOf(card);
        if (k < 0) return fail(`Du hast keine ${cardName(card)} auf der Hand.`);
      } else if (from === "stock") {
        if (top(P.stock) !== card) return fail("Der Vorratsstapel zeigt eine andere Karte.");
      } else {
        if (!Number.isInteger(a.i) || a.i < 0 || a.i >= PILES) return fail("Unbekannter Ablagestapel.");
        pile = P.disc[a.i];
        if (top(pile) !== card) return fail("Dieser Ablagestapel zeigt eine andere Karte.");
      }
      const dest = S.build[a.to];
      if (!fits(card, dest)) return fail(`Auf Haufen ${a.to + 1} kommt jetzt die ${dest.length + 1}.`);

      if (from === "hand") P.hand.splice(k, 1);
      else if (from === "stock") P.stock.pop();
      else pile.pop();
      dest.push(card);
      const v = dest.length;
      P.moves++; S.tm++; S.stall = 0;
      events.push({ t: "play", pi, from, i: from === "disc" ? a.i : 0, c: card, to: a.to, v });
      log(S, `${P.name} legt ${card === WILD ? `Skip-Bo (als ${v})` : `die ${v}`} auf Haufen ${a.to + 1}${from === "stock" ? " (Vorrat)" : ""}.`);
      if (v === TOP) {
        S.done.push(...dest);
        S.build[a.to] = [];
        events.push({ t: "clear", to: a.to });
        log(S, `Haufen ${a.to + 1} ist voll.`);
      }
      if (from === "stock" && !P.stock.length) { endRound(S, pi, events); return ok(); }
      if (!P.hand.length) drawUp(S, pi, events); // an empty hand is refilled at once
      return ok();
    }

    if (a.t === "discard") {
      if (!Number.isInteger(a.to) || a.to < 0 || a.to >= PILES) return fail("Unbekannter Ablagestapel.");
      if (!Number.isInteger(a.c) || a.c < 0 || a.c > TOP) return fail("Unbekannte Karte.");
      const k = P.hand.indexOf(a.c);
      if (k < 0) return fail(`Du hast keine ${cardName(a.c)} auf der Hand.`);
      P.hand.splice(k, 1);
      P.disc[a.to].push(a.c);
      P.moves++; S.stall = 0;
      events.push({ t: "discard", pi, c: a.c, to: a.to });
      log(S, `${P.name} legt ${a.c === WILD ? "Skip-Bo" : `die ${a.c}`} ab.`);
      beginTurn(S, nextPlayer(S, pi), events);
      return ok();
    }
    return fail("Unbekannte Aktion.");
  }

  // ---------- computer player ----------
  // Everything the player could do right now: one entry per distinct source card and per distinct build pile length.
  function allPlays(S, P) {
    const srcs = [];
    if (P.stock.length) srcs.push({ from: "stock", c: top(P.stock), i: 0 });
    let prev = -1;
    for (const c of P.hand) { if (c !== prev) srcs.push({ from: "hand", c, i: 0 }); prev = c; }
    P.disc.forEach((d, i) => { if (d.length) srcs.push({ from: "disc", c: top(d), i }); });
    const plays = [];
    for (const s of srcs) {
      const seen = new Set();
      S.build.forEach((b, to) => {
        if (!fits(s.c, b) || seen.has(b.length)) return;
        seen.add(b.length);
        plays.push({ from: s.from, c: s.c, i: s.i, to });
      });
    }
    return plays;
  }
  const asAction = (p) => ({ t: "play", from: p.from, c: p.c, i: p.i, to: p.to });

  // Can the stock card be played after laying a few cards from the hand and discard piles? The first step of the cheapest plan.
  function findChain(S, P, maxWild) {
    const v = top(P.stock);
    if (v === undefined || v === WILD) return null;
    let best = null, nodes = 0;
    const seen = new Set();
    for (let b = 0; b < PILES; b++) {
      const n = S.build[b].length;
      if (seen.has(n)) continue;
      seen.add(n);
      if (n + 1 >= v) continue; // equal: playable at once, bigger: this pile is past it
      const hand = P.hand.slice(), disc = P.disc.map((d) => d.slice()), steps = [];
      const dfs = (r, wilds) => {
        if (++nodes > 4000) return;
        if (r === v) {
          const cost = wilds * 20 + steps.length;
          if (!best || cost < best.cost) best = { cost, step: steps[0] };
          return;
        }
        for (const c of r === 0 ? [] : [r, WILD]) {
          const isWild = c === WILD;
          if (isWild && wilds >= maxWild) continue;
          const hi = hand.indexOf(c);
          if (hi >= 0) {
            hand.splice(hi, 1); steps.push({ from: "hand", c, i: 0, to: b });
            dfs(r + 1, wilds + (isWild ? 1 : 0));
            steps.pop(); hand.splice(hi, 0, c);
          }
          for (let d = 0; d < PILES; d++) {
            if (top(disc[d]) !== c) continue;
            disc[d].pop(); steps.push({ from: "disc", c, i: d, to: b });
            dfs(r + 1, wilds + (isWild ? 1 : 0));
            steps.pop(); disc[d].push(c);
          }
        }
      };
      dfs(n + 1, 0);
    }
    return best ? best.step : null;
  }

  // how many opponents could play their stock card if this pile ended up at `len` cards (only when they are close to winning)
  function feeds(S, pi, len) {
    let n = 0;
    S.players.forEach((p, i) => {
      if (i === pi || !p.stock.length || p.stock.length > 8) return;
      if (top(p.stock) === len + 1) n++;
    });
    return n;
  }

  function placement(c, d, critLo, critHi) {
    if (!d.length) return (TOP - c) * 0.35 + 0.5;
    const t = top(d);
    let cost = d.length * 0.15;
    if (c === t) cost += 1;
    else if (c === t - 1) cost += 0;
    else if (c < t) cost += 0.6 * (t - 1 - c);
    else cost += 3 + (c - t) * 0.8;
    if (c !== t && t >= critLo && t <= critHi) cost += 6; // do not bury a card the stock card needs
    return cost;
  }

  function discardPick(S, P) {
    const piles = S.build.map((b) => b.length);
    const v = top(P.stock);
    let lo = 99, hi = -1;
    if (v > 0) {
      let gap = 99, g = -1;
      for (const n of piles) if (n + 1 < v && v - 1 - n < gap) { gap = v - 1 - n; g = n; }
      if (g >= 0) { lo = g + 1; hi = v - 1; }
    }
    let best = null;
    const tried = new Set();
    for (const c of P.hand) {
      if (tried.has(c)) continue;
      tried.add(c);
      let cost;
      if (c === WILD) cost = 60;
      else {
        let d = 12;
        for (const n of piles) if (c >= n + 1) d = Math.min(d, c - (n + 1));
        cost = (12 - d) * 0.9 + (13 - c) * 0.25;
        if (c >= lo && c <= hi) cost += 14;
        if (P.hand.filter((x) => x === c).length > 1) cost -= 2;
      }
      for (let j = 0; j < PILES; j++) {
        const total = cost + placement(c, P.disc[j], lo, hi);
        if (!best || total < best.total) best = { total, c, to: j };
      }
    }
    return best;
  }

  function botMove(S, pi) {
    if (S.phase !== "play" || S.cur !== pi) return null;
    const P = S.players[pi], level = S.level || 2;
    const plays = allPlays(S, P);
    if (!plays.length && !P.hand.length) return { t: "pass" };

    const discard = () => {
      if (level === 1) {
        const pool = P.hand.filter((c) => c !== WILD), cards = pool.length ? pool : P.hand;
        const c = cards[rand(cards.length)];
        const empty = P.disc.map((d, j) => j).filter((j) => !P.disc[j].length);
        return { t: "discard", c, to: empty.length && Math.random() < 0.5 ? empty[rand(empty.length)] : rand(PILES) };
      }
      const b = discardPick(S, P);
      return { t: "discard", c: b.c, to: b.to };
    };

    if (level === 1) {
      const sp = plays.filter((p) => p.from === "stock");
      if (sp.length && Math.random() < 0.85) return asAction(sp[0]);
      const rest = plays.filter((p) => p.from !== "stock" && (p.c !== WILD || Math.random() < 0.1));
      if (rest.length && Math.random() < 0.6) return asAction(rest[rand(rest.length)]);
      return P.hand.length ? discard() : { t: "pass" };
    }

    // 1. the stock card, whenever it fits (a joker on the pile that lets the next stock card follow)
    const sp = plays.filter((p) => p.from === "stock");
    if (sp.length) {
      let pick = sp[0];
      if (pick.c === WILD) {
        const next = P.stock.length > 1 ? P.stock[P.stock.length - 2] : null;
        const score = (p) => (next != null && (next === WILD || next === S.build[p.to].length + 2) ? 100 : 0) + S.build[p.to].length;
        pick = sp.slice().sort((x, y) => score(y) - score(x))[0];
      } else if (level === 3) pick = sp.slice().sort((x, y) => feeds(S, pi, S.build[x.to].length + 1) - feeds(S, pi, S.build[y.to].length + 1))[0];
      return asAction(pick);
    }
    // 2. cards that make the stock card playable
    const chain = findChain(S, P, level === 3 ? 2 : 1);
    if (chain) return asAction(chain);
    // 3. everything else that fits, jokers kept back
    let safe = plays.filter((p) => p.c !== WILD);
    if (level === 3) {
      const calm = safe.filter((p) => !feeds(S, pi, S.build[p.to].length + 1));
      if (calm.length) safe = calm;
      else if (safe.length && S.players.some((p, i) => i !== pi && p.stock.length <= 8)) safe = safe.filter((p) => !feeds(S, pi, S.build[p.to].length + 1));
    }
    if (safe.length) {
      const score = (p) => (p.from === "disc" ? 2 : 0) + (p.from === "hand" && P.hand.length === 1 ? 3 : 0) - p.c * 0.01;
      return asAction(safe.slice().sort((x, y) => score(y) - score(x))[0]);
    }
    // 4. a joker only when it ends the hand or lets another card follow
    const wilds = plays.filter((p) => p.c === WILD && p.from !== "stock");
    if (wilds.length) {
      const last = P.hand.length === 1 && wilds.find((p) => p.from === "hand");
      if (last) return asAction(last);
      if (level === 3) {
        const follows = (p) => {
          const want = S.build[p.to].length + 2;
          return top(P.stock) === want || P.hand.includes(want) || P.disc.some((d) => top(d) === want);
        };
        const good = wilds.filter(follows).sort((x, y) => S.build[y.to].length - S.build[x.to].length)[0];
        if (good) return asAction(good);
      }
    }
    return P.hand.length ? discard() : { t: "pass" };
  }

  // The next computer move, paced like a person: a pause per card, a little longer for the first look at the hand.
  function botPlan(S) {
    if (!S || S.phase !== "play" || !S.players[S.cur] || !S.players[S.cur].bot) return null;
    return { key: `bot:${S.round}:${S.mv}`, delay: 650 + Math.random() * 350 + (S.tm === 0 ? 450 : 0), pi: S.cur };
  }

  // What a player may see. The hands of the others stay hidden, everything on the table is public.
  function view(S, pi) {
    const me = S.players[pi] ? pi : -1;
    return {
      me, phase: S.phase, cur: S.cur, turn: S.turn, mv: S.mv, round: S.round, goal: S.goal, stockOpt: S.stockOpt, level: S.level || 2,
      build: S.build.map((b) => b.length), wild: S.build.map((b) => b.length > 0 && top(b) === WILD),
      deckN: S.deck.length, doneN: S.done.length,
      hand: me >= 0 ? S.players[me].hand.slice() : null,
      players: S.players.map((p, i) => ({
        name: p.name, bot: p.bot, avatar: avatarOf(p, i), wins: p.wins, moves: p.moves || 0,
        handN: p.hand.length, stockN: p.stock.length, stockTop: p.stock.length ? top(p.stock) : -1, disc: p.disc.map((d) => d.slice())
      })),
      log: S.log.slice(), last: S.last, nextStarter: S.starter % S.players.length
    };
  }

  return { MAX_PLAYERS, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, STOCKS, HAND, PILES, TOP, WILD, normGoal, normStock, normLevel, stockSize, fits, newGame, startRound, act, botMove, botPlan, view };
});
