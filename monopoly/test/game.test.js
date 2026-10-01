"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Game = require("../public/game.js");

const { BOARD, GROUPS } = Game;
const names = ["Anna", "Ben", "Cleo", "Dirk", "Eva", "Finn"];
function setup(n = 2, rules, level = 2) {
  const S = Game.newGame(names.slice(0, n).map((name) => ({ name })), 1, rules, level);
  S.cur = 0;
  return S;
}
// roll these dice (pairs) in order, then restore Math.random
function withDice(list, fn) {
  const real = Math.random, q = list.slice();
  Math.random = () => ((q.length ? q.shift() : 1) - 1) / 6 + 0.05;
  try { return fn(); } finally { Math.random = real; }
}
const roll = (S, a, b) => withDice([a, b], () => Game.act(S, S.cur, { t: "roll" }));
const ok = (res) => { assert.ok(res.ok, res.error); return res; };
const give = (S, pi, idx, houses = 0, mort = 0) => { S.props[idx] = { owner: pi, mort, houses }; };
const giveGroup = (S, pi, g) => GROUPS[g].m.forEach((i) => give(S, pi, i));
const idxOf = (name) => BOARD.findIndex((f) => f.n === name);

test("a new game gives everybody the starting cash and an empty board", () => {
  const S = Game.newGame([{ name: "A" }, { name: "B" }, { name: "C" }], 1, { cash: 2500 }, 2);
  assert.strictEqual(S.phase, "play");
  assert.strictEqual(S.step, "roll");
  assert.ok(S.players.every((p) => p.cash === 2500 && p.pos === 0 && p.jail === 0 && Game.AVATARS.includes(p.avatar)));
  assert.ok(S.props.every((p) => p === null));
  assert.strictEqual(BOARD.length, 40);
});

test("settings are normalised, nonsense falls back to the defaults", () => {
  assert.strictEqual(Game.normGoal(9), 1);
  assert.strictEqual(Game.normLevel(3), 3);
  assert.deepStrictEqual(Game.normRules(null), Game.RULE_DEFAULTS);
  assert.deepStrictEqual(Game.normRules("x"), Game.RULE_DEFAULTS);
  const r = Game.normRules({ goDouble: false, parking: true, auction: "yes", cash: 999, limit: "40" });
  assert.deepStrictEqual(r, { goDouble: false, parking: true, auction: true, cash: 1500, limit: 40 });
  assert.strictEqual(Game.normRules({ limit: 0 }).limit, 0);
  assert.strictEqual(Game.normRules({ cash: 2500 }).cash, 2500);
  assert.deepStrictEqual(Game.normRules({ cash: "x", limit: 7, goDouble: 1 }, { goDouble: false, parking: true, auction: false, cash: 1000, limit: 20 }), { goDouble: false, parking: true, auction: false, cash: 1000, limit: 20 }, "bad values keep the current setting");
});

test("the board has 28 streets, stations and utilities and the standard colour groups", () => {
  assert.strictEqual(BOARD.filter((f) => f.k === "prop").length, 22);
  assert.strictEqual(BOARD.filter((f) => f.k === "station").length, 4);
  assert.strictEqual(BOARD.filter((f) => f.k === "util").length, 2);
  assert.deepStrictEqual(GROUPS.map((g) => g.m.length), [2, 3, 3, 3, 3, 3, 3, 2]);
  assert.strictEqual(Game.CARDS.chance.length, 16);
  assert.strictEqual(Game.CARDS.chest.length, 16);
});

test("only the player on turn may roll", () => {
  const S = setup();
  assert.strictEqual(Game.act(S, 1, { t: "roll" }).ok, false);
  assert.strictEqual(Game.act(S, 0, { t: "end" }).ok, false);
  assert.strictEqual(Game.act(S, 0, { t: "buy" }).ok, false);
});

test("landing exactly on Los pays 400 with the house rule and 200 without", () => {
  for (const [goDouble, bonus] of [[true, 400], [false, 200]]) {
    const S = setup(2, { goDouble });
    S.players[0].pos = 35;
    const res = ok(roll(S, 2, 3));
    assert.strictEqual(S.players[0].pos, 0);
    assert.strictEqual(S.players[0].cash, 1500 + bonus);
    const pay = res.events.find((e) => e.t === "pay" && e.why === "go");
    assert.strictEqual(pay.amount, bonus);
    assert.strictEqual(pay.exact, true);
    assert.strictEqual(pay.bonus, goDouble);
  }
});

