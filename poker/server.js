// Poker server: the shared Spieleabend room server (../shared/room-server.js) with the
// Texas Hold'em engine. Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const Game = require("./public/game.js");

const levelOf = (r) => (Game.BOT_LEVELS[r.botLevel] ? r.botLevel : "normal");
const roomRules = (r) => r.rules || (r.rules = Game.normRules({}));

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game,
  id: "poker",
  title: "Poker",
  maxPlayers: Game.MAX_PLAYERS,
  watchers: 20,
  hostHandover: true,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Gut gespielt!", "Uff …", "Beeil dich!", "Na warte!"],

  newRoom: (msg) => ({ chips: Game.normChips(msg.chips), rules: Game.normRules(msg.rules) }),
  roomFields: (room) => ({ chips: Game.normChips(room.chips), rules: roomRules(room), botLevel: levelOf(room) }),
  settings(room, msg) { // host changes the start chips, house rules and computer strength in the waiting room
    if (msg.chips != null) room.chips = Game.normChips(msg.chips);
    if (msg.rules) room.rules = Game.normRules(msg.rules);
    if (Game.BOT_LEVELS[msg.botLevel]) room.botLevel = msg.botLevel;
  },
  newGame(room, players) {
    return Game.newGame(players.map((m) => ({ name: m.name, bot: !!m.bot, avatar: m.bot ? "🤖" : m.avatar })), room.chips, roomRules(room), true);
  },
  // leaving a running game: the computer takes over the seat and its cards
  leaveGame(room, pid) {
    const S = room.state, m = room.members[pid];
    room.members[pid] = { name: m.name, bot: true, secret: null, avatar: "🤖" };
    S.players[pid].bot = true; S.players[pid].avatar = "🤖";
    room.touched = Date.now();
  },

  // every action changes seq, so a computer plays one visible step at a time
  botPlan(room) {
    const S = room.state;
    if (S.phase !== "play" || !S.players[S.cur].bot) return null;
    return { key: `bot:${S.hand}:${S.turn}:${S.seq}`, delay: 1000 + Math.random() * 1200, pi: S.cur };
  },
  botMove(room, pi, { apply }) {
    const S = room.state;
    const a = Game.suggest(Game.view(S, pi), levelOf(room));
    if (a && apply(room, pi, a).ok) return true;
    // never get stuck on a move that was not allowed
    const o = Game.options(S);
    return apply(room, pi, { t: o && o.canCheck ? "check" : "call" }).ok || apply(room, pi, { t: "fold" }).ok;
  },
  turnClock(room) {
    const S = room.state;
    return roomRules(room).turnTimer && S.phase === "play" && !S.players[S.cur].bot ? `${S.hand}:${S.turn}` : null;
  }
});
