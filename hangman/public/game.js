// Galgenmännchen (Hangman) engine. Pure state + rules, shared by the browser (one-phone mode)
// and the Node server (online mode). No DOM, no I/O.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HangmanGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 8;
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip", "Lexi Logik", "Bit Bert", "Wortwurm", "Ada Algo", "Byte Bea", "Kalle Kabel"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi", 0: "Zufällig" };
  const GOALS = [3, 5, 8];                      // rounds per game
  const PICKS = { random: "Zufallswort", player: "Ein Mitspieler" };
  const CLOCK_MS = 20000, CHOOSE_MS = 60000, GRACE = 600;
  const SOLVE_BONUS = 3, HANGED_BONUS = 5;      // solving the word / the chooser when nobody gets it
  // the keyboard: A–Z plus the German umlauts and ß, each its own letter
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜß".split("");
  // German letters from most to least common, the computer's first guesses
  const FREQ = "ENISRATDHULCGMOBWFKZPVÜÄÖJYßXQ".split("");

  // German words by category (upper case, ß kept as its own letter)
  const WORDS = {
    "Tiere": "HUND KATZE PFERD ELEFANT GIRAFFE KROKODIL SCHILDKRÖTE EICHHÖRNCHEN IGEL FUCHS WOLF BÄR LÖWE TIGER ZEBRA NASHORN NILPFERD KÄNGURU PINGUIN DELFIN WAL HAI QUALLE TINTENFISCH SCHMETTERLING BIENE AMEISE MARIENKÄFER REGENWURM SCHNECKE FROSCH EULE ADLER PAPAGEI FLAMINGO STORCH SCHWAN HAMSTER MEERSCHWEINCHEN KANINCHEN ESEL ZIEGE SCHAF KUH SCHWEIN HUHN DACHS WASCHBÄR FLEDERMAUS MAULWURF HIRSCH OTTER KAMEL LAMA AFFE GORILLA",
    "Essen & Trinken": "APFEL BIRNE BANANE ERDBEERE HIMBEERE KIRSCHE ZITRONE ORANGE ANANAS WASSERMELONE KARTOFFEL KAROTTE TOMATE GURKE PAPRIKA ZWIEBEL KNOBLAUCH BROKKOLI SPINAT BROT BREZEL BRÖTCHEN KÄSE BUTTER JOGHURT PFANNKUCHEN SCHNITZEL BRATWURST NUDELN SPAGHETTI PIZZA SUPPE SALAT KUCHEN SCHOKOLADE GUMMIBÄRCHEN KEKS HONIG MARMELADE MÜSLI KAFFEE TEE KAKAO APFELSAFT LIMONADE MILCH WASSER EIS POPCORN",
    "Zuhause": "KÜCHE BADEZIMMER SCHLAFZIMMER WOHNZIMMER KELLER DACHBODEN TREPPE FENSTER TÜR SOFA SESSEL TISCH STUHL SCHRANK REGAL BETT KISSEN DECKE TEPPICH VORHANG LAMPE SPIEGEL KÜHLSCHRANK HERD BACKOFEN WASCHMASCHINE STAUBSAUGER BESEN TELLER GABEL LÖFFEL MESSER TASSE PFANNE KOCHTOPF BADEWANNE DUSCHE ZAHNBÜRSTE HANDTUCH SCHLÜSSEL BRIEFKASTEN",
    "Natur": "BAUM BLUME WIESE WALD BERG FLUSS MEER INSEL STRAND WÜSTE VULKAN GLETSCHER WASSERFALL HÖHLE SONNE MOND STERN WOLKE REGENBOGEN GEWITTER SCHNEE NEBEL WIND BLITZ DONNER ROSE TULPE SONNENBLUME GÄNSEBLÜMCHEN LÖWENZAHN EICHE TANNE KASTANIE PILZ MOOS STEIN SAND",
    "Berufe": "ÄRZTIN LEHRER BÄCKER METZGER FRISEURIN POLIZIST FEUERWEHRMANN PILOTIN KOCH KELLNER GÄRTNER BAUER ELEKTRIKER KLEMPNER TISCHLER MALER ARCHITEKTIN ANWALT RICHTERIN JOURNALIST FOTOGRAF SCHAUSPIELERIN SÄNGER TIERARZT ZAHNARZT APOTHEKERIN PROGRAMMIERER MECHANIKER BRIEFTRÄGER BUSFAHRER ASTRONAUT KASSIERERIN HEBAMME",
    "Freizeit & Sport": "FUßBALL HANDBALL BASKETBALL VOLLEYBALL TENNIS TISCHTENNIS SCHWIMMEN RADFAHREN WANDERN KLETTERN SKIFAHREN SNOWBOARD SCHLITTSCHUH REITEN TANZEN BOWLING MINIGOLF ANGELN ZELTEN PICKNICK KARTENSPIEL BRETTSPIEL PUZZLE SCHACH KEGELN TRAMPOLIN SCHAUKEL RUTSCHE SPIELPLATZ FREIBAD KINO KONZERT MUSEUM ZIRKUS FREIZEITPARK ACHTERBAHN KARUSSELL",
    "Verkehr & Reisen": "AUTO FAHRRAD MOTORRAD ROLLER STRAßENBAHN BUS ZUG LOKOMOTIVE FLUGZEUG HUBSCHRAUBER SCHIFF FÄHRE SEGELBOOT KANU TRAKTOR LASTWAGEN KRANKENWAGEN FEUERWEHRAUTO TAXI AMPEL KREUZUNG AUTOBAHN BAHNHOF FLUGHAFEN HAFEN TANKSTELLE PARKPLATZ TUNNEL BRÜCKE FAHRKARTE KOFFER RUCKSACK REISEPASS",
    "Körper & Gesundheit": "KOPF NASE MUND OHR AUGE ZAHN ZUNGE HALS SCHULTER ARM ELLBOGEN HAND FINGER DAUMEN BAUCH RÜCKEN KNIE FUß ZEHE FERSE HERZ LUNGE MAGEN GEHIRN KNOCHEN MUSKEL HAARE AUGENBRAUE WIMPER SOMMERSPROSSE PFLASTER VERBAND FIEBER SCHNUPFEN HUSTEN",
    "Kleidung": "HOSE JEANS ROCK KLEID HEMD BLUSE PULLOVER JACKE MANTEL SCHAL MÜTZE HANDSCHUHE SOCKEN SCHUHE STIEFEL SANDALEN TURNSCHUHE GÜRTEL KRAWATTE BADEANZUG BADEHOSE SCHLAFANZUG REGENJACKE GUMMISTIEFEL HOSENTRÄGER BRILLE SONNENBRILLE ARMBANDUHR HALSKETTE OHRRING",
    "Schule & Büro": "SCHULE KLASSENZIMMER TAFEL KREIDE HEFT BUCH BLEISTIFT KUGELSCHREIBER RADIERGUMMI LINEAL SCHERE KLEBSTOFF SCHULRANZEN STUNDENPLAN HAUSAUFGABEN ZEUGNIS PAUSE MATHEMATIK ERDKUNDE GESCHICHTE BIOLOGIE BIBLIOTHEK COMPUTER DRUCKER TASTATUR BILDSCHIRM KALENDER BRIEFUMSCHLAG BÜROKLAMMER TACKER ORDNER",
    "Musik & Märchen": "GITARRE KLAVIER GEIGE TROMPETE SCHLAGZEUG FLÖTE HARFE AKKORDEON MUNDHARMONIKA TROMMEL XYLOPHON ORCHESTER DIRIGENT CHOR MELODIE OPER THEATER BALLETT GEMÄLDE SKULPTUR ROMAN MÄRCHEN GEDICHT DRACHE PRINZESSIN RITTER ZAUBERER HEXE SCHLOSS BURG SCHATZKARTE PIRAT EINHORN",
    "Länder & Städte": "DEUTSCHLAND ÖSTERREICH SCHWEIZ ITALIEN FRANKREICH SPANIEN PORTUGAL GRIECHENLAND KROATIEN UNGARN POLEN SCHWEDEN NORWEGEN FINNLAND DÄNEMARK ENGLAND IRLAND ISLAND KANADA MEXIKO BRASILIEN ÄGYPTEN AUSTRALIEN JAPAN CHINA INDIEN BERLIN HAMBURG MÜNCHEN WIEN GRAZ SALZBURG INNSBRUCK ZÜRICH PARIS LONDON ROM",
    "Technik": "HANDY SMARTPHONE LAPTOP TABLET KOPFHÖRER LAUTSPRECHER FERNSEHER FERNBEDIENUNG KAMERA MIKROFON ROBOTER RAKETE SATELLIT BATTERIE LADEKABEL STECKDOSE GLÜHBIRNE TASCHENLAMPE TASCHENRECHNER SPIELKONSOLE INTERNET PASSWORT WECKER THERMOMETER KOMPASS MAGNET SOLARZELLE WINDRAD",
    "Feste & Ferien": "GEBURTSTAG WEIHNACHTEN OSTERN SILVESTER FASCHING HOCHZEIT GESCHENK GEBURTSTAGSTORTE KERZE LUFTBALLON GIRLANDE KONFETTI FEUERWERK TANNENBAUM ADVENTSKALENDER LEBKUCHEN PLÄTZCHEN OSTEREI OSTERHASE NIKOLAUS CHRISTKIND WEIHNACHTSMARKT SCHNEEMANN PARTY KOSTÜM MASKE URLAUB SOMMERFERIEN"
  };
  const LIST = [];
  for (const cat of Object.keys(WORDS)) for (const w of WORDS[cat].split(" ")) LIST.push({ w, cat });

  // House rules. Shared with the UI, which renders one switch per entry.
  const RULES = [
    { k: "hint", name: "Anfang und Ende", desc: "Der erste und der letzte Buchstabe sind von Anfang an aufgedeckt." },
    { k: "hard", name: "Schwer", desc: "Nur 6 Fehlversuche statt 10, der Galgen steht schon." },
    { k: "streak", name: "Serie", desc: "Jeder weitere Treffer in Folge bringt einen Extrapunkt mehr: beim zweiten +1, beim dritten +2 und so weiter." },
    { k: "clock", name: "Zugzeit", desc: "20 Sekunden pro Tipp, sonst ist der Nächste dran. Wer das Wort aussucht, hat 60 Sekunden." }
  ];
  function normRules(r) {
    const o = {};
    for (const x of RULES) o[x.k] = !!(r && r[x.k] === true);
    return o;
  }
  const normGoal = (n) => (GOALS.includes(+n) ? +n : 5);
  const normPick = (p) => (PICKS[p] ? p : "random");
  const normLevel = (n) => (n != null && n !== "" && LEVELS[+n] ? +n : 2);
  // level 0 = random: every computer player got its own strength when the game started
  const lvOf = (S, pi) => S.level || (S.players[pi] && S.players[pi].lvl) || 2;
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);

  // "Straße" -> "STRAßE": upper case, but ß stays one letter (toUpperCase would make it SS)
  const normWord = (w) => [...String(w || "").trim()].map((c) => (c === "ß" || c === "ẞ" ? "ß" : c.toLocaleUpperCase("de-DE"))).join("");
  function wordError(w) {
    if (!w) return "Bitte gib ein Wort ein.";
    if (/\s/.test(w)) return "Nur ein einzelnes Wort, ohne Leerzeichen.";
    if (!/^[A-ZÄÖÜß]+$/.test(w)) return "Nur Buchstaben, Umlaute und ß.";
    if (w.length < 3) return "Mindestens 3 Buchstaben.";
    if (w.length > 20) return "Höchstens 20 Buchstaben.";
    return null;
  }
  const randomWord = () => LIST[rand(LIST.length)];

  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 60) S.log.shift();
  }
  const active = (S) => S.players.map((_, i) => i).filter((i) => i !== S.chooser && !S.players[i].out);
  const solved = (S) => !!S.word && [...S.word].every((c) => S.guessed.includes(c));

  // players: [{ name, bot, avatar }]; goal: rounds; pick: "random" | "player"; level: computer strength
  function newGame(players, goal, pick, rules, level) {
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p, i) => ({ name: p.name, bot: !!p.bot, lvl: 1 + Math.floor(Math.random() * 3), avatar: avatarOf(p, i), score: 0, chose: 0, words: 0, out: false })),
      goal: normGoal(goal), pick: normPick(pick), rules: normRules(rules), level: normLevel(level),
      round: 0, turn: 0, starter: rand(Math.max(1, players.length)), log: [], last: null, deadline: 0
    };
    startRound(S);
    return S;
  }

  function startRound(S) {
    S.round++;
    S.word = ""; S.cat = ""; S.hint = "";
    S.guessed = []; S.wrong = [];
    S.errors = 0; S.maxErrors = S.rules.hard ? 6 : 10;
    S.run = 0; S.moves = [];
    S.last = null; S.lastGuess = null; S.log = [];
    S.startScores = S.players.map((p) => p.score);
    S.players.forEach((p) => { p.out = false; });
    // who thinks of the word: whoever has chosen least often so far, at random among them
    S.chooser = -1;
    if (S.pick === "player" && S.players.length >= 2) {
      const least = Math.min(...S.players.map((p) => p.chose));
      const pool = S.players.map((_, i) => i).filter((i) => S.players[i].chose === least);
      S.chooser = pool[rand(pool.length)];
      S.players[S.chooser].chose++;
    }
    if (S.chooser >= 0 && !S.players[S.chooser].bot) {
      S.phase = "choose"; S.cur = S.chooser; S.turn++;
      log(S, `Runde ${S.round}: ${S.players[S.chooser].name} sucht ein Wort aus.`);
      armClock(S);
      return;
    }
    const r = randomWord();
    setWord(S, r.w, r.cat, "");
    log(S, S.chooser >= 0 ? `Runde ${S.round}: ${S.players[S.chooser].name} hat sich ein Wort ausgedacht.` : `Runde ${S.round}: ein Wort aus „${r.cat}“.`);
  }

  function setWord(S, word, cat, hint) {
    S.word = word; S.cat = cat || ""; S.hint = hint || "";
    if (S.rules.hint) for (const c of [word[0], word[word.length - 1]]) if (!S.guessed.includes(c)) S.guessed.push(c);
    S.phase = "play";
    const g = active(S);
    beginTurn(S, g[S.starter % g.length]);
    S.starter++;
  }

  function armClock(S, now) {
    const P = S.players[S.cur];
    const ms = !S.rules.clock || !P || P.bot ? 0 : S.phase === "choose" ? CHOOSE_MS : S.phase === "play" ? CLOCK_MS : 0;
    S.deadline = ms ? (now || Date.now()) + ms : 0;
  }
  function beginTurn(S, pi) {
    S.cur = pi;
    S.turn++;
    armClock(S);
  }
  // the next guesser after pi who is still in
  function nextGuesser(S, pi) {
    const g = active(S);
    if (!g.length) return -1;
    return g.find((i) => i > pi) != null ? g.find((i) => i > pi) : g[0];
  }
  function passTurn(S, pi, events) {
    S.run = 0;
    const n = nextGuesser(S, pi);
    if (n < 0) return endRound(S, -1, events);
    beginTurn(S, n);
  }

  // solver: who found the word (-1 if nobody)
  function endRound(S, solver, events) {
    const hanged = solver < 0 && S.errors >= S.maxErrors;
    if (solver >= 0) { S.players[solver].score += SOLVE_BONUS; S.players[solver].words++; }
    if (hanged && S.chooser >= 0) S.players[S.chooser].score += HANGED_BONUS;
    const over = S.round >= S.goal;
    const top = Math.max(...S.players.map((p) => p.score));
    S.phase = "roundEnd";
    S.cur = -1;
    S.deadline = 0;
    S.last = {
      word: S.word, cat: S.cat, solver, hanged, over,
      gains: S.players.map((p, i) => p.score - (S.startScores[i] || 0)),
      winners: over ? S.players.map((_, i) => i).filter((i) => S.players[i].score === top) : []
    };
    log(S, solver >= 0 ? `${S.players[solver].name} hat „${S.word}“ gelöst!` : hanged ? `Gehängt! Das Wort war „${S.word}“.` : `Keiner rät mehr mit. Das Wort war „${S.word}“.`);
    if (over) log(S, `${S.last.winners.map((i) => S.players[i].name).join(" & ")} ${S.last.winners.length > 1 ? "gewinnen" : "gewinnt"} das Spiel!`);
    events.push({ t: "end", solver, hanged, over });
  }

  // Apply an action by player `pi`. Returns { ok, error?, events }.
  // Actions: {t:"word", word, hint} {t:"letter", l} {t:"solve", word} {t:"giveup"} {t:"skip"} {t:"next"}
  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events });
    const ok = () => ({ ok: true, events });
    const P = S.players[pi];
    if (!P) return fail("Unbekannter Spieler.");
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
      if (S.last && S.last.over) { S.players.forEach((p) => { p.score = 0; p.chose = 0; p.words = 0; }); S.round = 0; }
      startRound(S);
      return ok();
    }
    if (S.phase === "roundEnd") return fail("Die Runde ist vorbei.");
    if (a.t === "skip") { // host moves on when the current player is away
      if (S.phase === "choose") {
        const r = randomWord();
        log(S, `${S.players[S.chooser].name} wird übersprungen, es gibt ein Zufallswort aus „${r.cat}“.`);
        setWord(S, r.w, r.cat, "");
      } else {
        log(S, `${S.players[S.cur].name} wird übersprungen.`);
        passTurn(S, S.cur, events);
      }
      return ok();
    }
    if (a.t === "giveup") { // leaves this round (online: leaves the game)
      if (P.out) return fail("Du bist schon raus.");
      if (pi === S.chooser && S.phase === "choose") {
        const r = randomWord();
        log(S, `${P.name} steigt aus, es gibt ein Zufallswort aus „${r.cat}“.`);
        setWord(S, r.w, r.cat, "");
        return ok();
      }
      if (pi === S.chooser) return fail("Du hast das Wort ausgesucht.");
      P.out = true;
      log(S, `${P.name} steigt aus.`);
      events.push({ t: "giveup", pi });
      if (S.cur === pi) passTurn(S, pi, events);
      else if (!active(S).length) endRound(S, -1, events);
      return ok();
    }

    if (a.t === "word") {
      if (S.phase !== "choose") return fail("Das Wort steht schon fest.");
      if (pi !== S.chooser) return fail(`${S.players[S.chooser].name} sucht das Wort aus.`);
      const w = normWord(a.word), e = wordError(w);
      if (e) return fail(e);
      const hint = String(a.hint || "").replace(/\s+/g, " ").trim().slice(0, 40);
      setWord(S, w, "", hint);
      log(S, `${P.name} hat sich ein Wort mit ${w.length} Buchstaben ausgedacht.`);
      events.push({ t: "chosen", pi, n: w.length });
      return ok();
    }

    if (S.phase !== "play") return fail(`${S.players[S.chooser].name} sucht noch das Wort aus.`);
    if (pi === S.chooser) return fail("Du hast das Wort ausgesucht, du rätst nicht mit.");
    if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);

    if (a.t === "letter") {
      const l = a.l === "ẞ" ? "ß" : a.l === "ß" ? "ß" : String(a.l || "").toLocaleUpperCase("de-DE");
      if (!ALPHABET.includes(l)) return fail("Diesen Buchstaben gibt es nicht.");
      if (S.guessed.includes(l) || S.wrong.includes(l)) return fail(`${l} wurde schon geraten.`);
      const n = [...S.word].filter((c) => c === l).length;
      S.lastGuess = { pi, l, n, turn: S.turn };
      if (n) {
        S.guessed.push(l);
        const bonus = S.rules.streak ? S.run : 0;
        S.run++;
        P.score += n + bonus;
        S.moves.push({ pi, l, n });
        events.push({ t: "hit", pi, l, n, bonus });
        if (solved(S)) { log(S, `${P.name}: ${l}, der letzte Buchstabe!${bonus ? ` (+${bonus} Serie)` : ""}`); endRound(S, pi, events); return ok(); }
        log(S, `${P.name}: ${l} kommt ${n === 1 ? "einmal" : `${n}-mal`} vor, nochmal!${bonus ? ` (+${bonus} Serie)` : ""}`);
        beginTurn(S, pi);
        return ok();
      }
      S.wrong.push(l);
      S.moves.push({ pi, l, n: 0 });
      S.errors++;
      events.push({ t: "miss", pi, l });
      log(S, `${P.name}: ${l} kommt nicht vor.`);
      if (S.errors >= S.maxErrors) { endRound(S, -1, events); return ok(); }
      passTurn(S, pi, events);
      return ok();
    }

    if (a.t === "solve") {
      const w = normWord(a.word);
      if (!w) return fail("Bitte gib ein Wort ein.");
      if (w === S.word) {
        const hidden = [...S.word].filter((c) => !S.guessed.includes(c)).length;
        for (const c of S.word) if (!S.guessed.includes(c)) S.guessed.push(c);
        P.score += hidden;
        S.lastGuess = { pi, word: w, ok: true, turn: S.turn };
        S.moves.push({ pi, word: w, ok: true });
        events.push({ t: "solve", pi });
        endRound(S, pi, events);
        return ok();
      }
      S.errors++;
      S.moves.push({ pi, word: w, ok: false });
      S.lastGuess = { pi, word: w, ok: false, turn: S.turn };
      events.push({ t: "wrongword", pi, word: w });
      log(S, `${P.name} tippt auf „${w}“, falsch!`);
      if (S.errors >= S.maxErrors) { endRound(S, -1, events); return ok(); }
      passTurn(S, pi, events);
      return ok();
    }
    return fail("Unbekannte Aktion.");
  }

  // A clock that ran out: a guesser loses the turn, a chooser gets a random word.
  function tick(S, now) {
    now = now || Date.now();
    if (!S.deadline || now <= S.deadline + GRACE) return [];
    const pi = S.cur, events = [{ t: "timeout", pi }];
    if (S.phase === "choose") {
      const r = randomWord();
      log(S, `${S.players[pi].name} war zu langsam, es gibt ein Zufallswort aus „${r.cat}“.`);
      setWord(S, r.w, r.cat, "");
    } else if (S.phase === "play") {
      log(S, `${S.players[pi].name} war zu langsam.`);
      passTurn(S, pi, events);
    } else return [];
    return events;
  }
  function nextDeadline(S, now) {
    if (!S.deadline || S.phase === "roundEnd") return -1;
    return Math.max(0, S.deadline + GRACE - (now || Date.now()));
  }
  const resetClock = (S) => armClock(S);

  // ---------- computer player: only uses what everybody sees ----------
  // the words from the list that fit what is on the table
  function candidates(v) {
    const n = v.mask.length, gone = new Set(v.wrong.concat(v.guessed));
    return LIST.filter(({ w }) => w.length === n && [...w].every((c, i) => (v.mask[i] ? c === v.mask[i] : !gone.has(c)))).map((x) => x.w);
  }
  // Like a person: it guesses common letters first and only "sees" the word once enough of it
  // stands. The word list stands in for its vocabulary, but it only uses it from a share of
  // revealed letters on (per level), otherwise a 480-word list gives the word away after two
  // letters. Leicht is a bit careless, Profi thinks along earlier.
  const BOT = {
    1: { think: 0.75, solve: 0.85, noise: 5, careless: 0.15 }, // uses the list late, picks among the 5 most common letters
    2: { think: 0.6, solve: 0.75, noise: 3, careless: 0.1 },
    3: { think: 0.35, solve: 0.55, noise: 1, careless: 0 }
  };
  // The letter a helper would try next, from what everybody sees: the one that appears in most of the
  // fitting words of the list (the category narrows them down), else the most common German letter.
  function suggest(v) {
    const open = ALPHABET.filter((l) => !v.guessed.includes(l) && !v.wrong.includes(l));
    if (!open.length) return null;
    const inCat = v.cat && WORDS[v.cat] ? new Set(WORDS[v.cat].split(" ")) : null;
    let cand = [...new Set(candidates(v))];
    if (inCat && cand.some((w) => inCat.has(w))) cand = cand.filter((w) => inCat.has(w));
    const byFreq = FREQ.filter((l) => open.includes(l)).concat(open.filter((l) => !FREQ.includes(l)));
    let best = byFreq[0], bestN = cand.length ? 0 : -1;
    for (const l of byFreq) {
      const n = cand.filter((w) => w.includes(l)).length;
      if (n > bestN) { best = l; bestN = n; }
    }
    return { l: best, n: Math.max(bestN, 0), of: cand.length };
  }
  function botMove(S, pi) {
    if (S.phase !== "play" || S.cur !== pi) return null;
    const v = view(S, pi), lv = lvOf(S, pi), cfg = BOT[lv] || BOT[2];
    const open = ALPHABET.filter((l) => !v.guessed.includes(l) && !v.wrong.includes(l));
    const byFreq = FREQ.filter((l) => open.includes(l));
    const shown = v.mask.filter(Boolean).length / v.mask.length;
    const cand = shown >= cfg.think ? [...new Set(candidates(v))] : [];
    const left = S.maxErrors - S.errors;
    if (cand.length === 1 && shown >= cfg.solve) return { t: "solve", word: cand[0] };
    if (cand.length === 2 && shown >= Math.max(cfg.solve, 0.7) && left > 3 && lv === 3) return { t: "solve", word: cand[rand(2)] };
    if (cand.length && Math.random() >= cfg.careless) { // the letter in the most fitting words
      let best = null, bestN = -1;
      for (const l of byFreq) {
        const n = cand.filter((w) => w.includes(l)).length;
        if (n > bestN) { best = l; bestN = n; }
      }
      if (bestN > 0) return { t: "letter", l: best };
    }
    if (Math.random() < cfg.careless) return { t: "letter", l: open[rand(open.length)] };
    return { t: "letter", l: byFreq[rand(Math.min(cfg.noise, byFreq.length))] || open[0] };
  }

  // The word stays hidden until the round ends, except for whoever picked it.
  function view(S, pi) {
    const me = S.players[pi] ? pi : -1;
    const reveal = S.phase === "roundEnd" || (me >= 0 && me === S.chooser);
    return {
      me, phase: S.phase, cur: S.cur, turn: S.turn, round: S.round, goal: S.goal, pick: S.pick, level: S.level == null ? 2 : S.level, rules: S.rules,
      chooser: S.chooser, cat: S.cat, hint: S.hint, word: reveal ? S.word : null,
      mask: [...S.word].map((c) => (S.guessed.includes(c) ? c : null)),
      guessed: S.guessed.slice(), wrong: S.wrong.slice(), run: S.run || 0, moves: (S.moves || []).slice(), errors: S.errors, maxErrors: S.maxErrors, lastGuess: S.lastGuess,
      clockMs: S.rules.clock ? (S.phase === "choose" ? CHOOSE_MS : CLOCK_MS) : 0, clock: S.deadline ? Math.max(0, S.deadline - Date.now()) : 0,
      players: S.players.map((p, i) => ({ name: p.name, bot: p.bot, avatar: avatarOf(p, i), score: p.score, words: p.words || 0, out: !!p.out })),
      log: S.log.slice(), last: S.last
    };
  }

  return {
    MAX_PLAYERS, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, GOALS, PICKS, RULES, ALPHABET, WORDS, LIST, SOLVE_BONUS, HANGED_BONUS,
    normRules, normGoal, normPick, normLevel, normWord, wordError, randomWord, candidates, suggest,
    newGame, startRound, act, tick, nextDeadline, resetClock, botMove, view
  };
});
