// Mensch-ärgere-dich-nicht server: the shared Spieleabend room server (../shared/room-server.js)
// with the MÄDN engine. Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const Game = require("./public/game.js");

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game,
  id: "maedn",
  title: "Mensch ärgere dich nicht",
  maxPlayers: Game.MAX_PLAYERS,
  watchers: 20,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Na warte!", "Glück gehabt!", "Ärger dich nicht!", "Gut gespielt!"],

  newRoom: (msg) => ({ goal: Game.normGoal(msg.goal), rules: Game.normRules(msg.rules), level: Game.normLevel(msg.level) }),
  roomFields: (room) => ({ goal: room.goal, rules: room.rules, level: room.level == null ? 2 : room.level }),
  settings(room, msg) { // house rules, goal and computer strength
    if (msg.rules) room.rules = Game.normRules(msg.rules);
    if (msg.goal != null) room.goal = Game.normGoal(msg.goal);
    if (msg.level != null) room.level = Game.normLevel(msg.level);
  },
  newGame: (room, players) => Game.newGame(players.map((m) => ({ name: m.name, bot: m.bot, avatar: m.avatar })), room.goal, room.rules, room.level),
  // leaving a running game: the computer takes over the seat
  leaveGame(room, pid) {
    if (room.state.phase !== "play") return;
    const m = room.members[pid];
    room.members[pid] = { name: m.name, bot: true, secret: null, avatar: Game.BOT_AVATAR };
    room.state.players[pid].bot = true;
    Game.resetClock(room.state);
    room.touched = Date.now();
  }
});