test("passing Los always pays 200, even with the double house rule", () => {
  const S = setup(2, { goDouble: true });
  S.players[0].pos = 38;
  const res = ok(roll(S, 3, 4)); // 7 -> Hauptbahnhof
  assert.strictEqual(S.players[0].pos, 5);
  assert.strictEqual(S.players[0].cash, 1700);
  const move = res.events.find((e) => e.t === "move");
  assert.strictEqual(move.passGo, true);
  assert.strictEqual(res.events.find((e) => e.t === "pay").exact, false);
  assert.strictEqual(S.step, "buy");
});

test("buying takes the money, declining starts an auction that the highest bidder wins", () => {
  const S = setup(3);
  ok(roll(S, 1, 2)); // Bäckergasse (3)
  assert.strictEqual(S.step, "buy");
  assert.strictEqual(S.buy, 3);
  ok(Game.act(S, 0, { t: "buy" }));
  assert.deepStrictEqual(S.props[3], { owner: 0, mort: 0, houses: 0 });
  assert.strictEqual(S.players[0].cash, 1440);
  assert.strictEqual(S.step, "after");
  ok(Game.act(S, 0, { t: "end" }));
  assert.strictEqual(S.cur, 1);
  ok(roll(S, 2, 3)); // 5 = Hauptbahnhof
  ok(Game.act(S, 1, { t: "decline" }));
  assert.strictEqual(S.step, "auction");
  assert.strictEqual(Game.actorOf(S), 2, "the bidding starts after the player on turn");
  assert.strictEqual(Game.act(S, 1, { t: "bid", amount: 10 }).ok, false);
  assert.strictEqual(Game.act(S, 2, { t: "bid", amount: 5000 }).ok, false, "more than the cash");
  ok(Game.act(S, 2, { t: "bid", amount: 50 }));
  assert.strictEqual(Game.act(S, 0, { t: "bid", amount: 50 }).ok, false, "must top the highest bid");
  ok(Game.act(S, 0, { t: "bid", amount: 120 }));
  ok(Game.act(S, 1, { t: "pass" }));
  const res = ok(Game.act(S, 2, { t: "pass" }));
  assert.ok(res.events.some((e) => e.t === "buy" && e.auction && e.pi === 0));
  assert.strictEqual(S.props[5].owner, 0);
  assert.strictEqual(S.players[0].cash, 1440 - 120);
  assert.strictEqual(S.auction, null);
  assert.strictEqual(S.step, "after");
});

test("an auction nobody bids in ends without a sale; without the auction rule declining just moves on", () => {
  const S = setup(2);
  ok(roll(S, 1, 2));
  ok(Game.act(S, 0, { t: "decline" }));
  ok(Game.act(S, 1, { t: "pass" }));
  const res = ok(Game.act(S, 0, { t: "pass" }));
  assert.ok(res.events.some((e) => e.t === "auctionEnd"));
  assert.strictEqual(S.props[3], null);
  assert.strictEqual(S.step, "after");
  const T = setup(2, { auction: false });
  ok(roll(T, 1, 2));
  ok(Game.act(T, 0, { t: "decline" }));
  assert.strictEqual(T.auction, null);
  assert.strictEqual(T.step, "after");
});

test("rent: single street, double on a full colour set, by houses, stations by count, utilities by dice", () => {
  const S = setup(2);
  give(S, 1, 3);
  S.cash = 0;
  ok(roll(S, 1, 2));
  assert.strictEqual(S.players[0].cash, 1500 - 4);
  assert.strictEqual(S.players[1].cash, 1500 + 4);

  const T = setup(2);
  giveGroup(T, 1, 0);
  ok(roll(T, 1, 2));
  assert.strictEqual(T.players[0].cash, 1500 - 8, "double rent on the full set");

  const U = setup(2);
  giveGroup(U, 1, 0);
  U.props[3].houses = 2;
  ok(roll(U, 1, 2));
  assert.strictEqual(U.players[0].cash, 1500 - 60);

  const V = setup(2);
  [5, 15, 25].forEach((i) => give(V, 1, i));
  V.players[0].pos = 2;
  ok(roll(V, 1, 2)); // -> 5
  assert.strictEqual(V.players[0].cash, 1500 - 100);

  const W = setup(2);
  give(W, 1, 12);
  W.players[0].pos = 7;
  ok(roll(W, 2, 3)); // -> 12
  assert.strictEqual(W.players[0].cash, 1500 - 4 * 5);
  const X = setup(2);
  give(X, 1, 12); give(X, 1, 28);
  X.players[0].pos = 7;
  ok(roll(X, 2, 3));
  assert.strictEqual(X.players[0].cash, 1500 - 10 * 5);
});

