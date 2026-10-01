// Carcassonne server: the shared Spieleabend room server (../shared/room-server.js) with this game's
// engine. Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const Game = require("./public/game.js");

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game,
  id: "carcassonne",
  title: "Carcassonne",
  maxPlayers: Game.MAX_PLAYERS,
  watchers: 20,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Na warte!", "Glück gehabt!", "Schön gelegt!", "Gut gespielt!"],

  newRoom: (msg) => ({ goal: Game.normGoal(msg.goal), level: Game.normLevel(msg.level) }),
  roomFields: (room) => ({ goal: room.goal, level: room.level || 2 }),
  settings(room, msg) {
    if (msg.goal != null) room.goal = Game.normGoal(msg.goal);
    if (msg.level != null) room.level = Game.normLevel(msg.level);
  },
  newGame: (room, players) => Game.newGame(
    players.map((m) => ({ name: m.name, bot: m.bot, avatar: m.avatar })),
    room.goal, room.level, { meadows: true }
  ),

  botPlan(room, ctx) {
    const plan = Game.botPlan(room.state);
    if (plan && process.env.BOT_MS) plan.delay = ctx.BOT_MS;
    return plan;
  },
});
