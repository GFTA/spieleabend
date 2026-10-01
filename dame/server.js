// Dame server: the shared Spieleabend room server (../shared/room-server.js) with this game's
// engine. Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const Game = require("./public/game.js");

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game,
  id: "dame",
  title: "Dame",
  maxPlayers: Game.MAX_PLAYERS,
  watchers: 20,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Na warte!", "Glück gehabt!", "Knapp daneben!", "Gut gespielt!"],

  newRoom: (msg) => ({ goal: Game.normGoal(msg.goal), rules: Game.normRules(msg.rules), level: Game.normLevel(msg.level) }),
  roomFields: (room) => ({ goal: room.goal, rules: room.rules, level: room.level == null ? 2 : room.level }),
  settings(room, msg) { // goal, house rules and computer strength
    if (msg.rules) room.rules = Game.normRules(msg.rules);
    if (msg.goal != null) room.goal = Game.normGoal(msg.goal);
    if (msg.level != null) room.level = Game.normLevel(msg.level);
  },
  newGame: (room, players) => Game.newGame(players.map((m) => ({ name: m.name, bot: m.bot, avatar: m.avatar })), room.goal, room.rules, room.level),
});