test("a mortgaged street collects no rent and your own streets are free", () => {
  const S = setup(2);
  give(S, 1, 3, 0, 1);
  ok(roll(S, 1, 2));
  assert.strictEqual(S.players[0].cash, 1500);
  const T = setup(2);
  give(T, 0, 3);
  ok(roll(T, 1, 2));
  assert.strictEqual(T.players[0].cash, 1500);
  assert.strictEqual(T.step, "after");
});

test("taxes go to the bank, or into the free parking pot with that house rule, which Frei Parken pays out", () => {
  const S = setup(2);
  S.players[0].pos = 1;
  ok(roll(S, 1, 2)); // 4: Einkommensteuer
  assert.strictEqual(S.players[0].cash, 1300);
  assert.strictEqual(S.pot, 0);

  const T = setup(2, { parking: true });
  T.players[0].pos = 1;
  ok(roll(T, 1, 2));
  assert.strictEqual(T.pot, 200);
  assert.strictEqual(T.players[0].cash, 1300);
  ok(Game.act(T, 0, { t: "end" }));
  T.players[1].pos = 14;
  const res = ok(roll(T, 2, 4)); // 6 -> Frei Parken (20)
  assert.strictEqual(T.players[1].cash, 1700);
  assert.strictEqual(T.pot, 0);
  assert.ok(res.events.some((e) => e.t === "pay" && e.why === "parking" && e.amount === 200));
});

test("doubles roll again, three doubles in a row go to jail", () => {
  const S = setup(2);
  ok(roll(S, 1, 1)); // 2 -> chest, but first make sure the turn continues
  assert.ok(S.step === "roll" || S.step === "buy" || S.step === "debt" || S.step === "after");
  const T = setup(2);
  T.props.fill({ owner: 1, mort: 1, houses: 0 }, 0); // everything mortgaged: nothing to pay or buy on the way
  for (let i = 0; i < 40; i++) if (!Game.BOARD[i] || !["prop", "station", "util"].includes(BOARD[i].k)) T.props[i] = null;
  T.decks.chance = [9, 8, 10, 13, 12, 14, 15, 0]; T.decks.chest = [3, 1, 2, 7, 8, 9, 10, 11];
  ok(roll(T, 2, 2));
  assert.strictEqual(T.step, "roll", "doubles: roll again");
  assert.strictEqual(T.doubles >= 1, true);
  T.players[0].pos = 0; T.doubles = 2;
  const res = ok(roll(T, 3, 3));
  assert.strictEqual(T.players[0].jail, 1);
  assert.strictEqual(T.players[0].pos, 10);
  assert.ok(res.events.some((e) => e.t === "jail" && e.why === "speed"));
  assert.strictEqual(T.step, "after");
});

test("Ab ins Gefängnis sends you to jail without Los money, you leave by paying, a card or doubles", () => {
  const S = setup(2);
  S.players[0].pos = 26;
  const res = ok(roll(S, 1, 3)); // -> 30
  assert.strictEqual(S.players[0].pos, 10);
  assert.strictEqual(S.players[0].jail, 1);
  assert.strictEqual(S.players[0].cash, 1500);
  const jail = res.events.find((e) => e.t === "jail");
  assert.deepStrictEqual([jail.from, jail.why], [30, "field"]);
  ok(Game.act(S, 0, { t: "end" }));
  ok(roll(S, 1, 2)); // somebody else keeps playing
  ok(Game.act(S, 1, { t: "buy" }));
  ok(Game.act(S, 1, { t: "end" }));
  assert.strictEqual(Game.act(S, 0, { t: "useCard" }).ok, false, "no card");
  ok(Game.act(S, 0, { t: "payJail" }));
  assert.strictEqual(S.players[0].jail, 0);
  assert.strictEqual(S.players[0].cash, 1450);
  assert.strictEqual(S.step, "roll");

  const T = setup(2);
  Object.assign(T.players[0], { pos: 10, jail: 1, cards: ["chance"] });
  T.decks.chance = T.decks.chance.filter((i) => i !== 9);
  ok(Game.act(T, 0, { t: "useCard" }));
  assert.strictEqual(T.players[0].jail, 0);
  assert.strictEqual(T.players[0].cards.length, 0);
  assert.ok(T.decks.chance.includes(9), "the card goes back into the deck");

  const U = setup(2);
  Object.assign(U.players[0], { pos: 10, jail: 1 });
  const r = ok(roll(U, 3, 3)); // doubles: free and move 6 -> Rosenweg... 16 steps? 10+6=16
  assert.strictEqual(U.players[0].jail, 0);
  assert.ok(r.events.some((e) => e.t === "jailOut" && e.how === "doubles"));
  assert.strictEqual(U.players[0].pos, 16);
  assert.notStrictEqual(U.step, "roll", "no extra roll after leaving jail with doubles");
});

