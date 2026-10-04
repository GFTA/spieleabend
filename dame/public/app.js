// Dame UI: single player (against the computer) and online rooms share one table renderer.
(() => {
  "use strict";
  const G = window.DameGame;
  // An old cached game.js next to a new app.js: reload once without cache instead of breaking.
  if (!G || !G.botMove || !G.AVATARS) {
    let tried = false;
    try { tried = sessionStorage.getItem("dame.reloaded") === "1"; sessionStorage.setItem("dame.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("dame.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const K = { local: "dame.v1", online: "dame.online", me: "dame.me", goal: "dame.goal", level: "dame.level", rules: "dame.rules",
    sound: "dame.sound", avatar: "dame.avatar", look: "dame.look" };
  const store = Spieleabend.store;
  const BOT_MS = 900;

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
  const HOME = window.HomeUI({ key: "dame.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost || (store.get(K.local) || {}).players ? "local" : "online", tabTouched = HOME.single(); // a saved local game: open on it, so a reload shows "Weiterspielen"
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
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const { toast, confetti, showBubble } = Spieleabend;

  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound,
    effects: ({ tone, noise }) => ({
      pick: () => tone(520, 0, 0.05, "sine", 0.08),
      move: () => { noise(0, 0.05, 0.22, 1500); tone(260, 0, 0.07, "triangle", 0.1, 170); },
      capture: () => { noise(0, 0.1, 0.36, 2400); tone(190, 0, 0.14, "triangle", 0.15, 90); },
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
        const manual = !!manualMove && same(manualMove.path, ev.path) && Date.now() - manualMove.t < 8000;
        if (manual) manualMove = null;
        animQ.push({ path: ev.path, caps: ev.caps, promoted: !!ev.promoted, manual });
      }
      if (ev.t === "timeout") { toast(mode === "online" && ev.pi === v.me ? "Zu langsam! Das Spiel hat für dich gezogen." : `${v.players[ev.pi].name} war zu langsam, Zufallszug!`); sfx("bad"); }
      if (ev.t === "giveup") toast(mode === "online" && ev.pi === v.me ? "Du hast aufgegeben." : `${v.players[ev.pi].name} gibt auf.`);
      if (ev.t === "undo") { animQ.length = 0; sfx("pick"); }
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
      if (!$("#menu").hidden || animating || (window.Tutorial && Tutorial.held())) { scheduleBot(); return; } // paused while the menu is open
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

  function plateHTML(i) {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = members && members[i] && !members[i].online;
    const cls = ["plate", V.phase === "play" && V.cur === i ? "active" : "", away ? "away" : ""].join(" ");
    const tag = p.bot ? "Computer" : away ? "offline" : mode === "online" && i === V.me ? "du" : "";
    const meta = [G.COLORS[V.col[i]], tag, p.kings ? `${p.kings} ${p.kings === 1 ? "Dame" : "Damen"}` : ""].filter(Boolean).join(" · ");
    return `<div class="${cls}" data-seat="${i}"><span class="pav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="pinfo"><span class="pname">${esc(p.name)}</span><span class="pmeta"><i class="chip c${V.col[i]}"></i>${esc(meta)}</span></span>` +
      `<span class="pscore" title="Steine auf dem Brett">${p.men + p.kings}</span>` +
      `<span class="pwins" title="Siege">${p.wins}</span></div>`;
  }

  // ---------- board ----------
  const boardEl = $("#board"), pcsEl = $("#pcs");
  const CROWN = '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18l1.5-10-5 4L12 4 7.5 12l-5-4z" fill="#e8b923" stroke="#8a6508" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const pcEls = new Map();   // square -> piece element that stands there
  let sqEls = [];            // square -> square element
  let flipped = false;       // black plays from the bottom when you are black
  let animating = false;
  let sel = null;            // { from, steps: [squares chosen so far] } while a piece is picked
  let tip = null;            // { key, path } the computer's suggestion for this turn
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

  function makePiece(i, v) {
    const el = document.createElement("div");
    el.className = `pc c${v >> 1}${v & 1 ? " k" : ""} born`;
    el.innerHTML = `<span class="disc">${CROWN}</span>`;
    el._v = v;
    setPos(el, i);
    pcsEl.append(el);
    pcEls.set(i, el);
    return el;
  }
  function syncPieces() {
    const grid = V.grid;
    for (const [i, el] of [...pcEls]) if (grid[i] < 0 || el._v !== grid[i]) { el.remove(); pcEls.delete(i); }
    for (let i = 0; i < 64; i++) if (grid[i] >= 0 && !pcEls.has(i)) makePiece(i, grid[i]);
  }

  // all legal moves of the piece on `from` that continue the squares picked so far
  const candsFor = (from, steps) => V.legal.filter((m) => m.path[0] === from && steps.every((s, k) => m.path[k + 1] === s));
  const movable = () => new Set(V.legal.map((m) => m.path[0]));
  // what dropping or tapping square t means: play a whole path, pick one more landing square, or nothing
  function resolve(from, steps, t) {
    const cands = candsFor(from, steps), n = steps.length;
    const finals = cands.filter((m) => m.path[m.path.length - 1] === t && m.path.length > n + 1);
    if (finals.length === 1) return { play: finals[0].path };
    if (finals.length > 1) {
      let k = n + 1;
      while (k < finals[0].path.length - 1 && finals.every((m) => m.path[k] === finals[0].path[k])) k++;
      return k > n + 1 ? { steps: finals[0].path.slice(1, k) } : { play: finals[0].path };
    }
    const nexts = cands.filter((m) => m.path[n + 1] === t);
    if (!nexts.length) return null;
    const done = nexts.find((m) => m.path.length === n + 2);
    return done ? { play: done.path } : { steps: steps.concat(t) };
  }

  function paintSel() {
    if (!V) return;
    if (sel && (!canPlay() || !candsFor(sel.from, sel.steps).length)) {
      sel = null;
      if (drag) cancelDrag();
    }
    if (V.phase === "play" && canPlay()) $("#whoHint").textContent = playHint();
    const mv = canPlay() && !animating ? movable() : new Set();
    const cands = sel ? candsFor(sel.from, sel.steps) : [];
    const takenNow = sel && cands.length ? cands[0].caps.slice(0, sel.steps.length) : [];
    for (const [i, el] of pcEls) {
      if (drag && drag.el === el) continue;
      el.classList.remove("sel", "taken", "moving", "can");
      setPos(el, i);
      if (takenNow.includes(i)) el.classList.add("taken");
      if (sel && sel.from === i) { el.classList.add("sel"); if (sel.steps.length) { el.classList.add("moving"); setPos(el, sel.steps[sel.steps.length - 1]); } }
      else if (!sel && V.mustCapture && mv.has(i)) el.classList.add("can");
    }
    const tgt = new Map(); // square -> captures there?
    if (sel) for (const m of cands) {
      const n = sel.steps.length, cap = m.caps.length > 0;
      tgt.set(m.path[n + 1], cap);
      tgt.set(m.path[m.path.length - 1], cap);
    }
    const lm = V.lastMove, tp = tip && tip.key === `${V.round}:${V.turn}` ? tip.path : null;
    for (let i = 0; i < 64; i++) {
      const el = sqEls[i]; if (!el) continue;
      const c = el.classList;
      c.remove("last", "src", "hop", "tip", "tgt", "cap", "drop");
      if (lm && lm.path && (i === lm.path[0] || i === lm.path[lm.path.length - 1])) c.add("last");
      if (tp && tp.includes(i)) c.add("tip");
      if (sel && i === sel.from) c.add("src");
      if (sel && sel.steps.includes(i)) c.add("hop");
      if (tgt.has(i) && !(sel && sel.steps.includes(i))) { c.add("tgt"); if (tgt.get(i)) c.add("cap"); }
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

  // one move on the board: the piece hops along its path, jumped pieces fade out, a promoted man gets its crown
  function runAnim(a) {
    const path = a.path, caps = a.caps || [], el = pcEls.get(path[0]);
    if (!el || !path.length || !caps.every((c) => pcEls.has(c))) { return false; }
    animating = true; sel = null;
    pcEls.delete(path[0]);
    el.classList.remove("sel", "taken", "can", "lift");
    el.classList.add("moving");
    const fade = (sq) => {
      const c = pcEls.get(sq); if (!c) return;
      pcEls.delete(sq); Spieleabend.toss(c, el);
    };
    const last = path[path.length - 1];
    const finish = () => {
      el.classList.remove("hop", "moving", "settle");
      const old = pcEls.get(last); if (old && old !== el) old.remove();
      pcEls.set(last, el);
      if (a.promoted) { el._v |= 1; el.classList.add("k", "crowned"); sfx("king"); }
      animating = false;
      if (animQ.length && runAnim(animQ.shift())) return;
      animQ.length = 0;
      if (V) render(); // syncs the board and shows the result sheet once the last move is over
    };
    if (a.manual) { // the player dropped it already: only settle and take the pieces
      el.classList.add("settle"); setPos(el, last);
      sfx(caps.length ? "capture" : "move");
      setTimeout(() => caps.forEach(fade), 100);
      setTimeout(finish, 300);
      return true;
    }
    const hop = (k) => {
      if (k >= path.length) return finish();
      el.classList.remove("hop"); void el.offsetWidth; el.classList.add("hop");
      setPos(el, path[k]);
      sfx(caps[k - 1] != null ? "capture" : "move");
      if (caps[k - 1] != null) setTimeout(() => fade(caps[k - 1]), 130);
      setTimeout(() => hop(k + 1), 290);
    };
    hop(1);
    return true;
  }

  // ---------- picking and dragging pieces ----------
  function commitPlay(path, manual) {
    if (!canPlay() || inflight) return;
    if (manual) manualMove = { path, t: Date.now() };
    const el = pcEls.get(path[0]);
    sel = null; tip = null;
    if (manual && el) { el.classList.remove("moving"); }
    if (mode === "online") { inflight = true; setTimeout(() => { inflight = false; }, 3000); }
    buzz(10);
    if (manual && el) { el.classList.add("settle"); setPos(el, path[path.length - 1]); }
    if (!doAct({ t: "move", path })) { manualMove = null; inflight = false; paintSel(); }
  }
  function playHint() {
    return sel && sel.steps.length ? "Spring weiter, du musst im selben Zug weiterschlagen."
      : V.mustCapture ? "Schlagzwang: Zieh einen leuchtenden Stein und schlag."
      : "Zieh einen Stein aufs Zielfeld, oder tippe Stein und Feld an.";
  }
  function applyResolved(r) {
    if (r.play) commitPlay(r.play, false);
    else { sel.steps = r.steps; sfx("pick"); buzz(8); paintSel(); }
  }
  function illegalHint() {
    toast(V.mustCapture ? "Schlagzwang: du musst schlagen." : "Dahin kann dieser Stein nicht ziehen.");
    sfx("bad"); shakeBoard();
  }
  function handleTap(i) {
    if (i < 0 || !V || V.phase !== "play") return;
    if (!canPlay()) { toast(mode === "online" && V.me < 0 ? "Du schaust zu." : `Warte, ${V.players[V.cur].name} ist dran.`); return; }
    if (inflight || animating) return;
    if (sel) { const r = resolve(sel.from, sel.steps, i); if (r) return applyResolved(r); }
    const v = V.grid[i];
    if (v >= 0 && (v >> 1) === V.col[V.cur]) {
      if (movable().has(i)) {
        if (sel && sel.from === i && !sel.steps.length) sel = null; else { sel = { from: i, steps: [] }; sfx("pick"); buzz(8); }
        paintSel();
      } else { toast(V.mustCapture ? "Schlagzwang: Dieser Stein kann nicht schlagen." : "Dieser Stein kann nicht ziehen."); sfx("bad"); shakeBoard(); }
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
    const t = squareAt(p.x, p.y), r = t >= 0 && t !== sel.from ? resolve(sel.from, sel.steps, t) : null;
    if (r) { applyResolved(r); return; }
    if (t >= 0 && t !== sel.from && !(sel.steps.length && sel.steps.includes(t))) illegalHint();
    paintSel();
  }

  boardEl.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || drag || down || !V || V.phase !== "play") return;
    const i = squareAt(e.clientX, e.clientY);
    if (i < 0) return;
    let from = -1;
    if (canPlay() && !animating && !inflight) {
      if (sel && sel.steps.length && sel.steps[sel.steps.length - 1] === i) from = sel.from; // pick the hopping piece up again
      else if (movable().has(i)) from = i;
    }
    down = { id: e.pointerId, i, x: e.clientX, y: e.clientY, from, touch: e.pointerType !== "mouse" };
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) {}
  });
  boardEl.addEventListener("pointermove", (e) => {
    if (!down || e.pointerId !== down.id) return;
    if (!drag) {
      if (down.from < 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) return;
      const el = pcEls.get(down.from); if (!el) return;
      if (!sel || sel.from !== down.from) sel = { from: down.from, steps: [] };
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
    captured: "Alle Steine geschlagen.", blocked: "Kein Zug mehr möglich.", giveup: "Aufgabe.",
    repetition: "Dreimal dieselbe Stellung.", quiet: `${G.QUIET_PLIES} Züge ohne Schlag oder Steinzug.`
  };

  function renderGame() {
    if (V.phase !== "roundEnd") peek = false;
    $("#plates").innerHTML = V.players.map((_, i) => plateHTML(i)).join("");
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> · ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}`;
    renderBoard();
    layoutBoard();

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
    renderClock();

    // turn change feedback
    const key = `${V.round}:${V.turn}:${V.cur}`;
    Spieleabend.mine(play && (mode === "online" || V.players.some((p) => p.bot)));
    if (play && lastTurn !== key && lastTurn !== null && (mode === "online" || V.players.some((p) => p.bot))) { buzz([40, 60, 40]); sfx("turn"); }
    lastTurn = key;

    // the result sheet waits until the last move has been shown
    $("#roundEnd").hidden = V.phase !== "roundEnd" || peek || animating || animQ.length > 0;
    if (V.phase === "roundEnd") {
      if (!peek && !animating && !animQ.length) renderRoundEnd();
      const k = `${V.rid}:${V.round}:${V.last.winners.join(",")}`;
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
    const h = a.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - $("#lastMove").offsetHeight - 14;
    boardEl.style.setProperty("--cell", Math.max(22, Math.floor(Math.min(w, h) / 8.7)) + "px");
  }
  if (window.ResizeObserver) new ResizeObserver(layoutBoard).observe($("#arena")); else addEventListener("resize", layoutBoard);

  $("#hintBtn").addEventListener("click", () => {
    if (!canPlay()) return;
    const a = G.suggest(V, V.cur);
    if (!a) return;
    tip = { key: `${V.round}:${V.turn}`, path: a.path };
    toast(`Tipp: ${G.sq(a.path[0])} nach ${G.sq(a.path[a.path.length - 1])}.`);
    paintSel();
  });
  $("#undoBtn").addEventListener("click", () => { if (canPlay() && V.canUndo) doAct({ t: "undo" }); });
  $("#resultBtn").addEventListener("click", () => { peek = false; render(); });

  // keys: Esc closes or drops the pick, T gives a tip, Z takes the move back
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") { if (open) $(open).hidden = true; else if (sel && !drag) { sel = null; paintSel(); } return; }
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
    $("#reText").textContent = `${RESULT_WHY[last.why] || ""} Nach ${last.moves} Zügen.` +
      (last.over ? "" : ` Gespielt wird bis ${V.goal} Siege, als Nächstes beginnt ${V.players[V.nextStarter].name}.`);
    scoreList($("#reScores"), last.winners);
    UI.roundEndFooter({ over: last.over, next: "Nächste Runde" });
  }

  // Statistik lebt im Profil (shared/profile.js, gilt für alle Spiele)
  const profile = Spieleabend.profile;
  function record(key) {
    const i = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
    if (i < 0) return;
    profile.result("dame", key, { won: V.last.winners.includes(i), draw: !V.last.winners.length, online: mode === "online" });
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
      error(m) { inflight = false; manualMove = null; if (V && !animating) paintSel(); },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text, name) => bubble(pi, text, name),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    memberExtra: (m, i) => `<i class="dot p${i}" title="${G.COLORS[i]}"></i>`,
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
          UI.armed("Runde neu starten", () => { L.round--; L.starter = (L.starter + 1) % 2; G.startRound(L); peek = false; sel = null; animQ.length = 0; store.set(K.local, L); render(); scheduleBot(); }),
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearTimeout(clockT); render(); })
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
    L = state; mode = "local"; peek = false; sel = null; tip = null; animQ.length = 0;
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
  UI.detectServer("/dame-server", "dame").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
