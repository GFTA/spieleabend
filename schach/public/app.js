// Schach UI: single player (against the computer) and online rooms share one table renderer.
(() => {
  "use strict";
  const G = window.SchachGame;
  // An old cached game.js next to a new app.js: reload once without cache instead of breaking.
  if (!G || !G.botMove || !G.AVATARS) {
    let tried = false;
    try { tried = sessionStorage.getItem("schach.reloaded") === "1"; sessionStorage.setItem("schach.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("schach.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const K = { local: "schach.v1", online: "schach.online", me: "schach.me", goal: "schach.goal", level: "schach.level", rules: "schach.rules",
    sound: "schach.sound", avatar: "schach.avatar", look: "schach.look" };
  const store = Spieleabend.store;
  const BOT_MS = 700;
  const VAL = [0, 1, 3, 3, 5, 9, 0];

  // table design and size (shared, kit.js), applied before anything is drawn
  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Größe" });

  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");

  const LEVELS = Object.entries(G.LEVELS).map(([v, name]) => [+v, name]).sort((x, y) => (x[0] || 9) - (y[0] || 9)); // "Zufällig" (0) last
  const GOALS = [[1, "Eine Runde"], [2, "Bis 2 Siege"], [3, "Bis 3 Siege"]];

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let R = null;           // last online room message
  let watching = false;   // in the waiting room, but watching the game that runs
  let V = null;           // view currently on screen
  let peek = false;       // round over, looking at the table
  let inflight = false;
  let server = null;      // server info once found ({} when only the WebSocket answered)
  let serverState = "checking"; // "checking" | "ok" | "none"
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "schach.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let goalLocal = G.normGoal(store.get(K.goal) || 1);
  let levelLocal = G.normLevel(store.get(K.level) || 2);
  let localRules = G.normRules(store.get(K.rules));
  let lastTurn = null, confettiFor = null;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const humans = (st) => st.players.map((_, i) => i).filter((i) => !st.players[i].bot);
  // shared device: with one person against the computer that person is "me", with two people nobody is
  const localMe = () => { const hs = humans(L); return hs.length === 1 ? hs[0] : -1; };
  const canPlay = () => !!V && V.phase === "play" && V.cur >= 0 && (mode === "local" ? !V.players[V.cur].bot : V.cur === V.me);
  const pname = (i) => (mode === "online" && i === V.me ? "Du" : V.players[i].name);
  const { toast, confetti, showBubble } = Spieleabend;
  const stamp = (v) => { if (v && !v._at) v._at = Date.now(); return v; };

  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound,
    effects: ({ tone, noise }) => ({
      pick: () => tone(520, 0, 0.05, "sine", 0.08),
      move: () => { noise(0, 0.04, 0.2, 1300); tone(230, 0, 0.07, "triangle", 0.12, 150); },
      capture: () => { noise(0, 0.1, 0.36, 2200); tone(180, 0, 0.14, "triangle", 0.16, 85); },
      check: () => { tone(880, 0, 0.1, "square", 0.07); tone(660, 0.11, 0.16, "square", 0.07); },
      king: () => [523, 659, 880].forEach((f, i) => tone(f, i * 0.07, 0.16, "triangle", 0.12)),
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16)),
      draw: () => { tone(440, 0, 0.2, "triangle", 0.1); tone(440, 0.22, 0.3, "triangle", 0.08); },
      tick: () => tone(1200, 0, 0.05, "square", 0.06)
    })
  });

  // ---------- events → feedback (every move is animated, also the computer's and other people's) ----------
  const animQ = [];              // moves waiting to be shown on the board
  let manualMove = null;         // a move the player already dragged into place
  function handleEvents(events, v) {
    if (!v) return;
    for (const ev of events || []) {
      if (ev.t === "move") {
        const manual = !!manualMove && manualMove.from === ev.from && manualMove.to === ev.to && Date.now() - manualMove.t < 8000;
        if (manual) manualMove = null;
        animQ.push(Object.assign({ manual }, ev));
      }
      if (ev.t === "timeout") { toast(mode === "online" && ev.pi === v.me ? "Deine Zeit ist abgelaufen." : `${v.players[ev.pi].name} hat keine Zeit mehr.`); sfx("bad"); }
      if (ev.t === "giveup") toast(mode === "online" && ev.pi === v.me ? "Du hast aufgegeben." : `${v.players[ev.pi].name} gibt auf.`);
      if (ev.t === "undo") { animQ.length = 0; closePromo(); sfx("pick"); }
      if (ev.t === "end") setTimeout(() => sfx(ev.winners && ev.winners.length ? "win" : "draw"), 500);
    }
  }

  // ---------- actions ----------
  function doAct(a, actor) {
    if (mode === "local") {
      const res = G.act(L, actor == null ? L.cur : actor, a);
      if (!res.ok) { toast(res.error); sfx("bad"); shakeBoard(); return false; }
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

  // the computer in single player (online the server moves it)
  let botT = null;
  function scheduleBot() {
    clearTimeout(botT);
    if (mode !== "local" || !L || L.phase !== "play" || !L.players[L.cur].bot) return;
    botT = setTimeout(() => {
      if (mode !== "local" || !L || L.phase !== "play" || !L.players[L.cur].bot) return;
      if (!$("#menu").hidden || animating || animQ.length) { scheduleBot(); return; } // paused while the menu is open
      const pi = L.cur, a = G.botMove(L, pi);
      const res = a ? G.act(L, pi, a) : null;
      if (res && res.ok) { handleEvents(res.events, G.view(L, localMe())); store.set(K.local, L); render(); }
      scheduleBot();
    }, BOT_MS);
  }

  // chess clocks: the server (or this page) settles a flag fall, this only shows the time
  function scheduleClock() {
    clearTimeout(scheduleClock.t);
    if (mode !== "local" || !L) return;
    const ms = G.nextDeadline(L);
    if (ms < 0) return;
    scheduleClock.t = setTimeout(() => {
      if (mode !== "local" || !L) return;
      const ev = G.tick(L);
      if (ev.length) { handleEvents(ev, G.view(L, localMe())); store.set(K.local, L); render(); scheduleBot(); }
      else scheduleClock();
    }, ms + 30);
  }
  const fmtTime = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  let beepKey = "";
  function tickTimes() {
    if (!V || !V.clockOn || $("#game").hidden) return;
    const spent = V.phase === "play" ? Date.now() - (V._at || Date.now()) : 0;
    for (const el of document.querySelectorAll("#plates .ptime")) {
      const i = +el.dataset.i, run = V.running === i && V.phase === "play";
      const ms = Math.max(0, V.times[i] - (run ? spent : 0));
      const t = fmtTime(ms);
      if (el.textContent !== t) el.textContent = t;
      el.classList.toggle("low", ms < 30000);
      el.classList.toggle("run", run);
      const s = Math.ceil(ms / 1000);
      if (run && i === V.cur && canPlay() && ms > 0 && s <= 5) {
        const k = `${V.turn}:${s}`;
        if (beepKey !== k) { beepKey = k; sfx("tick"); if (s === 1) buzz(30); }
      }
    }
  }
  setInterval(tickTimes, 250);

  // ---------- rendering ----------
  function showScreen(id) {
    for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id;
  }

  function render() {
    if (mode === "local" && L) {
      V = stamp(G.view(L, localMe()));
      showScreen("game");
      renderGame();
      scheduleClock();
    } else if (mode === "online" && R) {
      const meM = R.members[R.you], waiting = !!(R.view && meM && meM.lobby);
      if (!waiting) watching = false;
      if (!R.view || (waiting && !watching)) { V = null; showScreen("lobby"); UI.renderLobby(); $("#roundEnd").hidden = true; }
      else { V = stamp(R.view); showScreen("game"); renderGame(); }
    } else {
      V = null;
      $("#roundEnd").hidden = true;
      showScreen("home"); renderHome();
    }
    UI.update();
  }

  const pieceSVG = (t) => `<svg class="pcs" viewBox="0 0 45 45" aria-hidden="true"><use href="#pc${t}"/></svg>`;
  const miniSVG = (t, c) => `<svg class="pcs pmini c${c}" viewBox="0 0 45 45" aria-hidden="true"><use href="#pc${t}"/></svg>`;
  const gain = (i) => V.players[i].taken.reduce((s, t) => s + VAL[t], 0);

  function plateHTML(i) {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = members && members[i] && !members[i].online;
    const cls = ["plate", V.phase === "play" && V.cur === i ? "active" : "", away ? "away" : ""].join(" ");
    const tag = p.bot ? "Computer" : away ? "offline" : mode === "online" && i === V.me ? "du" : "";
    const meta = [G.COLORS[V.col[i]], tag].filter(Boolean).join(" · ");
    const lead = gain(i) - gain(1 - i);
    const taken = p.taken.slice().sort((a, b) => b - a).map((t) => miniSVG(t, 1 - V.col[i])).join("") + (lead > 0 ? `<b>+${lead}</b>` : "");
    return `<div class="${cls}" data-seat="${i}"><span class="pav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="pinfo"><span class="pname">${esc(p.name)}</span><span class="pmeta"><i class="chip c${V.col[i]}"></i>${esc(meta)}</span><span class="ptaken" title="Geschlagene Figuren">${taken}</span></span>` +
      (V.clockOn ? `<span class="ptime" data-i="${i}" title="Restzeit"></span>` : "") +
      `<span class="pwins" title="Siege">${p.wins}</span></div>`;
  }

  // ---------- board ----------
  const boardEl = $("#board"), pcsEl = $("#pcs");
  const pcEls = new Map();   // square -> piece element that stands there
  let sqEls = [];            // square -> square element
  let flipped = false;       // black plays from the bottom when you are black
  let animating = false;
  let sel = null;            // { from } while a piece is picked
  let tip = null;            // { key, from, to } the computer's suggestion for this turn
  let promoPending = null;   // { from, to, opts } while the player chooses a new piece
  let drag = null, down = null;

  const posOf = (i) => { const r = i >> 3, c = i & 7; return flipped ? { x: 7 - c, y: r } : { x: c, y: 7 - r }; };
  function setPos(el, i) { const p = posOf(i); el.style.setProperty("--x", p.x); el.style.setProperty("--y", p.y); }
  function squareAt(cx, cy) {
    const b = boardEl.getBoundingClientRect();
    const x = Math.floor(((cx - b.left) / b.width) * 8), y = Math.floor(((cy - b.top) / b.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return -1;
    return (flipped ? y : 7 - y) * 8 + (flipped ? 7 - x : x);
  }
  function shakeBoard() { boardEl.classList.remove("shake"); void boardEl.offsetWidth; boardEl.classList.add("shake"); }

  function buildSquares() {
    let html = "";
    sqEls = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const r = flipped ? y : 7 - y, c = flipped ? 7 - x : x;
      html += `<div class="sq${(r + c) % 2 === 0 ? " d" : ""}" data-i="${r * 8 + c}">` +
        (x === 0 ? `<i class="r">${r + 1}</i>` : "") + (y === 7 ? `<i class="f">${"abcdefgh"[c]}</i>` : "") + `</div>`;
    }
    $("#sqs").innerHTML = html;
    for (const el of $("#sqs").children) sqEls[+el.dataset.i] = el;
  }
  function clearPieces() { for (const el of pcEls.values()) el.remove(); pcEls.clear(); }

  function makePiece(i, v, born) {
    const el = document.createElement("div");
    el.className = `pc c${v >> 3}${born === false ? "" : " born"}`;
    el.innerHTML = pieceSVG(v & 7);
    el._v = v;
    setPos(el, i);
    pcsEl.append(el);
    pcEls.set(i, el);
    return el;
  }
  function syncPieces() {
    const grid = V.grid;
    for (const [i, el] of [...pcEls]) if (!grid[i] || el._v !== grid[i]) { el.remove(); pcEls.delete(i); }
    for (let i = 0; i < 64; i++) if (grid[i] && !pcEls.has(i)) makePiece(i, grid[i]);
  }

  const movesFrom = (from) => V.legal.filter((m) => m.from === from);
  const movable = () => new Set(V.legal.map((m) => m.from));
  // what dropping or tapping square t means for the picked piece: play it, choose a new piece, or nothing
  function resolve(from, t) {
    const ms = V.legal.filter((m) => m.from === from && m.to === t);
    if (!ms.length) return null;
    return ms[0].promo ? { promo: ms.map((m) => m.promo) } : { play: true };
  }

  function playHint() {
    return promoPending ? "Wähle die neue Figur."
      : V.check >= 0 ? "Schach! Rette deinen König."
      : "Zieh eine Figur aufs Zielfeld, oder tippe Figur und Feld an.";
  }

  function paintSel() {
    if (!V) return;
    if (sel && (!canPlay() || !movesFrom(sel.from).length)) {
      sel = null;
      if (drag) cancelDrag();
    }
    if (promoPending && (!sel || !canPlay())) closePromo();
    if (V.phase === "play" && canPlay()) $("#whoHint").textContent = playHint();
    const ms = sel ? movesFrom(sel.from) : [];
    for (const [i, el] of pcEls) {
      if (drag && drag.el === el) continue;
      el.classList.remove("sel", "moving");
      setPos(el, i);
      if (sel && sel.from === i) {
        el.classList.add("sel");
        if (promoPending) { el.classList.add("moving"); setPos(el, promoPending.to); }
      }
    }
    const tgt = new Map(); // square -> captures there?
    for (const m of ms) tgt.set(m.to, tgt.get(m.to) || m.cap);
    const lm = V.lastMove, tp = tip && tip.key === `${V.round}:${V.turn}` ? tip : null;
    for (let i = 0; i < 64; i++) {
      const el = sqEls[i]; if (!el) continue;
      const c = el.classList;
      c.remove("last", "src", "tip", "tgt", "cap", "drop", "chk");
      if (lm && (i === lm.from || i === lm.to)) c.add("last");
      if (tp && (i === tp.from || i === tp.to)) c.add("tip");
      if (V.check === i) c.add("chk");
      if (sel && i === sel.from) c.add("src");
      if (tgt.has(i)) { c.add("tgt"); if (tgt.get(i)) c.add("cap"); }
    }
  }

  function renderBoard() {
    const f = !!(V.me >= 0 && V.col[V.me] === 1);
    if (f !== flipped || !sqEls.length) { flipped = f; buildSquares(); clearPieces(); animQ.length = 0; }
    boardEl.classList.toggle("play", canPlay());
    if (animating) return;
    if (animQ.length && !runAnim(animQ.shift())) { animQ.length = 0; }
    if (animating) return;
    syncPieces();
    paintSel();
  }

  // one move on the board: the piece slides over, a captured piece fades out, a castling rook follows, a promoted pawn changes
  function runAnim(a) {
    const el = pcEls.get(a.from);
    const rook = a.castle ? pcEls.get(a.castle[0]) : null;
    if (!el || (el._v & 7) !== a.piece || (a.capSq >= 0 && !pcEls.has(a.capSq)) || (a.castle && !rook)) return false;
    animating = true; sel = null; closePromo();
    pcEls.delete(a.from);
    const victim = a.capSq >= 0 ? pcEls.get(a.capSq) : null;
    if (a.castle) pcEls.delete(a.castle[0]);
    paintSel(); // the target dots of the tapped piece go away while it slides
    el.classList.remove("sel", "lift");
    el.classList.add("moving");
    const finish = () => {
      el.classList.remove("moving", "settle");
      const old = pcEls.get(a.to); if (old && old !== el) { old.remove(); }
      pcEls.set(a.to, el);
      if (rook) pcEls.set(a.castle[1], rook);
      if (a.promo) { el._v = a.promo | (el._v & 8); el.innerHTML = pieceSVG(a.promo); el.classList.add("crowned"); sfx("king"); }
      else if (a.check) sfx("check");
      if (a.check && V && V.phase === "play") toast("Schach!");
      animating = false;
      if (animQ.length && runAnim(animQ.shift())) return;
      animQ.length = 0;
      if (V) render(); // syncs the board and shows the result sheet once the last move is over
    };
    if (victim) {
      pcEls.delete(a.capSq);
      setTimeout(() => { victim.classList.add("gone"); setTimeout(() => victim.remove(), 280); }, a.manual ? 100 : 130);
    }
    if (a.manual) el.classList.add("settle");
    setPos(el, a.to);
    if (rook) setPos(rook, a.castle[1]);
    sfx(a.cap ? "capture" : "move");
    setTimeout(finish, a.manual ? 300 : 310);
    return true;
  }

  // ---------- promotion ----------
  function openPromo(from, to, opts) {
    promoPending = { from, to, opts };
    const col = V.col[V.cur];
    $("#promoOpts").innerHTML = [5, 4, 3, 2].filter((t) => opts.includes(t))
      .map((t) => `<button type="button" class="c${col}" data-p="${t}" aria-label="${G.NAMES[t]}">${pieceSVG(t)}<span>${G.NAMES[t]}</span></button>`).join("");
    $("#promo").hidden = false;
    const el = pcEls.get(from);
    if (el) { el.classList.add("settle", "moving"); setPos(el, to); }
    $("#whoHint").textContent = playHint();
    sfx("pick");
  }
  function closePromo() {
    if (!promoPending) return;
    promoPending = null;
    $("#promo").hidden = true;
    for (const el of pcEls.values()) el.classList.remove("settle");
    if (V) paintSel();
  }
  $("#promoOpts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]"); if (!b || !promoPending) return;
    const { from, to } = promoPending;
    commitMove(from, to, +b.dataset.p, true);
  });
  $("#promoCancel").addEventListener("click", () => closePromo());
  $("#promo").addEventListener("pointerdown", (e) => { e.stopPropagation(); if (e.target === $("#promo")) closePromo(); });

  // ---------- picking and dragging pieces ----------
  function commitMove(from, to, promo, manual) {
    if (!canPlay() || inflight) return;
    if (manual) manualMove = { from, to, t: Date.now() };
    const el = pcEls.get(from);
    sel = null; tip = null;
    if (promoPending) { promoPending = null; $("#promo").hidden = true; }
    if (mode === "online") { inflight = true; setTimeout(() => { inflight = false; }, 3000); }
    buzz(10);
    if (manual && el) { el.classList.add("settle", "moving"); setPos(el, to); }
    const a = { t: "move", from, to };
    if (promo) a.promo = promo;
    if (!doAct(a)) { manualMove = null; inflight = false; paintSel(); }
  }
  function applyResolved(r, to, manual) {
    if (r.promo) openPromo(sel.from, to, r.promo);
    else commitMove(sel.from, to, 0, manual);
  }
  function illegalHint() {
    toast(V.check >= 0 ? "Dein König steht im Schach. Rette ihn zuerst." : "Dahin darf diese Figur nicht ziehen.");
    sfx("bad"); shakeBoard();
  }
  function handleTap(i) {
    if (i < 0 || !V || V.phase !== "play") return;
    if (!canPlay()) { toast(mode === "online" && V.me < 0 ? "Du schaust zu." : `Warte, ${V.players[V.cur].name} ist dran.`); return; }
    if (inflight || animating || promoPending) return;
    if (sel) { const r = resolve(sel.from, i); if (r) return applyResolved(r, i, false); }
    const v = V.grid[i];
    if (v && (v >> 3) === V.col[V.cur]) {
      if (movable().has(i)) {
        if (sel && sel.from === i) sel = null; else { sel = { from: i }; sfx("pick"); buzz(8); }
        paintSel();
      } else { toast(V.check >= 0 ? "Diese Figur kann den König nicht retten." : "Diese Figur kann gerade nicht ziehen."); sfx("bad"); shakeBoard(); }
      return;
    }
    if (sel) illegalHint();
  }

  function cancelDrag() {
    if (!drag) return;
    const el = drag.el;
    el.classList.remove("lift"); el.style.transform = "";
    drag = null; down = null;
  }
  // on touch the piece rises above the finger as it moves away, so a one-square step still works
  function dragPoint(e) {
    const far = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) / (drag.cell * 1.2);
    return { x: e.clientX, y: e.clientY - drag.maxLift * Math.min(1, far) };
  }
  function moveDrag(e) {
    const b = boardEl.getBoundingClientRect(), p = dragPoint(e);
    drag.el.style.transform = `translate(${p.x - b.left - drag.cell / 2}px,${p.y - b.top - drag.cell / 2}px)`;
    const t = squareAt(p.x, p.y);
    if (t !== drag.over) {
      if (drag.over >= 0 && sqEls[drag.over]) sqEls[drag.over].classList.remove("drop");
      drag.over = t;
      if (t >= 0 && sqEls[t] && sqEls[t].classList.contains("tgt")) sqEls[t].classList.add("drop");
    }
  }
  function endDrag(e, cancelled) {
    const d = drag, el = d.el, p = dragPoint(e);
    el.classList.remove("lift"); el.style.transform = "";
    for (const s of sqEls) s && s.classList.remove("drop");
    drag = null; down = null;
    if (cancelled || !sel || !canPlay() || inflight) { paintSel(); return; }
    const t = squareAt(p.x, p.y), r = t >= 0 && t !== sel.from ? resolve(sel.from, t) : null;
    if (r) { applyResolved(r, t, true); return; }
    if (t >= 0 && t !== sel.from) illegalHint();
    paintSel();
  }

  boardEl.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || drag || down || !V || V.phase !== "play" || e.target.closest("#promo")) return;
    const i = squareAt(e.clientX, e.clientY);
    if (i < 0) return;
    let from = -1;
    if (canPlay() && !animating && !inflight && !promoPending && movable().has(i)) from = i;
    down = { id: e.pointerId, i, x: e.clientX, y: e.clientY, from, touch: e.pointerType !== "mouse" };
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) {}
  });
  boardEl.addEventListener("pointermove", (e) => {
    if (!down || e.pointerId !== down.id) return;
    if (!drag) {
      if (down.from < 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) return;
      const el = pcEls.get(down.from); if (!el) return;
      if (!sel || sel.from !== down.from) sel = { from: down.from };
      const cell = boardEl.getBoundingClientRect().width / 8;
      drag = { id: e.pointerId, el, cell, maxLift: down.touch ? cell * 0.6 : 0, x0: down.x, y0: down.y, over: -1 };
      el.classList.add("lift");
      sfx("pick"); buzz(8);
      paintSel();
    }
    moveDrag(e);
    e.preventDefault();
  });
  boardEl.addEventListener("pointerup", (e) => {
    if (!down || e.pointerId !== down.id) return;
    if (drag) { endDrag(e, false); return; }
    down = null;
    handleTap(squareAt(e.clientX, e.clientY));
  });
  boardEl.addEventListener("pointercancel", (e) => { if (drag) endDrag(e, true); down = null; });
  boardEl.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- table ----------
  const RESULT_WHY = {
    mate: "Schachmatt.", stalemate: "Patt: Wer dran ist, kann nicht ziehen und steht nicht im Schach.", giveup: "Aufgabe.",
    timeout: "Die Zeit ist abgelaufen.", repetition: "Dreimal dieselbe Stellung.", fifty: "50 Züge ohne Bauernzug oder Schlag.",
    material: "Zu wenig Material für ein Matt."
  };

  function moveStripHTML() {
    const mv = V.moves;
    let html = "";
    for (let k = Math.max(0, mv.length - 14); k < mv.length; k++) {
      if (k % 2 === 0) html += `<span class="n">${k / 2 + 1}.</span>`;
      else if (k === Math.max(0, mv.length - 14)) html += `<span class="n">${(k + 1) / 2}…</span>`;
      html += `<span class="m${k === mv.length - 1 ? " cur" : ""}">${esc(mv[k])}</span>`;
    }
    return html || '<span class="n">Noch kein Zug</span>';
  }

  function renderGame() {
    if (V.phase !== "roundEnd") peek = false;
    $("#plates").innerHTML = V.players.map((_, i) => plateHTML(i)).join("");
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> · ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}`;
    renderBoard();
    tickTimes();

    // move list and log
    const strip = $("#moveStrip"), sk = V.moves.length + ":" + (V.moves[V.moves.length - 1] || "");
    if (strip.dataset.k !== sk) { strip.dataset.k = sk; strip.innerHTML = moveStripHTML(); strip.scrollLeft = strip.scrollWidth; }
    layoutBoard();
    const lmEl = $("#lastMove"), lines = V.log.slice(-2), lmKey = lines.join("\n");
    if (lmEl.dataset.k !== lmKey) {
      lmEl.dataset.k = lmKey;
      lmEl.innerHTML = lines.map((l, i) => `<div${i < lines.length - 1 ? ' class="old"' : ""}>${esc(l)}</div>`).join("");
      lmEl.classList.remove("fresh"); void lmEl.offsetWidth; lmEl.classList.add("fresh");
    }

    // dock
    const play = canPlay();
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
        hint = playHint();
      } else {
        who = `${P.name} ist dran`;
        hint = P.bot ? "Der Computer überlegt …" : mode === "online" && V.me < 0 ? "Du schaust zu." : "Warte auf den nächsten Zug.";
      }
    }
    $("#whoAv").textContent = av;
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    $("#dock").classList.toggle("myturn", play);
    $("#hintBtn").hidden = !play;
    $("#undoBtn").hidden = !(play && V.canUndo);
    $("#resultBtn").hidden = !(V.phase === "roundEnd" && peek);
    $("#reactBtn").hidden = mode !== "online";
    $("#keys").innerHTML = play ? "<kbd>Esc</kbd> Auswahl aufheben · <kbd>T</kbd> Tipp" + (V.canUndo ? " · <kbd>Z</kbd> Zug zurück" : "") : "";

    // turn change feedback
    const key = `${V.round}:${V.turn}:${V.cur}`;
    if (play && lastTurn !== key && lastTurn !== null && (mode === "online" || V.players.some((p) => p.bot))) { buzz([40, 60, 40]); sfx("turn"); }
    lastTurn = key;

    // the result sheet waits until the last move has been shown
    $("#roundEnd").hidden = V.phase !== "roundEnd" || peek || animating || animQ.length > 0;
    if (V.phase === "roundEnd") {
      if (!peek && !animating && !animQ.length) renderRoundEnd();
      const k = `${V.round}:${V.last.winners.join(",")}:${V.players.map((p) => p.wins).join(",")}:${V.draws}`;
      if (confettiFor !== k) {
        confettiFor = k; record(k);
        if (V.last.winners.some((w) => mode === "online" ? V.me < 0 || w === V.me : !V.players[w].bot)) setTimeout(() => confetti(), 900);
      }
    }
  }
  function layoutBoard() {
    const a = $("#arena");
    if ($("#game").hidden || !a.clientWidth) return;
    const cs = getComputedStyle(a);
    const w = a.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = a.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - $("#lastMove").offsetHeight - $("#moveStrip").offsetHeight - 28;
    boardEl.style.setProperty("--cell", Math.max(22, Math.floor(Math.min(w, h) / 8.7)) + "px");
  }
  if (window.ResizeObserver) new ResizeObserver(layoutBoard).observe($("#arena")); else addEventListener("resize", layoutBoard);

  $("#hintBtn").addEventListener("click", () => {
    if (!canPlay() || promoPending) return;
    const a = G.suggest(V, V.cur);
    if (!a) return;
    tip = { key: `${V.round}:${V.turn}`, from: a.from, to: a.to };
    toast(`Tipp: ${G.sq(a.from)} nach ${G.sq(a.to)}.`);
    paintSel();
  });
  $("#undoBtn").addEventListener("click", () => { if (canPlay() && V.canUndo) doAct({ t: "undo" }); });
  $("#resultBtn").addEventListener("click", () => { peek = false; render(); });

  // keys: Esc closes or drops the pick, T gives a tip, Z takes the move back
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") { if (open) $(open).hidden = true; else if (promoPending) closePromo(); else if (sel && !drag) { sel = null; paintSel(); } return; }
    if (e.target.closest("button")) return;
    if (open || $("#game").hidden || !$("#roundEnd").hidden || !canPlay()) return;
    const k = e.key.toLowerCase();
    if (k === "t") $("#hintBtn").click();
    else if (k === "z" && V.canUndo) $("#undoBtn").click();
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
    el.innerHTML = V.players.map((p, i) => {
      const you = mode === "online" && i === V.me ? " (du)" : "";
      return `<li class="${winners.includes(i) ? "win" : ""}"><span>${avi(p.avatar)}${esc(p.name)}${you}<small>${G.COLORS[V.col[i]]}</small></span>` +
        `<b>${p.wins} ${p.wins === 1 ? "Sieg" : "Siege"}</b></li>`;
    }).join("");
  }

  function renderRoundEnd() {
    const last = V.last, w = last.winners[0];
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round} vorbei`;
    $("#reTitle").textContent = w == null ? "Unentschieden" : `${mode === "online" && w === V.me ? "Du gewinnst" : `${V.players[w].name} gewinnt`} ${last.over ? "das Spiel" : "die Runde"}!`;
    $("#reText").textContent = `${RESULT_WHY[last.why] || ""} Nach ${Math.ceil(last.moves / 2)} Zügen.` +
      (last.over ? "" : ` Gespielt wird bis ${V.goal} Siege, als Nächstes beginnt ${V.players[V.nextStarter].name} mit Weiß.`);
    scoreList($("#reScores"), last.winners);
    UI.roundEndFooter({ over: last.over, next: "Nächste Runde" });
  }

  // Statistik lebt im Profil (shared/profile.js, gilt für alle Spiele)
  const profile = Spieleabend.profile;
  function record(key) {
    const i = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
    if (i < 0) return;
    profile.result("schach", key, { won: V.last.winners.includes(i), draw: !V.last.winners.length, online: mode === "online" });
  }

  function segHTML(list, cur) {
    return list.map(([v, a, b]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${a}${b ? `<small>${b}</small>` : ""}</button>`).join("");
  }

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
    $("#goalLocal").innerHTML = segHTML(GOALS, goalLocal);
    $("#levelLocal").innerHTML = segHTML(LEVELS, levelLocal);
    renderLocalRules();

    const saved = store.get(K.local);
    $("#resumePanel").hidden = !(saved && saved.players && saved.hist);
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
      room(m) { R = m; mode = "online"; inflight = false; if (m.view) { stamp(m.view); handleEvents(m.events, m.view); } render(); },
      react(m) { bubble(m.pi, m.e, m.name); },
      error(m) { inflight = false; manualMove = null; if (V && !animating) paintSel(); },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text, name) => bubble(pi, text, name),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    // goal, computer strength and house rules; the host picks, everyone sees it
    renderSettings(host) {
      for (const [id, list, cur] of [["#goalOnline", GOALS, R.goal], ["#levelOnline", LEVELS, R.level == null ? 2 : R.level]]) {
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
        if (V) scoreList($("#menuScores"), []);
        const on = activeNames(V ? V.rules : {});
        $("#menuRules").textContent = V ? `${V.goal === 1 ? "Eine Runde" : `Bis ${V.goal} Siege`}. ${on.length ? `Hausregeln: ${on.join(", ")}.` : "Keine Hausregeln."}` : "";
      },
      local(box) {
        if (V && V.phase === "play" && !V.players[V.cur].bot)
          box.append(UI.armed(`${V.players[V.cur].name} gibt auf`, () => doAct({ t: "giveup" })));
        box.append(
          UI.armed("Runde neu starten", () => { L.round--; L.starter = (L.starter + 1) % 2; G.startRound(L); G.resetClock(L); peek = false; sel = null; animQ.length = 0; store.set(K.local, L); render(); scheduleBot(); }),
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearTimeout(scheduleClock.t); render(); })
        );
      },
      player(box) {
        if (V && V.phase === "play" && V.me >= 0) box.append(UI.armed("Aufgeben", () => wsSend({ t: "act", a: { t: "giveup" } })));
      },
      skip: (v) => v.phase === "play" && v.cur !== v.me && !v.players[v.cur].bot
    }
  });
  function wsSend(m) { return UI.send(m); }

  // avatar picker on the start screen
  Spieleabend.avatarPicker({ avatars: G.AVATARS, get: () => myAvatar, set: (a) => { myAvatar = a; store.set(K.avatar, a); } });

  // ---------- start screen ----------
  for (const [id, key] of [["goal", "goal"], ["level", "level"]]) {
    $(`#${id}Online`).addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", [key]: +b.dataset.v }); });
  }
  $("#rulesLobby").addEventListener("change", (e) => {
    const k = e.target.dataset.rule; if (!k || !R || R.you !== R.host) return;
    const next = Object.assign({}, R.rules, { [k]: e.target.checked });
    store.set(K.rules, Object.assign(localRules, next));
    wsSend({ t: "settings", rules: next });
  });
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; tabTouched = true; renderHome(); } });
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
    wsSend({ t: "create", name: n, goal: goalLocal, rules: localRules, level: levelLocal, avatar: myAvatar });
  });

  function startLocal(state) {
    L = state; mode = "local"; peek = false; sel = null; tip = null; animQ.length = 0; closePromo();
    if (L.phase === "play") G.resetClock(L);
    store.set(K.local, L); render(); wake(); scheduleBot();
  }
  $("#startLocal").addEventListener("click", () => {
    const { names, bots } = HOME.roster($("#myName").value);
    const list = names.map((name, i) => ({ name, bot: bots[i], avatar: bots[i] ? G.BOT_AVATAR : myAvatar }));
    startLocal(G.newGame(list, goalLocal, localRules, levelLocal));
  });
  $("#resumeBtn").addEventListener("click", () => {
    const s = store.get(K.local); if (!s) return render();
    startLocal(s);
  });

  // ---------- round end ----------
  $("#reBtn").addEventListener("click", () => { peek = false; sel = null; animQ.length = 0; doAct({ t: "next" }, mode === "local" ? 0 : null); });
  $("#reLook").addEventListener("click", () => { peek = true; render(); });
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearTimeout(scheduleClock.t); render(); }
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
  UI.detectServer("/schach-server", "schach").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
