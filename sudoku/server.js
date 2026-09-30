// Sudoku server: the shared Spieleabend room server (../shared/room-server.js) with the
// Sudoku engine. Players race the same puzzle at once; computer opponents fill cells on a timer.
// Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const Game = require("./public/game.js");

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game,
  id: "sudoku",
  title: "Sudoku",
  maxPlayers: Game.MAX_PLAYERS,
  watchers: 20,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Na warte!", "Glück gehabt!", "Knapp daneben!", "Gut gespielt!"],

  newRoom: (msg) => ({ goal: Game.normGoal(msg.goal), level: Game.normLevel(msg.level) }),
  roomFields: (room) => ({ goal: room.goal, level: room.level || 2 }),
  settings(room, msg) { // the host changes these in the waiting room
    if (msg.goal != null) room.goal = Game.normGoal(msg.goal);
    if (msg.level != null) room.level = Game.normLevel(msg.level);
  },
  newGame: (room, players) => Game.newGame(players.map((m) => ({ name: m.name, bot: m.bot, avatar: m.avatar })), room.goal, room.level),

  // everybody plays at once, so the engine picks which computer moves next (tests shorten the pause with BOT_MS)
  botPlan(room, ctx) {
    const plan = Game.botPlan(room.state);
    if (plan && process.env.BOT_MS) plan.delay = ctx.BOT_MS;
    return plan;
  },
});