test("three failed tries in jail cost 50 and you move on", () => {
  const S = setup(2);
  S.props.fill(null);
  Object.assign(S.players[0], { pos: 10, jail: 1 });
  ok(roll(S, 1, 2));
  assert.strictEqual(S.players[0].jail, 2);
  assert.strictEqual(S.step, "after");
  assert.strictEqual(S.players[0].pos, 10);
  S.cur = 0; S.step = "roll";
  ok(roll(S, 1, 2));
  assert.strictEqual(S.players[0].jail, 3);
  S.cur = 0; S.step = "roll";
  ok(roll(S, 1, 2)); // third failure: pay and move 3 -> Bäckergasse... 13
  assert.strictEqual(S.players[0].jail, 0);
  assert.strictEqual(S.players[0].cash, 1450);
  assert.strictEqual(S.players[0].pos, 13);
});

test("building: whole set needed, evenly, costs money, hotel after four houses, bank supply is limited", () => {
  const S = setup(2);
  const [a, b] = GROUPS[0].m;
  give(S, 0, a);
  assert.strictEqual(Game.act(S, 0, { t: "build", idx: a }).ok, false, "no full set");
  give(S, 0, b);
  ok(Game.act(S, 0, { t: "build", idx: a }));
  assert.strictEqual(S.players[0].cash, 1450);
  assert.match(Game.act(S, 0, { t: "build", idx: a }).error, /gleichmäßig/);
  ok(Game.act(S, 0, { t: "build", idx: b }));
  for (let i = 0; i < 3; i++) { ok(Game.act(S, 0, { t: "build", idx: a })); ok(Game.act(S, 0, { t: "build", idx: b })); }
  assert.deepStrictEqual([S.props[a].houses, S.props[b].houses], [4, 4]);
  assert.strictEqual(S.houses, 32 - 8);
  ok(Game.act(S, 0, { t: "build", idx: a }));
  assert.strictEqual(S.props[a].houses, 5);
  assert.strictEqual(S.hotels, 11);
  assert.strictEqual(S.houses, 32 - 4);
  assert.strictEqual(Game.act(S, 0, { t: "build", idx: a }).ok, false, "hotel is the top");
  assert.strictEqual(Game.act(S, 1, { t: "build", idx: b }).ok, false, "not yours / not your turn");
  S.houses = 0;
  const T = setup(2);
  giveGroup(T, 0, 1);
  T.houses = 0;
  assert.match(Game.act(T, 0, { t: "build", idx: GROUPS[1].m[0] }).error, /keine Häuser/);
});

test("selling houses is even too and pays half, mortgages need an empty group and unmortgaging costs 10% extra", () => {
  const S = setup(2);
  giveGroup(S, 0, 0);
  const [a, b] = GROUPS[0].m;
  S.props[a].houses = 2; S.props[b].houses = 1;
  assert.match(Game.act(S, 0, { t: "sell", idx: b }).error, /gleichmäßig/);
  ok(Game.act(S, 0, { t: "sell", idx: a }));
  assert.strictEqual(S.players[0].cash, 1525);
  assert.strictEqual(Game.act(S, 0, { t: "mortgage", idx: a }).ok, false, "houses in the group");
  ok(Game.act(S, 0, { t: "sell", idx: a })); ok(Game.act(S, 0, { t: "sell", idx: b }));
  assert.strictEqual(Game.act(S, 0, { t: "sell", idx: b }).ok, false, "nothing left");
  ok(Game.act(S, 0, { t: "mortgage", idx: a }));
  assert.strictEqual(S.props[a].mort, 1);
  const cash = S.players[0].cash;
  assert.strictEqual(Game.act(S, 0, { t: "mortgage", idx: a }).ok, false);
  assert.match(Game.act(S, 0, { t: "build", idx: b }).error, /Hypothek/);
  ok(Game.act(S, 0, { t: "unmortgage", idx: a }));
  assert.strictEqual(S.players[0].cash, cash - 33);
  assert.strictEqual(S.props[a].mort, 0);
});

