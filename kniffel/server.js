// Kniffel server: the shared Spieleabend room server (../shared/room-server.js) with the
// Kniffel engine. Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const Game = require("./public/game.js");

const levelOf = (r) => (Game.BOT_LEVELS[r.botLevel] ? r.botLevel : "normal");
const roomRules = (r) => r.rules || (r.rules = Game.normRules({}));

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game,
  id: "kniffel",
  title: "Kniffel",
  maxPlayers: 8,
  watchers: 20,
  hostHandover: true,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Gut gespielt!", "Uff …", "Beeil dich!", "Na warte!"],

  newRoom: (msg) => ({ rules: Game.normRules(msg.rules) }),
  roomFields: (room) => ({ rules: roomRules(room), botLevel: levelOf(room) }),
  handlers: {
    rules(room, msg, { isHost }) { // host changes house rules in the waiting room
      if (!isHost || room.state) return false;
      room.rules = Game.normRules(msg.rules);
    },
    botLevel(room, msg, { isHost }) {
      if (!isHost || !Game.BOT_LEVELS[msg.level]) return false;
      room.botLevel = msg.level;
    }
  },
  newGame(room, players) {
    const S = Game.newGame(players.map((m) => m.name), roomRules(room));
    players.forEach((m, i) => { S.players[i].bot = !!m.bot; S.players[i].avatar = m.bot ? "🤖" : m.avatar; });
    return S;
  },

  // every roll, hold or entry changes seq, so a bot plays one visible step at a time;
  // its first roll waits so everybody can look at the last entry
  botPlan(room) {
    const S = room.state;
    if (!S.players[S.cur].bot) return null;
    return { key: `bot:${S.turn}:${S.phase}:${S.seq || 0}`, delay: (S.rolls ? 900 : 2400) + Math.random() * 700, pi: S.cur };
  },
  botMove(room, pi, { apply }) {
    const a = Game.suggest(Game.view(room.state, pi), levelOf(room));
    return !!a && apply(room, pi, a).ok;
  },
  turnClock(room) {
    const S = room.state;
    return roomRules(room).turnTimer && !S.players[S.cur].bot && S.phase === "play" ? `${S.round}:${S.turn}` : null;
  }
});
