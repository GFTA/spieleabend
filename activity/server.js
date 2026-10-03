// Activity server: the shared Spieleabend room server (../shared/room-server.js) with this game's
// engine. Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
// Strokes of the drawing do not go through the normal state broadcast: the person on sends small
// batches ({t:"draw"}), the server checks them and passes them on to everybody else in the room.
"use strict";

const Game = require("./public/game.js");

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game,
  id: "activity",
  title: "Activity",
  maxPlayers: Game.MAX_PLAYERS,
  watchers: 20,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Na warte!", "Glück gehabt!", "Knapp daneben!", "Gut gespielt!"],

  newRoom: (msg) => ({ goal: Game.normGoal(msg.goal), modes: Game.normModes(msg.modes), time: Game.normTime(msg.time), level: Game.normLevel(msg.level) }),
  roomFields: (room) => ({ goal: room.goal, modes: room.modes, time: room.time, level: room.level || 2 }),
  settings(room, msg) { // the host changes these in the waiting room
    if (msg.goal != null) room.goal = Game.normGoal(msg.goal);
    if (msg.modes != null) room.modes = Game.normModes(msg.modes);
    if (msg.time != null) room.time = Game.normTime(msg.time);
    if (msg.level != null) room.level = Game.normLevel(msg.level);
  },
  newGame: (room, players) => Game.newGame(players.map((m) => ({ name: m.name, bot: m.bot, avatar: m.avatar })), room.goal, room.modes, room.time, room.level),

  // the computers only guess; the engine plans when (human pace unless BOT_MS is set for tests)
  botPlan(room, ctx) { const p = Game.botPlan(room.state); if (p && process.env.BOT_MS) p.delay = ctx.BOT_MS; return p; },

  handlers: {
    draw(room, msg, ctx) {
      const S = room.state, pi = ctx.ws.pid;
      if (!S || pi == null || pi < 0) return false;
      const res = Game.draw(S, pi, msg.ops);
      if (!res.ok) { ctx.err(res.error); return false; }
      const out = JSON.stringify({ t: "draw", from: res.from, n: res.n, ops: res.ops });
      for (const ws of ctx.sockets.get(room.code) || []) if (ws !== ctx.ws && ws.pid != null && ws.readyState === 1) ws.send(out);
      return false; // no state broadcast for strokes
    },
    drawsync(room, msg, ctx) { // somebody missed a batch or joined late: send the whole page
      if (!room.state) return false;
      ctx.send(ctx.ws, Object.assign({ t: "draw", full: true }, Game.drawFull(room.state)));
      return false;
    }
  }
});