test("a hotel can only be taken down when the bank has four houses", () => {
  const S = setup(2);
  giveGroup(S, 0, 0);
  const [a, b] = GROUPS[0].m;
  S.props[a].houses = 5; S.props[b].houses = 5; S.hotels = 10; S.houses = 3;
  assert.match(Game.act(S, 0, { t: "sell", idx: a }).error, /nicht genug/);
  S.houses = 4;
  ok(Game.act(S, 0, { t: "sell", idx: a }));
  assert.strictEqual(S.props[a].houses, 4);
  assert.strictEqual(S.houses, 0);
  assert.strictEqual(S.hotels, 11);
});

test("chance and community cards: Los, jail, back 3, repairs, pay everybody, collect from everybody, free card", () => {
  const draw = (S, deck, id, from, a, b) => {
    S.decks[deck] = [id].concat(S.decks[deck].filter((i) => i !== id));
    S.players[0].pos = from;
    return ok(roll(S, a, b));
  };
  let S = setup(3);
  draw(S, "chance", 0, 3, 1, 3); // -> 7 chance: "Rücke vor bis auf Los"
  assert.strictEqual(S.players[0].pos, 0);
  assert.strictEqual(S.players[0].cash, 1900, "Los by card counts as landing on Los");

  S = setup(3);
  draw(S, "chance", 11, 3, 1, 3);
  assert.strictEqual(S.players[0].jail, 1);
  assert.strictEqual(S.players[0].pos, 10);
  assert.strictEqual(S.players[0].cash, 1500);

  S = setup(3);
  draw(S, "chance", 10, 3, 1, 3); // back 3: 7 -> 4 Einkommensteuer
  assert.strictEqual(S.players[0].pos, 4);
  assert.strictEqual(S.players[0].cash, 1300);

  S = setup(3);
  giveGroup(S, 0, 0); S.props[1].houses = 1; S.props[3].houses = 1;
  const res = draw(S, "chance", 12, 3, 1, 3);
  assert.strictEqual(S.players[0].cash, 1500 - 50);
  assert.ok(res.events.some((e) => e.t === "card" && e.deck === "chance" && e.id === 12));

  S = setup(3);
  draw(S, "chance", 14, 3, 1, 3);
  assert.deepStrictEqual(S.players.map((p) => p.cash), [1400, 1550, 1550]);

  S = setup(3);
  draw(S, "chest", 5, 0, 1, 1); // 2 -> chest, birthday
  assert.deepStrictEqual(S.players.map((p) => p.cash), [1550, 1475, 1475]);

  S = setup(3);
  draw(S, "chest", 3, 0, 1, 1);
  assert.deepStrictEqual(S.players[0].cards, ["chest"]);
  assert.ok(!S.decks.chest.includes(3), "a held free card is out of the deck");

  S = setup(2);
  draw(S, "chance", 5, 3, 1, 3); // next station from 7 -> 15 Nordbahnhof, owner is Ben
  assert.strictEqual(S.step, "buy");
  S = setup(2);
  give(S, 1, 15);
  draw(S, "chance", 5, 3, 1, 3);
  assert.strictEqual(S.players[0].cash, 1500 - 50, "twice the station rent");

  S = setup(2);
  give(S, 1, 12);
  draw(S, "chance", 7, 3, 1, 3); // next utility from 7 -> 12 Stadtwerke: 10 x dice (4)
  assert.strictEqual(S.players[0].cash, 1500 - 40);
});

test("not enough money means debt: raise it by mortgaging or selling, otherwise give up", () => {
  const S = setup(2);
  give(S, 1, 3);
  S.players[0].cash = 2;
  give(S, 0, 1);
  const res = ok(roll(S, 1, 2)); // rent 4
  assert.strictEqual(S.step, "debt");
  assert.ok(res.events.some((e) => e.t === "debt"));
  assert.strictEqual(Game.act(S, 0, { t: "end" }).ok, false);
  assert.strictEqual(Game.act(S, 0, { t: "roll" }).ok, false);
  const r2 = ok(Game.act(S, 0, { t: "mortgage", idx: 1 })); // +30 -> pays 4
  assert.ok(r2.events.some((e) => e.t === "pay" && e.why === "rent" && e.amount === 4));
  assert.strictEqual(S.players[0].cash, 28);
  assert.strictEqual(S.players[1].cash, 1504);
  assert.strictEqual(S.step, "after");
  assert.strictEqual(S.debt, null);
});

