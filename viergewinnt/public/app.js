// Vier gewinnt UI: one shared device and online rooms share one table renderer.
(() => {
  "use strict";
  const G = window.VierGame;
  // An old cached game.js next to a new app.js: reload once without cache instead of breaking.
  if (!G || !G.botMove || !G.AVATARS) {
    let tried = false;
    try { tried = sessionStorage.getItem("vier.reloaded") === "1"; sessionStorage.setItem("vier.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("vier.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const K = { local: "vier.v1", players: "vier.players", online: "vier.online", me: "vier.me", rules: "vier.rules", size: "vier.size", goal: "vier.goal", sound: "vier.sound", level: "vier.level", stats: "vier.stats",
    avatar: "vier.avatar", avatars: "vier.avatars", look: "vier.look" };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const BOT_MS = 900;

  // ---------- look: table design and board size (applied before anything is drawn) ----------
  const TABLES = [["night", "Nacht", "#1a1426"], ["felt", "Filz", "#15372a"], ["ocean", "Ozean", "#15243a"], ["light", "Hell", "#eceff5"], ["blossom", "Blüte", "#f7c6d9"]];
  const LOOK_SIZES = [["0.85", "Klein"], ["1", "Normal"], ["1.15", "Groß"]];
  let look = Object.assign({ table: "night", size: "1" }, store.get(K.look) || {});
  {
    // came here from the games.cool-kidz.net start page with a design already picked there
    const params = new URLSearchParams(location.search), qTable = params.get("table");
    if (qTable && TABLES.some((x) => x[0] === qTable)) {
      look.table = qTable; store.set(K.look, look);
      params.delete("table");
      history.replaceState(null, "", location.pathname + (params.toString() ? `?${params}` : ""));
    }
  }
  function applyLook() {
    const root = document.documentElement, t = TABLES.find((x) => x[0] === look.table) || TABLES[0];
    if (t[0] === "night") delete root.dataset.table; else root.dataset.table = t[0];
    root.style.setProperty("--cs", (LOOK_SIZES.find((x) => x[0] === look.size) || LOOK_SIZES[1])[0]);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", getComputedStyle(root).getPropertyValue("--bg").trim() || t[2]);
  }
  applyLook();

  // ---------- avatars ----------
  const randomAvatar = () => G.AVATARS[Math.floor(Math.random() * G.AVATARS.length)];
  let myAvatar = G.AVATARS.includes(store.get(K.avatar)) ? store.get(K.avatar) : randomAvatar();
  {
    // name and avatar picked on the games.cool-kidz.net start page (same hand-off as ?table=)
    const q = new URLSearchParams(location.search), qn = (q.get("name") || "").trim().slice(0, 18), qa = q.get("av");
    if (qa && G.AVATARS.includes(qa)) { myAvatar = qa; store.set(K.avatar, myAvatar); }
    if (qn) store.set(K.me, qn);
    if (q.has("name") || q.has("av")) {
      q.delete("name"); q.delete("av");
      history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : ""));
    }
  }
  store.set(K.avatar, myAvatar);
  let localAvatars = Array.isArray(store.get(K.avatars)) ? store.get(K.avatars) : [];
  const avatarFor = (i) => (G.AVATARS.includes(localAvatars[i]) ? localAvatars[i] : G.AVATARS[i % G.AVATARS.length]);
  const nextAvatar = (a) => G.AVATARS[(G.AVATARS.indexOf(a) + 1) % G.AVATARS.length];
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");

  const SIZES = [[7, "7×6", "klassisch"], [8, "8×7", "größer"], [10, "10×8", "riesig"]];
  const LEVELS = [[1, "Leicht"], [2, "Normal"], [3, "Profi"]];
  const GOALS = [[1, "Eine Runde"], [2, "Bis 2 Siege"], [3, "Bis 3 Siege"]];
  const ICON = {
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6" /></svg>'
  };

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let R = null;           // last online room message
  let watching = false; // in the waiting room, but watching the game that runs
  let V = null;           // view currently on screen
  let anim = null;        // { idx } disc that just fell, animated on the next board render
  let peek = false;       // round over, looking at the board
  let popMode = false;    // Pop Out: the next tap pulls a disc out at the bottom
  let keyCol = null;      // desktop: column chosen with the arrow keys
  let inflight = false;
  let server = null;      // server info once found ({} when only the WebSocket answered)
  let serverState = "checking"; // "checking" | "ok" | "none"
  const webHost = /^https?:$/.test(location.protocol);
  let tab = webHost ? "online" : "local", tabTouched = false;
  let players = store.get(K.players);
  if (!Array.isArray(players) || players.length !== 2) players = [{ name: "", bot: false }, { name: "", bot: true }];
  let sizeLocal = G.normSize(store.get(K.size) || 7), goalLocal = G.normGoal(store.get(K.goal) || 1);
  let localRules = G.normRules(store.get(K.rules));
  let levelLocal = G.normLevel(store.get(K.level) || 2);
  let lastTurn = null;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const humans = (st) => st.players.map((_, i) => i).filter((i) => !st.players[i].bot);
  // whose moves this screen makes: online your seat; on a shared device whoever is on (people only)
  const canPlay = () => !!V && V.phase === "play" && V.cur >= 0 && (mode === "local" ? !V.players[V.cur].bot : V.cur === V.me);
  const pname = (i) => (mode === "online" && i === V.me ? "Du" : V.players[i].name);
  const height = (c) => { let r = 0; while (r < V.rows && V.grid[c + r * V.cols] !== -1) r++; return r; };
  const ownBottom = (c) => V.grid[c] === V.cur;

  let toastT;
  function toast(msg) {
    if (!msg) return;
    const t = $("#toast"); t.textContent = msg; t.classList.remove("off");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("off"), 2800);
  }
  function flash(text, sub, cls) {
    const f = $("#flash"), s = $("#flashText");
    s.className = cls || "";
    s.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : "");
    f.hidden = false;
    s.style.animation = "none"; void s.offsetWidth; s.style.animation = "";
    clearTimeout(flash.t); flash.t = setTimeout(() => { f.hidden = true; }, 900);
  }
  function shakeBoard() {
    const b = $("#board"); b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake");
  }
  let soundOn = store.get(K.sound) !== false;
  const buzz = (ms) => { if (!soundOn) return; try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

  // tiny synthesized sound effects, no files needed; iOS unlocks audio on the first touch
  let actx = null, noiseBuf = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (actx.state === "suspended") actx.resume().catch(() => {});
    return actx;
  }
  document.addEventListener("pointerdown", () => { if (soundOn) audio(); }, { once: true, capture: true });
  function tone(freq, start, dur, type = "sine", vol = 0.18, to) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + start, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(start, dur, vol, freq) {
    const a = audio(); if (!a) return;
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = a.currentTime + start, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noiseBuf; f.type = "lowpass"; f.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(a.destination); s.start(t); s.stop(t + dur + 0.02);
  }
  const SFX = {
    drop: (fall) => { const d = 0.18 + fall * 0.045; noise(d, 0.12, 0.35, 1800); tone(220, d, 0.08, "triangle", 0.12, 140); },
    pop: () => tone(740, 0, 0.06, "sine", 0.12),
    pull: () => { tone(300, 0, 0.18, "triangle", 0.1, 600); noise(0.1, 0.25, 0.2, 900); },
    turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
    bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16)),
    draw: () => { tone(440, 0, 0.2, "triangle", 0.1); tone(440, 0.22, 0.3, "triangle", 0.08); },
    tick: () => tone(1200, 0, 0.05, "square", 0.06)
  };
  const sfx = (k, x) => { if (soundOn && document.visibilityState === "visible") try { SFX[k](x); } catch (e) {} };

  // ---------- events → feedback ----------
  function handleEvents(events, v) {
    if (!v) return;
    for (const ev of events || []) {
      if (ev.t === "drop") { const fall = v.rows - ev.row; anim = { idx: ev.col + ev.row * v.cols, fall }; sfx("drop", fall); }
      if (ev.t === "pop") sfx("pull");
      if (ev.t === "timeout") { toast(mode === "online" && ev.pi === v.me ? "Zu langsam! Das Spiel hat für dich eingeworfen." : `${v.players[ev.pi].name} war zu langsam, Zufallszug!`); sfx("bad"); }
      if (ev.t === "giveup") toast(mode === "online" && ev.pi === v.me ? "Du hast aufgegeben." : `${v.players[ev.pi].name} gibt auf.`);
      if (ev.t === "end") {
        const w = ev.winners[0];
        setTimeout(() => {
          if (w == null) { flash("Unentschieden!", "Das Brett ist voll.", "blue"); sfx("draw"); }
          else flash(`${v.need} in einer Reihe!`, mode === "online" && w === v.me ? "Du gewinnst" : `${v.players[w].name} gewinnt`, w ? "blue" : "");
        }, 420);
      }
    }
  }

  // ---------- actions ----------
  function doAct(a, actor) {
    if (mode === "local") {
      const res = G.act(L, actor == null ? L.cur : actor, a);
      if (!res.ok) { toast(res.error); sfx("bad"); shakeBoard(); return false; }
      popMode = false;
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

  function playCol(c) {
    if (!V || V.phase !== "play") return;
    if (!canPlay()) {
      toast(mode === "online" && V.me < 0 ? "Du schaust zu." : `Warte, ${V.players[V.cur].name} ist dran.`);
      return;
    }
    if (inflight) return;
    if (popMode) {
      if (!ownBottom(c)) { toast("Unten in dieser Spalte liegt keine eigene Scheibe."); shakeBoard(); sfx("bad"); return; }
    } else if (height(c) >= V.rows) { toast("Diese Spalte ist voll."); shakeBoard(); sfx("bad"); return; }
    const a = { t: popMode ? "pop" : "drop", col: c };
    if (mode === "online") { inflight = true; setTimeout(() => { inflight = false; }, 3000); popMode = false; }
    buzz(10);
    doAct(a);
  }

  // computer player in the shared-device mode (online the server moves it)
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
    const on = V.phase === "play" && V.clockMs > 0 && V.clock > 0 && !V.players[V.cur].bot;
    $("#clock").hidden = !on;
    clearInterval(renderClock.t);
    if (!on) return;
    clockEnd = Date.now() + V.clock;
    const bar = $("#clockBar"), total = V.clockMs;
    const step = () => {
      const left = Math.max(0, clockEnd - Date.now());
      bar.style.width = (left / total) * 100 + "%";
      $("#clock").classList.toggle("urgent", left < 3000);
      $("#clockSec").textContent = Math.ceil(left / 1000) + " s";
      const s = Math.ceil(left / 1000);
      if (canPlay() && left > 0 && s <= 3 && clockBeep !== `${V.turn}:${s}:${clockEnd}`) { clockBeep = `${V.turn}:${s}:${clockEnd}`; sfx("tick"); if (s === 1) buzz(30); }
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
  // shared device: with one person against the computer that person is "me", with two people nobody is
  const localMe = () => { const hs = humans(L); return hs.length === 1 ? hs[0] : -1; };

  function render() {
    if (mode === "local" && L) {
      V = G.view(L, localMe());
      showScreen("game");
      renderGame();
      scheduleClock();
    } else if (mode === "online" && R) {
      const meM = R.members[R.you], waiting = !!(R.view && meM && meM.lobby);
      if (!waiting) watching = false;
      if (!R.view || (waiting && !watching)) { V = null; showScreen("lobby"); renderLobby(); renderReady(); $("#roundEnd").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else {
      V = null;
      $("#roundEnd").hidden = true;
      showScreen("home"); renderHome();
    }
    updateNet();
  }

  // v: { cols, rows, grid }; o: { buttons, ghost, last, win, anim, disabled }
  function boardHTML(v, o) {
    let h = "";
    for (let c = 0; c < v.cols; c++) {
      let cells = "", top = 0;
      while (top < v.rows && v.grid[c + top * v.cols] !== -1) top++;
      for (let r = 0; r < v.rows; r++) {
        const idx = c + r * v.cols, x = v.grid[idx];
        let disc = "";
        if (x >= 0) {
          const cls = ["disc", "p" + x];
          if (o.last === idx) cls.push("last");
          if (o.win && o.win.includes(idx)) cls.push("win");
          let style = "";
          if (o.anim && o.anim.idx === idx) { cls.push("fall"); style = ` style="--fall:${o.anim.fall}"`; }
          disc = `<span class="${cls.join(" ")}"${style}></span>`;
        } else if (o.ghost != null && o.ghost.col === c && r === top) disc = `<span class="disc ghost p${o.ghost.p}"></span>`;
        cells += `<span class="hole">${disc}</span>`;
      }
      const off = o.disabled && o.disabled(c, top);
      h += o.buttons ? `<button type="button" class="col" data-col="${c}" aria-label="Spalte ${c + 1}"${off ? " disabled" : ""}>${cells}</button>` : `<span class="col">${cells}</span>`;
    }
    return h;
  }

  // the board fills the room the arena has left; the size setting (--cs) scales it
  const desktop = matchMedia("(min-width:900px) and (min-height:700px)");
  function layoutBoard() {
    const arena = $("#arena"), b = $("#board");
    if (!V || !arena.offsetParent) return;
    const st = getComputedStyle(arena);
    const W = arena.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
    const H = arena.clientHeight - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom) - $("#lastMove").offsetHeight - 10 - 8;
    const wf = V.cols + 0.14 * (V.cols - 1) + 0.392, hf = V.rows + 0.14 * (V.rows - 1) + 0.392;
    const cs = parseFloat((LOOK_SIZES.find((x) => x[0] === look.size) || LOOK_SIZES[1])[0]);
    const fit = Math.min(W / wf, H / hf, desktop.matches ? 86 : 64);
    const maxW = cs > 1 ? (arena.clientWidth - 8) / wf : W / wf; // big boards may use the side margins
    const cell = Math.max(18, Math.floor(Math.min(maxW, fit * cs)));
    b.style.setProperty("--cell", cell + "px");
  }
  desktop.addEventListener && desktop.addEventListener("change", () => { if (V) render(); });
  window.addEventListener("resize", () => { if (V) layoutBoard(); });
  if (window.ResizeObserver) new ResizeObserver(() => layoutBoard()).observe($("#arena"));

  function plateHTML(i) {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = members && members[i] && !members[i].online;
    const cls = ["plate", V.phase === "play" && V.cur === i ? "active" : "", away ? "away" : ""].join(" ");
    const tag = p.bot ? "Computer" : away ? "offline" : mode === "online" && i === V.me ? "du" : "";
    return `<div class="${cls}" data-seat="${i}"><span class="pav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="pinfo"><span class="pname">${esc(p.name)}</span><span class="pmeta"><i class="chip p${i}"></i><span>${G.COLORS[i]}${tag ? ` · ${tag}` : ""}</span></span></span>` +
      `<span class="pwins" title="Siege">${p.wins}</span></div>`;
  }

  function renderGame() {
    if (V.phase !== "roundEnd") peek = false;
    if (!canPlay()) { popMode = false; keyCol = null; }
    $("#plates").innerHTML = plateHTML(0) + plateHTML(1);
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> · ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}` + (V.draws ? ` · ${V.draws}× unentschieden` : "");

    // board
    const board = $("#board"), play = canPlay(), lm = V.lastMove;
    board.innerHTML = boardHTML(V, {
      buttons: true, anim, win: V.last && V.last.cells, last: lm && V.phase === "play" && !lm.pop ? lm.col + lm.row * V.cols : null,
      ghost: play && keyCol != null && !popMode ? { col: keyCol, p: V.cur } : null,
      disabled: (c, top) => !play || (popMode ? V.grid[c] !== V.cur : top >= V.rows)
    });
    anim = null;
    board.classList.toggle("play", play);
    board.classList.toggle("popmode", play && popMode);
    layoutBoard();

    // log
    const lmEl = $("#lastMove"), lines = V.log.slice(-2), lmKey = lines.join("\n");
    if (lmEl.dataset.k !== lmKey) {
      lmEl.dataset.k = lmKey;
      lmEl.innerHTML = lines.map((l, i) => `<div${i < lines.length - 1 ? ' class="old"' : ""}>${esc(l)}</div>`).join("");
      lmEl.classList.remove("fresh"); void lmEl.offsetWidth; lmEl.classList.add("fresh");
    }

    // dock
    let who = "", hint = "", av = "";
    if (V.phase === "roundEnd") {
      const w = V.last.winners[0];
      who = w == null ? "Unentschieden" : `${pname(w)} ${mode === "online" && w === V.me ? "gewinnst" : "gewinnt"}`;
      av = w == null ? "🤝" : V.players[w].avatar;
      hint = "Runde vorbei.";
    } else {
      const P = V.players[V.cur];
      av = P.avatar;
      if (play) {
        who = mode === "local" && humans(V).length === 2 ? `${P.name}, du bist dran` : "Du bist dran";
        hint = popMode ? "Tippe auf eine Spalte mit deiner Scheibe ganz unten." : `Tippe auf eine Spalte, um eine ${G.COLORS[V.cur].toLowerCase()}e Scheibe einzuwerfen.`;
      } else {
        who = `${P.name} ist dran`;
        hint = P.bot ? "Der Computer überlegt …" : mode === "online" && V.me < 0 ? "Du schaust zu." : "Warte auf den nächsten Zug.";
      }
    }
    $("#whoAv").textContent = av;
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    $("#dock").classList.toggle("myturn", play);
    const canPop = play && V.rules.popout && V.grid.slice(0, V.cols).some((x) => x === V.cur);
    $("#popBtn").hidden = !canPop;
    $("#popBtn").setAttribute("aria-pressed", String(popMode));
    $("#popBtn").textContent = popMode ? "Doch lieber einwerfen" : "Unten herausziehen";
    $("#resultBtn").hidden = !(V.phase === "roundEnd" && peek);
    $("#reactBtn").hidden = mode !== "online";
    $("#keys").innerHTML = play ? `<kbd>1</kbd>–<kbd>${Math.min(9, V.cols)}</kbd> einwerfen · <kbd>←</kbd><kbd>→</kbd> + <kbd>Enter</kbd>${V.rules.popout ? " · <kbd>P</kbd> Pop Out" : ""}` : "";
    renderClock();

    // turn change feedback
    const key = `${V.round}:${V.turn}:${V.cur}`;
    if (play && lastTurn !== key && lastTurn !== null && (mode === "online" || V.players.some((p) => p.bot))) { buzz([40, 60, 40]); sfx("turn"); }
    lastTurn = key;

    $("#roundEnd").hidden = V.phase !== "roundEnd" || peek;
    if (V.phase === "roundEnd") {
      if (!peek) renderRoundEnd();
      const k = `${V.round}:${V.last.winners.join(",")}:${V.players.map((p) => p.wins).join(",")}:${V.draws}`;
      if (confettiFor !== k) {
        confettiFor = k; record(k);
        if (V.last.winners.length) setTimeout(() => { confetti(); sfx("win"); }, 700);
      }
    }
  }

  $("#board").addEventListener("click", (e) => { const b = e.target.closest("[data-col]"); if (b && !b.disabled) playCol(+b.dataset.col); });
  // desktop: a see-through disc shows where it would land
  function hoverGhost(c) {
    for (const g of $("#board").querySelectorAll(".disc.ghost")) g.remove();
    if (c == null || !canPlay() || popMode) return;
    const top = height(c);
    if (top >= V.rows) return;
    const hole = $(`#board [data-col="${c}"]`).children[top];
    if (hole) hole.insertAdjacentHTML("beforeend", `<span class="disc ghost p${V.cur}"></span>`);
  }
  $("#board").addEventListener("mouseover", (e) => { const b = e.target.closest("[data-col]"); hoverGhost(b ? +b.dataset.col : null); });
  $("#board").addEventListener("mouseleave", () => hoverGhost(null));
  $("#popBtn").addEventListener("click", () => { popMode = !popMode; renderGame(); });
  $("#resultBtn").addEventListener("click", () => { peek = false; render(); });

  // keys: 1-9 (0 for column 10) drop, arrows + Enter, P for Pop Out, Esc closes
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") {
      if (open) $(open).hidden = true;
      else if (popMode || keyCol != null) { popMode = false; keyCol = null; if (V) renderGame(); }
      return;
    }
    if (open || $("#game").hidden || !$("#roundEnd").hidden || !canPlay()) return;
    const k = e.key.toLowerCase();
    if (/^[0-9]$/.test(k)) { const c = k === "0" ? 9 : +k - 1; if (c < V.cols) { e.preventDefault(); playCol(c); } return; }
    if (k === "arrowleft" || k === "arrowright") {
      e.preventDefault();
      keyCol = keyCol == null ? Math.floor(V.cols / 2) : Math.max(0, Math.min(V.cols - 1, keyCol + (k === "arrowleft" ? -1 : 1)));
      renderGame();
    } else if ((k === "enter" || k === " ") && keyCol != null) { e.preventDefault(); playCol(keyCol); }
    else if (k === "p" && V.rules.popout) { popMode = !popMode; renderGame(); }
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

  // ---------- confetti ----------
  let confettiFor = null;
  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cv = $("#confetti"), ctx = cv.getContext("2d"), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; cv.hidden = false;
    const cols = ["#e0393e", "#f2c230", "#2fa35b", "#2d6fd6", "#ffffff"];
    const ps = Array.from({ length: 140 }, () => ({
      x: Math.random() * cv.width, y: -Math.random() * cv.height * 0.5, w: (6 + Math.random() * 6) * dpr, h: (10 + Math.random() * 8) * dpr,
      vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: cols[(Math.random() * 5) | 0]
    }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05 * dpr; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      }
      if (t - t0 < 3200) requestAnimationFrame(frame); else { ctx.clearRect(0, 0, cv.width, cv.height); cv.hidden = true; }
    })(t0);
  }

  // ---------- reactions (online) ----------
  // reactions float above everything (fixed), so the top edge of the screen or a scrolling
  // player strip can't clip them; near the top they show up below the player instead
  function showBubble(host, b) {
    const r = host.getBoundingClientRect(), down = r.top < 110;
    b.style.top = (down ? r.bottom + 6 : r.top - 6) + "px";
    if (down) b.classList.add("down");
    document.body.appendChild(b);
    const w = b.offsetWidth / 2 + 8;
    b.style.left = Math.min(innerWidth - w, Math.max(w, r.left + r.width / 2)) + "px";
  }
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
    el.innerHTML = V.players.map((p, i) => {
      const you = i === V.me && mode === "online" ? " (du)" : "";
      return `<li class="${winners.includes(i) ? "win" : ""}"><span>${avi(p.avatar)}${esc(p.name)}${you}<small>${G.COLORS[i]}</small></span>` +
        `<b>${p.wins} ${p.wins === 1 ? "Sieg" : "Siege"}</b></li>`;
    }).join("") + (V.draws ? `<li><span>Unentschieden</span><b>${V.draws}</b></li>` : "");
  }

  function renderRoundEnd() {
    const last = V.last, w = last.winners[0];
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round} vorbei`;
    $("#reTitle").textContent = w == null ? "Unentschieden!" :
      `${mode === "online" && w === V.me ? "Du gewinnst" : `${V.players[w].name} gewinnt`} ${last.over ? "das Spiel" : "die Runde"}!`;
    $("#reText").textContent = (w == null ? "Das Brett ist voll, keiner hat eine Reihe." : `${V.need} in einer Reihe nach ${last.moves} Zügen.`) +
      (last.over ? "" : ` Gespielt wird bis ${V.goal} Siege, als Nächstes beginnt ${V.players[V.nextStarter].name}.`);
    scoreList($("#reScores"), last.winners);
    $("#reBtn").textContent = last.over ? "Revanche" : "Nächste Runde";
    if (mode === "online" && R && last.over) { // a rematch needs everyone still at the table
      const n = V.players.length, votes = R.rematch || [];
      const table = R.members.map((m, i) => i).filter((i) => i < n && !R.members[i].lobby && !R.members[i].bot && R.members[i].online);
      const yes = table.filter((i) => votes.includes(i)).length;
      $("#reBtn").textContent = votes.includes(R.you)
        ? (yes === table.length ? "Zu wenige für eine Revanche, warte auf Mitspieler" : `Warte auf die anderen (${yes}/${table.length})`)
        : `Revanche (${yes}/${table.length} bereit)`;
      $("#reBtn").hidden = V.me < 0;
      $("#reVotes").innerHTML = rematchStatus(n, votes);
    }
    $("#reVotes").hidden = !(mode === "online" && R && last.over);
    $("#reBtn").hidden = mode === "online" && V.me < 0;
    const back = $("#reBack");
    if (mode === "local") { back.hidden = false; back.textContent = "Zur Spieler-Auswahl"; }
    else { back.hidden = R.host !== V.me; back.textContent = "Zurück in den Warteraum"; }
    if (mode === "online" && last.over) back.hidden = !R.members[R.you]; // after a game everyone decides for themselves
  }

  // Bilanz: results per name on this device (people only, online just yourself)
  function record(key) {
    const st = store.get(K.stats) || {};
    if (st._last === key) return;
    st._last = key;
    const who = mode === "online" ? (V.me >= 0 ? [V.me] : []) : V.players.map((p, i) => (p.bot ? -1 : i)).filter((i) => i >= 0);
    for (const i of who) {
      const p = V.players[i], s = st[p.name] || (st[p.name] = { rounds: 0, wins: 0, draws: 0 });
      s.rounds++;
      if (V.last.winners.includes(i)) s.wins++;
      if (!V.last.winners.length) s.draws++;
    }
    store.set(K.stats, st);
  }
  function renderStats() {
    const st = store.get(K.stats) || {};
    const rows = Object.keys(st).filter((k) => k !== "_last").map((name) => ({ name, ...st[name] }))
      .sort((a, b) => b.wins - a.wins || b.rounds - a.rounds).slice(0, 8);
    $("#statsPanel").hidden = !rows.length;
    $("#statsList").innerHTML = rows.map((r) =>
      `<li><span>${esc(r.name)}<small>${r.rounds ? Math.round((r.wins / r.rounds) * 100) : 0} % gewonnen${r.draws ? ` · ${r.draws}× unentschieden` : ""}</small></span><b>${r.wins} von ${r.rounds}</b></li>`).join("");
  }

  function segHTML(list, cur) {
    return list.map(([v, a, b]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${a}${b ? `<small>${b}</small>` : ""}</button>`).join("");
  }

  function renderHome(force) {
    renderLocalRules();
    renderLook();
    $("#myAvatar").textContent = myAvatar;
    renderStats();
    for (const b of document.querySelectorAll("#modeTabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
    // never hide the online form on a web address: a failed check (ad blocker, slow
    // network) must not lock people out; connecting will tell if there really is no server
    $("#onlinePanel").hidden = tab !== "online" || !webHost;
    $("#onlineOff").hidden = tab !== "online" || webHost;
    const sh = $("#serverHint");
    sh.hidden = serverState === "ok";
    sh.textContent = serverState === "checking" ? "Suche den Spiel-Server …"
      : "Unter dieser Adresse antwortet kein Spiel-Server. Du kannst es trotzdem versuchen, „Ein Gerät für beide“ geht immer.";
    $("#localPanel").hidden = tab !== "local";
    $("#sizeLocal").innerHTML = segHTML(SIZES, sizeLocal);
    $("#goalLocal").innerHTML = segHTML(GOALS, goalLocal);
    $("#levelLocal").innerHTML = segHTML(LEVELS, levelLocal);

    const saved = store.get(K.local);
    $("#resumePanel").hidden = !(saved && saved.players);
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => p.name).join(" gegen ")} · Runde ${saved.round}`;
    const list = $("#plist");
    if (force || !list.contains(document.activeElement)) {
      list.innerHTML = players.map((p, i) =>
        `<div class="prow"><button class="avbtn" type="button" data-av="${i}" aria-label="Avatar für ${G.COLORS[i]} wechseln"${p.bot ? " disabled" : ""}>${p.bot ? G.BOT_AVATAR : avatarFor(i)}</button>` +
        `<input class="field" id="pname-${i}" data-i="${i}" maxlength="18" autocomplete="off" enterkeyhint="next" placeholder="${p.bot ? G.BOT_NAMES[i] : `Spieler ${i + 1}`} (${G.COLORS[i]})" value="${esc(p.name)}">` +
        `<button class="kind" type="button" data-kind="${i}" aria-pressed="${p.bot}">${p.bot ? ICON.bot + "Computer" : ICON.person + "Mensch"}</button></div>`).join("");
    }
  }

  function joinUrl() {
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    const base = local && server && server.ips && server.ips.length && !/^172\.(1[6-9]|2\d|3[01])\./.test(server.ips[0])
      ? `${location.protocol}//${server.ips[0]}:${location.port || server.port}/`
      : location.origin + location.pathname;
    return `${base}?r=${R.code}`;
  }

  let qrFor = null;
  function renderLobby() {
    $("#roomCode").textContent = R.code;
    const url = joinUrl();
    $("#joinUrl").textContent = url;
    if (qrFor !== url) { qrFor = url; drawQr(url); }
    const lan = /^http:\/\/(\d+\.){3}\d+[:/]/.test(url);
    $("#joinHint").textContent = "Dein Gegner scannt den QR-Code oder öffnet den Link und gibt den Code ein. Weitere Leute können zuschauen." + (lan ? " Alle müssen im selben WLAN sein." : "");
    const host = R.you === R.host;
    $("#closeLobby").hidden = !host;
    const watching = R.you < 0, seen = R.watchers || [];
    $("#membersLabel").textContent = `Spieler (${R.members.length}/${G.MAX_PLAYERS})` + (seen.length ? ` · ${seen.length} ${seen.length === 1 ? "schaut" : "schauen"} zu` : "");
    $("#sitBtn").hidden = !watching || R.members.length >= G.MAX_PLAYERS;
    $("#members").innerHTML = R.members.map((m, i) =>
      `<li class="${i === R.you ? "me" : ""}">${m.bot ? `<span class="botico">${ICON.bot}</span>` : `<span class="on${m.online ? "" : " off"}"></span>`}` +
      (i === R.you ? `<button class="av" type="button" data-myav aria-label="Avatar wechseln">${m.avatar}</button>` : `<span class="av" aria-hidden="true">${m.avatar || ""}</span>`) +
      `<span class="nm">${esc(m.name)}</span><i class="dot p${i}" title="${G.COLORS[i]}"></i>` +
      `${i === R.host ? '<span class="tag">Host</span>' : ""}${i === R.you ? '<span class="tag">du</span>' : ""}${m.bot ? '<span class="tag">Computer</span>' : ""}` +
      `${m.bot && host ? `<button class="rm" type="button" data-unbot="${i}" aria-label="${esc(m.name)} entfernen">×</button>` : ""}</li>`).join("");
    $("#addBot").hidden = !host || R.members.length >= G.MAX_PLAYERS;
    $("#startOnline").hidden = !host;
    $("#startOnline").disabled = R.members.length < 2;
    $("#startOnline").textContent = R.members.length < 2 ? "Warte auf Gegner …" : "Spiel starten";
    for (const [id, list, cur] of [["#sizeOnline", SIZES, R.size], ["#goalOnline", GOALS, R.goal], ["#levelOnline", LEVELS, R.level || 2]]) {
      const el = $(id), k = cur + ":" + host;
      if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = segHTML(list, cur); for (const b of el.children) b.disabled = !host; }
    }
    const rl = $("#rulesLobby"), key = JSON.stringify(R.rules) + host;
    if (rl.dataset.k !== key) { rl.dataset.k = key; rl.innerHTML = rulesHTML(R.rules || {}, host, "o"); }
    const onR = activeNames(R.rules);
    $("#rulesLobbySum").textContent = onR.length ? onR.join(", ") : "keine";
    $("#rulesLobbyHint").textContent = host ? "Tippe an, was gelten soll. Alle sehen deine Auswahl." : `${R.members[R.host].name} legt die Regeln fest.`;
    $("#lobbyHint").textContent = watching
      ? (R.members.length >= G.MAX_PLAYERS ? "Du schaust zu. Wird ein Platz frei, kannst du mitspielen." : "Du schaust zu. Tippe auf „Mitspielen“, um den freien Platz zu nehmen.")
      : host
      ? (R.members.length < 2 ? "Warte auf deinen Gegner, oder hol dir einen Computer-Gegner dazu." : "Alles bereit.")
      : `Warte, bis ${R.members[R.host].name} das Spiel startet.`;
  }
  $("#members").addEventListener("click", (e) => { const b = e.target.closest("[data-unbot]"); if (b) wsSend({ t: "unbot", i: +b.dataset.unbot }); });
  $("#addBot").addEventListener("click", () => wsSend({ t: "bot" }));
  $("#sitBtn").addEventListener("click", () => wsSend({ t: "sit" }));
  $("#members").addEventListener("click", (e) => {
    if (!e.target.closest("[data-myav]")) return;
    myAvatar = nextAvatar(myAvatar); store.set(K.avatar, myAvatar);
    wsSend({ t: "avatar", avatar: myAvatar });
  });

  // avatar picker in the online form
  $("#myAvatar").addEventListener("click", () => {
    const g = $("#avatarGrid");
    g.innerHTML = G.AVATARS.map((a) => `<button type="button" data-pick="${a}" aria-pressed="${a === myAvatar}">${a}</button>`).join("");
    g.hidden = !g.hidden;
  });
  $("#avatarGrid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]"); if (!b) return;
    myAvatar = b.dataset.pick; store.set(K.avatar, myAvatar);
    $("#avatarGrid").hidden = true; $("#myAvatar").textContent = myAvatar;
  });

  // look settings on the start screen and in the menu
  function renderLook() {
    const html = `<div class="label">Tisch</div><div class="seg tables">${TABLES.map(([k, n, c]) =>
      `<button type="button" data-table="${k}" aria-pressed="${look.table === k}"><span class="swatch" style="background:${c}"></span>${n}</button>`).join("")}</div>` +
      `<div class="label">Größe</div><div class="seg three">${LOOK_SIZES.map(([k, n]) =>
      `<button type="button" data-size="${k}" aria-pressed="${look.size === k}">${n}</button>`).join("")}</div>`;
    for (const id of ["#lookHome", "#lookMenu"]) if ($(id).innerHTML !== html) $(id).innerHTML = html;
    $("#lookSum").textContent = `${(TABLES.find((x) => x[0] === look.table) || TABLES[0])[1]} · ${(LOOK_SIZES.find((x) => x[0] === look.size) || LOOK_SIZES[1])[1]}`;
  }
  for (const id of ["#lookHome", "#lookMenu"]) $(id).addEventListener("click", (e) => {
    const t = e.target.closest("[data-table]"), z = e.target.closest("[data-size]");
    if (!t && !z) return;
    if (t) look.table = t.dataset.table;
    if (z) look.size = z.dataset.size;
    store.set(K.look, look); applyLook(); renderLook();
    if (V && !$("#game").hidden) layoutBoard();
  });
  $("#statsReset").addEventListener("click", (e) => { // second tap within 3 s deletes
    const b = e.currentTarget;
    if (b.dataset.armed) { store.del(K.stats); delete b.dataset.armed; b.textContent = "Bilanz löschen"; b.classList.remove("btn-danger"); renderStats(); return; }
    b.dataset.armed = "1"; b.textContent = "Sicher? Nochmal tippen"; b.classList.add("btn-danger");
    setTimeout(() => { delete b.dataset.armed; b.textContent = "Bilanz löschen"; b.classList.remove("btn-danger"); }, 3000);
  });
  $("#sizeOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", size: +b.dataset.v }); });
  $("#goalOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", goal: +b.dataset.v }); });
  $("#levelOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", level: +b.dataset.v }); });

  function drawQr(url) {
    const box = $("#qr");
    const paint = () => {
      try {
        const q = window.qrcode(0, "M"); q.addData(url); q.make();
        box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
        box.hidden = false;
      } catch (e) { box.hidden = true; }
    };
    if (window.qrcode) return paint();
    const s = document.createElement("script");
    s.src = "vendor/qrcode.js"; s.onload = paint; s.onerror = () => { box.hidden = true; };
    document.head.appendChild(s);
  }

  // connection pill: only after a short grace period, phones drop sockets all the time
  let netT = null;
  function updateNet() {
    const down = mode === "online" && wantOnline && !(ws && ws.readyState === 1);
    if (!down) { clearTimeout(netT); netT = null; $("#net").hidden = true; return; }
    if (!netT && $("#net").hidden) netT = setTimeout(() => { netT = null; if (mode === "online" && !(ws && ws.readyState === 1)) $("#net").hidden = false; }, 2000);
  }

  // ---------- online connection ----------
  let ws = null, wantOnline = false, retry = 0, queue = [];
  function connect() {
    if (ws && ws.readyState <= 1) return;
    // each socket only ever touches itself: a late close of an old socket must not
    // wipe out the new one
    const sock = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) { sock.close(); return; }
      retry = 0; clearTimeout(giveUpT);
      if (serverState !== "ok") { serverState = "ok"; server = server || {}; }
      const s = store.get(K.online);
      if (s && !queue.some((m) => m.t === "create" || m.t === "join"))
        sock.send(JSON.stringify(s.watch ? { t: "join", code: s.code, name: s.watch } : { t: "resume", code: s.code, secret: s.secret }));
      for (const m of queue.splice(0)) sock.send(JSON.stringify(m));
      render();
    };
    sock.onmessage = (e) => { if (ws !== sock) return; try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      if (wantOnline) setTimeout(connect, Math.min(8000, 400 * 2 ** retry++));
      render();
    };
  }
  let giveUpT = null;
  function wsSend(m) {
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; }
    if (m.t === "create" || m.t === "join") {
      queue.push(m); wantOnline = true; retry = 0; connect();
      clearTimeout(giveUpT);
      giveUpT = setTimeout(() => {
        if (ws && ws.readyState === 1) return;
        queue = []; wantOnline = false;
        if (ws) ws.close();
        toast("Der Spiel-Server antwortet nicht. Prüf die Adresse oder die Internetverbindung.");
        render();
      }, 8000);
      return true;
    }
    return false;
  }
  function onMsg(m) {
    if (m.t === "watching") {
      store.set(K.online, { code: m.code, watch: m.name });
      wantOnline = true; mode = "online";
      if (location.search) history.replaceState(null, "", location.pathname);
      toast("Das Spiel läuft schon oder der Raum ist voll: Du schaust zu.");
    } else if (m.t === "joined") {
      store.set(K.online, { code: m.code, secret: m.secret });
      wantOnline = true;
      mode = "online";
      if (location.search) history.replaceState(null, "", location.pathname);
      wake();
    } else if (m.t === "room") {
      R = m; mode = "online"; inflight = false;
      if (m.view) handleEvents(m.events, m.view);
      render();
    } else if (m.t === "react") {
      bubble(m.pi, m.e, m.name);
    } else if (m.t === "error") {
      inflight = false;
      toast(m.msg);
    } else if (m.t === "gone" || m.t === "left") {
      // keep the socket: a join or create sent a moment ago is answered on it
      store.del(K.online); R = null; mode = null;
      if (m.t === "gone") toast(m.reason === "idle" ? "Raum wegen Inaktivität geschlossen." : m.reason === "closed" ? "Der Raum wurde geschlossen." : "Diesen Raum gibt es nicht mehr.");
      render();
    }
  }

  // ---------- events ----------
  // a small board on the start screen, red is about to win
  (() => {
    const cols = 7, rows = 6, grid = new Array(cols * rows).fill(-1);
    [[3, 0, 0], [3, 1, 1], [4, 0, 1], [2, 0, 0], [4, 1, 0], [4, 2, 1], [5, 0, 1], [5, 1, 0], [5, 2, 1], [5, 3, 0], [1, 0, 0], [2, 1, 1]].forEach(([c, r, p]) => { grid[c + r * cols] = p; });
    $("#heroBoard").innerHTML = boardHTML({ cols, rows, grid }, {});
    $("#heroBoard").style.setProperty("--cell", "30px");
  })();
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; tabTouched = true; renderHome(); } });
  $("#sizeLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { sizeLocal = +b.dataset.v; store.set(K.size, sizeLocal); renderHome(); } });
  $("#goalLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { goalLocal = +b.dataset.v; store.set(K.goal, goalLocal); renderHome(); } });
  $("#levelLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { levelLocal = +b.dataset.v; store.set(K.level, levelLocal); renderHome(); } });

  $("#myName").value = store.get(K.me) || "";
  $("#soundOn").checked = soundOn;
  $("#soundOn").addEventListener("change", (e) => { soundOn = e.target.checked; store.set(K.sound, soundOn); if (soundOn) { audio(); sfx("pop"); } });
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
    wsSend({ t: "create", name: n, goal: goalLocal, size: sizeLocal, rules: localRules, level: levelLocal, avatar: myAvatar });
  });

  $("#plist").addEventListener("input", (e) => { if (e.target.dataset.i != null) { players[+e.target.dataset.i].name = e.target.value; store.set(K.players, players); } });
  $("#plist").addEventListener("click", (e) => {
    const kind = e.target.closest("[data-kind]"), av = e.target.closest("[data-av]");
    if (av) {
      const i = +av.dataset.av; if (players[i].bot) return;
      localAvatars[i] = nextAvatar(avatarFor(i)); store.set(K.avatars, localAvatars); renderHome(true); return;
    }
    if (!kind) return;
    players[+kind.dataset.kind].bot = !players[+kind.dataset.kind].bot;
    store.set(K.players, players); renderHome(true);
  });
  $("#plist").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const nx = document.getElementById(`pname-${+e.target.dataset.i + 1}`);
    if (nx) nx.focus(); else e.target.blur();
  });
  function startLocal(state) {
    L = state; mode = "local"; peek = false; popMode = false; keyCol = null;
    if (L.phase === "play") G.resetClock(L);
    store.set(K.local, L); render(); wake(); scheduleBot();
  }
  $("#startLocal").addEventListener("click", () => {
    if (!players.some((p) => !p.bot)) { toast("Mindestens ein Mensch muss mitspielen."); return; }
    const list = players.map((p, i) => ({ name: p.name.trim() || (p.bot ? G.BOT_NAMES[i] : `Spieler ${i + 1}`), bot: p.bot, avatar: avatarFor(i) }));
    startLocal(G.newGame(list, goalLocal, sizeLocal, localRules, levelLocal));
  });
  $("#resumeBtn").addEventListener("click", () => {
    const s = store.get(K.local); if (!s) return render();
    startLocal(s);
  });

  $("#startOnline").addEventListener("click", () => wsSend({ t: "start" }));
  // rules to read in the waiting room: the same text as in the game menu, copied once
  {
    const src = [...document.querySelectorAll("#menu summary")].find((s) => /Spielregeln/.test(s.textContent));
    if (src) $("#rulesHelpLobby").innerHTML = [...src.parentElement.children].filter((e) => e !== src).map((e) => e.outerHTML).join("");
  }
  // back to the Spieleabend start page: games.cool-kidz.net behind the tunnel, port 8090 of the same box in the LAN
  if (/^https?:$/.test(location.protocol) && !/(^|\.)cool-kidz\.net$/.test(location.hostname))
    for (const a of document.querySelectorAll("[data-start-link]")) a.href = `${location.protocol}//${location.hostname}:8090/`;
  // ---------- waiting room: ready up, or watch the game that runs ----------
  function renderReady() {
    const me = R.members[R.you], host = R.you === R.host, run = R.view;
    const over = !!(run && run.phase === "roundEnd" && run.last && run.last.over);
    const n = run ? run.players.length : 0, playing = (i) => !!run && i < n && !R.members[i].lobby;
    const btn = $("#readyBtn"), start = $("#startOnline"), box = $("#nowPlaying");
    btn.hidden = !me || me.bot;
    if (run && !over) { btn.dataset.act = "watch"; btn.textContent = "Zuschauen"; btn.classList.add("btn-primary"); }
    else {
      btn.dataset.act = "ready";
      btn.textContent = me && me.ready ? (over ? "Bei der Revanche dabei ✓" : "Bereit ✓") : (over ? "Bei der Revanche mitspielen" : "Bereit");
      btn.classList.toggle("btn-primary", !(me && me.ready));
    }
    box.hidden = !run;
    if (run) {
      const names = R.members.filter((m, i) => playing(i)).map((m) => esc(m.name)).join(", ");
      box.innerHTML = over
        ? `<b>Das Spiel ist vorbei.</b> ${names} stimmen gerade über eine Revanche ab. Willst du mitspielen, tippe auf „Bei der Revanche mitspielen“.`
        : `<b>Gerade läuft ein Spiel:</b> ${names}. Du kannst zuschauen. Ist es vorbei, kannst du bei der Revanche einsteigen.`;
    }
    const go = R.members.filter((m, i) => m.bot || (m.online && (m.ready || i === R.host)));
    start.hidden = !host || !!run;
    start.disabled = go.length < 2;
    start.textContent = go.length < 2 ? "Warte, bis jemand bereit ist …" : `Spiel starten (${go.length} Spieler)`;
    // who is ready, who plays, who waits
    [...document.querySelectorAll("#members > li")].forEach((li, i) => {
      const m = R.members[i];
      if (!m || m.bot) return;
      const t = run ? (playing(i) ? ["spielt", ""] : m.ready ? ["dabei", "ok"] : ["wartet", "wait"]) : m.ready ? ["bereit", "ok"] : null;
      if (t) li.insertAdjacentHTML("beforeend", `<span class="tag ${t[1]}">${t[0]}</span>`);
    });
    if (run) for (const el of document.querySelectorAll("#lobby .seg button, #lobby .rules-list input")) el.disabled = true;
    if (!me) return;
    const people = R.members.filter((m) => !m.bot && m.online), ready = people.filter((m) => m.ready).length;
    $("#lobbyHint").textContent = run
      ? (over ? "" : "Wer im Warteraum ist, spielt die nächste Runde mit, wenn er sich bereit meldet.")
      : (me.ready ? `Du bist bereit (${ready} von ${people.length}). Sind alle bereit, geht es los.` : `Tippe auf „Bereit“, wenn du mitspielen willst (${ready} von ${people.length} bereit).`) +
        (host ? " Mit „Spiel starten“ geht es sofort los, wer nicht bereit ist, wartet dann hier." : "");
  }
  // after a game: who is in for the rematch, who is still deciding, who went back, who left
  function rematchStatus(n, votes) {
    const groups = { in: [], extra: [], wait: [], lobby: [], gone: [] };
    R.members.forEach((m, i) => {
      if (m.bot) return;
      if (i < n && !m.lobby) groups[!m.online ? "gone" : votes.includes(i) ? "in" : "wait"].push(m);
      else if (m.ready && m.online) groups.extra.push(m);
      else if (i < n) groups[m.online ? "lobby" : "gone"].push(m);
    });
    return [["in", "Bereit"], ["extra", "Aus dem Warteraum dabei"], ["wait", "Überlegt noch"], ["lobby", "Zurück im Warteraum"], ["gone", "Gegangen"]]
      .filter(([k]) => groups[k].length).map(([k, t]) => `<span><b>${t}:</b> ${groups[k].map((m) => esc(m.name)).join(", ")}</span>`).join(" · ");
  }
  $("#readyBtn").addEventListener("click", () => {
    if ($("#readyBtn").dataset.act === "watch") { watching = true; render(); return; }
    const me = R && R.members[R.you];
    if (me) wsSend({ t: "ready", on: !me.ready });
  });

  $("#leaveLobby").addEventListener("click", () => wsSend({ t: "leave" }));
  // host closes the room for everyone; tap twice, like the menu actions
  let closeArm = null;
  $("#closeLobby").addEventListener("click", (e) => {
    const b = e.currentTarget, reset = () => { closeArm = null; b.textContent = "Raum für alle schließen"; b.classList.remove("btn-danger"); };
    if (closeArm) { clearTimeout(closeArm); reset(); wsSend({ t: "close" }); return; }
    b.textContent = "Sicher? Nochmal tippen"; b.classList.add("btn-danger");
    closeArm = setTimeout(reset, 3500);
  });
  $("#copyBtn").addEventListener("click", () => {
    const url = $("#joinUrl").textContent;
    const ok = () => toast("Link kopiert.");
    const fallback = () => { const r = document.createRange(); r.selectNodeContents($("#joinUrl")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Link markiert, jetzt kopieren."); };
    try { navigator.clipboard.writeText(url).then(ok, fallback); } catch (e) { fallback(); }
  });

  $("#reBtn").addEventListener("click", () => { peek = false; doAct({ t: "next" }, mode === "local" ? 0 : null); });
  $("#reLook").addEventListener("click", () => { peek = true; render(); });
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearTimeout(clockT); render(); }
    else if (R && R.members[R.you] && R.members[R.you].lobby) { watching = false; render(); }
    else if (V && V.phase === "roundEnd" && V.last && V.last.over) wsSend({ t: "lobby" });
    else wsSend({ t: "end" });
  });

  // menu with in-page two-step confirmation
  function armed(label, run) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn btn-ghost btn-block"; b.textContent = label;
    let t = null;
    b.addEventListener("click", () => {
      if (t) { clearTimeout(t); t = null; $("#menu").hidden = true; run(); return; }
      b.textContent = "Sicher? Nochmal tippen"; b.classList.add("btn-danger");
      t = setTimeout(() => { t = null; b.textContent = label; b.classList.remove("btn-danger"); }, 3500);
    });
    return b;
  }
  $("#menuBtn").addEventListener("click", () => {
    renderLook();
    scoreList($("#menuScores"), []);
    $("#menuLog").innerHTML = V ? V.log.slice().reverse().map((l) => `<li>${esc(l)}</li>`).join("") : "";
    const on = activeNames(V ? V.rules : {});
    const size = V ? `Spielfeld ${V.cols}×${V.rows}, ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}.` : "";
    $("#menuRules").textContent = `${size} ${on.length ? `Hausregeln: ${on.join(", ")}.` : "Keine Hausregeln."}`;
    const box = $("#menuActions"); box.innerHTML = "";
    if (mode === "local") {
      if (V && V.phase === "play" && !V.players[V.cur].bot && humans(V).length === 2)
        box.append(armed(`${V.players[V.cur].name} gibt auf`, () => doAct({ t: "giveup" })));
      box.append(
        armed("Runde neu starten", () => { L.round--; L.starter = (L.starter + 1) % 2; G.startRound(L); peek = false; store.set(K.local, L); render(); scheduleBot(); }),
        armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearTimeout(clockT); render(); })
      );
    } else if (mode === "online" && R) {
      if (R.members[R.you] && R.members[R.you].lobby) { // watching from the waiting room: no player actions
        const b = document.createElement("button");
        b.type = "button"; b.className = "btn btn-block"; b.textContent = "Zurück in den Warteraum";
        b.addEventListener("click", () => { watching = false; $("#menu").hidden = true; render(); });
        box.append(b);
        if (R.you === R.host) box.append(armed("Raum für alle schließen", () => wsSend({ t: "close" })));
        box.append(armed("Raum verlassen", () => wsSend({ t: "leave" })));
      } else {
const host = R.you === R.host;
      if (host && V && V.phase === "play" && V.cur !== V.me && !V.players[V.cur].bot)
        box.append(armed(`${V.players[V.cur].name} überspringen`, () => wsSend({ t: "act", a: { t: "skip" } })));
      if (V && V.phase === "play" && V.me >= 0)
        box.append(armed("Aufgeben", () => wsSend({ t: "act", a: { t: "giveup" } })));
      if (host) box.append(armed("Spiel beenden, zurück in den Warteraum", () => wsSend({ t: "end" })));
      if (R.you === R.host) box.append(armed("Raum für alle schließen", () => wsSend({ t: "close" })));
      box.append(armed("Raum verlassen", () => wsSend({ t: "leave" })));
      }
    }
    $("#menu").hidden = false;
  });
  $("#menuClose").addEventListener("click", () => { $("#menu").hidden = true; });

  // keep the screen on while playing (needs HTTPS; silently skipped otherwise)
  let lock = null;
  async function wake() {
    try { if ("wakeLock" in navigator && !lock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } } catch (e) {}
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (mode) wake();
    if (wantOnline && !(ws && ws.readyState <= 1)) { retry = 0; connect(); }
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- boot ----------
  // Is there a game server behind this address? Ask twice over HTTP (some ad blockers
  // eat such requests), then simply try the WebSocket.
  async function getJson(path, ms) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(path, { cache: "no-store", signal: ctl.signal });
      const j = await r.json();
      return j && j.vier ? j : null;
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  function probeSocket(ms) {
    return new Promise((res) => {
      let w;
      try { w = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws"); } catch (e) { return res(false); }
      const t = setTimeout(() => { w.close(); res(false); }, ms);
      w.onopen = () => { clearTimeout(t); w.close(); res(true); };
      w.onerror = () => { clearTimeout(t); res(false); };
    });
  }
  async function detectServer() {
    if (!webHost) return null;
    return (await getJson("/vier-server", 6000)) || (await getJson("/info", 4000)) || ((await probeSocket(6000)) ? {} : null);
  }
  const code = new URLSearchParams(location.search).get("r");
  if (code) $("#joinCode").value = code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  render();
  if (webHost && (store.get(K.online) && !code)) { wantOnline = true; connect(); }
  detectServer().then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
