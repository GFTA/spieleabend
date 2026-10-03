// Achievements of the player profile, worked out from the statistics (nothing extra is stored).
// Used by the start page (summary line, "new achievement" note) and by profile.html (the full list).
(function () {
  "use strict";
  const sum = (st, f) => Object.values(st).reduce((n, s) => n + f(s), 0);
  const count = (st, f) => Object.values(st).filter(f).length;
  const best = (st) => Math.max(0, ...Object.values(st).map((s) => s.bs));
  const mins = (a) => Object.values(a.play || {}).reduce((n, m) => n + m, 0);
  const ACH = [
    { id: "first", icon: "🎲", name: "Erste Partie", desc: "Spiel eine Partie zu Ende", goal: 1, val: (c) => sum(c.stats, (s) => s.g) },
    { id: "win1", icon: "🏆", name: "Erster Sieg", desc: "Gewinne eine Partie", goal: 1, val: (c) => sum(c.stats, (s) => s.w) },
    { id: "g10", icon: "🍻", name: "Stammgast", desc: "10 Partien gespielt", goal: 10, val: (c) => sum(c.stats, (s) => s.g) },
    { id: "g50", icon: "🎖️", name: "Spielefreak", desc: "50 Partien gespielt", goal: 50, val: (c) => sum(c.stats, (s) => s.g) },
    { id: "g100", icon: "👑", name: "Legende", desc: "100 Partien gespielt", goal: 100, val: (c) => sum(c.stats, (s) => s.g) },
    { id: "win10", icon: "🥇", name: "Siegertyp", desc: "10 Siege", goal: 10, val: (c) => sum(c.stats, (s) => s.w) },
    { id: "win25", icon: "💎", name: "Seriensieger", desc: "25 Siege", goal: 25, val: (c) => sum(c.stats, (s) => s.w) },
    { id: "run3", icon: "🔥", name: "Auf Kurs", desc: "3 Siege in Folge", goal: 3, val: (c) => best(c.stats) },
    { id: "run6", icon: "⚡", name: "Unaufhaltsam", desc: "6 Siege in Folge", goal: 6, val: (c) => best(c.stats) },
    { id: "days3", icon: "📆", name: "Dranbleiben", desc: "3 Tage in Folge gespielt", goal: 3, val: (c) => c.activity.streak || 0 },
    { id: "days7", icon: "🗓️", name: "Wochenserie", desc: "7 Tage in Folge gespielt", goal: 7, val: (c) => c.activity.streak || 0 },
    { id: "hours5", icon: "⏳", name: "Marathon", desc: "5 Stunden gespielt", goal: 300, val: (c) => mins(c.activity), unit: "Min." },
    { id: "explorer", icon: "🧭", name: "Entdecker", desc: "5 verschiedene Spiele gespielt", goal: 5, val: (c) => count(c.stats, (s) => s.g > 0) },
    { id: "versatile", icon: "🎯", name: "Vielseitig", desc: "In 5 verschiedenen Spielen gewonnen", goal: 5, val: (c) => count(c.stats, (s) => s.w > 0) },
    { id: "all", icon: "🌍", name: "Alle Spiele", desc: "Jedes Spiel mindestens einmal gespielt", goal: (c) => c.games.length || 1, val: (c) => (c.games.length ? c.games.filter((x) => c.stats[x.id] && c.stats[x.id].g > 0).length : 0) },
    { id: "online10", icon: "📡", name: "Online dabei", desc: "10 Online-Partien gespielt", goal: 10, val: (c) => sum(c.stats, (s) => s.og) },
    { id: "online5w", icon: "🛰️", name: "Online-Sieger", desc: "5 Online-Partien gewonnen", goal: 5, val: (c) => sum(c.stats, (s) => s.ow) }
  ];
  // ctx: { stats, games: [{id}], activity: { streak, play } }
  function list(ctx) {
    return ACH.map((a) => {
      const goal = typeof a.goal === "function" ? a.goal(ctx) : a.goal, v = Math.min(goal, a.val(ctx));
      return { id: a.id, icon: a.icon, name: a.name, desc: a.desc, goal, val: v, ok: v >= goal, unit: a.unit || "" };
    });
  }
  window.SAAch = { list };
})();