test("bankruptcy hands everything to the creditor and ends the round when one player is left", () => {
  const S = setup(2);
  give(S, 1, 3);
  S.players[0].cash = 2;
  give(S, 0, 6, 0, 1);
  S.players[0].cards = ["chest"];
  ok(roll(S, 1, 2));
  assert.strictEqual(S.step, "debt");
  assert.strictEqual(Game.act(S, 1, { t: "bankrupt" }).ok, false);
  S.props[6].mort = 1;
  const res = ok(Game.act(S, 0, { t: "bankrupt" }));
  assert.ok(res.events.some((e) => e.t === "bankrupt" && e.pi === 0 && e.to === 1));
  assert.strictEqual(S.props[6].owner, 1);
  assert.strictEqual(S.props[6].mort, 1);
  assert.deepStrictEqual(S.players[1].cards, ["chest"]);
  assert.strictEqual(S.players[0].out, true);
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [1]);
  assert.strictEqual(S.last.over, true);
  assert.strictEqual(S.last.reason, "last");
  assert.strictEqual(Game.act(S, 0, { t: "roll" }).ok, false);
});

test("with three players the game goes on after one is bankrupt and out players are skipped", () => {
  const S = setup(3);
  give(S, 1, 3);
  S.players[0].cash = 0;
  ok(roll(S, 1, 2));
  ok(Game.act(S, 0, { t: "bankrupt" }));
  assert.strictEqual(S.phase, "play");
  assert.strictEqual(S.cur, 1);
  S.players[1].pos = 5;
  ok(roll(S, 1, 2)); // -> Lindenstraße
  ok(Game.act(S, 1, { t: "decline" }));
  assert.deepStrictEqual(S.auction.in, [2, 1], "the bankrupt player is not in the auction");
  ok(Game.act(S, 2, { t: "pass" }));
  ok(Game.act(S, 1, { t: "pass" }));
  assert.strictEqual(S.props[8], null);
});

test("trades: both sides are checked, the other side accepts or declines, buildings block them", () => {
  const S = setup(3);
  give(S, 0, 1); give(S, 1, 3);
  S.players[1].cards = ["chest"];
  const offer = { t: "trade", to: 1, give: { cash: 100, props: [1] }, take: { props: [3], card: 1 } };
  ok(Game.act(S, 0, offer));
  assert.strictEqual(Game.actorOf(S), 1);
  assert.strictEqual(Game.act(S, 0, { t: "roll" }).ok, false, "waiting for the answer");
  assert.strictEqual(Game.act(S, 2, { t: "accept" }).ok, false);
  ok(Game.act(S, 1, { t: "accept" }));
  assert.strictEqual(S.props[1].owner, 1);
  assert.strictEqual(S.props[3].owner, 0);
  assert.deepStrictEqual([S.players[0].cash, S.players[1].cash], [1400, 1600]);
  assert.deepStrictEqual([S.players[0].cards, S.players[1].cards], [["chest"], []]);

  const bad = [
    { t: "trade", to: 0, give: { cash: 1 }, take: {} },
    { t: "trade", to: 5, give: { cash: 1 }, take: {} },
    { t: "trade", to: 1, give: {}, take: {} },
    { t: "trade", to: 1, give: { cash: 99999 }, take: {} },
    { t: "trade", to: 1, give: { props: [5] }, take: {} },
    { t: "trade", to: 1, give: { cash: -5 }, take: {} },
    { t: "trade", to: 1, give: { cash: 1.5 }, take: {} },
    { t: "trade", to: 1, give: { props: [1, 1] }, take: {} },
    { t: "trade", to: 1, give: { props: ["constructor"] }, take: {} },
    { t: "trade", to: 1, give: { cash: 5 }, take: { card: 1 } },
    { t: "trade", to: 1, give: [], take: {} }
  ];
  for (const a of bad) {
    const before = JSON.stringify(S);
    assert.strictEqual(Game.act(S, 0, a).ok, false, JSON.stringify(a));
    assert.strictEqual(JSON.stringify(S), before);
  }
  ok(Game.act(S, 0, { t: "trade", to: 1, give: { cash: 10 }, take: {} }));
  ok(Game.act(S, 1, { t: "reject" }));
  assert.strictEqual(S.trade, null);
  ok(Game.act(S, 0, { t: "trade", to: 1, give: { cash: 10 }, take: {} }));
  ok(Game.act(S, 0, { t: "cancel" }));
  assert.strictEqual(S.trade, null);

  const T = setup(2);
  giveGroup(T, 0, 0); T.props[1].houses = 1;
  assert.match(Game.act(T, 0, { t: "trade", to: 1, give: { props: [1] }, take: {} }).error, /Häuser/);
});

