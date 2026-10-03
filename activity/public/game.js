// Activity engine. Pure state + rules, shared by the browser (single player) and the Node server
// (online). No DOM, no I/O. One player at a time gets a word and has to get it across: draw it,
// explain it or act it out. Everybody else types guesses; the faster, the more points. Each human
// player is "on" the same number of times. The computers only guess, they never perform.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ActivityGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 8;
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip", "Pixel Paula", "Byte Ben", "Turbo Tina", "Nano Nick", "Zack Zora", "Bit Bruno"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi" };
  const GOALS = { 1: "1 Durchgang", 2: "2 Durchgänge", 3: "3 Durchgänge" };
  const TIMES = { 1: 50000, 2: 75000, 3: 100000 };
  const TIME_LABELS = { 1: "Kurz", 2: "Normal", 3: "Lang" };
  const MODES = { draw: "Zeichnen", explain: "Erklären", mime: "Pantomime" };
  const MODE_BIT = { draw: 1, explain: 2, mime: 4 };
  const MODE_HELP = {
    draw: "Zeichne den Begriff. Keine Buchstaben oder Zahlen, und nicht sprechen.",
    explain: "Erkläre den Begriff mit Worten. Den Begriff selbst und Teile davon darfst du nicht sagen.",
    mime: "Stelle den Begriff dar. Nicht sprechen und nicht auf Dinge zeigen."
  };
  const PREP_MS = 20000, REVEAL_MS = 5500;
  const CANVAS_W = 1000, CANVAS_H = 750;
  const PALETTE = ["#1a1426", "#e0393e", "#f4a31b", "#f2d13a", "#3fb86b", "#2f8fe0", "#7a4fd0", "#c98a5b", "#ffffff"];
  const WIDTHS = [4, 9, 18, 34];
  const MAX_OPS = 80, MAX_NUMS = 600, MAX_STROKES = 400, MAX_POINTS = 8000;

  // Words by mode and difficulty (easy, medium, hard). "A|B" gives alternatives that also count.
  const split = (s) => s.split(",").map((w) => w.trim()).filter(Boolean);
  const WORDS = {
    draw: [
      split("Haus,Sonne,Baum,Katze,Hund,Fisch,Blume,Auto,Apfel,Mond,Stern,Herz,Schlange,Vogel,Schmetterling,Fahrrad,Brille,Schuh,Tisch,Stuhl,Eis,Banane,Pizza,Ball,Boot,Regenschirm,Uhr,Schlüssel,Krone,Wolke,Pilz,Kuh,Ente,Torte,Zug,Flugzeug,Lampe,Telefon,Buch,Zahnbürste"),
      split("Leuchtturm,Schaukel,Regenbogen,Vulkan,Roboter,Fernseher,Gitarre,Schneemann,Nashorn,Wasserfall,Hängematte,Kaktus,Skateboard,Pinguin,Hubschrauber,Burg,Zelt,Fallschirm,Eisbär,Piratenschiff,Kühlschrank,Staubsauger,Schildkröte,Känguru,Fernglas,Waschmaschine,Raumschiff,Dinosaurier,Hamburger,Windmühle,Wecker,Briefkasten,Rakete,Zirkus,Spinne,Krokodil,Feuerwehr,Sanduhr,Trampolin,Kürbis"),
      split("Sonnenfinsternis,Zeitmaschine,Hochzeit,Erdbeben,Wettervorhersage,Stau,Langeweile,Mülltrennung,Fußgängerzone,Schlafwandler,Sprachassistent,Gänsehaut,Heimweh,Schnitzeljagd,Sackgasse,Zebrastreifen,Wasserrutsche,Flaschenpost,Gewitter,Detektiv,Kettenreaktion,Wanderdüne,Spiegelei,Mitternacht,Vogelscheuche")
    ],
    explain: [
      split("Urlaub,Geburtstag,Schule,Zahnarzt,Supermarkt,Schokolade,Weihnachten,Fußball,Kino,Handy,Frühstück,Strand,Regen,Computer,Krankenhaus,Bäckerei,Sommer,Freund,Spielplatz,Lehrer,Zirkus,Eisdiele,Bibliothek,Friseur,Schwimmbad"),
      split("Bewerbungsgespräch,Steuererklärung,Fernbedienung,Navigationsgerät,Wochenende,Kreuzworträtsel,Einkaufswagen,Schlüsseldienst,Rettungsgasse,Reisepass,Waschsalon,Lieferdienst,Sonnenbrand,Notausgang,Wohngemeinschaft,Speisekarte,Vorfahrt,Gartenzwerg,Mikrowelle,Raumfahrt,Wasserwaage,Schlussverkauf,Hausaufgaben,Kontoauszug,Sonnenaufgang"),
      split("Inflation,Demokratie,Nachhaltigkeit,Gerechtigkeit,Schnapsidee,Fernweh,Ironie,Lampenfieber,Kompromiss,Datenschutz,Gewohnheit,Kopfkino,Prokrastination,Schwarzarbeit,Zeitverschwendung,Nostalgie,Selbstvertrauen,Bürokratie,Aberglaube,Eigentor,Perspektive,Klimawandel,Wettbewerb,Gleichgewicht,Glückskeks")
    ],
    mime: [
      split("Schlafen,Duschen,Angeln,Gitarre spielen|Gitarre,Zähne putzen|Zähneputzen,Tanzen,Schwimmen,Telefonieren,Kochen,Fußball spielen|Fußball,Lesen,Singen,Radfahren|Fahrrad fahren,Weinen,Niesen,Joggen|Laufen,Skifahren|Ski fahren,Fotografieren,Essen,Husten,Lachen,Klatschen"),
      split("Zelt aufbauen,Baby wickeln,Bungeejumping|Bungee-Jumping,Tauchen,Rasenmähen|Rasen mähen,Luftballon aufblasen,Auto waschen,Pizza backen,Surfen,Bowling spielen|Bowling,Geschenk auspacken,Haare schneiden,Marathon laufen|Marathon,Hula-Hoop,Staubsaugen,Schneemann bauen,Seilspringen,Fenster putzen,Zirkusdirektor,Kellner,Jongleur,Cowboy,Angeln gehen"),
      split("Weltraumspaziergang,Kuh melken,Vorstellungsgespräch,Verkehrspolizist,Dirigent,Zauberer|Magier,Bauchtanz,Zeitlupe,Schiffbruch,Roboter,Pinguin,Dornröschen,Rotkäppchen,Schlafwandeln,Schluckauf,Briefmarke lecken,Schnecke,Superheld,Zahnarztbesuch,Gewichtheber,Torwart,Opernsänger")
    ]
  };

  const normGoal = (n) => (GOALS[+n] ? +n : 1);
  const normTime = (n) => (TIMES[+n] ? +n : 2);
  const normLevel = (n) => (LEVELS[+n] ? +n : 2);
  const normModes = (n) => (Number.isInteger(+n) && +n >= 1 && +n <= 7 ? +n : 7);
  const modeList = (bits) => Object.keys(MODE_BIT).filter((m) => normModes(bits) & MODE_BIT[m]);
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const timeMs = (S) => TIMES[S.time] || TIMES[2];

  // ---------- guessing ----------
  const ARTICLES = ["der", "die", "das", "ein", "eine", "einen", "dem", "den"];
  const norm = (s) => {
    const words = String(s).toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length > 1 && ARTICLES.includes(words[0])) words.shift();
    return words.join("").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  };
  function lev(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  // "ok" = counts as the word (typos and a plural ending are fine), "close" = nearly, "no"
  function match(alias, text) {
    const g = norm(text);
    if (!g) return "no";
    let res = "no";
    for (const a of alias.map(norm)) {
      if (!a) continue;
      if (g === a) return "ok";
      if (a.length >= 4 && ["n", "e", "s", "en", "er", "es"].includes(g.slice(a.length)) && g.startsWith(a)) return "ok";
      const d = lev(g, a);
      if (a.length >= 11 ? d <= 2 : a.length >= 6 ? d <= 1 : false) return "ok";
      if ((a.length >= 6 && d <= 2) || (a.length >= 4 && d <= 1) || (a.length >= 5 && g.length >= 4 && (g.includes(a) || a.includes(g)))) res = "close";
    }
    return res;
  }

  function pickWord(S, mode) {
    const used = (S.used[mode] = S.used[mode] || []);
    const lists = WORDS[mode];
    for (let tries = 0; tries < 2; tries++) {
      const r = Math.random(), d = r < 0.45 ? 1 : r < 0.8 ? 2 : 3;
      for (const dd of [d, 1, 2, 3]) {
        const pool = lists[dd - 1].filter((w) => !used.includes(w));
        if (pool.length) {
          const raw = pool[rand(pool.length)];
          used.push(raw);
          const alias = raw.split("|").map((x) => x.trim());
          return { text: alias[0], alias, d: dd };
        }
      }
      used.length = 0; // everything was played: start over
    }
    return { text: "Haus", alias: ["Haus"], d: 1 };
  }

  const isLetter = (ch) => /[\p{L}\p{N}]/u.test(ch);
  function pattern(S) {
    const t = S.word.text, shown = S.hintOrder.slice(0, S.hints);
    return Array.from(t).map((ch, i) => (!isLetter(ch) || shown.includes(i) ? ch : "_")).join("");
  }

  // ---------- setup ----------
  // players: [{ name, bot, avatar }]; goal: how often each human is on; modes: bit mask 1 draw, 2 explain, 4 mime;
  // time: 1..3 seconds per turn; level: how well the computers guess
  function newGame(players, goal, modes, time, level) {
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p, i) => ({ name: p.name, bot: !!p.bot, avatar: avatarOf(p, i), wins: 0, score: 0, acted: 0 })),
      goal: normGoal(goal), modes: normModes(modes), time: normTime(time), level: normLevel(level),
      round: 0, starter: 0, last: null, used: {}
    };
    S.starter = rand(S.players.length);
    startRound(S);
    return S;
  }

  // a new game: everybody's score starts again, wins stay
  function startRound(S) {
    S.round++;
    S.last = null;
    S.hist = [];
    S.turn = 0;
    S.idx = -1;
    S.players.forEach((p) => { p.score = 0; p.acted = 0; });
    const humans = S.players.map((p, i) => i).filter((i) => !S.players[i].bot);
    const rounds = S.goal * (humans.length === 1 ? 3 : 1); // alone it would be over too fast
    const start = humans.length ? S.starter % humans.length : 0;
    S.order = [];
    for (let r = 0; r < rounds; r++) for (let k = 0; k < humans.length; k++) S.order.push(humans[(start + k) % humans.length]);
    S.starter = (S.starter + 1) % S.players.length;
    S.turns = S.order.length;
    nextTurn(S, []);
  }

  function nextTurn(S, events) {
    do S.idx++; while (S.idx < S.order.length && S.players[S.order[S.idx]].bot); // computers that took over a seat never perform
    if (S.idx >= S.order.length) return endRound(S, events);
    const pi = S.order[S.idx], mode = modeList(S.modes)[rand(modeList(S.modes).length)];
    S.turn++;
    S.cur = pi;
    S.mode = mode;
    S.word = pickWord(S, mode);
    S.swapped = false;
    S.phase = "prep";
    S.until = Date.now() + PREP_MS;
    S.solved = {}; S.feed = []; S.fn = 0; S.draw = []; S.dn = 0; S.hints = 0; S.hintOrder = []; S.bots = {}; S.lastTurn = null;
    events.push({ t: "turn", pi, mode });
  }

  function startPlay(S, events) {
    const now = Date.now(), total = timeMs(S);
    S.phase = "play";
    S.startedAt = now;
    S.total = total;
    S.until = now + total;
    S.hints = 0;
    const idx = Array.from(S.word.text).map((ch, i) => (isLetter(ch) ? i : -1)).filter((i) => i >= 0);
    S.hintOrder = shuffle(idx);
    S.maxHints = Math.min(2, Math.floor(idx.length / 3));
    // when the computers guess: a plan made now, played by botPlan/botMove
    const base = { 1: 0.55, 2: 0.8, 3: 0.95 }[S.level] * (S.mode === "explain" ? 1 : 0.9) * (1.05 - 0.12 * S.word.d);
    const early = { 1: 0.3, 2: 0.2, 3: 0.12 }[S.level];
    S.bots = {};
    S.players.forEach((p, i) => {
      if (!p.bot || i === S.cur) return;
      const q = [];
      const wrongs = Math.random() < 0.5 ? 1 + rand(2) : 0;
      const pool = WORDS[S.mode].flat().map((w) => w.split("|")[0]).filter((w) => w !== S.word.text);
      for (let k = 0; k < wrongs; k++) q.push({ at: Math.round(total * (0.1 + Math.random() * 0.5)), text: pool[rand(pool.length)], ok: false });
      if (Math.random() < base) q.push({ at: Math.round(total * (early + Math.random() * 0.62)), text: S.word.text, ok: true });
      S.bots[i] = q.sort((x, y) => x.at - y.at);
    });
    events.push({ t: "go" });
  }

  const guessers = (S) => S.players.map((p, i) => i).filter((i) => i !== S.cur);

  function endTurn(S, reason, events) {
    const solvers = Object.keys(S.solved).map(Number);
    S.players[S.cur].acted++;
    S.lastTurn = { pi: S.cur, mode: S.mode, word: S.word.text, d: S.word.d, solvers, got: Object.assign({}, S.solved), reason };
    S.hist.push({ turn: S.turn, pi: S.cur, mode: S.mode, word: S.word.text, d: S.word.d, solvers });
    if (S.hist.length > 40) S.hist.shift();
    S.phase = "reveal";
    S.until = Date.now() + REVEAL_MS;
    events.push({ t: "reveal", pi: S.cur, word: S.word.text, solvers, reason });
  }

  function endRound(S, events) {
    const top = Math.max(...S.players.map((p) => p.score));
    const winners = top > 0 ? S.players.map((p, i) => i).filter((i) => S.players[i].score === top) : [];
    winners.forEach((i) => { S.players[i].wins++; });
    S.phase = "roundEnd";
    S.cur = -1;
    S.mode = null;
    S.last = { winners, over: true, turns: S.turn, top };
    events.push({ t: "end", winners });
  }

  // ---------- time ----------
  function nextDeadline(S) {
    if (!S || !S.until) return -1;
    let at = S.until;
    if (S.phase === "play") {
      if (S.hints < (S.maxHints || 0)) at = Math.min(at, S.startedAt + S.total * (S.hints === 0 ? 0.5 : 0.75));
    } else if (S.phase !== "prep" && S.phase !== "reveal") return -1;
    return Math.max(0, at - Date.now());
  }

  // Advance whatever has run out (hint, prepare time, turn time, reveal time). Returns events.
  function tick(S) {
    const events = [], now = Date.now();
    if (!S || !S.until) return events;
    if (S.phase === "prep" && now >= S.until) startPlay(S, events);
    else if (S.phase === "play") {
      if (now >= S.until) endTurn(S, "time", events);
      else if (S.hints < (S.maxHints || 0) && now >= S.startedAt + S.total * (S.hints === 0 ? 0.5 : 0.75)) { S.hints++; events.push({ t: "hint", n: S.hints }); }
    } else if (S.phase === "reveal" && now >= S.until) nextTurn(S, events);
    return events;
  }

  // ---------- actions ----------
  // Actions: {t:"go"} {t:"swap"} {t:"giveup"} {t:"guess",text} {t:"skip"} {t:"next"}
  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events });
    const ok = () => ({ ok: true, events });
    const P = S.players[pi];
    if (!P) return fail("Unbekannter Spieler.");
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Das Spiel läuft noch.");
      startRound(S);
      return ok();
    }
    if (S.phase === "roundEnd") return fail("Gerade spielt niemand.");
    if (a.t === "skip") { // a computer holds the seat of whoever is on: nothing to perform
      if (!S.players[S.cur] || !S.players[S.cur].bot || (S.phase !== "prep" && S.phase !== "play")) return fail("Niemand muss übersprungen werden.");
      S.players[S.cur].acted++;
      nextTurn(S, events);
      return ok();
    }
    if (a.t === "guess") {
      if (S.phase !== "play") return fail("Gerade wird nicht geraten.");
      if (pi === S.cur) return fail("Du darfst nicht mitraten.");
      if (S.solved[pi] != null) return fail("Du hast den Begriff schon erraten.");
      if (typeof a.text !== "string") return fail("Schreib einen Begriff.");
      const text = a.text.replace(/\s+/g, " ").trim().slice(0, 40);
      if (!text) return fail("Schreib einen Begriff.");
      const q = S.bots && S.bots[pi];
      if (P.bot && q && q.length) q.shift();
      const res = match(S.word.alias, text);
      if (res !== "ok") {
        S.feed.push({ n: S.fn++, pi, text, close: res === "close" });
        if (S.feed.length > 30) S.feed.shift();
        events.push({ t: "guess", pi, close: res === "close" });
        return ok();
      }
      const left = Math.max(0, S.until - Date.now()), speed = left > S.total * 2 / 3 ? 3 : left > S.total / 3 ? 2 : 1;
      const pts = S.word.d + speed, give = S.word.d >= 3 ? 3 : 2;
      S.solved[pi] = pts;
      P.score += pts;
      S.players[S.cur].score += give;
      S.feed.push({ n: S.fn++, pi, solved: true, pts });
      if (S.feed.length > 30) S.feed.shift();
      events.push({ t: "solve", pi, pts, first: Object.keys(S.solved).length === 1 });
      if (guessers(S).every((i) => S.solved[i] != null)) endTurn(S, "all", events);
      return ok();
    }
    if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);
    if (a.t === "go") {
      if (S.phase !== "prep") return fail("Es läuft schon.");
      startPlay(S, events);
      return ok();
    }
    if (a.t === "swap") {
      if (S.phase !== "prep") return fail("Tauschen geht nur vor dem Start.");
      if (S.swapped) return fail("Du hast schon getauscht.");
      S.swapped = true;
      S.word = pickWord(S, S.mode);
      events.push({ t: "swap", pi });
      return ok();
    }
    if (a.t === "giveup") {
      if (S.phase === "prep") { P.acted++; events.push({ t: "giveup", pi }); nextTurn(S, events); return ok(); }
      if (S.phase !== "play") return fail("Gerade läuft nichts.");
      events.push({ t: "giveup", pi });
      endTurn(S, "giveup", events);
      return ok();
    }
    return fail("Unbekannte Aktion.");
  }

  // ---------- drawing ----------
  // ops: ["b", colour, width, x, y] begins a stroke, ["m", x, y, x, y, ...] extends it, ["u"] takes the last stroke
  // back, ["x"] clears the page. Strokes live in S.draw; S.dn counts accepted batches so a viewer can tell it missed one.
  function draw(S, pi, ops) {
    const fail = (error) => ({ ok: false, error });
    if (S.phase !== "play" || S.mode !== "draw" || pi !== S.cur) return fail("Gerade wird nicht gezeichnet.");
    if (!Array.isArray(ops) || !ops.length || ops.length > MAX_OPS) return fail("Ungültige Zeichnung.");
    const strokes = S.draw.slice(), clean = [];
    let nums = 0, points = strokes.reduce((n, s) => n + s.p.length / 2, 0);
    const coord = (v, max) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : null);
    for (const op of ops) {
      if (!Array.isArray(op) || typeof op[0] !== "string") return fail("Ungültige Zeichnung.");
      nums += op.length;
      if (nums > MAX_NUMS) return fail("Ungültige Zeichnung.");
      if (op[0] === "b") {
        const c = op[1], w = op[2], x = coord(op[3], CANVAS_W), y = coord(op[4], CANVAS_H);
        if (op.length !== 5 || !Number.isInteger(c) || c < 0 || c >= PALETTE.length || !Number.isInteger(w) || w < 0 || w >= WIDTHS.length || x == null || y == null) return fail("Ungültige Zeichnung.");
        if (strokes.length >= MAX_STROKES || points + 1 > MAX_POINTS) return fail("Die Zeichenfläche ist voll. Lösche etwas.");
        strokes.push({ c, w, p: [x, y] }); points++;
        clean.push(["b", c, w, x, y]);
      } else if (op[0] === "m") {
        if (op.length < 3 || op.length % 2 === 0 || !strokes.length) return fail("Ungültige Zeichnung.");
        const add = [];
        for (let i = 1; i < op.length; i += 2) {
          const x = coord(op[i], CANVAS_W), y = coord(op[i + 1], CANVAS_H);
          if (x == null || y == null) return fail("Ungültige Zeichnung.");
          add.push(x, y);
        }
        if (points + add.length / 2 > MAX_POINTS) return fail("Die Zeichenfläche ist voll. Lösche etwas.");
        const last = strokes[strokes.length - 1];
        strokes[strokes.length - 1] = { c: last.c, w: last.w, p: last.p.concat(add) };
        points += add.length / 2;
        clean.push(["m"].concat(add));
      } else if (op[0] === "u") { strokes.pop(); points = strokes.reduce((n, s) => n + s.p.length / 2, 0); clean.push(["u"]); }
      else if (op[0] === "x") { strokes.length = 0; points = 0; clean.push(["x"]); }
      else return fail("Ungültige Zeichnung.");
    }
    S.draw = strokes;
    S.dn++;
    return { ok: true, ops: clean, from: S.dn - 1, n: S.dn };
  }
  const drawFull = (S) => ({ n: S.dn || 0, strokes: S.draw || [] });

  // ---------- computer players ----------
  // The next computer guess: { pi, delay, key } or null. The server and the browser both ask this.
  function botPlan(S) {
    if (S.phase === "prep" || S.phase === "play") {
      if (S.players[S.cur] && S.players[S.cur].bot) return { pi: S.cur, delay: 1200, key: `skip:${S.round}:${S.turn}` };
    }
    if (S.phase !== "play") return null;
    let best = null;
    for (const [k, q] of Object.entries(S.bots || {})) {
      const pi = +k;
      if (!q.length || S.solved[pi] != null || !S.players[pi] || !S.players[pi].bot) continue;
      if (!best || q[0].at < best.at) best = { pi, at: q[0].at, n: q.length };
    }
    if (!best) return null;
    return { pi: best.pi, delay: Math.max(250, S.startedAt + best.at - Date.now()), key: `g:${S.round}:${S.turn}:${best.pi}:${best.n}` };
  }
  function botMove(S, pi) {
    if (S.phase !== "play" && S.phase !== "prep") return null;
    if (pi === S.cur) return S.players[pi].bot ? { t: "skip" } : null;
    const q = S.bots && S.bots[pi];
    if (S.phase !== "play" || !q || !q.length || S.solved[pi] != null) return null;
    return { t: "guess", text: q[0].text };
  }

  // ---------- what a player sees ----------
  // Only whoever is on sees the word before it is solved; pi only marks who "me" is.
  function view(S, pi) {
    const me = S.players[pi] ? pi : -1;
    const playing = S.phase === "prep" || S.phase === "play";
    const showWord = playing && S.word && (pi === S.cur || S.solved[pi] != null);
    return {
      me, phase: S.phase, cur: S.cur, turn: S.turn, turns: S.turns, round: S.round, goal: S.goal, modes: S.modes, time: S.time, level: S.level || 2,
      mode: S.mode, help: S.mode ? MODE_HELP[S.mode] : "",
      left: S.until && S.phase !== "roundEnd" ? Math.max(0, S.until - Date.now()) : 0, total: S.phase === "play" ? S.total : S.phase === "prep" ? PREP_MS : REVEAL_MS,
      word: showWord ? S.word.text : null, d: showWord ? S.word.d : 0,
      pattern: playing && S.word && S.phase === "play" ? pattern(S) : null, swapped: !!S.swapped, hints: S.hints || 0,
      players: S.players.map((p, i) => ({ name: p.name, bot: p.bot, avatar: avatarOf(p, i), wins: p.wins, score: p.score, acted: p.acted || 0, solved: playing && S.solved[i] != null ? S.solved[i] : null })),
      feed: playing ? S.feed.slice() : [], dn: S.dn || 0,
      lastTurn: S.phase === "reveal" ? S.lastTurn : null, hist: S.hist.slice(), last: S.last, order: S.order.slice(S.idx + 1, S.idx + 5).filter((i) => !S.players[i].bot)
    };
  }

  return {
    MAX_PLAYERS, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, GOALS, TIMES, TIME_LABELS, MODES, MODE_BIT, MODE_HELP, WORDS, PALETTE, WIDTHS,
    PREP_MS, REVEAL_MS, CANVAS_W, CANVAS_H, normGoal, normTime, normLevel, normModes, modeList, norm, match,
    newGame, startRound, act, tick, nextDeadline, draw, drawFull, botPlan, botMove, view
  };
});
