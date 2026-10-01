// Monopoly server: the shared Spieleabend room server (../shared/room-server.js) with this game's
// engine. Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const Game = require("./public/game.js");

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game,
  id: "monopoly",
  title: "Monopoly",
  maxPlayers: Game.MAX_PLAYERS,
  watchers: 20,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Na warte!", "Glück gehabt!", "Knapp daneben!", "Gut gespielt!"],

  newRoom: (msg) => ({ goal: Game.normGoal(msg.goal), rules: Game.normRules(msg.rules), level: Game.normLevel(msg.level) }),
  roomFields: (room) => ({ goal: room.goal, rules: room.rules, level: room.level || 2 }),
  settings(room, msg) { // the host changes these in the waiting room
    if (msg.goal != null) room.goal = Game.normGoal(msg.goal);
    if (msg.level != null) room.level = Game.normLevel(msg.level);
    if (msg.rules && typeof msg.rules === "object") room.rules = Game.normRules(msg.rules, room.rules);
  },
  newGame: (room, players) => Game.newGame(players.map((m) => ({ name: m.name, bot: m.bot, avatar: m.avatar })), room.goal, room.rules, room.level),

  // Not only the player on turn acts: auctions and trade offers ask other seats, so the engine says who moves next and when.
  botPlan(room, ctx) {
    const p = Game.botPlan(room.state);
    if (p && process.env.BOT_MS) p.delay = ctx.BOT_MS;
    return p;
  },
});
