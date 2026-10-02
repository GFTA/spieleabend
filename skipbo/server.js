// Skip-Bo server: the shared Spieleabend room server (../shared/room-server.js) with this game's
// engine. Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const Game = require("./public/game.js");

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game,
  id: "skipbo",
  title: "Skip-Bo",
  maxPlayers: Game.MAX_PLAYERS,
  watchers: 20,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Na warte!", "Glück gehabt!", "Knapp daneben!", "Gut gespielt!"],

  newRoom: (msg) => ({ goal: Game.normGoal(msg.goal), stock: Game.normStock(msg.stock), level: Game.normLevel(msg.level) }),
  roomFields: (room) => ({ goal: room.goal, stock: room.stock || 0, level: room.level || 2 }),
  settings(room, msg) { // the host changes these in the waiting room
    if (msg.goal != null) room.goal = Game.normGoal(msg.goal);
    if (msg.stock != null) room.stock = Game.normStock(msg.stock);
    if (msg.level != null) room.level = Game.normLevel(msg.level);
  },
  newGame: (room, players) => Game.newGame(players.map((m) => ({ name: m.name, bot: m.bot, avatar: m.avatar })), room.goal, room.stock, room.level),

  // The computer paces itself in the engine (like a person); the browser uses the same Game.botPlan for single player.
  botPlan(room, ctx) { const p = Game.botPlan(room.state); if (p && process.env.BOT_MS) p.delay = ctx.BOT_MS; return p; },
});
