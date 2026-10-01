// Galgenmännchen UI: one shared device and online rooms share one table renderer.
(() => {
  "use strict";
  const G = window.HangmanGame;
  // An old cached game.js next to a new app.js: reload once without cache instead of breaking.
  if (!G || !G.botMove || !G.AVATARS) {
    let tried = false;
    try { tried = sessionStorage.getItem("hangman.reloaded") === "1"; sessionStorage.setItem("hangman.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("hangman.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const K = { local: "hangman.v1", online: "hangman.online", me: "hangman.me", rules: "hangman.rules", pick: "hangman.pick", goal: "hangman.goal", sound: "hangman.sound", level: "hangman.level", stats: "hangman.stats",
    avatar: "hangman.avatar", look: "hangman.look" };
  const store = Spieleabend.store;
  const BOT_MS = 1000;

  // ---------- look: table design and size (shared, kit.js), applied before anything is drawn ----------
  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Größe" });

  // ---------- avatars ----------
  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");

  const PICKS = [["random", "Zufallswort", "aus der Wortliste"], ["player", "Ein Mitspieler", "denkt sich eins aus"]];
  const LEVELS = [[1, "Leicht"], [2, "Normal"], [3, "Profi"], [0, "Zufällig"]];
  const GOALS = [[3, "3 Runden"], [5, "5 Runden"], [8, "8 Runden"]];
  const ICON = {
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6" /></svg>'
  };

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let R = null;           // last online room message
  let watching = false;   // in the waiting room, but watching the game that runs
  let V = null;           // view currently on screen
  let peek = false;       // round over, looking at the table
  let solving = false;    // the "whole word" field is open
  let fresh = null;       // { l } letter just revealed, animated on the next render
  let inflight = false;
  let server = null;      // server info once found ({} when only the WebSocket answered)
  let serverState = "checking"; // "checking" | "ok" | "none"
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "hangman.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let pickLocal = G.normPick(store.get(K.pick)), goalLocal = G.normGoal(store.get(K.goal) || 5);
  let localRules = G.normRules(store.get(K.rules));
  let levelLocal = G.normLevel(store.get(K.level));
  let lastTurn = null, lastErrors = 0;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const humans = (st) => st.players.map((_, i) => i).filter((i) => !st.players[i].bot);
  // whose guesses this screen makes: online your seat; on a shared device whoever is on (people only)
  const canPlay = () => !!V && V.phase === "play" && V.cur >= 0 && (mode === "local" ? !V.players[V.cur].bot : V.cur === V.me);
  const canChoose = () => !!V && V.phase === "choose" && (mode === "local" ? !V.players[V.chooser].bot : V.chooser === V.me);
  const pname = (i) => (mode === "online" && i === V.me ? "Du" : V.players[i].name);

  const { toast, confetti, showBubble } = Spieleabend;
  Spieleabend.followTurn("#plates", ".plate.active"); // the player on turn scrolls into view
  function flash(text, sub, cls) {
    const f = $("#flash"), s = $("#flashText");
    s.className = cls || "";
    s.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : "");
    f.hidden = false;
    s.style.animation = "none"; void s.offsetWidth; s.style.animation = "";
    clearTimeout(flash.t); flash.t = setTimeout(() => { f.hidden = true; }, 900);
  }
  function shake() {
    for (const el of [$("#word"), $("#gallows svg")]) if (el) { el.classList.remove("shake"); void el.getBoundingClientRect(); el.classList.add("shake"); }
  }
  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound,
    effects: ({ tone }) => ({
      hit: (n) => { for (let k = 0; k < Math.min(n || 1, 4); k++) tone(660 + k * 110, k * 0.07, 0.12, "triangle", 0.14); },
      miss: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16)),
      hanged: () => [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.16, 0.3, "triangle", 0.12)),
      tick: () => tone(1200, 0, 0.05, "square", 0.06)
    })
  });

  // ---------- events → feedback ----------
  function handleEvents(events, v) {
    if (!v) return;
    for (const ev of events || []) {
      if (ev.t === "hit") { fresh = { l: ev.l }; sfx("hit", ev.n); if (ev.bonus) toast(`Serie! +${ev.bonus} Extrapunkt${ev.bonus > 1 ? "e" : ""}`); }
      if (ev.t === "miss") { sfx("miss"); setTimeout(shake, 30); }
      if (ev.t === "wrongword") { sfx("miss"); setTimeout(shake, 30); toast(`„${ev.word}“ ist es nicht.`); }
      if (ev.t === "timeout") { toast(mode === "online" && ev.pi === v.me ? "Zu langsam!" : `${v.players[ev.pi].name} war zu langsam.`); sfx("miss"); }
      if (ev.t === "giveup") toast(mode === "online" && ev.pi === v.me ? "Du bist in dieser Runde raus." : `${v.players[ev.pi].name} steigt aus.`);
      if (ev.t === "chosen" && !(mode === "online" && ev.pi === v.me)) toast(`${v.players[ev.pi].name} hat ein Wort mit ${ev.n} Buchstaben.`);
      if (ev.t === "end") {
        setTimeout(() => {
          if (ev.solver >= 0) flash("Gelöst!", mode === "online" && ev.solver === v.me ? "Du hast es" : `${v.players[ev.solver].name} hat es`, "blue");
          else if (ev.hanged) { flash("Gehängt!", ""); sfx("hanged"); }
        }, 380);
      }
    }
  }

  // ---------- actions ----------
  function doAct(a, actor) {
    if (mode === "local") {
      const res = G.act(L, actor == null ? L.cur : actor, a);
      if (!res.ok) { toast(res.error); sfx("miss"); shake(); return false; }
      handleEvents(res.events, G.view(L, localMe()));
      store.set(K.local, L);
      render();
      scheduleBot();
      return true;
    }
    if (mode === "online") {
      if (!wsSend({ t: "act", a })) { toast("Keine Verbindung zum Server."); return false; }
      return true;
    }
    return false;
  }

  function guess(l) {
    if (!V || V.phase !== "play") return;
    if (!canPlay()) {
      toast(mode === "online" && V.me === V.chooser ? "Du hast das Wort ausgesucht, du rätst nicht mit." : mode === "online" && V.me < 0 ? "Du schaust zu." : `Warte, ${V.players[V.cur].name} ist dran.`);
      return;
    }
    if (inflight) return;
    if (V.guessed.includes(l) || V.wrong.includes(l)) { toast(`${l} wurde schon geraten.`); return; }
    if (mode === "online") { inflight = true; setTimeout(() => { inflight = false; }, 3000); }
    buzz(10);
    doAct({ t: "letter", l });
  }

  // computer players in the shared-device mode (online the server moves them)
  let botT = null;
  function scheduleBot() {
    clearTimeout(botT);
    if (mode !== "local" || !L || L.phase !== "play" || !L.players[L.cur].bot) return;
    botT = setTimeout(() => {
      if (mode !== "local" || !L || L.phase !== "play" || !L.players[L.cur].bot) return;
      if (!$("#menu").hidden) { scheduleBot(); return; } // paused while the menu is open
      const pi = L.cur, a = G.botMove(L, pi);
      const res = a ? G.act(L, pi, a) : null;
      if (res && res.ok) { handleEvents(res.events, G.view(L, localMe())); store.set(K.local, L); render(); }
      scheduleBot();
    }, BOT_MS);
  }
  // turn clock: a bar that runs out, beeps in the last seconds when it is your move
  let clockEnd = 0, clockT = null, clockBeep = null;
  function renderClock() {
    const who = V.phase === "choose" ? V.chooser : V.cur;
    const on = (V.phase === "play" || V.phase === "choose") && V.clockMs > 0 && V.clock > 0 && who >= 0 && !V.players[who].bot;
    $("#clock").hidden = !on;
    clearInterval(renderClock.t);
    if (!on) return;
    clockEnd = Date.now() + V.clock;
    const bar = $("#clockBar"), total = V.clockMs;
    const step = () => {
      const left = Math.max(0, clockEnd - Date.now());
      bar.style.width = (left / total) * 100 + "%";
      $("#clock").classList.toggle("urgent", left < 5000);
      $("#clockSec").textContent = Math.ceil(left / 1000) + " s";
      const s = Math.ceil(left / 1000);
      if ((canPlay() || canChoose()) && left > 0 && s <= 3 && clockBeep !== `${V.turn}:${s}:${clockEnd}`) { clockBeep = `${V.turn}:${s}:${clockEnd}`; sfx("tick"); if (s === 1) buzz(30); }
      if (!left) clearInterval(renderClock.t);
    };
    step(); renderClock.t = setInterval(step, 100);
  }
  function scheduleClock() {
    clearTimeout(clockT);
    if (mode !== "local" || !L) return;
    const ms = G.nextDeadline(L);
    if (ms < 0) return;
    clockT = setTimeout(() => {
      if (mode !== "local" || !L) return;
      const ev = G.tick(L);
      if (ev.length) { handleEvents(ev, G.view(L, localMe())); store.set(K.local, L); render(); scheduleBot(); }
      else scheduleClock();
    }, ms + 30);
  }

  // ---------- rendering ----------
  function showScreen(id) {
    for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id;
  }
  // shared device: nobody is "me" (the word stays hidden for everyone until the round ends)
  const localMe = () => -1;

  function render() {
    if (mode === "local" && L) {
      V = G.view(L, localMe());
      showScreen("game");
      renderGame();
      scheduleClock();
    } else if (mode === "online" && R) {
      const meM = R.members[R.you], waiting = !!(R.view && meM && meM.lobby);
      if (!waiting) watching = false;
      if (!R.view || (waiting && !watching)) { V = null; showScreen("lobby"); UI.renderLobby(); $("#roundEnd").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else {
      V = null;
      $("#roundEnd").hidden = true;
      showScreen("home"); renderHome();
    }
    UI.update();
  }

  // the gallows as parts that appear one by one: 4 wooden ones, the rope, then the man
  const PARTS = [
    ["wood", "M20 208H130"], ["wood", "M45 208V14"], ["wood", "M45 14H135"], ["wood", "M45 52L83 14"],
    ["rope", "M135 14V44"], ["man", "M135 44a16 16 0 1 0 0.01 0"], ["man", "M135 76V136"],
    ["man", "M135 92L112 118"], ["man", "M135 92L158 118"], ["man", "M135 136L114 178"], ["man", "M135 136L156 178"]
  ];
  // shown: how many parts are drawn; with 10 tries the gallows builds up too, with 6 it stands already
  function gallowsHTML(errors, max, cls, newest) {
    const pre = PARTS.length - max; // parts drawn from the start
    const shown = pre + errors;
    return `<svg class="gallows ${cls || ""}" viewBox="0 0 180 220" aria-label="Galgen: ${errors} von ${max} Fehlern">` +
      PARTS.map(([k, d], i) => `<path class="part ${k}${i < shown ? " on" : ""}${i === shown - 1 && newest ? " new" : ""}" d="${d}"/>`).join("") +
      `<path class="part face" d="M128 56l5 5M133 56l-5 5M137 56l5 5M142 56l-5 5M129 68q6 -4 12 0"/></svg>`;
  }
  function wordHTML(v, full, newL) {
    const letters = full ? [...full] : v.mask;
    return letters.map((c, i) => {
      const shown = full ? c : v.mask[i];
      const missed = full && !v.mask[i];
      return `<span class="slot${missed ? " missed" : ""}${shown && newL && shown === newL && !full ? " new" : ""}">${shown || ""}</span>`;
    }).join("");
  }

  function plateHTML(i) {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = members && members[i] && !members[i].online;
    const on = (V.phase === "play" && V.cur === i) || (V.phase === "choose" && V.chooser === i);
    const cls = ["plate", on ? "active" : "", away ? "away" : "", p.out ? "out" : ""].join(" ");
    const tag = i === V.chooser ? "sucht aus" : p.out ? "raus" : p.bot ? "Computer" : away ? "offline" : mode === "online" && i === V.me ? "du" : "rät mit";
    return `<div class="${cls}" data-seat="${i}"><span class="pav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="pinfo"><span class="pname">${esc(p.name)}</span><span class="pmeta">${tag}</span></span>` +
      `<span class="pwins" title="Punkte">${p.score}</span></div>`;
  }

  function renderGame() {
    if (V.phase !== "roundEnd") peek = false;
    if (!canPlay()) solving = false;
    $("#plates").innerHTML = V.players.map((_, i) => plateHTML(i)).join("");
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> von ${V.goal}`;

    const choosing = V.phase === "choose", end = V.phase === "roundEnd";
    const grew = V.errors > lastErrors && !choosing; lastErrors = V.errors;
    const won = end && V.last && V.last.solver >= 0;
    $("#gallows").innerHTML = gallowsHTML(V.errors, V.maxErrors, end ? (V.last.hanged ? "hanged" : won ? "saved" : "") : "", grew);
    $("#catLine").innerHTML = choosing ? "" : [V.cat ? `Kategorie: <b>${esc(V.cat)}</b>` : "", V.hint ? `Hinweis: <b>${esc(V.hint)}</b>` : "", `${V.mask.length} Buchstaben`].filter(Boolean).join(" · ");
    const w = $("#word");
    w.hidden = choosing;
    w.style.setProperty("--n", Math.max(6, V.mask.length));
    w.classList.toggle("win", won);
    // everyone sees the same slots (whoever picked the word gets it spelled out below); at the end the whole word
    w.innerHTML = wordHTML(V, end ? V.last.word : null, fresh && fresh.l);
    fresh = null;
    $("#wrong").innerHTML = choosing ? "" : (V.wrong.length ? V.wrong.map((l) => `<span>${l}</span>`).join("") : "") + (V.rules.streak && V.run > 0 && V.phase === "play" ? `<span class="run">Serie ×${V.run}</span>` : "") + `<span class="cnt">${V.errors} von ${V.maxErrors} Fehlern</span>`;

    // choosing the word
    const ch = canChoose();
    $("#choose").hidden = !ch;
    $("#chooseLabel").textContent = mode === "local" && ch ? `${V.players[V.chooser].name}, denk dir ein Wort aus` : "Dein Wort";
    $("#chooseNote").textContent = (mode === "local" ? "Die anderen schauen weg! " : "") + "Ein deutsches Wort mit 3 bis 20 Buchstaben, Umlaute und ß gehen auch. Die anderen sehen es erst am Ende der Runde.";
    const wait = $("#waiting");
    wait.hidden = !(choosing && !ch) && !(V.word && !end && mode === "online");
    wait.innerHTML = choosing && !ch ? `${V.players[V.chooser].avatar} ${esc(V.players[V.chooser].name)} denkt sich ein Wort aus …`
      : V.word && !end ? `Dein Wort: <b>${esc(V.word)}</b>. Die anderen raten, du schaust zu.` : "";

    // log
    const lmEl = $("#lastMove"), lines = V.log.slice(-2), lmKey = lines.join("\n");
    if (lmEl.dataset.k !== lmKey) {
      lmEl.dataset.k = lmKey;
      lmEl.innerHTML = lines.map((l, i) => `<div${i < lines.length - 1 ? ' class="old"' : ""}>${esc(l)}</div>`).join("");
      lmEl.classList.remove("fresh"); void lmEl.offsetWidth; lmEl.classList.add("fresh");
    }

    // dock
    const play = canPlay();
    let who = "", hint = "", av = "";
    if (end) {
      const s = V.last.solver;
      who = s >= 0 ? `${pname(s)} ${mode === "online" && s === V.me ? "hast es gelöst" : "hat es gelöst"}` : V.last.hanged ? "Gehängt!" : "Runde vorbei";
      av = s >= 0 ? V.players[s].avatar : "🪢";
      hint = `Das Wort war „${V.last.word}“.`;
    } else if (choosing) {
      const P = V.players[V.chooser];
      av = P.avatar;
      who = ch ? (mode === "local" ? `${P.name} sucht aus` : "Du suchst das Wort aus") : `${P.name} sucht aus`;
      hint = ch ? "Tipp dein Wort oben ein, oder nimm ein Zufallswort." : "Gleich geht es los.";
    } else {
      const P = V.players[V.cur];
      av = P.avatar;
      if (play) {
        who = mode === "local" && humans(V).length > 1 ? `${P.name}, du bist dran` : "Du bist dran";
        hint = "Tippe einen Buchstaben, oder löse das ganze Wort.";
      } else {
        who = `${P.name} ist dran`;
        hint = P.bot ? "Der Computer überlegt …" : mode === "online" && V.me === V.chooser ? "Dein Wort wird geraten." : mode === "online" && V.me < 0 ? "Du schaust zu." : "Warte auf den nächsten Tipp.";
      }
    }
    $("#whoAv").textContent = av;
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    $("#dock").classList.toggle("myturn", play || ch);
    const kbd = $("#kbd");
    kbd.hidden = choosing;
    kbd.classList.toggle("off", !play);
    kbd.innerHTML = G.ALPHABET.map((l) => {
      const st = V.guessed.includes(l) ? "ok" : V.wrong.includes(l) ? "no" : "";
      const tp = !st && play && tip && tip.key === `${V.round}:${V.turn}` && tip.l === l ? " tip" : "";
      return `<button type="button" data-l="${l}" class="${st}${tp}"${st || !play ? " disabled" : ""} aria-label="${l}">${l}</button>`;
    }).join("");
    $("#solve").hidden = !(play && solving);
    $("#solveBtn").hidden = !play || solving;
    $("#tipBtn").hidden = !play || solving;
    $("#resultBtn").hidden = !(end && peek);
    $("#reactBtn").hidden = mode !== "online";
    $("#keys").innerHTML = play ? "Buchstaben einfach tippen · <kbd>Enter</kbd> Wort lösen · <kbd>Esc</kbd> zurück" : "";
    renderClock();

    // turn change feedback
    const key = `${V.round}:${V.turn}:${V.cur}:${V.phase}`;
    if ((play || ch) && lastTurn !== key && lastTurn !== null && (mode === "online" || V.players.some((p) => p.bot))) { buzz([40, 60, 40]); sfx("turn"); }
    lastTurn = key;

    $("#roundEnd").hidden = !end || peek;
    if (end) {
      if (!peek) renderRoundEnd();
      const k = `${V.round}:${V.last.word}:${V.players.map((p) => p.score).join(",")}`;
      if (confettiFor !== k) {
        confettiFor = k; if (V.last.over) record(k);
        const meIdx = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
        const meWon = V.last.solver >= 0 && V.last.solver === meIdx;
        const iWon = V.last.over && meIdx >= 0 && V.last.winners.includes(meIdx);
        if (meWon || iWon) setTimeout(() => { confetti(); sfx("win"); }, 700);
      }
    }
  }

  $("#kbd").addEventListener("click", (e) => { const b = e.target.closest("[data-l]"); if (b && !b.disabled) guess(b.dataset.l); });
  let tip = null; // { key, l }: the letter the tip button pointed at this turn
  $("#tipBtn").addEventListener("click", () => {
    if (!V || V.phase !== "play" || !canPlay()) return;
    const s = G.suggest(V);
    if (!s) return;
    tip = { key: `${V.round}:${V.turn}`, l: s.l };
    toast(s.of > 1 ? `Tipp: ${s.l} steckt in ${s.n} von ${s.of} passenden Wörtern.` : `Tipp: versuch es mit ${s.l}.`);
    sfx("pop");
    renderGame();
  });
  $("#solveBtn").addEventListener("click", () => { solving = true; renderGame(); $("#solveWord").focus(); });
  $("#solve").addEventListener("submit", (e) => {
    e.preventDefault();
    const w = $("#solveWord").value.trim();
    if (!w) { toast("Bitte gib ein Wort ein."); return; }
    solving = false; $("#solveWord").value = "";
    doAct({ t: "solve", word: w });
  });
  $("#choose").addEventListener("submit", (e) => {
    e.preventDefault();
    const w = G.normWord($("#chooseWord").value), err = G.wordError(w);
    if (err) { toast(err); $("#chooseWord").focus(); return; }
    doAct({ t: "word", word: w, hint: $("#chooseHint").value }, mode === "local" ? L.chooser : null);
    $("#chooseWord").value = ""; $("#chooseHint").value = "";
  });
  $("#chooseRandom").addEventListener("click", () => {
    const r = G.randomWord();
    $("#chooseWord").value = r.w; $("#chooseHint").value = r.cat;
  });
  $("#resultBtn").addEventListener("click", () => { peek = false; render(); });

  // keys: letters guess, Enter opens "solve", Esc closes
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) {
      if (e.key === "Escape" && e.target.id === "solveWord") { solving = false; renderGame(); }
      return;
    }
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") {
      if (open) $(open).hidden = true;
      else if (solving) { solving = false; renderGame(); }
      return;
    }
    if (open || $("#game").hidden || !$("#roundEnd").hidden || !canPlay()) return;
    if (e.key === "Enter") { e.preventDefault(); solving = true; renderGame(); $("#solveWord").focus(); return; }
    const l = e.key === "ß" ? "ß" : e.key.length === 1 ? e.key.toLocaleUpperCase("de-DE") : "";
    if (G.ALPHABET.includes(l)) { e.preventDefault(); guess(l); }
  });

  // ---------- house rules ----------
  const activeNames = (r) => G.RULES.filter((x) => r && r[x.k]).map((x) => x.name);
  function rulesHTML(r, editable, pre) {
    return G.RULES.map((x) =>
      `<label class="toggle" for="rule-${pre}-${x.k}"><input type="checkbox" id="rule-${pre}-${x.k}" data-rule="${x.k}"` +
      `${r[x.k] ? " checked" : ""}${editable ? "" : " disabled"}><span>${x.name}<small>${x.desc}</small></span></label>`).join("");
  }
  function renderLocalRules() {
    const box = $("#rulesLocal");
    if (!box.firstChild) box.innerHTML = rulesHTML(localRules, true, "l");
    const on = activeNames(localRules);
    $("#rulesLocalSum").textContent = on.length ? on.join(", ") : "keine";
  }
  $("#rulesLocal").addEventListener("change", (e) => {
    const k = e.target.dataset.rule; if (!k) return;
    localRules[k] = e.target.checked; store.set(K.rules, localRules); renderLocalRules();
  });
  $("#rulesLobby").addEventListener("change", (e) => {
    const k = e.target.dataset.rule; if (!k || !R || R.you !== R.host) return;
    const next = Object.assign({}, R.rules, { [k]: e.target.checked });
    store.set(K.rules, Object.assign(localRules, next));
    wsSend({ t: "settings", rules: next });
  });

  let confettiFor = null;

  // ---------- reactions (online) ----------
  function bubble(pi, e, who) {
    const host = pi >= 0 ? document.querySelector(`#plates [data-seat="${pi}"]`) : $("#dock");
    if (!host) return;
    const b = document.createElement("span");
    b.className = "bubble" + (e.length > 3 ? " say" : ""); b.textContent = pi < 0 && who ? `${who}: ${e}` : e;
    showBubble(host, b);
    setTimeout(() => b.remove(), 2800);
    sfx("pop");
  }
  $("#reactBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#reactBar").hidden = !$("#reactBar").hidden; });
  $("#reactBar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-e]"); if (!b) return;
    $("#reactBar").hidden = true;
    wsSend({ t: "react", e: b.dataset.e });
  });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#reactBar, #reactBtn")) $("#reactBar").hidden = true; });

  function scoreList(el, winners, gains) {
    const order = V.players.map((_, i) => i).sort((a, b) => V.players[b].score - V.players[a].score);
    el.innerHTML = order.map((i) => {
      const p = V.players[i], you = i === V.me && mode === "online" ? " (du)" : "", g = gains && gains[i];
      return `<li class="${winners.includes(i) ? "win" : ""}"><span>${avi(p.avatar)}${esc(p.name)}${you}${i === V.chooser ? "<small>hat ausgesucht</small>" : ""}</span>` +
        `<b>${g ? `<span class="gain">+${g}</span>` : ""}${p.score} ${p.score === 1 ? "Punkt" : "Punkte"}</b></li>`;
    }).join("");
  }

  function renderRoundEnd() {
    const last = V.last, s = last.solver;
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round} von ${V.goal}`;
    const winners = last.winners.map((i) => (mode === "online" && i === V.me ? "Du" : V.players[i].name));
    $("#reTitle").textContent = last.over
      ? `${winners.join(" & ")} ${winners.length > 1 ? "gewinnen" : winners[0] === "Du" ? "gewinnst" : "gewinnt"} das Spiel!`
      : s >= 0 ? `${mode === "online" && s === V.me ? "Du hast" : `${V.players[s].name} hat`} es gelöst!` : last.hanged ? "Gehängt!" : "Keiner hat es gelöst";
    const rw = $("#reWord");
    rw.style.setProperty("--n", Math.max(6, last.word.length));
    rw.classList.toggle("win", s >= 0);
    rw.innerHTML = wordHTML(V, last.word);
    $("#reText").textContent = (last.cat ? `Kategorie: ${last.cat}. ` : "") +
      (s >= 0 ? `+${G.SOLVE_BONUS} Bonus fürs Lösen.` : last.hanged && V.chooser >= 0 ? `${V.players[V.chooser].name} bekommt ${G.HANGED_BONUS} Punkte, weil keiner es erraten hat.` : "") +
      (last.over ? "" : ` Gespielt werden ${V.goal} Runden.`);
    $("#reMoves").innerHTML = (V.moves || []).map((m, i) => {
      const a = V.players[m.pi].avatar, ok = m.word ? m.ok : m.n > 0;
      return `<span class="${ok ? "" : "no"}" style="--i:${i}" title="${esc(V.players[m.pi].name)}"><i>${a}</i>${m.word ? `${esc(m.word)}` : m.l}${m.n > 1 ? `<small>×${m.n}</small>` : ""}</span>`;
    }).join("");
    scoreList($("#reScores"), last.winners, last.gains);
    UI.roundEndFooter({ over: last.over, next: "Nächste Runde" });
  }

  // Statistik lebt im Profil (shared/profile.js, gilt für alle Spiele); die alte Bilanz dieses Browsers wird einmal übernommen
  const profile = Spieleabend.profile;
  { const old = (store.get(K.stats) || {})[profile.get().name]; if (old) profile.importLegacy("hangman", { rounds: old.rounds || old.games, wins: old.wins }); }
  function record(key) {
    const i = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
    if (i < 0) return;
    profile.result("hangman", key, { won: V.last.winners.includes(i), draw: !V.last.winners.length, online: mode === "online" });
  }

  function segHTML(list, cur) {
    return list.map(([v, a, b]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${a}${b ? `<small>${b}</small>` : ""}</button>`).join("");
  }

  function renderHome(force) {
    renderLocalRules();
    LOOK.render();
    $("#myAvatar").textContent = myAvatar;
    for (const b of document.querySelectorAll("#modeTabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
    // never hide the online form on a web address: a failed check (ad blocker, slow
    // network) must not lock people out; connecting will tell if there really is no server
    $("#onlinePanel").hidden = tab !== "online" || !webHost;
    $("#onlineOff").hidden = tab !== "online" || webHost;
    const sh = $("#serverHint");
    sh.hidden = serverState === "ok";
    sh.textContent = serverState === "checking" ? "Suche den Spiel-Server …"
      : "Unter dieser Adresse antwortet kein Spiel-Server. Du kannst es trotzdem versuchen, „Einzelspieler“ geht immer.";
    $("#localPanel").hidden = tab !== "local";
    $("#goalLocal").innerHTML = segHTML(GOALS, goalLocal);
    $("#levelLocal").innerHTML = segHTML(LEVELS, levelLocal);

    const saved = store.get(K.local);
    $("#resumePanel").hidden = !(saved && saved.players);
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => p.name).join(", ")} · Runde ${saved.round} von ${saved.goal}`;
    HOME.render();
  }

  // ---------- waiting room and menu: shared (room-ui.js), plus this game's own parts ----------
  const UI = window.RoomUI({
    room: () => R, view: () => V, mode: () => mode, server: () => server,
    watching: (v) => (v === undefined ? watching : (watching = v)),
    onlineKey: K.online,
    on: {
      opened() { if (serverState !== "ok") { serverState = "ok"; server = server || {}; } },
      joined() { mode = "online"; wake(); },
      room(m) { R = m; mode = "online"; inflight = false; if (m.view) handleEvents(m.events, m.view); render(); },
      react(m) { bubble(m.pi, m.e, m.name); },
      error() { inflight = false; },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text, name) => bubble(pi, text, name),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    // who picks the word, rounds, computer strength and house rules; the host picks, everyone sees it
    renderSettings(host) {
      for (const [id, list, cur] of [["#pickOnline", PICKS, R.pick || "random"], ["#goalOnline", GOALS, R.goal], ["#levelOnline", LEVELS, R.level == null ? 2 : R.level]]) {
        const el = $(id), k = cur + ":" + host;
        if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = segHTML(list, cur); for (const b of el.children) b.disabled = !host; }
      }
      $("#pickHint").textContent = R.pick === "player"
        ? "Jede Runde denkt sich ein zufällig gewählter Spieler ein Wort aus, jeder kommt etwa gleich oft dran. Computer nehmen ein Zufallswort."
        : "Jede Runde ein zufälliges deutsches Wort aus der Wortliste, die Kategorie steht als Hinweis dabei.";
      const rl = $("#rulesLobby"), key = JSON.stringify(R.rules) + host;
      if (rl.dataset.k !== key) { rl.dataset.k = key; rl.innerHTML = rulesHTML(R.rules || {}, host, "o"); }
      const onR = activeNames(R.rules);
      $("#rulesLobbySum").textContent = onR.length ? onR.join(", ") : "keine";
      $("#rulesLobbyHint").textContent = host ? "Tippe an, was gelten soll. Alle sehen deine Auswahl." : `${R.members[R.host].name} legt die Regeln fest.`;
    },
    menu: {
      open() {
        LOOK.render();
        scoreList($("#menuScores"), []);
        const on = activeNames(V ? V.rules : {});
        const what = V ? `${V.pick === "player" ? "Ein Mitspieler sucht das Wort aus" : "Zufallswörter"}, ${V.goal} Runden.` : "";
        $("#menuRules").textContent = `${what} ${on.length ? `Hausregeln: ${on.join(", ")}.` : "Keine Hausregeln."}`;
      },
      local(box) {
        box.append(
          UI.armed("Runde neu starten", () => { L.round--; L.players.forEach((p, i) => { p.score = L.startScores[i] || 0; }); if (L.chooser >= 0) L.players[L.chooser].chose--; G.startRound(L); peek = false; store.set(K.local, L); render(); scheduleBot(); }),
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearTimeout(clockT); render(); })
        );
      },
      player(box) {
        if (V && V.phase === "play" && V.me >= 0 && V.me !== V.chooser && !V.players[V.me].out)
          box.append(UI.armed("In dieser Runde aussteigen", () => wsSend({ t: "act", a: { t: "giveup" } })));
      },
      skip: (v) => (v.phase === "play" && v.cur !== v.me && !v.players[v.cur].bot) || (v.phase === "choose" && v.chooser !== v.me)
    }
  });

  Spieleabend.avatarPicker({ avatars: G.AVATARS, get: () => myAvatar, set: (a) => { myAvatar = a; store.set(K.avatar, a); } });

  $("#pickOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", pick: b.dataset.v }); });
  $("#goalOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", goal: +b.dataset.v }); });
  $("#levelOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", level: +b.dataset.v }); });

  // ---------- online connection (shared, room-ui.js) ----------
  function wsSend(m) { return UI.send(m); }

  // ---------- start screen ----------
  // a gallows halfway up and a half-guessed word
  $("#heroGallows").innerHTML = gallowsHTML(6, 10, "", false);
  $("#heroWord").style.setProperty("--n", 8);
  $("#heroWord").innerHTML = [..."G_LG_N"].map((c) => `<span class="slot">${c === "_" ? "" : c}</span>`).join("");
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; tabTouched = true; renderHome(); } });
  $("#goalLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { goalLocal = +b.dataset.v; store.set(K.goal, goalLocal); renderHome(); } });
  $("#levelLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { levelLocal = +b.dataset.v; store.set(K.level, levelLocal); renderHome(); } });

  $("#myName").value = store.get(K.me) || "";
  $("#myName").addEventListener("input", (e) => store.set(K.me, e.target.value));
  const myName = () => {
    const n = $("#myName").value.trim();
    if (!n) { toast("Bitte gib zuerst deinen Namen ein."); $("#myName").focus(); }
    return n;
  };

  function startLocal(state) {
    L = state; mode = "local"; peek = false; solving = false; lastErrors = L.errors || 0;
    if (L.phase !== "roundEnd") G.resetClock(L);
    store.set(K.local, L); render(); wake(); scheduleBot();
  }
  $("#startLocal").addEventListener("click", () => {
    const { names, bots } = HOME.roster($("#myName").value);
    const list = names.map((name, i) => ({ name, bot: bots[i], avatar: bots[i] ? G.BOT_AVATAR : myAvatar }));
    startLocal(G.newGame(list, goalLocal, "random", localRules, levelLocal));
  });
  $("#resumeBtn").addEventListener("click", () => {
    const s = store.get(K.local); if (!s) return render();
    startLocal(s);
  });

  $("#reBtn").addEventListener("click", () => { peek = false; lastErrors = 0; doAct({ t: "next" }, mode === "local" ? 0 : null); });
  $("#reLook").addEventListener("click", () => { peek = true; render(); });
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearTimeout(clockT); render(); }
    else if (R && R.members[R.you] && R.members[R.you].lobby) { watching = false; render(); }
    else if (V && V.phase === "roundEnd" && V.last && V.last.over) wsSend({ t: "lobby" });
    else wsSend({ t: "end" });
  });

  // keep the screen on while playing (needs HTTPS; silently skipped otherwise)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (mode) wake();
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- boot ----------
  const code = UI.roomCode();
  render();
  if (webHost && (store.get(K.online) && !code)) UI.resume();
  UI.detectServer("/hangman-server", "hangman").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
