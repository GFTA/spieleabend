// Monopoly engine. Pure state + rules, shared by the browser (single player) and the Node
// server (online). No DOM, no I/O. Own street names and card texts, classic rules (buy or auction,
// rent, building houses evenly, mortgages, jail, trades, bankruptcy) plus house rules the host sets
// in the waiting room (rules: goDouble, parking, auction, cash, limit).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MonopolyGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 6;
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip", "Pixel Paula", "Byte Ben", "Turbo Tina", "Nano Nick", "Zack Zora", "Bit Bruno"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi" };
  const CUR = "€";
  const money = (n) => CUR + n;
  const CASHES = { 1000: "€1000", 1500: "€1500", 2500: "€2500" };
  const LIMITS = { 0: "Ohne Limit", 20: "20 Züge", 40: "40 Züge", 60: "60 Züge" }; // turns per player, then the richest wins
  const RULE_DEFAULTS = { goDouble: true, parking: false, auction: true, cash: 1500, limit: 40 };
  const GO_PAY = 200, JAIL_FEE = 50, JAIL_POS = 10, HOUSES = 32, HOTELS = 12;

  const normGoal = (n) => ([1, 2, 3].includes(+n) ? +n : 1);
  const normLevel = (n) => (LEVELS[+n] ? +n : 2);
  const bool = (v, d) => (typeof v === "boolean" ? v : d);
  // bad values fall back to `base` (the room's current rules when the host changes one setting)
  function normRules(r, base) {
    r = r && typeof r === "object" ? r : {};
    const d = base || RULE_DEFAULTS;
    return {
      goDouble: bool(r.goDouble, d.goDouble), parking: bool(r.parking, d.parking), auction: bool(r.auction, d.auction),
      cash: CASHES[r.cash] && typeof r.cash === "number" ? r.cash : d.cash,
      limit: typeof r.limit === "number" && LIMITS[r.limit] != null ? r.limit : d.limit
    };
  }
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // ---------- the board ----------
  const GROUPS = [ // name, colour, house price
    ["Braun", "#8d5a2b", 50], ["Hellblau", "#7dd3fc", 50], ["Pink", "#f472b6", 100], ["Orange", "#fb923c", 100],
    ["Rot", "#ef4444", 150], ["Gelb", "#facc15", 150], ["Grün", "#22c55e", 200], ["Dunkelblau", "#3b5bdb", 200]
  ].map(([name, color, house]) => ({ name, color, house, m: [] }));
  const P = (n, g, p, r) => ({ n, k: "prop", g, p, r, h: GROUPS[g].house });
  const ST = (n) => ({ n, k: "station", p: 200 });
  const UT = (n) => ({ n, k: "util", p: 150 });
  const CH = { n: "Ereignis", k: "chance" }, CC = { n: "Gemeinschaft", k: "chest" };
  const BOARD = [
    { n: "Los", k: "go" }, P("Mühlenweg", 0, 60, [2, 10, 30, 90, 160, 250]), CC, P("Bäckergasse", 0, 60, [4, 20, 60, 180, 320, 450]),
    { n: "Einkommensteuer", k: "tax", t: 200 }, ST("Hauptbahnhof"), P("Birkenallee", 1, 100, [6, 30, 90, 270, 400, 550]), CH,
    P("Lindenstraße", 1, 100, [6, 30, 90, 270, 400, 550]), P("Rosenweg", 1, 120, [8, 40, 100, 300, 450, 600]),
    { n: "Gefängnis", k: "jail" }, P("Kastanienplatz", 2, 140, [10, 50, 150, 450, 625, 750]), UT("Stadtwerke"),
    P("Eichenring", 2, 140, [10, 50, 150, 450, 625, 750]), P("Ahornstieg", 2, 160, [12, 60, 180, 500, 700, 900]), ST("Nordbahnhof"),
    P("Hafenstraße", 3, 180, [14, 70, 200, 550, 750, 950]), CC, P("Werftgasse", 3, 180, [14, 70, 200, 550, 750, 950]),
    P("Kaianlage", 3, 200, [16, 80, 220, 600, 800, 1000]), { n: "Frei Parken", k: "park" },
    P("Marktplatz", 4, 220, [18, 90, 250, 700, 875, 1050]), CH, P("Rathausgasse", 4, 220, [18, 90, 250, 700, 875, 1050]),
    P("Schlossallee", 4, 240, [20, 100, 300, 750, 925, 1100]), ST("Ostbahnhof"), P("Seeblick", 5, 260, [22, 110, 330, 800, 975, 1150]),
    P("Uferpromenade", 5, 260, [22, 110, 330, 800, 975, 1150]), UT("Wasserwerk"), P("Gartenstadt", 5, 280, [24, 120, 360, 850, 1025, 1200]),
    { n: "Ab ins Gefängnis", k: "gojail" }, P("Bergstraße", 6, 300, [26, 130, 390, 900, 1100, 1275]),
    P("Gipfelweg", 6, 300, [26, 130, 390, 900, 1100, 1275]), CC, P("Almwiese", 6, 320, [28, 150, 450, 1000, 1200, 1400]), ST("Südbahnhof"), CH,
    P("Königsallee", 7, 350, [35, 175, 500, 1100, 1300, 1500]), { n: "Zusatzsteuer", k: "tax", t: 100 },
    P("Kaiserplatz", 7, 400, [50, 200, 600, 1400, 1700, 2000])
  ];
  BOARD.forEach((f, i) => { if (f.k === "prop") GROUPS[f.g].m.push(i); });
  const ownable = (i) => Number.isInteger(i) && i >= 0 && i < 40 && (BOARD[i].k === "prop" || BOARD[i].k === "station" || BOARD[i].k === "util");

  // m: bank pays you (negative: you pay), to: move there, near: next station/utility, back: steps back, all: players pay you (negative: you pay each),
  // rep: [per house, per hotel], jail, free
  const CARDS = {
    chance: [
      { text: "Rücke vor bis auf Los.", to: 0 },
      { text: "Fahre zum Hauptbahnhof. Kommst du über Los, ziehst du Gehalt ein.", to: 5 },
      { text: "Spaziere zum Kaiserplatz.", to: 39 },
      { text: "Rücke vor zur Hafenstraße.", to: 16 },
      { text: "Rücke vor zum Marktplatz.", to: 21 },
      { text: "Rücke zum nächsten Bahnhof vor und zahle dem Besitzer das Doppelte.", near: "station" },
      { text: "Rücke zum nächsten Bahnhof vor und zahle dem Besitzer das Doppelte.", near: "station" },
      { text: "Rücke zum nächsten Versorgungswerk vor. Gehört es jemandem, zahlst du das Zehnfache der Augenzahl.", near: "util" },
      { text: "Die Bank zahlt dir Dividende: €50.", m: 50 },
      { text: "Du kommst aus dem Gefängnis frei. Behalte die Karte.", free: 1 },
      { text: "Gehe drei Felder zurück.", back: 3 },
      { text: "Gehe in das Gefängnis. Gehe nicht über Los.", jail: 1 },
      { text: "Allgemeine Reparaturen: €25 je Haus, €100 je Hotel.", rep: [25, 100] },
      { text: "Strafe für zu schnelles Fahren: €15.", m: -15 },
      { text: "Du bist Vorsitzender des Spielevereins: zahle jedem Mitspieler €50.", all: -50 },
      { text: "Dein Bausparvertrag wird fällig: €150.", m: 150 }
    ],
    chest: [
      { text: "Bankirrtum zu deinen Gunsten: €200.", m: 200 },
      { text: "Arztrechnung: €50.", m: -50 },
      { text: "Du verkaufst alte Aktien: €50.", m: 50 },
      { text: "Du kommst aus dem Gefängnis frei. Behalte die Karte.", free: 1 },
      { text: "Gehe in das Gefängnis. Gehe nicht über Los.", jail: 1 },
      { text: "Du hast Geburtstag: jeder Mitspieler schenkt dir €25.", all: 25 },
      { text: "Deine Lebensversicherung wird fällig: €100.", m: 100 },
      { text: "Krankenhausgebühr: €100.", m: -100 },
      { text: "Schulgeld: €50.", m: -50 },
      { text: "Beratungshonorar: €25.", m: 25 },
      { text: "Straßenreparaturen: €40 je Haus, €115 je Hotel.", rep: [40, 115] },
      { text: "Du gewinnst den Backwettbewerb: €10.", m: 10 },
      { text: "Erbschaft: €100.", m: 100 },
      { text: "Steuerrückzahlung: €20.", m: 20 },
      { text: "Rücke vor zum Mühlenweg. Kommst du über Los, ziehst du Gehalt ein.", to: 1 },
      { text: "Flohmarkt: Du verkaufst Krimskrams für €30.", m: 30 }
    ]
  };
  const FREE_ID = { chance: CARDS.chance.findIndex((c) => c.free), chest: CARDS.chest.findIndex((c) => c.free) };

  // ---------- helpers ----------
  const active = (S) => S.players.map((p, i) => i).filter((i) => !S.players[i].out);
  const others = (S, pi) => active(S).filter((i) => i !== pi);
  const ownedBy = (S, pi) => S.props.map((p, i) => (p && p.owner === pi ? i : -1)).filter((i) => i >= 0);
  const ownsSet = (S, pi, g) => GROUPS[g].m.every((i) => S.props[i] && S.props[i].owner === pi);
  const setLevel = (S, g) => GROUPS[g].m.map((i) => S.props[i] ? S.props[i].houses : 0);
  const mortgageValue = (i) => BOARD[i].p / 2;
  const unmortgageCost = (i) => Math.ceil((BOARD[i].p / 2) * 1.1);
  const goAmount = (S) => (S.rules.goDouble ? GO_PAY * 2 : GO_PAY);
  function worth(S, pi) {
    let w = S.players[pi].cash;
    for (const i of ownedBy(S, pi)) { const pr = S.props[i]; w += pr.mort ? mortgageValue(i) : BOARD[i].p; if (BOARD[i].k === "prop") w += pr.houses * BOARD[i].h; }
    return w;
  }
  function actorOf(S) {
    if (S.phase !== "play") return -1;
    if (S.trade) return S.trade.to;
    if (S.auction) return S.auction.in[S.auction.turn];
    return S.cur;
  }
  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 60) S.log.shift();
  }

  function newGame(players, goal, rules, level) {
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p, i) => ({ name: p.name, bot: !!p.bot, avatar: avatarOf(p, i), wins: 0, cash: 0, pos: 0, jail: 0, cards: [], out: false, turns: 0 })),
      goal: normGoal(goal), rules: normRules(rules), level: normLevel(level),
      round: 0, starter: 0, log: [], last: null, seq: 0, pace: 0
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
    S.props = Array(40).fill(null);
    S.houses = HOUSES; S.hotels = HOTELS;
    S.pot = 0; S.turn = 1; S.dice = [0, 0]; S.doubles = 0;
    S.step = "roll"; S.buy = -1; S.auction = null; S.trade = null; S.debt = null; S.resume = null; S.refused = [];
    S.decks = { chance: shuffle(CARDS.chance.map((c, i) => i)), chest: shuffle(CARDS.chest.map((c, i) => i)) };
    S.players.forEach((p) => { p.cash = S.rules.cash; p.pos = 0; p.jail = 0; p.cards = []; p.out = false; p.turns = 0; });
    const first = S.starter % S.players.length;
    S.starter = (S.starter + 1) % S.players.length;
    S.cur = first;
    log(S, `Runde ${S.round}: ${S.players[first].name} beginnt.`);
  }

  function endRound(S, winner, reason, events) {
    S.players[winner].wins++;
    const over = S.players[winner].wins >= S.goal;
    S.phase = "roundEnd";
    S.cur = -1; S.step = "end"; S.buy = -1; S.auction = null; S.trade = null; S.debt = null; S.resume = null;
    S.last = { winners: [winner], over, reason, worths: S.players.map((p, i) => (p.out ? 0 : worth(S, i))), moves: S.turn };
    log(S, `${S.players[winner].name} ${over ? "gewinnt das Spiel" : "gewinnt die Runde"}!`);
    events.push({ t: "end", winners: [winner], reason });
  }

  function endTurn(S, events) {
    const P = S.players[S.cur];
    P.turns++;
    S.doubles = 0; S.resume = null;
    const act = active(S);
    if (S.rules.limit && act.every((i) => S.players[i].turns >= S.rules.limit)) {
      const best = act.slice().sort((x, y) => worth(S, y) - worth(S, x) || S.players[y].cash - S.players[x].cash)[0];
      log(S, `Zeitlimit erreicht: ${S.players[best].name} ist am reichsten.`);
      return endRound(S, best, "limit", events);
    }
    let n = S.cur;
    do n = (n + 1) % S.players.length; while (S.players[n].out);
    S.cur = n; S.turn++; S.step = "roll";
    events.push({ t: "turn", pi: n });
  }

  function afterLanding(S) {
    const P = S.players[S.cur];
    S.resume = null;
    S.step = S.doubles > 0 && P.jail === 0 && !P.out ? "roll" : "after";
  }

  // pay `amount` from pi to `to` (player index, -1 bank, "each" every other player). Fines and taxes feed the parking pot if that house rule is on.
  function transfer(S, pi, to, amount, why, events, extra) {
    const P = S.players[pi];
    P.cash -= amount;
    if (to === "each") {
      const o = others(S, pi), per = amount / o.length;
      o.forEach((j) => { S.players[j].cash += per; events.push({ t: "pay", from: pi, to: j, amount: per, why }); });
      return;
    }
    const ev = { t: "pay", from: pi, to, amount, why };
    if (extra) Object.assign(ev, extra);
    if (to >= 0) S.players[to].cash += amount;
    else if (S.rules.parking && (why === "tax" || why === "fine" || why === "jail")) { S.pot += amount; ev.pot = true; }
    events.push(ev);
  }
  // true when paid; otherwise the player is in debt and has to raise money (or give up)
  function charge(S, pi, to, amount, why, events, extra, resume) {
    if (amount <= 0) return true;
    if (S.players[pi].cash >= amount) { transfer(S, pi, to, amount, why, events, extra); return true; }
    S.debt = { pi, to, amount, why, ...(extra || {}) };
    S.step = "debt"; S.resume = resume || null;
    events.push({ t: "debt", pi, to, amount });
    return false;
  }
  function settleDebt(S, events) {
    const d = S.debt;
    if (!d || S.players[d.pi].cash < d.amount) return;
    S.debt = null;
    const { pi, to, amount, why, ...extra } = d;
    transfer(S, pi, to, amount, why, events, extra);
    resumeAfter(S, events);
  }
  function resumeAfter(S, events) {
    const r = S.resume;
    S.resume = null;
    if (r && r.move != null) { if (moveSteps(S, S.cur, r.move, events)) land(S, S.cur, events, {}); } else afterLanding(S);
  }

  // ---------- moving ----------
  function moveTo(S, pi, to, dir, events) {
    const P = S.players[pi], from = P.pos;
    const steps = dir > 0 ? (to - from + 40) % 40 : (from - to + 40) % 40;
    const passGo = dir > 0 && to < from && to !== 0;
    P.pos = to;
    events.push({ t: "move", pi, from, to, dir, steps, passGo: dir > 0 && to < from });
    if (dir > 0 && to === 0) {
      const amount = goAmount(S);
      P.cash += amount;
      events.push({ t: "pay", from: -1, to: pi, amount, why: "go", exact: true, bonus: amount > GO_PAY });
      log(S, `${P.name} landet auf Los und bekommt ${amount}.`);
    } else if (passGo) {
      P.cash += GO_PAY;
      events.push({ t: "pay", from: -1, to: pi, amount: GO_PAY, why: "go", exact: false });
      log(S, `${P.name} zieht über Los (+${GO_PAY}).`);
    }
  }
  function moveSteps(S, pi, steps, events) {
    moveTo(S, pi, (S.players[pi].pos + steps) % 40, 1, events);
    return true;
  }
  function goJail(S, pi, events, why) {
    const P = S.players[pi], from = P.pos;
    P.pos = JAIL_POS; P.jail = 1;
    S.doubles = 0; S.step = "after"; S.resume = null; S.buy = -1;
    events.push({ t: "jail", pi, from, why });
    log(S, `${P.name} geht ins Gefängnis${why === "speed" ? " (dreimal Pasch)" : ""}.`);
  }

  function rentFor(S, i, o) {
    const f = BOARD[i], pr = S.props[i], ow = pr.owner;
    if (f.k === "prop") return pr.houses > 0 ? f.r[pr.houses] : ownsSet(S, ow, f.g) ? f.r[0] * 2 : f.r[0];
    const n = ownedBy(S, ow).filter((j) => BOARD[j].k === f.k).length;
    if (f.k === "station") return 25 * 2 ** (n - 1) * (o && o.double ? 2 : 1);
    return (o && o.ten ? 10 : n >= 2 ? 10 : 4) * (S.dice[0] + S.dice[1]);
  }

  function land(S, pi, events, o) {
    const P = S.players[pi], f = BOARD[P.pos];
    if (f.k === "go" || f.k === "jail") return afterLanding(S);
    if (f.k === "park") {
      if (S.rules.parking && S.pot > 0) {
        const amount = S.pot; S.pot = 0; P.cash += amount;
        events.push({ t: "pay", from: -1, to: pi, amount, why: "parking", pot: true });
        log(S, `${P.name} kassiert den Jackpot von ${amount}.`);
      }
      return afterLanding(S);
    }
    if (f.k === "gojail") return goJail(S, pi, events, "field");
    if (f.k === "tax") {
      log(S, `${P.name} zahlt ${f.n} (${f.t}).`);
      if (charge(S, pi, -1, f.t, "tax", events, { idx: P.pos })) afterLanding(S);
      return;
    }
    if (f.k === "chance" || f.k === "chest") return drawCard(S, pi, f.k, events);
    const pr = S.props[P.pos];
    if (!pr) {
      if (P.cash >= f.p) { S.step = "buy"; S.buy = P.pos; events.push({ t: "offer", pi, idx: P.pos }); return; }
      if (S.rules.auction) return startAuction(S, P.pos, events);
      return afterLanding(S);
    }
    if (pr.owner === pi || pr.mort) return afterLanding(S);
    const rent = rentFor(S, P.pos, o);
    log(S, `${P.name} zahlt ${rent} Miete an ${S.players[pr.owner].name} (${f.n}).`);
    if (charge(S, pi, pr.owner, rent, "rent", events, { idx: P.pos })) afterLanding(S);
  }

  function drawCard(S, pi, deck, events) {
    const P = S.players[pi], id = S.decks[deck].shift(), c = CARDS[deck][id];
    if (c.free) P.cards.push(deck); else S.decks[deck].push(id);
    events.push({ t: "card", pi, deck, id });
    log(S, `${P.name} zieht: ${c.text}`);
    if (c.m != null) {
      if (c.m > 0) { P.cash += c.m; events.push({ t: "pay", from: -1, to: pi, amount: c.m, why: "card" }); } else if (!charge(S, pi, -1, -c.m, "fine", events)) return;
      return afterLanding(S);
    }
    if (c.to != null) { moveTo(S, pi, c.to, 1, events); return land(S, pi, events, {}); }
    if (c.near) {
      let to = P.pos;
      do to = (to + 1) % 40; while (BOARD[to].k !== c.near);
      moveTo(S, pi, to, 1, events);
      return land(S, pi, events, c.near === "station" ? { double: true } : { ten: true });
    }
    if (c.back) { moveTo(S, pi, (P.pos + 40 - c.back) % 40, -1, events); return land(S, pi, events, {}); }
    if (c.jail) return goJail(S, pi, events, "card");
    if (c.rep) {
      let h = 0, H = 0;
      for (const i of ownedBy(S, pi)) if (BOARD[i].k === "prop") { if (S.props[i].houses === 5) H++; else h += S.props[i].houses; }
      const cost = h * c.rep[0] + H * c.rep[1];
      if (cost > 0 && !charge(S, pi, -1, cost, "fine", events)) return;
      return afterLanding(S);
    }
    if (c.all > 0) {
      for (const j of others(S, pi)) {
        const amount = Math.min(c.all, S.players[j].cash);
        if (amount > 0) transfer(S, j, pi, amount, "card", events);
      }
      return afterLanding(S);
    }
    if (c.all < 0) {
      const total = -c.all * others(S, pi).length;
      if (total > 0 && !charge(S, pi, "each", total, "card", events)) return;
      return afterLanding(S);
    }
    afterLanding(S);
  }

  // ---------- auction ----------
  function startAuction(S, idx, events) {
    const act = active(S), at = act.indexOf(S.cur);
    S.auction = { idx, bid: 0, who: -1, in: act.slice(at + 1).concat(act.slice(0, at + 1)), turn: 0 };
    S.step = "auction"; S.buy = -1;
    events.push({ t: "auction", idx });
    log(S, `Versteigerung: ${BOARD[idx].n}.`);
  }
  function auctionDone(S, events) {
    const A = S.auction;
    if (A.in.length === 0 || (A.in.length === 1 && A.who === A.in[0])) {
      S.auction = null;
      if (A.who >= 0) {
        S.players[A.who].cash -= A.bid;
        S.props[A.idx] = { owner: A.who, mort: 0, houses: 0 };
        events.push({ t: "pay", from: A.who, to: -1, amount: A.bid, why: "auction", idx: A.idx });
        events.push({ t: "buy", pi: A.who, idx: A.idx, auction: true });
        log(S, `${S.players[A.who].name} ersteigert ${BOARD[A.idx].n} für ${A.bid}.`);
      } else {
        events.push({ t: "auctionEnd", idx: A.idx });
        log(S, `${BOARD[A.idx].n} findet keinen Käufer.`);
      }
      afterLanding(S);
    }
  }

  // ---------- managing property (also used by the browser on the public view to enable buttons) ----------
  const levelsOf = (S, g) => GROUPS[g].m.map((i) => S.props[i].houses);
  function buildError(S, pi, idx) {
    if (!ownable(idx) || BOARD[idx].k !== "prop") return "Hier kann man nicht bauen.";
    const pr = S.props[idx], f = BOARD[idx];
    if (!pr || pr.owner !== pi) return "Das Grundstück gehört dir nicht.";
    if (!ownsSet(S, pi, f.g)) return "Dir gehört nicht die ganze Farbgruppe.";
    if (GROUPS[f.g].m.some((i) => S.props[i].mort)) return "In der Gruppe liegt eine Hypothek.";
    if (pr.houses >= 5) return "Hier steht schon ein Hotel.";
    if (pr.houses > Math.min(...levelsOf(S, f.g))) return "Baue gleichmäßig: erst die anderen Straßen der Gruppe.";
    if (S.players[pi].cash < f.h) return "Zu wenig Geld.";
    if (pr.houses < 4 ? S.houses < 1 : S.hotels < 1) return pr.houses < 4 ? "Die Bank hat keine Häuser mehr." : "Die Bank hat keine Hotels mehr.";
    return null;
  }
  function sellError(S, pi, idx) {
    if (!ownable(idx) || BOARD[idx].k !== "prop") return "Hier steht nichts zum Verkaufen.";
    const pr = S.props[idx], f = BOARD[idx];
    if (!pr || pr.owner !== pi) return "Das Grundstück gehört dir nicht.";
    if (pr.houses < 1) return "Hier steht kein Haus.";
    if (pr.houses < Math.max(...levelsOf(S, f.g))) return "Verkaufe gleichmäßig: erst bei den höchsten Straßen.";
    if (pr.houses === 5 && S.houses < 4) return "Die Bank hat nicht genug Häuser für den Rückbau.";
    return null;
  }
  function mortError(S, pi, idx) {
    if (!ownable(idx)) return "Das kann man nicht beleihen.";
    const pr = S.props[idx], f = BOARD[idx];
    if (!pr || pr.owner !== pi) return "Das Grundstück gehört dir nicht.";
    if (pr.mort) return "Schon beliehen.";
    if (f.k === "prop" && GROUPS[f.g].m.some((i) => S.props[i] && S.props[i].houses > 0)) return "Erst alle Häuser der Gruppe verkaufen.";
    return null;
  }
  function unmortError(S, pi, idx) {
    if (!ownable(idx)) return "Das kann man nicht auslösen.";
    const pr = S.props[idx];
    if (!pr || pr.owner !== pi) return "Das Grundstück gehört dir nicht.";
    if (!pr.mort) return "Keine Hypothek.";
    if (S.players[pi].cash < unmortgageCost(idx)) return "Zu wenig Geld.";
    return null;
  }

  // ---------- trades ----------
  function cleanSide(x) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const cash = x.cash == null ? 0 : x.cash, props = x.props == null ? [] : x.props, card = x.card == null ? 0 : x.card;
    if (!Number.isInteger(cash) || cash < 0 || cash > 100000) return null;
    if (!Array.isArray(props) || props.length > 28 || !props.every((i) => ownable(i)) || new Set(props).size !== props.length) return null;
    if (card !== 0 && card !== 1) return null;
    return { cash, props: props.slice().sort((a, b) => a - b), card };
  }
  function sideError(S, pi, s) {
    const P = S.players[pi];
    if (s.cash > P.cash) return `${P.name} hat nicht so viel Geld.`;
    if (s.card > P.cards.length) return `${P.name} hat keine Freikarte.`;
    for (const i of s.props) {
      const pr = S.props[i];
      if (!pr || pr.owner !== pi) return `${BOARD[i].n} gehört ${P.name} nicht.`;
      if (BOARD[i].k === "prop" && GROUPS[BOARD[i].g].m.some((j) => S.props[j] && S.props[j].houses > 0)) return `In der Gruppe von ${BOARD[i].n} stehen Häuser. Erst verkaufen.`;
    }
    return null;
  }
  function tradeError(S, from, to, give, take) {
    if (!give.cash && !give.props.length && !give.card && !take.cash && !take.props.length && !take.card) return "Das Angebot ist leer.";
    return sideError(S, from, give) || sideError(S, to, take);
  }
  function doTrade(S, T, events) {
    const A = S.players[T.from], B = S.players[T.to];
    A.cash += T.take.cash - T.give.cash; B.cash += T.give.cash - T.take.cash;
    for (const i of T.give.props) S.props[i].owner = T.to;
    for (const i of T.take.props) S.props[i].owner = T.from;
    if (T.give.card) B.cards.push(A.cards.pop());
    if (T.take.card) A.cards.push(B.cards.pop());
    events.push({ t: "tradeDone", from: T.from, to: T.to, give: T.give, take: T.take });
    log(S, `${A.name} und ${B.name} tauschen.`);
  }

  // ---------- bankruptcy ----------
  function bankrupt(S, pi, events) {
    const P = S.players[pi], to = S.debt && typeof S.debt.to === "number" ? S.debt.to : -1;
    P.out = true;
    for (const i of ownedBy(S, pi)) {
      const pr = S.props[i];
      if (BOARD[i].k === "prop" && pr.houses) { if (pr.houses === 5) S.hotels++; else S.houses += pr.houses; }
      if (to >= 0) S.props[i] = { owner: to, mort: pr.mort, houses: 0 }; else S.props[i] = null;
    }
    for (const deck of P.cards) { if (to >= 0) S.players[to].cards.push(deck); else S.decks[deck].push(FREE_ID[deck]); }
    if (to >= 0) S.players[to].cash += P.cash;
    events.push({ t: "bankrupt", pi, to });
    log(S, `${P.name} ist pleite${to >= 0 ? ` – alles geht an ${S.players[to].name}` : ""}.`);
    P.cash = 0; P.cards = []; P.jail = 0;
    S.debt = null; S.resume = null; S.step = "after";
    const left = active(S);
    if (left.length === 1) return endRound(S, left[0], "last", events);
    endTurn(S, events);
  }

  // ---------- actions ----------
  const wait = (S) => { const a = actorOf(S); return S.players[a] ? `${S.players[a].name} ist dran.` : "Gerade ist niemand dran."; };
  const myTurn = (S, pi, steps) => (S.cur === pi && !S.trade && steps.includes(S.step) ? null : wait(S));
  const pay = (S, from, to, amount, why, events, extra) => { // bank <-> player, no checks
    if (from >= 0) S.players[from].cash -= amount;
    if (to >= 0) S.players[to].cash += amount;
    events.push({ t: "pay", from, to, amount, why, ...(extra || {}) });
  };

  const refuse = (S, T) => { S.refused.push(`${T.from}:${T.take.props.join(",")}`); if (S.refused.length > 40) S.refused.shift(); };

  const ACTIONS = {
    roll(S, pi, a, ev) {
      const bad = myTurn(S, pi, ["roll"]);
      if (bad) return bad;
      const P = S.players[pi], d1 = 1 + rand(6), d2 = 1 + rand(6), dbl = d1 === d2, sum = d1 + d2;
      S.dice = [d1, d2];
      if (P.jail > 0) {
        ev.push({ t: "roll", pi, d: [d1, d2], doubles: 0 });
        if (dbl) {
          P.jail = 0; S.doubles = 0;
          ev.push({ t: "jailOut", pi, how: "doubles" });
          log(S, `${P.name} würfelt einen Pasch und kommt frei.`);
        } else if (P.jail < 3) {
          P.jail++;
          log(S, `${P.name} würfelt ${sum} und bleibt im Gefängnis.`);
          S.step = "after";
          return;
        } else {
          P.jail = 0;
          ev.push({ t: "jailOut", pi, how: "fee" });
          log(S, `${P.name} muss ${JAIL_FEE} zahlen und kommt frei.`);
          if (!charge(S, pi, -1, JAIL_FEE, "jail", ev, null, { move: sum })) return;
        }
        moveSteps(S, pi, sum, ev);
        return land(S, pi, ev, {});
      }
      S.doubles = dbl ? S.doubles + 1 : 0;
      ev.push({ t: "roll", pi, d: [d1, d2], doubles: S.doubles });
      if (S.doubles === 3) return goJail(S, pi, ev, "speed");
      log(S, `${P.name} würfelt ${d1} + ${d2}${dbl ? " (Pasch)" : ""}.`);
      moveSteps(S, pi, sum, ev);
      land(S, pi, ev, {});
    },
    payJail(S, pi, a, ev) {
      const bad = myTurn(S, pi, ["roll"]);
      if (bad) return bad;
      const P = S.players[pi];
      if (P.jail < 1) return "Du bist nicht im Gefängnis.";
      if (P.cash < JAIL_FEE) return "Zu wenig Geld.";
      P.jail = 0;
      transfer(S, pi, -1, JAIL_FEE, "jail", ev);
      ev.push({ t: "jailOut", pi, how: "pay" });
      log(S, `${P.name} zahlt ${JAIL_FEE} und kommt frei.`);
    },
    useCard(S, pi, a, ev) {
      const bad = myTurn(S, pi, ["roll"]);
      if (bad) return bad;
      const P = S.players[pi];
      if (P.jail < 1) return "Du bist nicht im Gefängnis.";
      if (!P.cards.length) return "Du hast keine Freikarte.";
      const deck = P.cards.pop();
      S.decks[deck].push(FREE_ID[deck]);
      P.jail = 0;
      ev.push({ t: "jailOut", pi, how: "card" });
      log(S, `${P.name} kommt mit der Freikarte frei.`);
    },
    buy(S, pi, a, ev) {
      if (S.step !== "buy" || S.cur !== pi) return wait(S);
      const P = S.players[pi], idx = S.buy, price = BOARD[idx].p;
      if (P.cash < price) return "Zu wenig Geld.";
      S.props[idx] = { owner: pi, mort: 0, houses: 0 };
      S.buy = -1;
      pay(S, pi, -1, price, "buy", ev, { idx });
      ev.push({ t: "buy", pi, idx });
      log(S, `${P.name} kauft ${BOARD[idx].n} für ${price}.`);
      afterLanding(S);
    },
    decline(S, pi, a, ev) {
      if (S.step !== "buy" || S.cur !== pi) return wait(S);
      const idx = S.buy;
      S.buy = -1;
      ev.push({ t: "decline", pi, idx });
      if (S.rules.auction) startAuction(S, idx, ev); else afterLanding(S);
    },
    bid(S, pi, a, ev) {
      const A = S.auction;
      if (!A || actorOf(S) !== pi) return wait(S);
      const amount = a.amount;
      if (!Number.isInteger(amount) || amount <= A.bid) return "Biete mehr als das Höchstgebot.";
      if (amount > S.players[pi].cash) return "Zu wenig Geld.";
      A.bid = amount; A.who = pi; A.turn = (A.turn + 1) % A.in.length;
      ev.push({ t: "bid", pi, amount });
      auctionDone(S, ev);
    },
    pass(S, pi, a, ev) {
      const A = S.auction;
      if (!A || actorOf(S) !== pi) return wait(S);
      A.in.splice(A.turn, 1);
      if (A.in.length) A.turn %= A.in.length; else A.turn = 0;
      ev.push({ t: "pass", pi });
      auctionDone(S, ev);
    },
    build(S, pi, a, ev) {
      const bad = myTurn(S, pi, ["roll", "after"]) || buildError(S, pi, a.idx);
      if (bad) return bad;
      const pr = S.props[a.idx], cost = BOARD[a.idx].h;
      pr.houses++;
      if (pr.houses === 5) { S.hotels--; S.houses += 4; } else S.houses--;
      pay(S, pi, -1, cost, "build", ev, { idx: a.idx });
      ev.push({ t: "build", pi, idx: a.idx, level: pr.houses });
      log(S, `${S.players[pi].name} baut auf ${BOARD[a.idx].n} ${pr.houses === 5 ? "ein Hotel" : "ein Haus"}.`);
    },
    sell(S, pi, a, ev) {
      const bad = (S.cur === pi && !S.trade && ["roll", "after", "debt"].includes(S.step) ? null : wait(S)) || sellError(S, pi, a.idx);
      if (bad) return bad;
      const pr = S.props[a.idx], back = BOARD[a.idx].h / 2;
      if (pr.houses === 5) { S.hotels++; S.houses -= 4; } else S.houses++;
      pr.houses--;
      pay(S, -1, pi, back, "sell", ev, { idx: a.idx });
      ev.push({ t: "sell", pi, idx: a.idx, level: pr.houses });
      log(S, `${S.players[pi].name} verkauft ein Haus auf ${BOARD[a.idx].n}.`);
      if (S.step === "debt") settleDebt(S, ev);
    },
    mortgage(S, pi, a, ev) {
      const bad = (S.cur === pi && !S.trade && ["roll", "after", "debt"].includes(S.step) ? null : wait(S)) || mortError(S, pi, a.idx);
      if (bad) return bad;
      S.props[a.idx].mort = 1;
      pay(S, -1, pi, mortgageValue(a.idx), "mortgage", ev, { idx: a.idx });
      ev.push({ t: "mortgage", pi, idx: a.idx, on: 1 });
      log(S, `${S.players[pi].name} beleiht ${BOARD[a.idx].n}.`);
      if (S.step === "debt") settleDebt(S, ev);
    },
    unmortgage(S, pi, a, ev) {
      const bad = myTurn(S, pi, ["roll", "after"]) || unmortError(S, pi, a.idx);
      if (bad) return bad;
      S.props[a.idx].mort = 0;
      pay(S, pi, -1, unmortgageCost(a.idx), "unmortgage", ev, { idx: a.idx });
      ev.push({ t: "mortgage", pi, idx: a.idx, on: 0 });
      log(S, `${S.players[pi].name} löst ${BOARD[a.idx].n} aus.`);
    },
    end(S, pi, a, ev) {
      const bad = myTurn(S, pi, ["after"]);
      if (bad) return bad;
      endTurn(S, ev);
    },
    bankrupt(S, pi, a, ev) {
      if (S.step !== "debt" || S.cur !== pi || S.trade) return "Du bist nicht verschuldet.";
      bankrupt(S, pi, ev);
    },
    trade(S, pi, a, ev) {
      const bad = myTurn(S, pi, ["roll", "after"]);
      if (bad) return bad;
      const to = a.to;
      if (!Number.isInteger(to) || to === pi || !S.players[to] || S.players[to].out) return "Ungültiger Tauschpartner.";
      const give = cleanSide(a.give), take = cleanSide(a.take);
      if (!give || !take) return "Ungültiges Angebot.";
      const err = tradeError(S, pi, to, give, take);
      if (err) return err;
      S.trade = { from: pi, to, give, take };
      ev.push({ t: "tradeOffer", from: pi, to });
      log(S, `${S.players[pi].name} macht ${S.players[to].name} ein Tauschangebot.`);
    },
    accept(S, pi, a, ev) {
      const T = S.trade;
      if (!T || T.to !== pi) return "Kein Angebot an dich.";
      const err = tradeError(S, T.from, T.to, T.give, T.take);
      if (err) return err;
      S.trade = null;
      doTrade(S, T, ev);
    },
    reject(S, pi, a, ev) {
      const T = S.trade;
      if (!T || T.to !== pi) return "Kein Angebot an dich.";
      S.trade = null;
      refuse(S, T);
      ev.push({ t: "tradeNo", from: T.from, to: T.to });
      log(S, `${S.players[pi].name} lehnt ab.`);
    },
    cancel(S, pi, a, ev) {
      const T = S.trade;
      if (!T || T.from !== pi) return "Du hast kein Angebot offen.";
      S.trade = null;
      refuse(S, T);
      ev.push({ t: "tradeNo", from: T.from, to: T.to, cancelled: true });
    }
  };

  const EVENT_MS = { roll: 1100, jail: 1500, card: 1900, tradeDone: 900, bankrupt: 1600, end: 0 };
  function paceOf(events) {
    let ms = 0;
    for (const e of events) {
      if (e.t === "move") ms += 240 * e.steps + 250;
      else if (e.t === "pay") ms += e.why === "go" ? 1500 : 500;
      else ms += has(EVENT_MS, e.t) ? EVENT_MS[e.t] : 350;
    }
    return ms;
  }

  // Apply an action by player `pi`. Returns { ok, error?, events }.
  // Actions: roll payJail useCard buy decline bid{amount} pass build{idx} sell{idx} mortgage{idx} unmortgage{idx} end bankrupt
  //          trade{to,give:{cash,props,card},take:{...}} accept reject cancel skip next
  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events: [] });
    const P = Number.isInteger(pi) ? S.players[pi] : null;
    if (!P) return fail("Unbekannter Spieler.");
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
      if (S.last && S.last.over) { S.players.forEach((p) => { p.wins = 0; }); S.round = 0; }
      startRound(S);
      S.seq++;
      return { ok: true, events };
    }
    if (S.phase !== "play") return fail("Gerade ist niemand dran.");
    if (a.t === "skip") { // the host moves on when the actor is away: the computer plays their move
      const who = actorOf(S), m = botMove(S, who);
      if (!m) return fail("Gerade nicht möglich.");
      const res = act(S, who, m);
      if (res.ok) log(S, `${S.players[who].name} wurde übersprungen.`);
      return res;
    }
    if (!has(ACTIONS, a.t)) return fail("Unbekannte Aktion.");
    if (P.out) return fail("Du bist ausgeschieden.");
    const err = ACTIONS[a.t](S, pi, a, events);
    if (err) return fail(err);
    S.seq++;
    S.pace = paceOf(events);
    return { ok: true, events };
  }

  // ---------- computer player ----------
  const round10 = (n) => Math.max(10, Math.round(n / 10) * 10);
  const reserveOf = (lv) => (lv === 1 ? 300 : lv === 2 ? 200 : 150);
  // would owning idx complete a colour set for pi? does an opponent own the rest of its group?
  function completes(S, pi, idx) {
    const f = BOARD[idx];
    return f.k === "prop" && GROUPS[f.g].m.every((i) => i === idx || (S.props[i] && S.props[i].owner === pi));
  }
  function blocks(S, idx) {
    const f = BOARD[idx];
    if (f.k !== "prop") return false;
    const rest = GROUPS[f.g].m.filter((i) => i !== idx), o = S.props[rest[0]] && S.props[rest[0]].owner;
    return o != null && rest.every((i) => S.props[i] && S.props[i].owner === o);
  }
  function botAuction(S, pi) {
    const A = S.auction, me = S.players[pi], lv = S.level || 2, price = BOARD[A.idx].p;
    let limit = price * (lv === 1 ? 0.75 : lv === 2 ? 1 : 1.15);
    if (lv > 1 && completes(S, pi, A.idx)) limit = price * 1.7;
    if (lv === 3 && blocks(S, A.idx)) limit = Math.max(limit, price * 1.4);
    limit = Math.min(Math.floor(limit / 10) * 10, me.cash - 20);
    const next = A.bid === 0 ? round10(price * 0.4) : A.bid + round10(price * 0.1);
    return next <= limit && next <= me.cash ? { t: "bid", amount: next } : { t: "pass" };
  }
  function botBuy(S, pi) {
    const me = S.players[pi], lv = S.level || 2, idx = S.buy, price = BOARD[idx].p;
    const left = me.cash - price, reserve = lv === 1 ? 50 : lv === 2 ? 120 : 60;
    if (lv === 1 && Math.random() < 0.3) return { t: "decline" };
    return left >= reserve || (completes(S, pi, idx) && left >= 10) ? { t: "buy" } : { t: "decline" };
  }
  function botDebt(S, pi) {
    const me = S.players[pi], need = S.debt.amount - me.cash, mine = ownedBy(S, pi);
    let potential = 0;
    for (const i of mine) { const pr = S.props[i]; if (!pr.mort) potential += mortgageValue(i); if (BOARD[i].k === "prop") potential += pr.houses * (BOARD[i].h / 2); }
    if (potential < need) return { t: "bankrupt" };
    const full = (i) => BOARD[i].k === "prop" && ownsSet(S, pi, BOARD[i].g);
    const mort = mine.filter((i) => !mortError(S, pi, i)).sort((x, y) => full(x) - full(y) || BOARD[x].p - BOARD[y].p);
    if (mort.length) return { t: "mortgage", idx: mort[0] };
    const sell = mine.filter((i) => !sellError(S, pi, i)).sort((x, y) => BOARD[x].h - BOARD[y].h);
    if (sell.length) return { t: "sell", idx: sell[0] };
    return { t: "bankrupt" };
  }
  function sideValue(S, pi, side, receiving) {
    let v = side.cash + (side.card ? 50 : 0);
    for (const i of side.props) {
      v += S.props[i].mort ? mortgageValue(i) : BOARD[i].p;
      if (receiving ? completes(S, pi, i) : false) v += 250;
    }
    return v;
  }
  function botTradeOk(S, pi) {
    const T = S.trade, lv = S.level || 2;
    if (tradeError(S, T.from, T.to, T.give, T.take)) return false;
    const got = sideValue(S, pi, T.give, true);
    let lose = sideValue(S, pi, T.take, false);
    for (const i of T.take.props) {
      if (BOARD[i].k !== "prop") continue;
      if (ownsSet(S, pi, BOARD[i].g)) lose += 400; // breaks our own set
      else if (completes(S, T.from, i) || T.give.props.length === 0 && blocks(S, i)) lose += 300; // helps them to a set
    }
    return got >= lose * (lv === 1 ? 0.9 : lv === 2 ? 1.15 : 1.3);
  }
  function botManage(S, pi) {
    const me = S.players[pi], lv = S.level || 2, reserve = reserveOf(lv);
    const mort = ownedBy(S, pi).filter((i) => S.props[i].mort && me.cash - unmortgageCost(i) >= reserve + 100).sort((x, y) => BOARD[y].p - BOARD[x].p);
    if (mort.length) return { t: "unmortgage", idx: mort[0] };
    const can = ownedBy(S, pi).filter((i) => BOARD[i].k === "prop" && !buildError(S, pi, i) && me.cash - BOARD[i].h >= reserve);
    if (can.length) {
      can.sort((x, y) => S.props[x].houses - S.props[y].houses || BOARD[y].g - BOARD[x].g);
      return { t: "build", idx: can[0] };
    }
    return null;
  }
  // offer money for the one street that is missing to a colour set
  function botTrade(S, pi) {
    const me = S.players[pi];
    for (let idx = 0; idx < 40; idx++) {
      const pr = S.props[idx];
      if (BOARD[idx].k !== "prop" || !pr || pr.owner === pi || pr.mort || !completes(S, pi, idx) || S.refused.includes(`${pi}:${idx}`)) continue;
      const amount = round10((BOARD[idx].p + 300) * 1.25);
      if (me.cash - amount >= 100) return { t: "trade", to: pr.owner, give: { cash: amount }, take: { props: [idx] } };
    }
    return null;
  }
  // The computer's next move for `pi` when it is that player's turn to act (also in auctions and trade offers), or null.
  function botMove(S, pi) {
    if (S.phase !== "play" || actorOf(S) !== pi) return null;
    const me = S.players[pi], lv = S.level || 2;
    if (S.trade) return { t: botTradeOk(S, pi) ? "accept" : "reject" };
    if (S.auction) return botAuction(S, pi);
    if (S.step === "buy") return botBuy(S, pi);
    if (S.step === "debt") return botDebt(S, pi);
    if (me.jail > 0 && S.step === "roll") {
      if (me.cards.length) return { t: "useCard" };
      const free = S.props.filter((p, i) => ownable(i) && !p).length;
      if (me.cash >= JAIL_FEE + 300 && ((lv === 3 && free >= 6) || (lv === 2 && me.jail >= 2 && free >= 6))) return { t: "payJail" };
    }
    const m = botManage(S, pi) || (lv > 1 && S.step === "roll" && me.jail === 0 ? botTrade(S, pi) : null);
    if (m) return m;
    return S.step === "roll" ? { t: "roll" } : { t: "end" };
  }
  // When and who: the server and the single-player page both ask this, `key` changes whenever the plan does.
  function botPlan(S) {
    const who = actorOf(S);
    if (who < 0 || !S.players[who].bot) return null;
    return { pi: who, delay: Math.max(800, S.pace || 0), key: `m${S.seq}` };
  }

  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
  // Everything on the table is public; pi only marks who "me" is. The shape is the same as the state's for
  // the parts the helpers (buildError, rentFor, worth, ...) need, so the page can call them on a view.
  function view(S, pi) {
    const me = S.players[pi] ? pi : -1;
    return {
      me, phase: S.phase, cur: S.cur, actor: actorOf(S), step: S.step, turn: S.turn, round: S.round, goal: S.goal, level: S.level || 2,
      rules: { ...S.rules }, dice: S.dice.slice(), doubles: S.doubles, pot: S.pot, houses: S.houses, hotels: S.hotels, buy: S.buy,
      props: S.props.map((p) => p && { ...p }), auction: clone(S.auction), trade: clone(S.trade), debt: clone(S.debt),
      players: S.players.map((p, i) => ({ name: p.name, bot: p.bot, avatar: avatarOf(p, i), wins: p.wins, cash: p.cash, pos: p.pos, jail: p.jail, cards: p.cards.slice(), out: p.out, turns: p.turns })),
      log: S.log.slice(), last: S.last, nextStarter: S.starter % S.players.length
    };
  }

  return {
    MAX_PLAYERS, CUR, money, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, CASHES, LIMITS, RULE_DEFAULTS, GO_PAY, JAIL_FEE, BOARD, GROUPS, CARDS,
    normGoal, normLevel, normRules, newGame, startRound, act, botMove, botPlan, view,
    actorOf, worth, rentFor, ownsSet, ownedBy, active, mortgageValue, unmortgageCost,
    buildError, sellError, mortError, unmortError, cleanSide, tradeError
  };
});