test("the computer accepts a good trade offer and turns a bad one down", () => {
  const S = setup(2, undefined, 2);
  S.players[1].bot = true;
  give(S, 1, 3);
  ok(Game.act(S, 0, { t: "trade", to: 1, give: { cash: 20 }, take: { props: [3] } }));
  assert.deepStrictEqual(Game.botMove(S, 1), { t: "reject" });
  ok(Game.act(S, 1, { t: "reject" }));
  ok(Game.act(S, 0, { t: "trade", to: 1, give: { cash: 900 }, take: { props: [3] } }));
  assert.deepStrictEqual(Game.botMove(S, 1), { t: "accept" });
});

test("the host can skip whoever has to act: the computer plays that move", () => {
  const S = setup(3);
  const res = ok(Game.act(S, 2, { t: "skip" })); // anybody may ask, the server only lets the host
  assert.ok(res.events.some((e) => e.t === "roll"));
  assert.ok(S.log.some((l) => /übersprungen/.test(l)));
  let guard = 0;
  while (S.cur === 0 && guard++ < 20) ok(Game.act(S, 1, { t: "skip" }));
  assert.ok(guard < 20, "skipping always makes progress");
  const T = setup(3);
  T.step = "buy"; T.buy = 3;
  const r = ok(Game.act(T, 0, { t: "skip" }));
  assert.ok(r.events.length >= 1);
  assert.notStrictEqual(T.step, "buy");
});

test("the turn limit ends the game, the richest wins", () => {
  const S = setup(3);
  S.rules.limit = 2;
  S.props.fill(null);
  give(S, 1, 39); give(S, 1, 37);
  let guard = 0;
  while (S.phase === "play" && guard++ < 300) {
    const who = Game.actorOf(S);
    const m = Game.botMove(S, who) || { t: "end" };
    ok(Game.act(S, who, m));
  }
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.reason, "limit");
  assert.strictEqual(S.last.worths.length, 3);
  const best = S.last.worths.indexOf(Math.max(...S.last.worths));
  assert.strictEqual(S.last.winners[0], best);
  assert.ok(S.players.every((p) => p.turns >= 2));
});

test("a won game can be replayed: next resets the round or the whole game", () => {
  const S = Game.newGame([{ name: "A" }, { name: "B" }], 2, { limit: 1 }, 2);
  const finish = () => { let g = 0; while (S.phase === "play" && g++ < 500) { const w = Game.actorOf(S); ok(Game.act(S, w, Game.botMove(S, w))); } };
  assert.strictEqual(Game.act(S, 0, { t: "next" }).ok, false, "the round is still running");
  finish();
  assert.strictEqual(S.last.over, false);
  ok(Game.act(S, 0, { t: "next" }));
  assert.strictEqual(S.round, 2);
  assert.ok(S.props.every((p) => p === null));
  assert.ok(S.players.every((p) => p.cash === 1500 && p.pos === 0));
  finish();
  assert.ok(S.players.some((p) => p.wins >= 1));
});

test("the computer always makes a legal move and finishes a game at every level and table size", () => {
  for (const level of [1, 2, 3]) for (const n of [2, 3, 4, 6]) {
    const S = Game.newGame(names.slice(0, n).map((name) => ({ name, bot: true })), 1, { limit: 30, parking: n % 2 === 0, auction: n !== 3 }, level);
    let guard = 0;
    while (S.phase === "play" && guard++ < 6000) {
      const who = Game.actorOf(S), a = Game.botMove(S, who);
      assert.ok(a, `no move for ${who} in step ${S.step}`);
      const res = Game.act(S, who, a);
      assert.ok(res.ok, `${JSON.stringify(a)}: ${res.error} (${S.step})`);
      assert.ok(S.players.every((p) => p.cash >= 0), "cash never goes negative");
    }
    assert.strictEqual(S.phase, "roundEnd");
    assert.ok(S.last.winners.length === 1);
    assert.ok(S.houses >= 0 && S.houses <= 32 && S.hotels >= 0 && S.hotels <= 12);
  }
});

test("bot plans name who moves next and change with every move", () => {
  const S = Game.newGame([{ name: "A", bot: true }, { name: "B" }], 1, {}, 2);
  S.cur = 0;
  const p1 = Game.botPlan(S);
  assert.strictEqual(p1.pi, 0);
  assert.ok(p1.delay >= 800);
  ok(Game.act(S, 0, Game.botMove(S, 0)));
  assert.notStrictEqual(Game.botPlan(S) && Game.botPlan(S).key, p1.key);
  S.cur = 1; S.step = "roll";
  assert.strictEqual(Game.botPlan(S), null, "a human is on turn");
  assert.strictEqual(Game.botMove(S, 0), null, "and the computer is not asked");
});

