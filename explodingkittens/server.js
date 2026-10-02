// Exploding Kittens server: the shared Spieleabend room server (../shared/room-server.js) with this game's
// engine. Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const Game = require("./public/game.js");

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game,
  id: "explodingkittens",
  title: "Exploding Kittens",
  maxPlayers: Game.MAX_PLAYERS,
  watchers: 20,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Nö!", "Na warte!", "Glück gehabt!", "Gut gespielt!"],

  newRoom: (msg) => ({ goal: Game.normGoal(msg.goal), level: Game.normLevel(msg.level) }),
  roomFields: (room) => ({ goal: room.goal, level: room.level || 2 }),
  settings(room, msg) { // the host changes these in the waiting room
    if (msg.goal != null) room.goal = Game.normGoal(msg.goal);
    if (msg.level != null) room.level = Game.normLevel(msg.level);
  },
  newGame: (room, players) => Game.newGame(players.map((m) => ({ name: m.name, bot: m.bot, avatar: m.avatar })), room.goal, room.level, !!process.env.BOT_MS),

  // Computers move at a human pace, and say "Nö!" inside the open window; the engine plans both.
  botPlan(room, ctx) {
    const p = Game.botPlan(room.state);
    if (p && process.env.BOT_MS) p.delay = ctx.BOT_MS;
    return p;
  },
  // Whoever has to decide (play, give a card, hide a kitten) has Game.TURN_MS; the window for "Nö!" runs by itself.
  turnClock(room) {
    const S = room.state, w = Game.waitingFor(S);
    return w >= 0 && !S.players[w].bot ? `${S.round}:${S.mv}` : null;
  }
});
