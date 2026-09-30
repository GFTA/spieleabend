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

  // everybody plays at once: keep scheduling the slowest unfinished computer opponent
  botPlan(room, ctx) {
    const S = room.state;
    if (!S || S.phase !== "play" || !Game.botMove) return null;
    const bots = S.players.map((p, i) => i).filter((i) => S.players[i].bot && !S.players[i].done && !S.players[i].out);
    if (!bots.length) return null;
    bots.sort((a, b) => S.players[a].filled - S.players[b].filled || a - b);
    const pi = bots[0];
    const base = Game.botDelayMs(S.level);
    // tests set BOT_MS very low; production keeps level-based pacing around the shared default
    const delay = ctx && ctx.BOT_MS ? Math.max(30, Math.round(ctx.BOT_MS * (base / 900))) : base;
    return { key: `bot:${pi}:${S.players[pi].filled}:${S.round}`, delay, pi };
  },
});
