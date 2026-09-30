// @@TITLE@@ server: the shared Spieleabend room server (../shared/room-server.js) with this game's
// engine. Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const Game = require("./public/game.js");

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game,
  id: "@@ID@@",
  title: "@@TITLE@@",
  maxPlayers: Game.MAX_PLAYERS,
  watchers: 20,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Na warte!", "Glück gehabt!", "Knapp daneben!", "Gut gespielt!"],

  newRoom: (msg) => ({ goal: Game.normGoal(msg.goal), target: Game.normTarget(msg.target), level: Game.normLevel(msg.level) }),
  roomFields: (room) => ({ goal: room.goal, target: room.target, level: room.level || 2 }),
  settings(room, msg) { // the host changes these in the waiting room
    if (msg.goal != null) room.goal = Game.normGoal(msg.goal);
    if (msg.target != null) room.target = Game.normTarget(msg.target);
    if (msg.level != null) room.level = Game.normLevel(msg.level);
  },
  newGame: (room, players) => Game.newGame(players.map((m) => ({ name: m.name, bot: m.bot, avatar: m.avatar })), room.goal, room.target, room.level),

  // Turn-based games need nothing more: the shared server lets the computer move after BOT_MS.
  // A game where everybody plays at once (like Sudoku) puts the pacing into the engine instead:
  //   Game.botPlan(state) -> { pi, delay, key } | null   (human pace, key changes only when the plan does)
  //   botPlan(room, ctx) { const p = Game.botPlan(room.state); if (p && process.env.BOT_MS) p.delay = ctx.BOT_MS; return p; },
  // The browser calls the same Game.botPlan for single player, so server and client never differ.
});
