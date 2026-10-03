// Activity UI: single player (against the computer) and online rooms share one table renderer.
// The drawing is not part of the room state: the person on sends small batches of strokes, everybody else paints them.
(() => {
  "use strict";
  const G = window.ActivityGame;
  // An old cached game.js next to a new app.js: reload once without cache instead of breaking.
  if (!G || !G.botMove || !G.AVATARS || !G.PALETTE) {
    let tried = false;
    try { tried = sessionStorage.getItem("activity.reloaded") === "1"; sessionStorage.setItem("activity.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("activity.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const K = { local: "activity.v1", online: "activity.online", me: "activity.me", goal: "activity.goal", modes: "activity.modes", time: "activity.time", level: "activity.level",
    sound: "activity.sound", avatar: "activity.avatar", look: "activity.look" };
  const store = Spieleabend.store;
  const ME = 0; // alone, the person is seat 0

  // table design and size (shared, kit.js), applied before anything is drawn
  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Größe" });

  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");

  const ICON = { draw: "✏️", explain: "🗣️", mime: "🎭" };
  const VERB = { draw: ["zeichnest", "zeichnet"], explain: ["erklärst", "erklärt"], mime: ["spielst vor", "spielt vor"] };
  const MODE_LIST = Object.entries(G.MODES).map(([k, name]) => [G.MODE_BIT[k], `${ICON[k]} ${name}`]);
  const LEVELS = Object.entries(G.LEVELS).map(([v, name]) => [+v, name]);
  const TIMES = Object.entries(G.TIME_LABELS).map(([v, name]) => [+v, name, `${G.TIMES[v] / 1000} s`]);
  const GOALS = [[1, "Kurz", "1 Durchgang"], [2, "Mittel", "2 Durchgänge"], [3, "Lang", "3 Durchgänge"]];

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let R = null;           // last online room message
  let watching = false;   // in the waiting room, but watching the game that runs
  let V = null;           // view currently on screen
  let pulse = null;       // seat that just solved
  let peek = false;       // game over, looking at the table
  let server = null;      // server info once found ({} when only the WebSocket answered)
  let serverState = "checking"; // "checking" | "ok" | "none"
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "activity.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let goalLocal = G.normGoal(store.get(K.goal) || 1), modesLocal = G.normModes(store.get(K.modes) || 7), timeLocal = G.normTime(store.get(K.time) || 2);
  let levelLocal = G.normLevel(store.get(K.level) || 2);
  let confettiFor = null;
  let turnKey = null, feedSeen = -1, prevPat = "", endAt = 0, lastSec = -1;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const pname = (i) => (i === V.me ? "Du" : V.players[i].name);
  const isActor = () => !!V && V.me >= 0 && V.cur === V.me && (V.phase === "prep" || V.phase === "play");
  const canDraw = () => !!V && isActor() && V.phase === "play" && V.mode === "draw";
  const canGuess = () => !!V && V.me >= 0 && V.phase === "play" && V.cur !== V.me && V.players[V.me].solved == null;
  const { toast, confetti, showBubble } = Spieleabend;

  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound,
    effects: ({ tone }) => ({
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      guess: () => tone(520, 0, 0.05, "sine", 0.07),
      close: () => { tone(560, 0, 0.08, "triangle", 0.1); tone(640, 0.08, 0.1, "triangle", 0.1); },
      solve: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.16, "triangle", 0.14)),
      hint: () => tone(900, 0, 0.12, "sine", 0.1),
      go: () => { tone(440, 0, 0.1, "triangle", 0.12); tone(660, 0.1, 0.16, "triangle", 0.12); },
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      tick: () => tone(1200, 0, 0.04, "square", 0.05),
      reveal: () => { tone(392, 0, 0.12, "triangle", 0.12); tone(330, 0.12, 0.2, "triangle", 0.12); },
      bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16))
    })
  });

  // ---------- events → feedback (every move is animated, also the computer's and other people's) ----------
  function handleEvents(events, v) {
    if (!v) return;
    for (const ev of events || []) {
      if (ev.t === "turn") { if (ev.pi === v.me) { toast("Du bist dran!"); buzz([40, 60, 40]); sfx("turn"); } }
      else if (ev.t === "go") sfx("go");
      else if (ev.t === "guess") sfx(ev.close ? "close" : "guess");
      else if (ev.t === "solve") { pulse = ev.pi; sfx("solve"); if (ev.pi === v.me) buzz(30); }
      else if (ev.t === "hint") sfx("hint");
      else if (ev.t === "reveal") sfx("reveal");
      else if (ev.t === "swap") { if (ev.pi !== v.me) toast(`${v.players[ev.pi].name} nimmt einen anderen Begriff.`); }
      else if (ev.t === "giveup") toast(ev.pi === v.me ? "Du hast aufgegeben." : `${v.players[ev.pi].name} gibt auf.`);
      else if (ev.t === "end") setTimeout(() => sfx("win"), 500);
    }
  }

  // ---------- actions ----------
  function doAct(a) {
    if (mode === "local") {
      const res = G.act(L, ME, a);
      if (!res.ok) { toast(res.error); sfx("bad"); return false; }
      handleEvents(res.events, G.view(L, ME));
      store.set(K.local, L);
      render();
      return true;
    }
    if (mode === "online") {
      if (!wsSend({ t: "act", a })) { toast("Keine Verbindung zum Server."); return false; }
      return true;
    }
    return false;
  }

  // the computer in single player (online the server moves it); it only guesses
  let botT = null, botKey = null;
  function scheduleBot() {
    if (mode !== "local" || !L) { clearTimeout(botT); botKey = null; return; }
    const p = G.botPlan(L);
    if (!p) { clearTimeout(botT); botKey = null; return; }
    if (p.key === botKey) return;
    clearTimeout(botT); botKey = p.key;
    botT = setTimeout(() => {
      botKey = null;
      if (mode !== "local" || !L) return;
      const q = G.botPlan(L);
      if (!q || q.key !== p.key) { scheduleBot(); return; }
      const a = G.botMove(L, q.pi), res = a ? G.act(L, q.pi, a) : null;
      if (res && res.ok) { handleEvents(res.events, G.view(L, ME)); store.set(K.local, L); render(); }
      else scheduleBot();
    }, p.delay);
  }
  function stopLocal() { clearTimeout(botT); botKey = null; store.del(K.local); L = null; mode = null; }

  // time in single player: hints, running out, next turn
  setInterval(() => {
    if (mode === "local" && L) {
      const ev = G.tick(L);
      if (ev.length) { handleEvents(ev, G.view(L, ME)); store.set(K.local, L); render(); }
    }
    clock();
  }, 250);

  function clock() {
    if (!V || $("#game").hidden) return;
    const left = Math.max(0, endAt - Date.now()), timed = V.phase === "play" || V.phase === "prep";
    const bar = $("#timer");
    bar.hidden = !timed && V.phase !== "reveal";
    bar.firstElementChild.style.transform = `scaleX(${V.total ? Math.min(1, left / V.total) : 0})`;
    bar.classList.toggle("low", V.phase === "play" && left <= 10000);
    const sec = Math.ceil(left / 1000);
    $("#secs").textContent = timed ? sec + " s" : "";
    if (V.phase === "play" && sec !== lastSec && sec <= 5 && sec > 0) sfx("tick");
    lastSec = sec;
  }

  // ---------- rendering ----------
  function showScreen(id) {
    for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id;
  }

  function render() {
    if (mode === "local" && L) {
      V = G.view(L, ME);
      showScreen("game");
      renderGame();
      scheduleBot();
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

  function plateHTML(i) {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = members && members[i] && !members[i].online;
    const playing = V.phase === "prep" || V.phase === "play";
    const on = playing && V.cur === i;
    const cls = ["plate", on ? "active" : "", away ? "away" : "", pulse === i ? "pulse" : ""].join(" ");
    let tag = p.bot ? "Computer" : away ? "offline" : i === V.me ? "du" : "";
    if (on) tag = VERB[V.mode][1];
    else if (playing && p.solved != null) tag = `+${p.solved}`;
    return `<div class="${cls}" data-seat="${i}">${playing && p.solved != null ? '<span class="tick">✓</span>' : ""}<span class="pav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="pinfo"><span class="pname">${esc(p.name)}</span><span class="pmeta">${esc(tag) || "&nbsp;"}</span></span>` +
      `<span class="pscore">${p.score}</span>` +
      `<span class="pwins" title="Siege">${p.wins}</span></div>`;
  }

  function wordHTML(text, fresh) {
    return Array.from(text).map((ch, i) => (ch === " " ? '<span class="gap"></span>' : `<span class="l${fresh && fresh.includes(i) ? " rev" : ""}">${esc(ch)}</span>`)).join("");
  }

  function renderGame() {
    if (V.phase !== "roundEnd") peek = false;
    const key = `${V.round}:${V.turn}`;
    if (key !== turnKey) newTurn(key);
    endAt = Date.now() + V.left;
    $("#plates").innerHTML = V.players.map((_, i) => plateHTML(i)).join("");
    pulse = null;
    $("#roundInfo").innerHTML = `Zug <b>${Math.min(V.turn, V.turns)}</b> von ${V.turns}`;

    const act = isActor(), play = V.phase === "play", prep = V.phase === "prep", reveal = V.phase === "reveal", over = V.phase === "roundEnd";
    const m = V.mode || (V.lastTurn && V.lastTurn.mode) || null;
    const lt = V.lastTurn;
    const showCanvas = m === "draw" && (play || reveal);
    $("#modeChip").textContent = m ? `${ICON[m]} ${G.MODES[m]}` : "";
    $("#modeChip").hidden = !m;

    // the word (hidden as a pattern for those who guess)
    const wl = $("#wordLine"), ws = $("#wordSub");
    wl.classList.remove("pat", "got");
    if (reveal && lt) {
      wl.innerHTML = wordHTML(lt.word); wl.classList.add(lt.solvers.length ? "got" : "x");
      ws.textContent = lt.solvers.length ? `Erraten von ${lt.solvers.map((i) => (i === V.me ? "dir" : V.players[i].name)).join(", ")}` : lt.reason === "giveup" ? "Aufgegeben" : "Niemand hat es erraten";
    } else if (V.word && (prep || play)) {
      wl.innerHTML = wordHTML(V.word);
      if (!act) wl.classList.add("got");
      ws.innerHTML = `<span class="stars">${"★".repeat(V.d)}${"☆".repeat(3 - V.d)}</span> ${act ? "Dein Begriff" : "Erraten!"}`;
    } else if (play && V.pattern) {
      const fresh = prevPat && prevPat.length === V.pattern.length ? Array.from(V.pattern).map((c, i) => (c !== prevPat[i] ? i : -1)).filter((i) => i >= 0) : [];
      wl.innerHTML = wordHTML(V.pattern, fresh); wl.classList.add("pat");
      const n = Array.from(V.pattern).filter((c) => c !== " ").length;
      ws.textContent = `${n} Buchstaben${V.hints ? "" : ", nach der Hälfte der Zeit gibt es Hinweise"}`;
      prevPat = V.pattern;
    } else if (prep) {
      wl.textContent = "Gleich geht's los"; ws.textContent = "";
    } else { wl.textContent = ""; ws.textContent = ""; }
    if (!play) prevPat = "";

    // the picture or a card for explaining and acting
    $("#canvasWrap").hidden = !showCanvas;
    const card = $("#card");
    card.hidden = showCanvas || over;
    card.classList.toggle("go", play);
    if (!card.hidden) {
      const who = V.players[V.cur] ? V.players[V.cur].name : "";
      $("#cardBig").textContent = reveal ? (lt && lt.solvers.length ? "🎉" : "🤷") : ICON[m] || "";
      if (reveal && lt) {
        $("#cardTitle").textContent = lt.solvers.length ? `${lt.solvers.length} ${lt.solvers.length === 1 ? "hat" : "haben"} es erraten` : "Zeit abgelaufen";
        $("#cardHelp").textContent = `${V.players[lt.pi].name} bekommt ${lt.solvers.length * (lt.d >= 3 ? 3 : 2)} Punkte fürs Darstellen.`;
      } else if (act) {
        $("#cardTitle").textContent = `Du ${VERB[m][0]}`;
        $("#cardHelp").textContent = V.help;
      } else {
        $("#cardTitle").textContent = `${who} ${VERB[m] ? VERB[m][1] : ""}`;
        $("#cardHelp").textContent = prep ? "Gleich geht's los. Gleich kannst du raten." : V.me >= 0 ? "Tippe unten, was gemeint ist." : "Du schaust zu.";
      }
    }
    if (showCanvas) { sizeCanvas(); $("#canvasWrap").classList.toggle("watch", !canDraw()); }
    if (mode === "online" && !act && V.mode === "draw" && V.dn !== dn) requestSync();

    // feed: what the others guess (fresh lines pop in)
    const fe = $("#feed");
    fe.innerHTML = V.feed.map((f) => {
      const cls = [f.solved ? "ok" : "", f.n > feedSeen ? "fresh" : ""].join(" ").trim();
      const name = f.pi === V.me ? "Du" : V.players[f.pi].name;
      return f.solved ? `<div class="${cls}"><span class="who2">${esc(name)}</span><span class="txt">hat es erraten!</span><span class="near">+${f.pts}</span></div>`
        : `<div class="${cls}"><span class="who2">${esc(name)}:</span><span class="txt">${esc(f.text)}</span>${f.close ? '<span class="near">nah dran</span>' : ""}</div>`;
    }).join("");
    if (V.feed.length) feedSeen = Math.max(feedSeen, V.feed[V.feed.length - 1].n);
    fe.scrollTop = fe.scrollHeight;
    fe.hidden = !V.feed.length;

    // dock
    let who = "", hint = "", av = "";
    if (over) {
      const w = V.last.winners;
      who = !w.length ? "Keiner hat gepunktet" : w.length > 1 ? "Unentschieden" : w[0] === V.me ? "Du gewinnst" : `${V.players[w[0]].name} gewinnt`;
      av = w.length ? V.players[w[0]].avatar : "🤷";
      hint = "Spiel vorbei.";
    } else if (reveal && lt) {
      av = V.players[lt.pi].avatar;
      who = lt.solvers.length ? "Erraten!" : "Nicht erraten";
      hint = "Gleich geht's weiter.";
    } else {
      const P = V.players[V.cur];
      av = P.avatar;
      if (act && prep) { who = `Du ${VERB[m][0]}`; hint = "Lies in Ruhe. Nach 20 Sekunden geht es von selbst los."; }
      else if (act) { who = `Du ${VERB[m][0]}`; hint = m === "draw" ? "Zeichne mit dem Finger oder der Maus." : V.help; }
      else if (canGuess()) { who = "Rate mit!"; hint = prep ? `${P.name} ${VERB[m][1]} gleich.` : `${P.name} ${VERB[m][1]}.`; }
      else if (play && V.me >= 0) { who = "Erraten!"; hint = "Warte auf die anderen."; }
      else { who = `${P.name} ${VERB[m] ? VERB[m][1] : "ist dran"}`; hint = V.me < 0 ? "Du schaust zu." : "Gleich geht's los."; }
    }
    $("#whoAv").textContent = av;
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    $("#dock").classList.toggle("myturn", act);

    $("#tools").hidden = !canDraw();
    const gf = $("#guessForm"), showForm = canGuess();
    if (gf.hidden && showForm && matchMedia("(hover:hover)").matches) setTimeout(() => $("#guessInput").focus(), 0);
    gf.hidden = !showForm;
    $("#swapBtn").hidden = !(act && prep && !V.swapped);
    $("#goBtn").hidden = !(act && prep);
    $("#giveBtn").hidden = !act;
    $("#giveBtn").textContent = prep ? "Überspringen" : "Aufgeben";
    $("#resultBtn").hidden = !(over && peek);
    $("#reactBtn").hidden = mode !== "online";
    $("#keys").innerHTML = "";
    clock();

    $("#roundEnd").hidden = !over || peek;
    if (over) {
      if (!peek) renderRoundEnd();
      const k = `${V.round}:${V.last.winners.join(",")}:${V.players.map((p) => p.wins).join(",")}`;
      if (confettiFor !== k) {
        confettiFor = k; record(k);
        setTimeout(() => confetti(), 700);
      }
    }
  }

  function newTurn(key) {
    turnKey = key; prevPat = ""; lastSec = -1;
    feedSeen = V.feed.length ? V.feed[V.feed.length - 1].n : -1;
    $("#guessInput").value = "";
    strokes = []; dn = 0; pend = []; drawing = false;
    if (mode === "local" && L && L.draw && L.draw.length) { strokes = L.draw.map((s) => ({ c: s.c, w: s.w, p: s.p.slice() })); dn = L.dn || 0; }
    else if (mode === "online" && V.dn > 0) requestSync(true);
    paintSoon();
  }

  $("#giveBtn").addEventListener("click", () => doAct({ t: "giveup" }));
  $("#goBtn").addEventListener("click", () => doAct({ t: "go" }));
  $("#swapBtn").addEventListener("click", () => doAct({ t: "swap" }));
  $("#resultBtn").addEventListener("click", () => { peek = false; render(); });
  $("#guessForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = $("#guessInput"), text = inp.value.trim();
    if (!text || !canGuess()) return;
    inp.value = "";
    buzz(8);
    doAct({ t: "guess", text });
  });

  // ---------- the drawing ----------
  const PAL = G.PALETTE, WID = G.WIDTHS, cv = $("#board"), cx = cv.getContext("2d");
  let strokes = [], dn = 0, pend = [], drawing = false, syncAt = 0, flushT = null, paintQ = false;
  let pen = { c: 0, w: 1 };
  const points = () => strokes.reduce((n, s) => n + s.p.length / 2, 0);

  function strokePath(s, sc) {
    cx.strokeStyle = PAL[s.c]; cx.lineWidth = WID[s.w] * sc; cx.lineCap = cx.lineJoin = "round";
    cx.beginPath(); cx.moveTo(s.p[0] * sc, s.p[1] * sc);
    if (s.p.length < 4) cx.lineTo(s.p[0] * sc + 0.01, s.p[1] * sc);
    for (let i = 2; i < s.p.length; i += 2) cx.lineTo(s.p[i] * sc, s.p[i + 1] * sc);
    cx.stroke();
  }
  function paint() {
    paintQ = false;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
    const sc = cv.width / G.CANVAS_W;
    for (const s of strokes) strokePath(s, sc);
  }
  function paintSoon() { if (!paintQ) { paintQ = true; requestAnimationFrame(paint); } }
  function sizeCanvas() {
    const w = Math.round(cv.clientWidth * (window.devicePixelRatio || 1));
    if (w && Math.abs(cv.width - w) > 1) { cv.width = w; cv.height = Math.round(w * G.CANVAS_H / G.CANVAS_W); paintSoon(); }
  }
  if (window.ResizeObserver) new ResizeObserver(() => { if (!$("#canvasWrap").hidden) sizeCanvas(); }).observe($("#canvasWrap"));

  // the same bookkeeping as the server (game.js draw)
  function applyOps(ops) {
    for (const op of ops) {
      if (op[0] === "b") strokes.push({ c: op[1], w: op[2], p: [op[3], op[4]] });
      else if (op[0] === "m" && strokes.length) { const s = strokes[strokes.length - 1]; for (let i = 1; i < op.length; i++) s.p.push(op[i]); }
      else if (op[0] === "u") strokes.pop();
      else if (op[0] === "x") strokes.length = 0;
    }
  }
  function requestSync(force) {
    const now = Date.now();
    if (!force && now - syncAt < 800) return;
    syncAt = now; wsSend({ t: "drawsync" });
  }
  function onDraw(m) {
    if (!V || isActor()) return;
    if (m.full) { strokes = (m.strokes || []).map((s) => ({ c: s.c, w: s.w, p: s.p.slice() })); dn = m.n; }
    else if (m.from === dn) { applyOps(m.ops); dn = m.n; }
    else { requestSync(); return; }
    paintSoon();
  }

  // send what was drawn in small batches (about 10 per second, well below the server's limit)
  function flush() {
    clearTimeout(flushT); flushT = null;
    if (!pend.length) return;
    const ops = pend; pend = [];
    let chunk = [], nums = 0;
    const out = () => {
      if (!chunk.length) return;
      if (mode === "local") G.draw(L, ME, chunk); else wsSend({ t: "draw", ops: chunk });
      chunk = []; nums = 0;
    };
    for (const op of ops) {
      if (chunk.length >= 60 || nums + op.length > 500) out();
      chunk.push(op); nums += op.length;
    }
    out();
  }
  const queue = (op) => { pend.push(op); if (!flushT) flushT = setTimeout(flush, 100); };
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return [Math.max(0, Math.min(G.CANVAS_W, Math.round((e.clientX - r.left) / r.width * G.CANVAS_W))), Math.max(0, Math.min(G.CANVAS_H, Math.round((e.clientY - r.top) / r.height * G.CANVAS_H)))];
  };
  cv.addEventListener("pointerdown", (e) => {
    if (!canDraw() || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    if (strokes.length >= 400 || points() >= 7990) { toast("Die Zeichenfläche ist voll. Lösche etwas."); sfx("bad"); return; }
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    drawing = true;
    const [x, y] = pos(e), s = { c: pen.c, w: pen.w, p: [x, y] };
    strokes.push(s); queue(["b", s.c, s.w, x, y]);
    strokePath(s, cv.width / G.CANVAS_W);
  });
  cv.addEventListener("pointermove", (e) => {
    if (!drawing || !canDraw()) return;
    e.preventDefault();
    const s = strokes[strokes.length - 1], sc = cv.width / G.CANVAS_W;
    for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : null) || [e]) {
      if (points() >= 8000) break;
      const [x, y] = pos(ev), lx = s.p[s.p.length - 2], ly = s.p[s.p.length - 1];
      if (Math.abs(x - lx) + Math.abs(y - ly) < 2) continue;
      s.p.push(x, y);
      cx.strokeStyle = PAL[s.c]; cx.lineWidth = WID[s.w] * sc; cx.lineCap = cx.lineJoin = "round";
      cx.beginPath(); cx.moveTo(lx * sc, ly * sc); cx.lineTo(x * sc, y * sc); cx.stroke();
      const last = pend[pend.length - 1];
      if (last && last[0] === "m" && last.length < 200) last.push(x, y); else queue(["m", x, y]);
    }
  });
  const up = () => { if (!drawing) return; drawing = false; flush(); };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  cv.addEventListener("contextmenu", (e) => e.preventDefault());

  function buildTools() {
    const t = $("#tools");
    t.innerHTML = PAL.map((c, i) => `<button type="button" class="sw${i === PAL.length - 1 ? " erase" : ""}" data-c="${i}" style="background:${c}" aria-label="${i === PAL.length - 1 ? "Radierer" : "Farbe " + (i + 1)}" aria-pressed="${i === pen.c}">${i === PAL.length - 1 ? "⌫" : ""}</button>`).join("") +
      '<span class="sep"></span>' +
      WID.map((w, i) => `<button type="button" class="wd" data-w="${i}" aria-label="Dicke ${i + 1}" aria-pressed="${i === pen.w}"><i style="width:${4 + i * 4}px;height:${4 + i * 4}px"></i></button>`).join("") +
      '<span class="sep"></span><button type="button" class="tool" data-u="1" aria-label="Rückgängig">↶ Zurück</button><button type="button" class="tool" data-x="1" aria-label="Alles löschen">Löschen</button>';
  }
  buildTools();
  $("#tools").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || !canDraw()) return;
    if (b.dataset.c != null) pen.c = +b.dataset.c;
    else if (b.dataset.w != null) pen.w = +b.dataset.w;
    else if (b.dataset.u) { flush(); if (strokes.length) { strokes.pop(); queue(["u"]); paintSoon(); flush(); } }
    else if (b.dataset.x) { flush(); if (strokes.length) { strokes.length = 0; queue(["x"]); paintSoon(); flush(); } }
    for (const x of $("#tools").querySelectorAll("[data-c]")) x.setAttribute("aria-pressed", String(+x.dataset.c === pen.c));
    for (const x of $("#tools").querySelectorAll("[data-w]")) x.setAttribute("aria-pressed", String(+x.dataset.w === pen.w));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (open) $(open).hidden = true;
  });

  // ---------- reactions (online) ----------
  function bubble(pi, e, who) {
    const host = pi >= 0 ? document.querySelector(`#plates [data-seat="${pi}"]`) : $("#dock");
    if (!host) return;
    const b = document.createElement("span");
    const text = e.length > 3;
    b.className = "bubble" + (text ? " say" : ""); b.textContent = pi < 0 && who ? `${who}: ${e}` : e;
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

  function scoreList(el, winners) {
    const order = V.players.map((p, i) => i).sort((a, b) => V.players[b].score - V.players[a].score);
    el.innerHTML = order.map((i) => {
      const p = V.players[i], you = i === V.me ? " (du)" : "";
      return `<li class="${winners.includes(i) ? "win" : ""}"><span>${avi(p.avatar)}${esc(p.name)}${you}<small>${p.score} Punkte</small></span>` +
        `<b>${p.wins} ${p.wins === 1 ? "Sieg" : "Siege"}</b></li>`;
    }).join("");
  }

  function renderRoundEnd() {
    const last = V.last, w = last.winners;
    $("#reLabel").textContent = "Spiel vorbei";
    $("#reTitle").textContent = !w.length ? "Keiner hat gepunktet" : w.length > 1 ? "Unentschieden!" : `${w[0] === V.me ? "Du gewinnst" : `${V.players[w[0]].name} gewinnt`}!`;
    $("#reText").textContent = `${last.top} Punkte nach ${last.turns} ${last.turns === 1 ? "Zug" : "Zügen"}.`;
    scoreList($("#reScores"), w);
    $("#reHist").innerHTML = V.hist.map((h) => {
      const n = V.players.length - 1;
      return `<li><span>${ICON[h.mode]} <b>${esc(h.word)}</b></span><span>${esc(V.players[h.pi].name)} · ${h.solvers.length}/${n} erraten</span></li>`;
    }).join("");
    UI.roundEndFooter({ over: true, next: "Neues Spiel" });
  }

  // Statistik lebt im Profil (shared/profile.js, gilt für alle Spiele)
  const profile = Spieleabend.profile;
  function record(key) {
    const i = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
    if (i < 0) return;
    profile.result("activity", key, { won: V.last.winners.includes(i), draw: !V.last.winners.length, online: mode === "online" });
  }

  // ---------- start screen ----------
  function segHTML(list, cur) {
    return list.map(([v, a, b]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${a}${b ? `<small>${b}</small>` : ""}</button>`).join("");
  }
  const togglesHTML = (bits) => MODE_LIST.map(([bit, name]) => `<button type="button" data-v="${bit}" aria-pressed="${!!(bits & bit)}">${name}</button>`).join("");
  const flip = (bits, bit) => ((bits ^ bit) & 7) || bits; // never switch off the last one

  function renderHome() {
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
    $("#modesLocal").innerHTML = togglesHTML(modesLocal);
    $("#timeLocal").innerHTML = segHTML(TIMES, timeLocal);
    $("#goalLocal").innerHTML = segHTML(GOALS, goalLocal);
    $("#levelLocal").innerHTML = segHTML(LEVELS, levelLocal);

    const saved = store.get(K.local);
    $("#resumePanel").hidden = !(saved && saved.players);
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => p.name).join(", ")} · Zug ${saved.turn} von ${saved.turns}`;
    HOME.render();
  }

  // ---------- waiting room and menu: shared (room-ui.js), plus this game's own parts ----------
  const UI = window.RoomUI({
    room: () => R, view: () => V, mode: () => mode, server: () => server,
    watching: (v) => (v === undefined ? watching : (watching = v)),
    onlineKey: K.online,
    on: {
      opened() { if (serverState !== "ok") { serverState = "ok"; server = server || {}; } },
      joined(m) { mode = "online"; wake(); },
      room(m) { R = m; mode = "online"; if (m.view) handleEvents(m.events, m.view); render(); },
      msg(m) { if (m.t === "draw") onDraw(m); },
      react(m) { bubble(m.pi, m.e, m.name); },
      error(m) {},
      left() { R = null; mode = null; turnKey = null; }
    },
    bubble: (pi, text, name) => bubble(pi, text, name),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    // the settings the host picks in the waiting room; everyone sees them
    renderSettings(host) {
      for (const [id, html, cur] of [["#modesOnline", togglesHTML, R.modes], ["#timeOnline", (c) => segHTML(TIMES, c), R.time], ["#goalOnline", (c) => segHTML(GOALS, c), R.goal], ["#levelOnline", (c) => segHTML(LEVELS, c), R.level || 2]]) {
        const el = $(id), k = cur + ":" + host;
        if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = html(cur); for (const b of el.children) b.disabled = !host; }
      }
    },
    menu: {
      open() {
        LOOK.render();
        if (V && $("#menuScores")) scoreList($("#menuScores"), []);
        const c = V ? { modes: V.modes, time: V.time, goal: V.goal } : null;
        if ($("#menuRules")) $("#menuRules").textContent = c ? `${G.modeList(c.modes).map((x) => G.MODES[x]).join(", ")} · ${G.TIME_LABELS[c.time]} · ${G.GOALS[c.goal]}` : "";
      },
      local(box) {
        box.append(
          UI.armed("Spiel neu starten", () => { L = G.newGame(L.players.map((p) => ({ name: p.name, bot: p.bot, avatar: p.avatar })), L.goal, L.modes, L.time, L.level); turnKey = null; peek = false; store.set(K.local, L); render(); }),
          UI.armed("Spiel beenden", () => { stopLocal(); render(); })
        );
      },
      player(box) {
        if (V && (V.phase === "play" || V.phase === "prep") && isActor()) box.append(UI.armed("Aufgeben", () => wsSend({ t: "act", a: { t: "giveup" } })));
      },
      skip: () => false
    }
  });
  function wsSend(m) { return UI.send(m); }

  // avatar picker on the start screen
  Spieleabend.avatarPicker({ avatars: G.AVATARS, get: () => myAvatar, set: (a) => { myAvatar = a; store.set(K.avatar, a); } });

  const hostSet = (key, v) => { if (R && R.you === R.host) wsSend({ t: "settings", [key]: v }); };
  $("#modesOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R) hostSet("modes", flip(R.modes, +b.dataset.v)); });
  for (const [id, key] of [["time", "time"], ["goal", "goal"], ["level", "level"]]) {
    $(`#${id}Online`).addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) hostSet(key, +b.dataset.v); });
  }
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; tabTouched = true; renderHome(); } });
  $("#modesLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { modesLocal = flip(modesLocal, +b.dataset.v); store.set(K.modes, modesLocal); renderHome(); } });
  $("#timeLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { timeLocal = +b.dataset.v; store.set(K.time, timeLocal); renderHome(); } });
  $("#goalLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { goalLocal = +b.dataset.v; store.set(K.goal, goalLocal); renderHome(); } });
  $("#levelLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { levelLocal = +b.dataset.v; store.set(K.level, levelLocal); renderHome(); } });

  $("#myName").value = store.get(K.me) || "";
  $("#myName").addEventListener("input", (e) => store.set(K.me, e.target.value));
  $("#joinCode").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ""); });
  const myName = () => {
    const n = $("#myName").value.trim();
    if (!n) { toast("Bitte gib zuerst deinen Namen ein."); $("#myName").focus(); }
    return n;
  };
  function join() {
    const n = myName(); if (!n) return;
    const code = $("#joinCode").value.trim();
    if (code.length !== 4) { toast("Der Raum-Code hat 4 Buchstaben."); $("#joinCode").focus(); return; }
    store.del(K.online);
    wsSend({ t: "join", code, name: n, avatar: myAvatar });
  }
  $("#joinBtn").addEventListener("click", join);
  $("#joinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  $("#createBtn").addEventListener("click", () => {
    const n = myName(); if (!n) return;
    store.del(K.online);
    wsSend({ t: "create", name: n, goal: goalLocal, modes: modesLocal, time: timeLocal, level: levelLocal, avatar: myAvatar });
  });

  function startLocal(state) {
    L = state; mode = "local"; peek = false; turnKey = null;
    store.set(K.local, L); render(); wake();
  }
  $("#startLocal").addEventListener("click", () => {
    const { names, bots } = HOME.roster($("#myName").value);
    const list = names.map((name, i) => ({ name, bot: bots[i], avatar: bots[i] ? G.BOT_AVATAR : myAvatar }));
    startLocal(G.newGame(list, goalLocal, modesLocal, timeLocal, levelLocal));
  });
  $("#resumeBtn").addEventListener("click", () => {
    const s = store.get(K.local); if (!s) return render();
    startLocal(s);
  });

  // ---------- game over ----------
  $("#reBtn").addEventListener("click", () => { peek = false; doAct({ t: "next" }); });
  $("#reLook").addEventListener("click", () => { peek = true; render(); });
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { stopLocal(); render(); }
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
  UI.detectServer("/activity-server", "activity").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
