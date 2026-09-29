// Würfelpoker server: the shared Spieleabend room server (../shared/room-server.js) with the
// Würfelpoker engine. Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const Game = require("./public/game.js");

const GOALS = [0, 3, 5, 7];
const levelOf = (r) => (Game.BOT_LEVELS[r.botLevel] ? r.botLevel : "normal");
const roomRules = (r) => r.rules || (r.rules = Game.normRules({ chaos: r.chaos, stack: r.stack }));

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game,
  id: "wuerfelpoker",
  title: "Würfelpoker",
  maxPlayers: 8,
  watchers: 20,
  hostHandover: true,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Gut gespielt!", "Uff …", "Beeil dich!", "Na warte!"],

  newRoom: (msg) => ({ goal: GOALS.includes(+msg.goal) ? +msg.goal : 5, rules: Game.normRules(msg.rules) }),
  roomFields: (room) => ({ goal: room.goal, rules: roomRules(room), botLevel: levelOf(room) }),
  handlers: {
    rules(room, msg, { isHost }) { // host changes house rules in the waiting room
      if (!isHost || room.state) return false;
      room.rules = Game.normRules(msg.rules);
    },
    goal(room, msg, { isHost }) { // host changes the goal in the waiting room
      if (!isHost || room.state || !GOALS.includes(+msg.goal)) return false;
      room.goal = +msg.goal;
    },
    botLevel(room, msg, { isHost }) {
      if (!isHost || !Game.BOT_LEVELS[msg.level]) return false;
      room.botLevel = msg.level;
    }
  },
  newGame(room, players) {
    const S = Game.newGame(players.map((m) => m.name), room.goal, roomRules(room));
    players.forEach((m, i) => { S.players[i].bot = !!m.bot; S.players[i].avatar = m.bot ? "🤖" : m.avatar; });
    return S;
  },

  // every roll or hold changes seq, so a bot takes its turn one visible step at a time;
  // its first roll waits so everybody can look at the last result
  botPlan(room) {
    const S = room.state;
    if (!S.players[S.cur].bot) return null;
    return { key: `bot:${S.round}:${S.turn}:${S.phase}:${S.seq || 0}`, delay: (S.rolls ? 850 : 2400) + Math.random() * 700, pi: S.cur };
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
