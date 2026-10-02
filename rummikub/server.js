// Rummikub server: the shared Spieleabend room server (../shared/room-server.js) with this game's
// engine. Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const Game = require("./public/game.js");

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game,
  id: "rummikub",
  title: "Rummikub",
  maxPlayers: Game.MAX_PLAYERS,
  watchers: 20,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Na warte!", "Glück gehabt!", "Knapp daneben!", "Gut gespielt!"],

  newRoom: (msg) => ({ goal: Game.normGoal(msg.goal), meld: Game.normMeld(msg.meld), level: Game.normLevel(msg.level) }),
  roomFields: (room) => ({ goal: room.goal, meld: room.meld, level: room.level || 2 }),
  settings(room, msg) { // the host changes these in the waiting room
    if (msg.goal != null) room.goal = Game.normGoal(msg.goal);
    if (msg.meld != null) room.meld = Game.normMeld(msg.meld);
    if (msg.level != null) room.level = Game.normLevel(msg.level);
  },
  newGame: (room, players) => Game.newGame(players.map((m) => ({ name: m.name, bot: m.bot, avatar: m.avatar })), room.goal, room.meld, room.level),

  // The computer paces itself in the engine (like a person); the browser uses the same Game.botPlan for single player.
  botPlan(room, ctx) { const p = Game.botPlan(room.state); if (p && process.env.BOT_MS) p.delay = ctx.BOT_MS; return p; },
});
