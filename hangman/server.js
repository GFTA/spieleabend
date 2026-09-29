// Galgenmännchen server: the shared Spieleabend room server (../shared/room-server.js) with the
// Hangman engine. Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const Game = require("./public/game.js");

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game,
  id: "hangman",
  title: "Galgenmännchen",
  maxPlayers: Game.MAX_PLAYERS,
  watchers: 20,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Na warte!", "Glück gehabt!", "Knapp daneben!", "Gut gespielt!"],

  newRoom: (msg) => ({ goal: Game.normGoal(msg.goal), pick: Game.normPick(msg.pick), rules: Game.normRules(msg.rules), level: Game.normLevel(msg.level) }),
  roomFields: (room) => ({ goal: room.goal, pick: room.pick, rules: room.rules, level: room.level == null ? 2 : room.level }),
  settings(room, msg) { // rounds, who picks the word, house rules and computer strength
    if (msg.rules) room.rules = Game.normRules(msg.rules);
    if (msg.goal != null) room.goal = Game.normGoal(msg.goal);
    if (msg.pick != null) room.pick = Game.normPick(msg.pick);
    if (msg.level != null) room.level = Game.normLevel(msg.level);
  },
  newGame: (room, players) => Game.newGame(players.map((m) => ({ name: m.name, bot: m.bot, avatar: m.avatar })), room.goal, room.pick, room.rules, room.level),
  // leaving a running game: out of this round (a chooser's word becomes a random one)
  leaveGame(room, pid, { apply }) {
    if (room.state.phase !== "roundEnd" && !room.state.players[pid].out) apply(room, pid, { t: "giveup" });
  }
});
