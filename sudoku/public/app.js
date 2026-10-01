// Sudoku UI: solo / vs computer and online race share one renderer.
(() => {
  "use strict";
  const G = window.SudokuGame;
  if (!G || !G.botMove || !G.AVATARS) {
    let tried = false;
    try { tried = sessionStorage.getItem("sudoku.reloaded") === "1"; sessionStorage.setItem("sudoku.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("sudoku.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const K = { local: "sudoku.v1", online: "sudoku.online", me: "sudoku.me", goal: "sudoku.goal", level: "sudoku.level",
    sound: "sudoku.sound", stats: "sudoku.stats", avatar: "sudoku.avatar", look: "sudoku.look" };
  const store = Spieleabend.store;

  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Größe" });
  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");

  const LEVELS = Object.entries(G.LEVELS).map(([v, name]) => [+v, name]);
  const GOALS = [[1, "Eine Runde"], [2, "Bis 2 Siege"], [3, "Bis 3 Siege"]];

  let mode = null;
  let L = null;
  let R = null;
  let watching = false;
  let V = null;
  let peek = false;
  let inflight = false;
  let server = null;
  let serverState = "checking";
  let sel = -1;
  let noteMode = false;
  let confettiFor = null;
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "sudoku.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, min: 0, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost || (store.get(K.local) || {}).players ? "local" : "online", tabTouched = HOME.single(); // a saved local game: open on it, so a reload shows "Weiterspielen"
  let goalLocal = G.normGoal(store.get(K.goal) || 1);
  let levelLocal = G.normLevel(store.get(K.level) || 2);

  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const canPlay = () => !!V && V.phase === "play" && V.me >= 0 && !V.players[V.me].done && !V.players[V.me].out;
  const pname = (i) => (i === V.me ? "Du" : V.players[i].name);
  const { toast, confetti, showBubble } = Spieleabend;
  Spieleabend.followTurn("#plates", ".plate.me");

  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound,
    effects: ({ tone }) => ({
      set: () => tone(520, 0, 0.05, "triangle", 0.1),
      clear: () => tone(280, 0, 0.06, "sine", 0.08),
      wrong: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16))
    })
  });

  function handleEvents(events, v) {
    if (!v) return;
    for (const ev of events || []) {
      if (ev.t === "set" && ev.pi === v.me) sfx("set");
      if (ev.t === "clear" && ev.pi === v.me) sfx("clear");
      if (ev.t === "wrong") {
        toast(ev.pi === v.me ? "Leider falsch — weiter lösen!" : `${v.players[ev.pi].name}: falsche Lösung.`);
        if (ev.pi === v.me) sfx("wrong");
      }
      if (ev.t === "giveup") toast(ev.pi === v.me ? "Du hast aufgegeben." : `${v.players[ev.pi].name} gibt auf.`);
      if (ev.t === "end") setTimeout(() => sfx("win"), 400);
    }
  }

  // the local game survives a reload; its clock only runs while the game is open
  function saveLocal() { L.savedAt = Date.now(); store.set(K.local, L); }

  function doAct(a, asPi) {
    if (mode === "local") {
      const pi = asPi != null ? asPi : 0;
      const res = G.act(L, pi, a);
      if (!res.ok) { toast(res.error); sfx("bad"); return false; }
      handleEvents(res.events, G.view(L, 0));
      saveLocal();
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

  // Filling in is many quick taps, so nothing waits for the server: the tap shows at once and the
  // next room message from the server replaces it with the real state (messages stay in order).
  function fillCell(a) {
    if (!doAct(a) || mode !== "online") return;
    const me = V.players[V.me];
    if (a.t === "set") { me.grid[a.i] = a.n; me.notes[a.i] = 0; }
    else if (a.t === "clear") { me.grid[a.i] = 0; me.notes[a.i] = 0; }
    else if (a.t === "note") me.notes[a.i] ^= 1 << (a.n - 1);
    renderGrid();
  }

  function playSet(n) {
    if (!canPlay()) { toast(V && V.me < 0 ? "Du schaust zu." : "Du bist fertig oder raus."); return; }
    if (sel < 0) { toast("Tippe zuerst ein Feld an."); return; }
    if (V.puzzle[sel]) { toast("Diese Zahl ist vorgegeben."); sfx("bad"); return; }
    buzz(8);
    fillCell({ t: noteMode ? "note" : "set", i: sel, n });
  }
  function playClear() {
    if (!canPlay() || sel < 0 || V.puzzle[sel]) return;
    fillCell({ t: "clear", i: sel });
  }
  function playSubmit() {
    if (!canPlay() || inflight) return;
    if (mode === "online") { inflight = true; setTimeout(() => { inflight = false; }, 2500); }
    buzz(12);
    doAct({ t: "submit" });
  }

  // the computers in single player (online the server moves them); the engine decides who and when
  let botT = null;
  function scheduleBot() {
    clearTimeout(botT);
    const plan = mode === "local" && L ? G.botPlan(L) : null;
    if (!plan) return;
    botT = setTimeout(() => {
      if (mode !== "local" || !L || L.phase !== "play") return;
      if (!$("#menu").hidden) { scheduleBot(); return; } // paused while the menu is open
      const a = G.botMove(L, plan.pi);
      const res = a ? G.act(L, plan.pi, a) : null;
      if (res && res.ok) { handleEvents(res.events, G.view(L, 0)); saveLocal(); render(); }
      scheduleBot();
    }, plan.delay);
  }

  function bubble(pi, text, name) {
    const host = $(`#plates .plate[data-i="${pi}"]`) || $("#whoAv");
    showBubble(host, { text, name });
  }

  function fmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  // The server's clock and the phone's clock differ, so the timer counts from the elapsed time the view
  // carries (`V.elapsed`, measured by whoever owns the game) and not from `V.startedAt`.
  let clockBase = 0;
  let tickT = null;
  function armTimer() {
    clearInterval(tickT);
    if (!V || V.phase !== "play") return;
    clockBase = Date.now() - V.elapsed;
    tickT = setInterval(() => {
      if (!V || V.phase !== "play") { clearInterval(tickT); return; }
      const el = $("#timer");
      if (el) el.textContent = fmt(Date.now() - clockBase);
    }, 250);
  }

  function showScreen(id) {
    for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id;
  }

  function segHTML(list, cur) {
    return list.map(([v, name]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${esc(name)}</button>`).join("");
  }

  function scoreList(el, highlight) {
    if (!V) { el.innerHTML = ""; return; }
    const order = V.players.map((p, i) => i).sort((a, b) => V.players[b].wins - V.players[a].wins || (V.players[a].timeMs || 1e15) - (V.players[b].timeMs || 1e15));
    el.innerHTML = order.map((i) => {
      const p = V.players[i], win = highlight.includes(i);
      const time = p.done ? fmt(p.timeMs) : (p.out ? "raus" : `${p.progress}%`);
      return `<li class="${win ? "win" : ""}"><span>${avi(p.avatar)}${esc(pname(i))}${p.bot ? " <small>Computer</small>" : ""}</span><b>${p.wins} · ${time}</b></li>`;
    }).join("");
  }

  function conflictSet(grid, puzzle) {
    const bad = new Set();
    if (!grid) return bad;
    const groups = [];
    for (let r = 0; r < 9; r++) groups.push([...Array(9)].map((_, c) => r * 9 + c));
    for (let c = 0; c < 9; c++) groups.push([...Array(9)].map((_, r) => r * 9 + c));
    for (let br = 0; br < 3; br++) for (let bc = 0; bc < 3; bc++) {
      const g = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g.push((br * 3 + r) * 9 + bc * 3 + c);
      groups.push(g);
    }
    for (const g of groups) {
      const seen = new Map();
      for (const i of g) {
        const n = grid[i]; if (!n) continue;
        if (seen.has(n)) { bad.add(i); bad.add(seen.get(n)); }
        else seen.set(n, i);
      }
    }
    return bad;
  }

  function cellHTML(i, grid, notes, bad, selVal, sr, sc) {
    const given = !!V.puzzle[i], n = grid[i], r = i / 9 | 0, c = i % 9;
    const cls = [
      given ? "given" : "",
      i === sel ? "sel" : "",
      sel >= 0 && (r === sr || c === sc || ((r / 3 | 0) === (sr / 3 | 0) && (c / 3 | 0) === (sc / 3 | 0))) ? "hl" : "",
      selVal && n === selVal ? "same" : "",
      bad.has(i) && !given ? "bad" : ""
    ].filter(Boolean).join(" ");
    let inner = n ? String(n) : "";
    if (!n && notes && notes[i]) {
      const bits = notes[i];
      inner = `<span class="notes">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<span>${bits & (1 << (d - 1)) ? d : ""}</span>`).join("")}</span>`;
    }
    return `<button type="button" role="gridcell" data-i="${i}" class="${cls}" aria-label="Feld ${r + 1},${c + 1}${n ? ": " + n : ""}">${inner}</button>`;
  }

  function renderGrid() {
    const box = $("#grid");
    if (!V) { box.innerHTML = ""; return; }
    const me = V.me >= 0 ? V.players[V.me] : null;
    const grid = me && me.grid ? me.grid : (V.solution || V.puzzle);
    const notes = me && me.notes ? me.notes : null;
    const bad = me && V.phase === "play" ? conflictSet(grid, V.puzzle) : new Set();
    const selVal = sel >= 0 && grid[sel] ? grid[sel] : 0;
    const [sr, sc] = sel >= 0 ? [sel / 9 | 0, sel % 9] : [-1, -1];
    let html = "";
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        let cells = "";
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
          cells += cellHTML((br * 3 + r) * 9 + bc * 3 + c, grid, notes, bad, selVal, sr, sc);
        }
        html += `<div class="block" role="rowgroup">${cells}</div>`;
      }
    }
    box.innerHTML = html;
  }

  function renderGame() {
    if (!V) return;
    const end = V.phase === "roundEnd";
    $("#roundInfo").textContent = `Runde ${V.round}${V.goal > 1 ? ` · bis ${V.goal} Siege` : ""} · ${G.LEVELS[V.level] || ""}`;
    $("#diffLabel").textContent = G.LEVELS[V.level] || "";
    const me = V.me >= 0 ? V.players[V.me] : null;
    $("#mistakesLabel").textContent = me ? (me.mistakes ? `${me.mistakes} Fehler` : "") : "";
    $("#timer").textContent = fmt(V.elapsed);
    armTimer();

    $("#plates").innerHTML = V.players.map((p, i) => {
      const cls = ["plate", i === V.me ? "me" : "", p.done ? "done" : "", p.out ? "out" : ""].filter(Boolean).join(" ");
      const meta = p.done ? G.fmtTime(p.timeMs) : p.out ? "aufgegeben" : `${p.progress}%`;
      return `<div class="${cls}" data-i="${i}"><span class="pav">${p.avatar || ""}</span><div class="pinfo"><div class="pname">${esc(pname(i))}</div><div class="pmeta">${meta}</div></div><div class="pscore">${p.filled}</div>${p.wins ? `<span class="pwins">${p.wins}</span>` : ""}</div>`;
    }).join("");

    renderGrid();

    const play = canPlay();
    $("#dock").classList.toggle("myturn", play);
    $("#whoAv").textContent = me ? me.avatar : "👀";
    if (end) {
      const w = V.last && V.last.winners && V.last.winners[0];
      $("#whoName").textContent = w == null ? "Niemand fertig" : (w === V.me ? "Du hast gewonnen!" : `${V.players[w].name} gewinnt`);
      $("#whoHint").textContent = V.last && V.last.timeMs != null ? `Zeit: ${fmt(V.last.timeMs)}` : "";
    } else if (me && me.done) {
      $("#whoName").textContent = "Fertig!";
      $("#whoHint").textContent = `Deine Zeit: ${fmt(me.timeMs)}`;
    } else if (me && me.out) {
      $("#whoName").textContent = "Aufgegeben";
      $("#whoHint").textContent = "Die anderen spielen weiter.";
    } else if (play) {
      $("#whoName").textContent = "Dein Sudoku";
      $("#whoHint").textContent = noteMode ? "Notiz-Modus: tippe eine Zahl für Bleistift-Markierungen." : "Tippe ein Feld, dann eine Zahl. „Fertig“ prüft deine Lösung.";
    } else {
      $("#whoName").textContent = "Zuschauen";
      $("#whoHint").textContent = "Du siehst nur den Fortschritt der anderen.";
    }

    for (const b of $("#pad").querySelectorAll("[data-n]")) b.disabled = !play;
    for (const id of ["clearBtn", "noteBtn", "submitBtn"]) {
      const b = $("#" + id); if (b) b.disabled = !play;
    }
    $("#reactBtn").hidden = mode !== "online";
    $("#noteBtn").setAttribute("aria-pressed", noteMode ? "true" : "false");
    $("#resultBtn").hidden = !(end && peek);
    $("#submitBtn").hidden = end && peek;
    $("#clearBtn").hidden = end && peek;
    $("#noteBtn").hidden = end && peek;
    renderRoundEnd();
  }

  function renderHome() {
    for (const b of $("#modeTabs").children) b.setAttribute("aria-pressed", b.dataset.tab === tab ? "true" : "false");
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
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => p.name).join(" gegen ")} · Runde ${saved.round} · ${G.LEVELS[saved.level] || ""}`;
    HOME.render();
  }

  function renderRoundEnd() {
    const box = $("#roundEnd");
    if (!V || V.phase !== "roundEnd" || peek) { box.hidden = true; return; }
    box.hidden = false;
    const over = !!(V.last && V.last.over);
    const w = V.last && V.last.winners || [];
    $("#reLabel").textContent = over ? "Spielende" : `Runde ${V.round}`;
    if (!w.length) {
      $("#reTitle").textContent = "Kein Sieger";
      $("#reText").textContent = "Niemand hat das Rätsel gelöst.";
    } else {
      const i = w[0];
      $("#reTitle").textContent = i === V.me ? "Du gewinnst!" : `${V.players[i].name} gewinnt!`;
      $("#reText").textContent = `Zeit: ${fmt(V.last.timeMs)}${over ? " — Spiel gewonnen." : ""}`;
    }
    scoreList($("#reScores"), w);
    UI.roundEndFooter({ over, next: "Nächste Runde" });

    // rid is new for every round (the round number starts at 1 again after a rematch); the profile ignores a key it has seen
    if (over && V.me >= 0 && confettiFor !== V.rid) {
      confettiFor = V.rid;
      const won = w.includes(V.me);
      if (won) confetti();
      try { Spieleabend.profile.result("sudoku", `r${V.rid}`, { won, online: mode === "online" }); } catch (e) {}
    }
  }

  function render() {
    if (mode === "local" && L) {
      V = G.view(L, 0);
      showScreen("game");
      renderGame();
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

  const UI = window.RoomUI({
    room: () => R, view: () => V, mode: () => mode, server: () => server,
    watching: (v) => (v === undefined ? watching : (watching = v)),
    onlineKey: K.online,
    on: {
      opened() { if (serverState !== "ok") { serverState = "ok"; server = server || {}; } },
      joined(m) { mode = "online"; wake(); },
      room(m) { R = m; mode = "online"; inflight = false; if (m.view) handleEvents(m.events, m.view); render(); },
      react(m) { bubble(m.pi, m.e, m.name); },
      error(m) { inflight = false; },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text, name) => bubble(pi, text, name),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    renderSettings(host) {
      for (const [id, list, cur] of [["#goalOnline", GOALS, R.goal], ["#levelOnline", LEVELS, R.level || 2]]) {
        const el = $(id), k = cur + ":" + host;
        if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = segHTML(list, cur); for (const b of el.children) b.disabled = !host; }
      }
    },
    menu: {
      open() {
        LOOK.render();
        if (V) scoreList($("#menuScores"), (V.last && V.last.winners) || []);
        $("#menuRules").textContent = V ? `${G.LEVELS[V.level] || ""} · ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}. Alle lösen dasselbe Rätsel gegen die Uhr.` : "";
      },
      local(box) {
        box.append(
          UI.armed("Runde neu starten", () => { L.round--; G.startRound(L); peek = false; sel = -1; saveLocal(); render(); scheduleBot(); }),
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearInterval(tickT); render(); })
        );
      },
      player(box) {
        if (V && V.phase === "play" && V.me >= 0 && !V.players[V.me].done && !V.players[V.me].out)
          box.append(UI.armed("Aufgeben", () => wsSend({ t: "act", a: { t: "giveup" } })));
      },
      skip: (v) => false
    }
  });
  function wsSend(m) { return UI.send(m); }

  Spieleabend.avatarPicker({ avatars: G.AVATARS, get: () => myAvatar, set: (a) => { myAvatar = a; store.set(K.avatar, a); } });

  for (const [id, key] of [["goal", "goal"], ["level", "level"]]) {
    $(`#${id}Online`).addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", [key]: +b.dataset.v }); });
  }
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
    L = state; mode = "local"; peek = false; sel = -1; noteMode = false;
    if (L.phase === "play" && L.savedAt) L.startedAt += Date.now() - L.savedAt; // the clock stood still while the game was closed
    saveLocal(); render(); wake(); scheduleBot();
  }
  $("#startLocal").addEventListener("click", () => {
    const { names, bots } = HOME.roster($("#myName").value);
    const list = names.map((name, i) => ({ name, bot: bots[i], avatar: bots[i] ? G.BOT_AVATAR : myAvatar }));
    startLocal(G.newGame(list, goalLocal, levelLocal));
  });
  $("#resumeBtn").addEventListener("click", () => {
    const s = store.get(K.local); if (!s) return render();
    startLocal(s);
  });

  $("#grid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]"); if (!b || !canPlay()) return;
    sel = +b.dataset.i;
    renderGrid();
  });
  $("#pad").addEventListener("click", (e) => {
    const n = e.target.closest("[data-n]");
    if (n) playSet(+n.dataset.n);
  });
  $("#acts").addEventListener("click", (e) => {
    if (e.target.closest("#clearBtn")) return playClear();
    if (e.target.closest("#noteBtn")) { noteMode = !noteMode; renderGame(); return; }
    if (e.target.closest("#submitBtn")) return playSubmit();
    if (e.target.closest("#resultBtn")) { peek = false; render(); }
  });

  document.addEventListener("keydown", (e) => {
    if (!canPlay() || !$("#menu").hidden || !$("#roundEnd").hidden) return;
    if (e.key >= "1" && e.key <= "9") { e.preventDefault(); playSet(+e.key); }
    else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") { e.preventDefault(); playClear(); }
    else if (e.key === "n" || e.key === "N") { noteMode = !noteMode; renderGame(); }
    else if (e.key === "Enter") { e.preventDefault(); playSubmit(); }
    else if (e.key.startsWith("Arrow") && sel >= 0) {
      e.preventDefault();
      const r = sel / 9 | 0, c = sel % 9;
      if (e.key === "ArrowUp") sel = ((r + 8) % 9) * 9 + c;
      if (e.key === "ArrowDown") sel = ((r + 1) % 9) * 9 + c;
      if (e.key === "ArrowLeft") sel = r * 9 + ((c + 8) % 9);
      if (e.key === "ArrowRight") sel = r * 9 + ((c + 1) % 9);
      renderGrid();
    }
  });

  $("#reBtn").addEventListener("click", () => { peek = false; doAct({ t: "next" }); });
  $("#reLook").addEventListener("click", () => { peek = true; render(); });
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearInterval(tickT); render(); }
    else if (R && R.members[R.you] && R.members[R.you].lobby) { watching = false; render(); }
    else if (V && V.phase === "roundEnd" && V.last && V.last.over) wsSend({ t: "lobby" });
    else wsSend({ t: "end" });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (mode) wake();
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  const code = UI.roomCode();
  render();
  if (webHost && (store.get(K.online) && !code)) UI.resume();
  UI.detectServer("/sudoku-server", "sudoku").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
