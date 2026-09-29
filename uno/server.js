// Pass-Uno server: the shared Spieleabend room server (../shared/room-server.js) with the
// Uno engine. Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const Uno = require("./public/game.js");

const GOALS = [0, 250, 500];
const levelOf = (r) => (Uno.BOT_LEVELS[r.botLevel] ? r.botLevel : "normal");
const roomRules = (r) => r.rules || (r.rules = Uno.normRules({ chaos: r.chaos, stack: r.stack }));
const forgotUno = new Map(); // code -> Map of UNO windows -> whether the bot forgets to call

module.exports = require("../shared/room-server.js")({
  dir: __dirname,
  Game: Uno,
  id: "uno",
  title: "Pass-Uno",
  legacyPath: "/pass-uno-server",
  metaName: "pass-uno-version",
  maxPlayers: 10,
  watchers: 20,
  hostHandover: true,
  reactions: ["👍", "😂", "😱", "😡", "🎉", "🙈", "Gut gespielt!", "Uff …", "Beeil dich!", "Na warte!"],

  newRoom: (msg) => ({ goal: GOALS.includes(+msg.goal) ? +msg.goal : 500, rules: Uno.normRules(msg.rules) }),
  roomFields: (room) => ({ goal: room.goal, rules: roomRules(room), botLevel: levelOf(room) }),
  handlers: {
    rules(room, msg, { isHost }) { // host changes house rules in the waiting room
      if (!isHost || room.state) return false;
      room.rules = Uno.normRules(msg.rules);
    },
    goal(room, msg, { isHost }) { // host changes the goal in the waiting room
      if (!isHost || room.state || !GOALS.includes(+msg.goal)) return false;
      room.goal = +msg.goal;
    },
    botLevel(room, msg, { isHost }) {
      if (!isHost || !Uno.BOT_LEVELS[msg.level]) return false;
      room.botLevel = msg.level;
    }
  },
  newGame(room, players) {
    const S = Uno.newGame(players.map((m) => m.name), room.goal, roomRules(room));
    players.forEach((m, i) => { S.players[i].bot = !!m.bot; S.players[i].avatar = m.bot ? "🤖" : m.avatar; });
    return S;
  },

  // a bot moves when it is its turn, or calls UNO (unless it forgets, then it gets the penalty)
  botPlan(room) {
    const S = room.state;
    if (!forgotUno.has(room.code)) forgotUno.set(room.code, new Map());
    const decided = forgotUno.get(room.code); // "pi:until" -> true if the bot forgets, decided once per window
    const forgets = (w) => {
      const k = `${w.pi}:${w.until}`;
      if (!decided.has(k)) decided.set(k, Math.random() > Uno.BOT_UNO[levelOf(room)]);
      return decided.get(k);
    };
    const open = new Set((S.unoWaits || []).map((w) => `${w.pi}:${w.until}`));
    for (const k of decided.keys()) if (!open.has(k)) decided.delete(k);
    const botWait = (S.unoWaits || []).find((w) => S.players[w.pi].bot && !forgets(w));
    if (botWait) return { key: `uno:${S.round}:${S.turn}:${botWait.pi}`, delay: 500 + Math.random() * 900, pi: botWait.pi };
    if (S.players[S.cur].bot) return { key: `bot:${S.round}:${S.turn}:${S.phase}`, delay: 900 + Math.random() * 900, pi: S.cur };
    return null;
  },
  botMove(room, pi, { apply }) {
    const S = room.state;
    const a = Uno.suggest(Uno.view(S, pi), levelOf(room));
    if (!a) return false;
    return apply(room, pi, a).ok || (a.t === "play" && apply(room, pi, { t: S.phase === "drawn" ? "keep" : "draw" }).ok);
  },
  turnClock(room) {
    const S = room.state, cur = S.players[S.cur];
    return roomRules(room).turnTimer && !cur.bot && (S.phase === "play" || S.phase === "drawn") ? `${S.round}:${S.turn}` : null;
  }
});