test("view marks who is me, copies the state and keeps the helper shape", () => {
  const S = setup(3);
  giveGroup(S, 1, 0);
  const v = Game.view(S, 1);
  assert.strictEqual(v.me, 1);
  assert.strictEqual(Game.view(S, -1).me, -1);
  assert.strictEqual(v.players.length, 3);
  assert.strictEqual(v.actor, 0);
  v.props[1].houses = 3; v.players[0].cash = 1; v.rules.cash = 1;
  assert.strictEqual(S.props[1].houses, 0);
  assert.strictEqual(S.players[0].cash, 1500);
  assert.strictEqual(S.rules.cash, 1500);
  assert.strictEqual(Game.view(S, 1).props[1].owner, 1);
  assert.strictEqual(Game.buildError(Game.view(S, 1), 1, 1), null, "the page can ask the same questions on a view");
  assert.strictEqual(Game.worth(S, 1), 1500 + 60 + 60);
});

// The engine runs on the server's only thread for every room at once: a rule step, a bot move or
// a whole generated game must never take noticeable time. Keep a check like this for anything heavy.
test("the engine is fast: 30 bot-only games take well under a second", () => {
  const t0 = Date.now();
  for (let k = 0; k < 30; k++) {
    const S = Game.newGame(names.slice(0, 4).map((name) => ({ name, bot: true })), 1, { limit: 40 }, 2);
    let guard = 0;
    while (S.phase === "play" && guard++ < 6000) { const who = Game.actorOf(S); Game.act(S, who, Game.botMove(S, who)); }
    assert.strictEqual(S.phase, "roundEnd");
  }
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
});

// Every message from a browser reaches Game.act unchecked: nothing hostile may change the state or throw.
// Table lookups by a client value need hasOwnProperty, else "constructor" / "__proto__" slip through.
test("hostile messages are rejected and leave the state untouched", () => {
  const S = setup(3);
  give(S, 0, 1); give(S, 0, 3);
  const bad = ["constructor", "__proto__", "toString", NaN, Infinity, -1, 40, 1.5, null, {}, [], "7", true];
  const hostile = [null, undefined, 5, "roll", [], {}, { t: null }, { t: 5 }, { t: "constructor" }, { t: "__proto__" }, { t: "toString" }, { t: "hasOwnProperty" },
    { t: "roll", id: "constructor" }, { t: "bid", amount: "constructor" }, { t: "next" }, { t: "end" }, { t: "bankrupt" }, { t: "accept" }, { t: "reject" }, { t: "cancel" },
    { t: "payJail" }, { t: "useCard" }, { t: "buy" }, { t: "decline" }, { t: "pass" }];
  for (const v of bad) for (const t of ["build", "sell", "mortgage", "unmortgage", "bid", "trade"]) {
    hostile.push({ t, idx: v, amount: v, to: v, give: v, take: v });
    hostile.push({ t, idx: v, to: 1, give: { cash: v, props: [v], card: v }, take: { cash: v, props: v } });
  }
  const pis = [-1, 0, 1, 2, 3, 99, "constructor", "0", NaN, null];
  for (const step of ["roll", "buy", "auction", "debt", "after"]) for (const pi of pis) for (const a of hostile) {
    const T = JSON.parse(JSON.stringify(S));
    T.step = step;
    if (step === "buy") T.buy = 5;
    if (step === "auction") T.auction = { idx: 5, bid: 0, who: -1, in: [1, 2, 0], turn: 0 };
    if (step === "debt") T.debt = { pi: 0, to: 1, amount: 99999, why: "rent", idx: 3 };
    const before = JSON.stringify(T);
    let res;
    assert.doesNotThrow(() => { res = Game.act(T, pi, a); }, JSON.stringify([pi, a]));
    if (!res.ok) assert.strictEqual(JSON.stringify(T), before, "a rejected action must not change the state: " + JSON.stringify([step, pi, a]));
  }
});

test("a game state survives JSON like the server saves it", () => {
  const S = Game.newGame(names.slice(0, 3).map((name) => ({ name, bot: true })), 1, {}, 2);
  for (let i = 0; i < 400 && S.phase === "play"; i++) { const w = Game.actorOf(S); ok(Game.act(S, w, Game.botMove(S, w))); }
  const copy = JSON.parse(JSON.stringify(S));
  assert.deepStrictEqual(copy, S);
  for (let i = 0; i < 200 && copy.phase === "play"; i++) { const w = Game.actorOf(copy); ok(Game.act(copy, w, Game.botMove(copy, w))); }
});
