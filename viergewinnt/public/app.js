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
  const K = { local: "vier.v1", online: "vier.online", me: "vier.me", rules: "vier.rules", size: "vier.size", goal: "vier.goal", sound: "vier.sound", level: "vier.level", stats: "vier.stats",
    avatar: "vier.avatar", look: "vier.look" };
  const store = Spieleabend.store;
  const BOT_MS = 900;

  // ---------- look: table design and board size (applied before anything is drawn) ----------
  // ---------- look: table design and size (shared, kit.js), applied before anything is drawn ----------
  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Größe", onChange: () => { if (V && !$("#game").hidden) layoutBoard(); } });

  // ---------- avatars ----------
  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");

  const SIZES = [[7, "7×6", "klassisch"], [8, "8×7", "größer"], [10, "10×8", "riesig"]];
  const LEVELS = [[1, "Leicht"], [2, "Normal"], [3, "Profi"], [0, "Zufällig"]];
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
  let flipIdx = null, vanish = null, tip = null; // swap flip, undone discs fading out, tip {key, col|swap}
  let anim = null;        // { idx } disc that just fell, animated on the next board render
  let peek = false;       // round over, looking at the board
  let popMode = false;    // Pop Out: the next tap pulls a disc out at the bottom
  let keyCol = null;      // desktop: column chosen with the arrow keys
  let inflight = false;
  let server = null;      // server info once found ({} when only the WebSocket answered)
  let serverState = "checking"; // "checking" | "ok" | "none"
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "vier.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let sizeLocal = G.normSize(store.get(K.size) || 7), goalLocal = G.normGoal(store.get(K.goal) || 1);
  let localRules = G.normRules(store.get(K.rules));
  let levelLocal = G.normLevel(store.get(K.level));
  let lastTurn = null;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const humans = (st) => st.players.map((_, i) => i).filter((i) => !st.players[i].bot);
  // whose moves this screen makes: online your seat; on a shared device whoever is on (people only)
  const canPlay = () => !!V && V.phase === "play" && V.cur >= 0 && (mode === "local" ? !V.players[V.cur].bot : V.cur === V.me);
  const pname = (i) => (mode === "online" && i === V.me ? "Du" : V.players[i].name);
  const height = (c) => { let r = 0; while (r < V.rows && V.grid[c + r * V.cols] !== -1) r++; return r; };
  const ownBottom = (c) => V.grid[c] === V.cur;

  const { toast, confetti, showBubble } = Spieleabend;
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
  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound,
    effects: ({ tone, noise }) => ({
      drop: (fall) => { const d = 0.18 + fall * 0.045; noise(d, 0.12, 0.35, 1800); tone(220, d, 0.08, "triangle", 0.12, 140); },
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      pull: () => { tone(300, 0, 0.18, "triangle", 0.1, 600); noise(0.1, 0.25, 0.2, 900); },
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16)),
      draw: () => { tone(440, 0, 0.2, "triangle", 0.1); tone(440, 0.22, 0.3, "triangle", 0.08); },
      tick: () => tone(1200, 0, 0.05, "square", 0.06)
    })
  });

  // ---------- events → feedback ----------
  // the final disc falls and the winning four light up before the result sheet covers the board
  let endHold = 0, endHoldT = null;
  function handleEvents(events, v) {
    if (!v) return;
    if ((events || []).some((e) => e.t === "end") && (events || []).some((e) => e.t === "drop" || e.t === "pop")) {
      endHold = Date.now() + 1700; clearTimeout(endHoldT);
      endHoldT = setTimeout(() => { if (V && V.phase === "roundEnd") render(); }, 1750);
    }
    for (const ev of events || []) {
      if (ev.t === "drop") { const fall = v.rows - ev.row; anim = { idx: ev.col + ev.row * v.cols, fall }; sfx("drop", fall); }
      if (ev.t === "pop") sfx("pull");
      if (ev.t === "swap") { flipIdx = ev.col + ev.row * v.cols; sfx("pull"); toast(`${mode === "online" && ev.pi === v.me ? "Du übernimmst" : v.players[ev.pi].name + " übernimmt"} die erste Scheibe.`); }
      if (ev.t === "undo") { vanish = ev.cells; sfx("pop"); }
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
      if (!$("#menu").hidden || (window.Tutorial && Tutorial.held())) { scheduleBot(); return; } // paused while the menu is open
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
      if (!R.view || (waiting && !watching)) { V = null; showScreen("lobby"); UI.renderLobby(); $("#roundEnd").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else {
      V = null;
      $("#roundEnd").hidden = true;
      showScreen("home"); renderHome();
    }
    UI.update();
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
          if (o.flip === idx) cls.push("flip");
          if (o.win && o.win.includes(idx)) cls.push("win");
          let style = "";
          if (o.anim && o.anim.idx === idx) { cls.push("fall"); style = ` style="--fall:${o.anim.fall}"`; }
          disc = `<span class="${cls.join(" ")}"${style}></span>`;
        } else if (o.vanish && o.vanish.some((x) => x.idx === idx)) disc = `<span class="disc vanish p${o.vanish.find((x) => x.idx === idx).p}"></span>`;
        else if (o.ghost != null && o.ghost.col === c && r === top) disc = `<span class="disc ghost p${o.ghost.p}"></span>`;
        cells += `<span class="hole${o.tip === c && r === top ? " tip" : ""}">${disc}</span>`;
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
    const wf = V.cols + 0.14 * (V.cols - 1) + 0.392, hf = V.rows + 0.14 * (V.rows - 1) + 0.392 + 0.85; // room for the disc hovering above the board
    const cs = parseFloat(LOOK.get().size) || 1;
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
    const tp = tip && tip.key === `${V.round}:${V.turn}` && play ? tip : null;
    board.innerHTML = boardHTML(V, {
      buttons: true, anim, flip: flipIdx, vanish, tip: tp && tp.col != null ? tp.col : null, win: V.last && V.last.cells, last: lm && V.phase === "play" && !lm.pop ? lm.col + lm.row * V.cols : null,
      ghost: play && keyCol != null && !popMode ? { col: keyCol, p: V.cur } : null,
      disabled: (c, top) => !play || (popMode ? V.grid[c] !== V.cur : top >= V.rows)
    });
    anim = null; flipIdx = null; vanish = null;
    board.classList.toggle("play", play);
    board.classList.toggle("popmode", play && popMode);
    layoutBoard();
    applyAim();

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
        hint = popMode ? "Tippe auf eine Spalte mit deiner Scheibe ganz unten." : "Tippe auf eine Spalte, oder halte, schiebe und lass zum Einwerfen los.";
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
    $("#hintBtn").hidden = !play;
    $("#swapBtn").hidden = !(play && V.canSwap);
    $("#swapBtn").classList.toggle("tip", !!(tp && tp.swap));
    $("#undoBtn").hidden = !(play && V.canUndo);
    $("#popBtn").hidden = !canPop;
    $("#popBtn").setAttribute("aria-pressed", String(popMode));
    $("#popBtn").textContent = popMode ? "Doch lieber einwerfen" : "Unten herausziehen";
    $("#resultBtn").hidden = !(V.phase === "roundEnd" && peek);
    $("#reactBtn").hidden = mode !== "online";
    $("#keys").innerHTML = play ? `<kbd>1</kbd>–<kbd>${Math.min(9, V.cols)}</kbd> einwerfen · <kbd>←</kbd><kbd>→</kbd> + <kbd>Enter</kbd>${V.rules.popout ? " · <kbd>P</kbd> Pop Out" : ""}` : "";
    renderClock();

    // turn change feedback
    const key = `${V.round}:${V.turn}:${V.cur}`;
    Spieleabend.mine(play && (mode === "online" || V.players.some((p) => p.bot)));
    if (play && lastTurn !== key && lastTurn !== null && (mode === "online" || V.players.some((p) => p.bot))) { buzz([40, 60, 40]); sfx("turn"); }
    lastTurn = key;

    $("#roundEnd").hidden = V.phase !== "roundEnd" || peek || Date.now() < endHold;
    if (V.phase === "roundEnd") {
      if (!peek) renderRoundEnd();
      const k = `${V.round}:${V.last.winners.join(",")}:${V.players.map((p) => p.wins).join(",")}:${V.draws}`;
      if (confettiFor !== k) {
        confettiFor = k; record(k);
        const me = mode === "online" ? V.me : localMe();
        if (V.last.winners.length && (me < 0 ? mode === "local" : V.last.winners.includes(me))) setTimeout(() => { confetti(); sfx("win"); }, Math.max(700, endHold - Date.now() + 100));
      }
    }
  }

  // keyboard (Enter on a focused column); touch and mouse go through the pointer handlers below
  $("#board").addEventListener("click", (e) => { if (e.detail) return; const b = e.target.closest("[data-col]"); if (b && !b.disabled) playCol(+b.dataset.col); });

  // aim: a see-through disc in the landing cell plus a disc hovering above the column
  let aimCol = null, drag = null;
  function applyAim() {
    const b = $("#board");
    const ok = aimCol != null && V && canPlay() && !popMode && height(aimCol) < V.rows;
    const col = ok ? b.querySelector(`[data-col="${aimCol}"]`) : null;
    const want = col ? col.children[height(aimCol)] : null;
    for (const g of b.querySelectorAll(".disc.ghost")) if (g.parentNode !== want) g.remove();
    if (want && !want.querySelector(".disc")) want.insertAdjacentHTML("beforeend", `<span class="disc ghost p${V.cur}"></span>`);
    for (const c of b.querySelectorAll(".col.aimed")) if (c !== col) c.classList.remove("aimed");
    let t = b.querySelector(".disc.aim");
    if (!col) { if (t) t.remove(); return; }
    col.classList.add("aimed");
    if (!t) { t = document.createElement("span"); b.appendChild(t); }
    t.className = `disc aim p${V.cur}`;
    t.style.left = col.offsetLeft + (col.offsetWidth - t.offsetWidth) / 2 + "px";
  }
  function colAt(x) {
    let best = null, bd = 1e9;
    for (const c of $("#board").querySelectorAll(".col")) {
      const r = c.getBoundingClientRect(), d = Math.abs(x - (r.left + r.right) / 2);
      if (d < bd) { bd = d; best = c; }
    }
    return best ? +best.dataset.col : null;
  }
  // the whole strip above and across the board counts as a column
  function inZone(e) {
    const r = $("#board").getBoundingClientRect(), a = $("#arena").getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= a.top && e.clientY <= r.bottom;
  }
  const arenaEl = $("#arena");
  arenaEl.addEventListener("pointerdown", (e) => {
    if ((e.pointerType === "mouse" && e.button !== 0) || !V || V.phase !== "play" || !inZone(e)) return;
    drag = { id: e.pointerId, col: colAt(e.clientX), away: false };
    try { arenaEl.setPointerCapture(e.pointerId); } catch {}
    aimCol = drag.col; applyAim();
    e.preventDefault();
  });
  arenaEl.addEventListener("pointermove", (e) => {
    if (drag) {
      if (e.pointerId !== drag.id) return;
      const r = $("#board").getBoundingClientRect();
      drag.col = colAt(e.clientX);
      drag.away = e.clientY > r.bottom + (r.width / V.cols) * 0.7; // pulled down off the board: release cancels
      aimCol = drag.away ? null : drag.col;
      applyAim();
    } else if (e.pointerType === "mouse") {
      aimCol = V && inZone(e) ? colAt(e.clientX) : null;
      applyAim();
    }
  });
  arenaEl.addEventListener("pointerup", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { col, away } = drag;
    drag = null; aimCol = null; applyAim();
    if (!away && col != null) playCol(col);
  });
  arenaEl.addEventListener("pointercancel", () => { drag = null; aimCol = null; applyAim(); });
  arenaEl.addEventListener("pointerleave", (e) => { if (!drag && e.pointerType === "mouse") { aimCol = null; applyAim(); } });
  arenaEl.addEventListener("contextmenu", (e) => e.preventDefault());
  $("#hintBtn").addEventListener("click", () => {
    if (!canPlay()) return;
    const a = G.suggest(V, V.cur);
    if (!a) return;
    tip = { key: `${V.round}:${V.turn}`, col: a.t === "drop" ? a.col : null, swap: a.t === "swap" };
    toast(a.t === "swap" ? "Tipp: Übernimm die erste Scheibe." : `Tipp: Spalte ${a.col + 1}.`);
    renderGame();
  });
  $("#swapBtn").addEventListener("click", () => { if (canPlay() && V.canSwap) doAct({ t: "swap" }); });
  $("#undoBtn").addEventListener("click", () => { if (canPlay() && V.canUndo) doAct({ t: "undo" }); });
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

  // ---------- reactions (online) ----------
  // reactions float above everything (fixed), so the top edge of the screen or a scrolling
  // player strip can't clip them; near the top they show up below the player instead
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
    UI.roundEndFooter({ over: last.over, next: "Nächste Runde" });
  }

  // Statistik lebt im Profil (shared/profile.js, gilt für alle Spiele); die alte Bilanz dieses Browsers wird einmal übernommen
  const profile = Spieleabend.profile;
  { const old = (store.get(K.stats) || {})[profile.get().name]; if (old) profile.importLegacy("viergewinnt", { rounds: old.rounds || old.games, wins: old.wins }); }
  function record(key) {
    const i = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
    if (i < 0) return;
    profile.result("viergewinnt", key, { won: V.last.winners.includes(i), draw: !V.last.winners.length, online: mode === "online" });
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
    $("#sizeLocal").innerHTML = segHTML(SIZES, sizeLocal);
    $("#goalLocal").innerHTML = segHTML(GOALS, goalLocal);
    $("#levelLocal").innerHTML = segHTML(LEVELS, levelLocal);

    const saved = store.get(K.local);
    $("#resumePanel").hidden = !(saved && saved.players);
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => p.name).join(" gegen ")} · Runde ${saved.round}`;
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
      room(m) { R = m; mode = "online"; inflight = false; if (m.view) handleEvents(m.events, m.view); render(); },
      react(m) { bubble(m.pi, m.e, m.name); },
      error(m) { inflight = false; },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text, name) => bubble(pi, text, name),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    memberExtra: (m, i) => `<i class="dot p${i}" title="${G.COLORS[i]}"></i>`,
    // board size, goal, computer strength and house rules; the host picks, everyone sees it
    renderSettings(host) {
      for (const [id, list, cur] of [["#sizeOnline", SIZES, R.size], ["#goalOnline", GOALS, R.goal], ["#levelOnline", LEVELS, R.level == null ? 2 : R.level]]) {
        const el = $(id), k = cur + ":" + host;
        if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = segHTML(list, cur); for (const b of el.children) b.disabled = !host; }
      }
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
        const size = V ? `Spielfeld ${V.cols}×${V.rows}, ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}.` : "";
        $("#menuRules").textContent = `${size} ${on.length ? `Hausregeln: ${on.join(", ")}.` : "Keine Hausregeln."}`;
      },
      local(box) {
        if (V && V.phase === "play" && !V.players[V.cur].bot && humans(V).length === 2)
          box.append(UI.armed(`${V.players[V.cur].name} gibt auf`, () => doAct({ t: "giveup" })));
        box.append(
          UI.armed("Runde neu starten", () => { L.round--; L.starter = (L.starter + 1) % 2; G.startRound(L); peek = false; store.set(K.local, L); render(); scheduleBot(); }),
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearTimeout(clockT); render(); })
        );
      },
      player(box) {
        if (V && V.phase === "play" && V.me >= 0)
          box.append(UI.armed("Aufgeben", () => wsSend({ t: "act", a: { t: "giveup" } })));
      },
      skip: (v) => v.phase === "play" && v.cur !== v.me && !v.players[v.cur].bot
    }
  });

  // avatar picker in the online form
  Spieleabend.avatarPicker({ avatars: G.AVATARS, get: () => myAvatar, set: (a) => { myAvatar = a; store.set(K.avatar, a); } });

  // look settings on the start screen and in the menu
  $("#sizeOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", size: +b.dataset.v }); });
  $("#goalOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", goal: +b.dataset.v }); });
  $("#levelOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", level: +b.dataset.v }); });


  // connection pill: only after a short grace period, phones drop sockets all the time

  // ---------- online connection ----------
  function wsSend(m) { return UI.send(m); }

  // ---------- events ----------
  // a small board on the start screen, red is about to win
  (() => {
    const cols = 7, rows = 6, grid = new Array(cols * rows).fill(-1);
    [[3, 0, 0], [3, 1, 1], [4, 0, 1], [2, 0, 0], [4, 1, 0], [4, 2, 1], [5, 0, 1], [5, 1, 0], [5, 2, 1], [5, 3, 0], [1, 0, 0], [2, 1, 1]].forEach(([c, r, p]) => { grid[c + r * cols] = p; });
    $("#heroBoard").innerHTML = boardHTML({ cols, rows, grid }, {});
  })();
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; tabTouched = true; renderHome(); } });
  $("#sizeLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { sizeLocal = +b.dataset.v; store.set(K.size, sizeLocal); renderHome(); } });
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
    L = state; mode = "local"; peek = false; popMode = false; keyCol = null;
    if (L.phase === "play") G.resetClock(L);
    store.set(K.local, L); render(); wake(); scheduleBot();
  }
  $("#startLocal").addEventListener("click", () => {
    const { names, bots } = HOME.roster($("#myName").value);
    const list = names.map((name, i) => ({ name, bot: bots[i], avatar: bots[i] ? G.BOT_AVATAR : myAvatar }));
    startLocal(G.newGame(list, goalLocal, sizeLocal, localRules, levelLocal));
  });
  $("#resumeBtn").addEventListener("click", () => {
    const s = store.get(K.local); if (!s) return render();
    startLocal(s);
  });

  // ---------- waiting room: ready up, or watch the game that runs ----------

  // host closes the room for everyone; tap twice, like the menu actions

  $("#reBtn").addEventListener("click", () => { peek = false; doAct({ t: "next" }, mode === "local" ? 0 : null); });
  $("#reLook").addEventListener("click", () => { peek = true; render(); });
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearTimeout(clockT); render(); }
    else if (R && R.members[R.you] && R.members[R.you].lobby) { watching = false; render(); }
    else if (V && V.phase === "roundEnd" && V.last && V.last.over) wsSend({ t: "lobby" });
    else wsSend({ t: "end" });
  });

  // leave the room from the menu's bottom row: first tap turns it red, the second leaves


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
  UI.detectServer("/vier-server", "vier").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
