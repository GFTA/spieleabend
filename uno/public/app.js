// Pass-Uno UI: local pass-and-play and online rooms share one table renderer.
(() => {
  "use strict";
  const G = window.UnoGame;
  // An old cached game.js next to a new app.js: reload once without cache instead of breaking.
  if (!G || !G.RULES || !G.normRules) {
    let tried = false;
    try { tried = sessionStorage.getItem("passuno.reloaded") === "1"; sessionStorage.setItem("passuno.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("passuno.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const CVAR = { r: "var(--red)", y: "var(--yellow)", g: "var(--green)", b: "var(--blue)" };
  const ORDER = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "rev", "d2", "wild", "d4"];
  const ICON = {
    skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M6.6 17.4 17.4 6.6"/></svg>',
    rev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h14l-4-4"/><path d="M20 15H6l4 4"/></svg>',
    wildMini: '<svg viewBox="0 0 24 24"><path d="M12 12V3a9 9 0 0 1 9 9z" fill="#e0393e"/><path d="M12 12h9a9 9 0 0 1-9 9z" fill="#2d6fd6"/><path d="M12 12v9a9 9 0 0 1-9-9z" fill="#f2c230"/><path d="M12 12H3a9 9 0 0 1 9-9z" fill="#2fa35b"/></svg>'
  };
  const K = { local: "passuno.v2", online: "passuno.online", me: "passuno.me" };
  const store = Spieleabend.store;

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let hidden = false;     // local: hand-off screen is up
  let R = null;           // last online room message
  let watching = false; // in the waiting room, but watching the game that runs
  let V = null;           // view currently on screen
  let sel = null;         // selected card id (tap fallback)
  let pendingWild = null;
  let server = null;      // server info once found ({} when only the WebSocket answered)
  let serverState = "checking"; // "checking" | "ok" | "none"
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "passuno.opp", max: 10, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let goalLocal = 500, goalOnline = 500;
  let localLevel = G.BOT_LEVELS[store.get("passuno.level")] ? store.get("passuno.level") : "normal";
  let myAvatar = Spieleabend.identity({ me: K.me, avatar: "passuno.avatar", avatars: G.AVATARS });
  const nextAvatar = (a) => G.AVATARS[(G.AVATARS.indexOf(a) + 1) % G.AVATARS.length];
  let lastTurn = null;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const myTurn = () => !!V && (V.phase === "play" || V.phase === "drawn") && V.cur === V.me;
  const stackOk = (c) => !V.pending || (V.top.v === "d2" ? c.v === "d2" || c.v === "d4" : c.v === "d4");
  const fits = (c) => stackOk(c) && (c.c === "w" || c.c === V.color || c.v === V.top.v);
  const rules = () => (V && V.rules) || {};
  // jump-in: the exact same card as the top one may be thrown in out of turn (online only)
  const jumpable = (c) => mode === "online" && !myTurn() && rules().jumpIn && (V.phase === "play" || V.phase === "drawn") &&
    !V.pending && c.c !== "w" && c.c === V.top.c && c.v === V.top.v;
  const playable = (c) => myTurn() ? (V.phase === "drawn" ? c.id === V.drawnId && fits(c) : fits(c)) : jumpable(c);
  const pname = (i) => (i === V.me && mode === "online" ? "du" : V.players[i].name);
  function whyNot(c) {
    if (!myTurn()) return rules().jumpIn && mode === "online"
      ? `${V.players[V.cur].name} ist dran. Reinwerfen geht nur mit genau derselben Karte.`
      : `Warte, ${V.players[V.cur].name} ist dran.`;
    if (V.phase === "drawn" && c.id !== V.drawnId) return "Nach dem Ziehen darfst du nur die gezogene Karte legen.";
    if (V.pending) return `Leg eine ${V.top.v === "d2" ? "+2 oder +4" : "+4"} drauf oder zieh ${V.pending} Karten vom Stapel.`;
    return `Passt nicht. Gesucht: ${G.CNAME[V.color]} oder ${V.top.c === "w" ? "eine Farbwahl-Karte" : G.VNAME[V.top.v] || V.top.v}.`;
  }
  let sortMode = store.get("passuno.sort") === "value" ? "value" : "color";
  const byColor = (a, b) => "rygbw".indexOf(a.c) - "rygbw".indexOf(b.c);
  const byValue = (a, b) => ORDER.indexOf(a.v) - ORDER.indexOf(b.v);
  const sortHand = (h) => [...h].sort((a, b) =>
    (sortMode === "value" ? byValue(a, b) || byColor(a, b) : byColor(a, b) || byValue(a, b)) || a.id - b.id);

  function cardHTML(c, extra = "", tag = "span") {
    let mid, corner;
    if (G.isNum(c)) { const u = c.v === "6" || c.v === "9" ? ' class="u"' : ""; mid = `<span${u}>${c.v}</span>`; corner = mid; }
    else if (c.v === "skip" || c.v === "rev") { mid = ICON[c.v]; corner = ICON[c.v]; }
    else if (c.v === "d2") { mid = corner = "+2"; }
    else if (c.v === "d4") { mid = corner = "+4"; }
    else { mid = ""; corner = ICON.wildMini; }
    const attrs = tag === "button" ? ` type="button" aria-label="${G.cardName(c)}"` : ` role="img" aria-label="${G.cardName(c)}"`;
    return `<${tag} class="card c-${c.c} ${extra}" data-id="${c.id}"${attrs}>` +
      `<span class="corner tl">${corner}</span><span class="oval"><span class="mid">${mid}</span></span><span class="corner br">${corner}</span></${tag}>`;
  }

  const { toast, confetti, showBubble } = Spieleabend;
  function flashUno(who) {
    const f = $("#unoFlash"); $("#unoWho").textContent = who || "";
    f.hidden = false;
    const s = f.firstElementChild; s.style.animation = "none"; void s.offsetWidth; s.style.animation = "";
    clearTimeout(flashUno.t); flashUno.t = setTimeout(() => { f.hidden = true; }, 800);
  }
  function shake(id) {
    const el = document.querySelector(`#hand [data-id="${id}"]`);
    if (el) { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }
  }
  const { sfx, buzz, wake } = Spieleabend.sound({
    key: "passuno.sound",
    effects: ({ tone }) => ({
      card: () => { tone(520, 0, 0.07, "triangle", 0.2); tone(340, 0.03, 0.08, "triangle", 0.12); },
      draw: () => tone(260, 0, 0.1, "triangle", 0.14),
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      uno: () => { tone(523, 0, 0.1, "square", 0.08); tone(659, 0.09, 0.1, "square", 0.08); tone(784, 0.18, 0.22, "square", 0.08); },
      alarm: () => { tone(880, 0, 0.08, "square", 0.07); tone(880, 0.16, 0.08, "square", 0.07); },
      bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16)),
      pop: () => tone(740, 0, 0.06, "sine", 0.12)
    })
  });

  // ---------- actions ----------
  // messages for rule events; `me` is the viewer online, -1 on a shared phone
  function ruleEvent(ev, players, me) {
    const who = (i) => (i === me ? "Du" : players[i].name);
    if (ev.t === "took") toast(ev.pi === me ? `+${ev.n} Karten für dich.` : `${who(ev.pi)} zieht ${ev.n} Karten.`);
    if (ev.t === "swap") toast(`${who(ev.pi)} tauscht die Hand mit ${ev.with === me ? "dir" : players[ev.with].name}!`);
    if (ev.t === "rotate") toast("Alle Hände wandern eins weiter!");
    if (ev.t === "jump") { toast(`${who(ev.pi)} wirft rein!`); sfx("uno"); }
    if (ev.t === "timeout") toast(ev.pi === me ? "Zeit abgelaufen: du hast eine Karte gezogen." : `${players[ev.pi].name}: Zeit abgelaufen.`);
    if (ev.t === "surrender") toast(ev.pi === me ? "Du hast diese Runde aufgegeben." : `${players[ev.pi].name} gibt diese Runde auf.`);
  }
  function localEvents(events, turnBefore) {
    for (const ev of events || []) {
      if (ev.t === "played") { sfx("card"); playFrom = ev.pi; }
      if (ev.t === "drew" || ev.t === "took") sfx("draw");
      ruleEvent(ev, L.players, -1);
      if (ev.t === "uno") { flashUno(L.players[ev.pi].name); sfx("uno"); }
      if (ev.t === "penalty") { toast(`${L.players[ev.pi].name} war zu langsam: 2 Strafkarten!`); sfx("bad"); }
      if (ev.t === "drew" && L.turn !== turnBefore && !isBot(ev.pi)) {
        const c = L.players[ev.pi].hand.find((x) => x.id === ev.id);
        if (c) toast(`Gezogen: ${G.cardName(c)}. Passt nicht, dein Zug ist vorbei.`);
      }
    }
  }
  // local mode keeps its own clock for the UNO window
  let localUnoT = null;
  function scheduleLocalUno() {
    clearTimeout(localUnoT);
    if (mode !== "local" || !L) return;
    const ms = G.nextDeadline(L);
    if (ms < 0) return;
    localUnoT = setTimeout(() => {
      if (mode !== "local" || !L) return;
      const snap = snapshot(), ev = G.tick(L);
      localEvents(ev); trackIncoming(snap, ev);
      store.set(K.local, L); render(); seatFlights(ev); scheduleLocalUno();
    }, ms + 30);
  }

  // Shared phone: remember which new cards each player got (drawn, +2/+4, penalties),
  // so they fly in from the pile when that player looks at the hand next.
  const incoming = {};
  const snapshot = () => L.players.map((p) => new Set(p.hand.map((c) => c.id)));
  function trackIncoming(before, events) {
    if ((events || []).some((e) => e.t === "swap" || e.t === "rotate")) return;
    L.players.forEach((p, i) => {
      const fresh = p.hand.filter((c) => !before[i].has(c.id)).map((c) => c.id);
      if (fresh.length) incoming[i] = (incoming[i] || []).concat(fresh);
    });
  }
  let hold = null, holdT = null; // keep showing the drawer's hand while their card flies in
  // With computer players on a shared phone, the hand on screen belongs to the last human
  // who looked; bots play without a hand-off, and two humans in a row still get one.
  let viewer = null;
  const isBot = (i) => !!(L && L.players[i] && L.players[i].bot);
  const firstHuman = () => L.players.findIndex((p) => !p.bot);
  function localViewer() {
    if (hold != null) return hold;
    if (!isBot(L.cur)) return L.cur;
    return viewer != null && !isBot(viewer) ? viewer : firstHuman();
  }
  function afterTurnChange() {
    if (isBot(L.cur)) hidden = false;
    else hidden = L.cur !== viewer;
  }
  let localBotT = null, localBotKey = null, localUnoDecided = null;
  const localForgot = new Set();
  function scheduleLocalBot() {
    if (mode !== "local" || !L || (L.phase !== "play" && L.phase !== "drawn")) { clearTimeout(localBotT); localBotKey = null; return; }
    let w = (L.unoWaits || []).find((x) => isBot(x.pi) && !localForgot.has(`${x.pi}:${x.until}`));
    if (w && `${w.pi}:${w.until}` !== localUnoDecided) {
      localUnoDecided = `${w.pi}:${w.until}`;
      // weaker computers sometimes forget UNO and take the penalty
      if (Math.random() > G.BOT_UNO[localLevel]) { localForgot.add(localUnoDecided); w = null; }
    }
    const pi = w ? w.pi : isBot(L.cur) ? L.cur : -1;
    const key = pi < 0 ? null : `${L.round}:${L.turn}:${L.phase}:${pi}:${!!w}`;
    if (key === localBotKey) return;
    clearTimeout(localBotT); localBotKey = key;
    if (pi < 0) return;
    localBotT = setTimeout(() => {
      localBotKey = null;
      if (mode !== "local" || !L) return;
      const a = G.suggest(G.view(L, pi), localLevel);
      if (a && !doAct(a, pi) && a.t === "play") doAct({ t: L.phase === "drawn" ? "keep" : "draw" }, pi);
    }, (w ? 500 : 900) + Math.random() * 700);
  }
  function doAct(a, actor) {
    if (mode === "local") {
      const before = L.turn, who = actor == null ? L.cur : actor, snap = snapshot();
      const res = G.act(L, who, a);
      localEvents(res.events, before);
      trackIncoming(snap, res.events);
      if (!res.ok) { if (!isBot(who)) toast(res.error); store.set(K.local, L); render(); return false; }
      sel = null;
      if (L.phase !== "roundEnd" && L.turn !== before) {
        afterTurnChange();
        // drew a card that does not fit: let them watch it arrive before passing the phone
        if (hidden && (res.events || []).some((e) => e.t === "drew" && e.pi === who) && incoming[who]) {
          hold = who; clearTimeout(holdT);
          holdT = setTimeout(() => { hold = null; render(); }, 450 + 110 * (incoming[who].length - 1) + 700);
        }
      }
      store.set(K.local, L);
      render();
      seatFlights(res.events);
      scheduleLocalUno();
      return true;
    }
    if (mode === "online") {
      if (!wsSend({ t: "act", a })) { toast("Keine Verbindung zum Server."); return false; }
      sel = null;
      return true;
    }
    return false;
  }

  function tryPlay(id) {
    const c = V.hand.find((x) => x.id === id);
    if (!c) return false;
    if (!playable(c)) { shake(id); toast(whyNot(c)); return false; }
    if (c.c === "w") { pendingWild = id; $("#picker").hidden = false; return true; }
    if (c.v === "7" && rules().sevenZero && V.hand.length > 1) { openSwap(id); return true; }
    return doAct({ t: "play", id });
  }
  let pendingSwap = null;
  function openSwap(id) {
    pendingSwap = id;
    $("#swapList").innerHTML = V.players.map((p, i) => i === V.me ? "" :
      `<button type="button" data-target="${i}"><span>${esc(p.name)}</span><b>${p.count} Karten</b></button>`).join("");
    $("#swapPicker").hidden = false;
  }
  $("#swapList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-target]"); if (!b) return;
    $("#swapPicker").hidden = true;
    const id = pendingSwap; pendingSwap = null;
    if (id != null) doAct({ t: "play", id, target: +b.dataset.target });
  });
  $("#swapCancel").addEventListener("click", () => { $("#swapPicker").hidden = true; pendingSwap = null; });
  function tryDraw() {
    if (!myTurn()) { toast(V ? `Warte, ${V.players[V.cur].name} ist dran.` : ""); return; }
    if (V.phase !== "play") { toast("Du hast schon gezogen. Leg die Karte oder tippe „Behalten“."); return; }
    doAct({ t: "draw" });
  }
  // first tap lifts the card, a second tap on it plays it
  let tipShown = false;
  function tapCard(id) {
    const c = V.hand.find((x) => x.id === id); if (!c) return;
    if (!playable(c)) { shake(id); toast(whyNot(c)); return; }
    if (sel === id) { sel = null; tryPlay(id); return; }
    sel = id; renderGame();
    if (!tipShown) { tipShown = true; toast("Nochmal antippen zum Legen, oder auf den Stapel ziehen."); }
  }

  // ---------- drag and drop ----------
  let drag = null, renderPending = false;
  function dropZone(kind, y) {
    const dock = $("#dock").getBoundingClientRect();
    if (kind === "card") return y < dock.top - 10;
    return y > dock.top - 30;
  }
  // iOS Safari sends pointermove/up to the element the finger went down on, even if a
  // re-render removed it from the page; then nothing reaches window. So we listen on
  // that element too, never re-render during a drag, and drop a stale drag on the next touch.
  const seen = new WeakSet();
  const once = (e) => { if (seen.has(e)) return false; seen.add(e); return true; };
  function onElMove(e) { if (once(e)) onMove(e); }
  function onElUp(e) { if (once(e)) endDrag(e, false); }
  function onElCancel(e) { if (once(e)) endDrag(e, true); }
  function abortDrag() {
    if (!drag) return;
    const d = drag; drag = null;
    finishDrag(d);
  }
  function finishDrag(d) {
    d.src.removeEventListener("pointermove", onElMove);
    d.src.removeEventListener("pointerup", onElUp);
    d.src.removeEventListener("pointercancel", onElCancel);
    if (d.ghost) d.ghost.remove();
    $("#discard").classList.remove("drop"); $("#dock").classList.remove("drop"); $("#drawPile").classList.remove("dragging");
    const el = d.kind === "card" && document.querySelector(`#hand [data-id="${d.id}"]`);
    if (el) el.classList.remove("lifted");
    if (renderPending) { renderPending = false; render(); }
  }
  function onDown(e) {
    if (e.button > 0) return;
    if (drag) abortDrag();
    const cardEl = e.target.closest("#hand .card[data-id]");
    const deckEl = e.target.closest("#drawPile");
    if (cardEl) drag = { kind: "card", id: +cardEl.dataset.id, el: cardEl, src: cardEl };
    else if (deckEl) drag = { kind: "deck", el: deckEl.querySelector(".card:last-child"), src: deckEl };
    else return;
    Object.assign(drag, { pid: e.pointerId, x0: e.clientX, y0: e.clientY, t0: Date.now(), active: false });
    drag.src.addEventListener("pointermove", onElMove);
    drag.src.addEventListener("pointerup", onElUp);
    drag.src.addEventListener("pointercancel", onElCancel);
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < 14) return; // fingers wobble; small moves are still a tap
      if (drag.kind === "card" && Math.abs(dy) < Math.abs(dx) * 0.8) { abortDrag(); return; } // sideways: scroll the hand
      if (drag.kind === "deck" && !myTurn()) { toast(`Warte, ${V.players[V.cur].name} ist dran.`); abortDrag(); return; }
      if (drag.kind === "deck" && V.phase !== "play") { toast("Du hast schon gezogen."); abortDrag(); return; }
      if (drag.kind === "card") {
        const c = V.hand.find((x) => x.id === drag.id);
        if (!c || !playable(c)) { const id = drag.id; abortDrag(); shake(id); toast(c ? whyNot(c) : ""); return; }
      }
      const r = drag.el.getBoundingClientRect();
      const g = drag.el.cloneNode(true);
      g.classList.remove("sel", "fresh", "no", "shake");
      g.classList.add("ghost");
      g.style.width = r.width + "px";
      g.style.setProperty("--cw", r.width + "px");
      document.body.appendChild(g);
      drag.ghost = g; drag.ox = drag.x0 - r.left; drag.oy = drag.y0 - r.top;
      drag.active = true;
      if (drag.kind === "card") drag.el.classList.add("lifted"); else $("#drawPile").classList.add("dragging");
      buzz(10);
    }
    e.preventDefault();
    const x = e.clientX - drag.ox, y = e.clientY - drag.oy;
    drag.ghost.style.transform = `translate(${x}px,${y}px) rotate(${Math.max(-12, Math.min(12, dx / 12))}deg) scale(1.06)`;
    const over = dropZone(drag.kind, e.clientY);
    $("#discard").classList.toggle("drop", drag.kind === "card" && over);
    $("#dock").classList.toggle("drop", drag.kind === "deck" && over);
  }
  function endDrag(e, cancelled) {
    if (!drag || (e && e.pointerId !== drag.pid)) return;
    const d = drag; drag = null;
    finishDrag(d);
    if (cancelled) return;
    const tap = !d.active || (!dropZone(d.kind, e.clientY) && Date.now() - d.t0 < 350 && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 30);
    if (tap) { if (d.kind === "card") tapCard(d.id); else tryDraw(); return; }
    if (!dropZone(d.kind, e.clientY)) return;
    if (d.kind === "card") tryPlay(d.id); else tryDraw();
  }
  document.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", (e) => { if (once(e)) onMove(e); }, { passive: false });
  window.addEventListener("pointerup", (e) => { if (once(e)) endDrag(e, false); });
  window.addEventListener("pointercancel", (e) => { if (once(e)) endDrag(e, true); });
  window.addEventListener("blur", abortDrag);
  // desktop: the mouse wheel scrolls the hand sideways
  $("#hand").addEventListener("wheel", (e) => {
    const h = $("#hand");
    if (h.scrollWidth <= h.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    h.scrollLeft += e.deltaY; e.preventDefault();
  }, { passive: false });
  // desktop: D draws, U calls UNO, Esc closes whatever is open
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    const open = ["#picker", "#swapPicker", "#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") {
      if (open) { $(open).hidden = true; pendingWild = null; pendingSwap = null; }
      else if (sel != null) { sel = null; renderGame(); }
      return;
    }
    if (open || $("#game").hidden) return;
    const k = e.key.toLowerCase();
    if (k === "u" && !$("#unoCall").hidden) { $("#unoBig").click(); e.preventDefault(); }
    else if (k === "d" && $("#handoff").hidden) { tryDraw(); e.preventDefault(); }
    else if (k === "h") showHint();
    else if (k === "s") toggleSort();
  });
  // keyboard users: Enter/Space on a card or the pile
  $("#hand").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b && e.detail === 0) tapCard(+b.dataset.id); });
  $("#drawPile").addEventListener("click", (e) => { if (e.detail === 0) tryDraw(); });
  document.addEventListener("contextmenu", (e) => { if (e.target.closest(".card")) e.preventDefault(); });

  // ---------- rendering ----------
  function showScreen(id) {
    for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id;
  }

  function render() {
    renderUnoCall();
    if (drag) { renderPending = true; return; }
    if (mode === "local" && L) {
      V = G.view(L, localViewer());
      showScreen("game");
      renderGame();
      $("#handoff").hidden = !(hidden && hold == null && !isBot(L.cur) && L.phase !== "roundEnd");
      if (!$("#handoff").hidden) renderHandoff();
      scheduleLocalBot();
    } else if (mode === "online" && R) {
      $("#handoff").hidden = true;
      const meM = R.members[R.you], waiting = !!(R.view && meM && meM.lobby);
      if (!waiting) watching = false;
      if (!R.view || (waiting && !watching)) { V = null; showScreen("lobby"); UI.renderLobby(); $("#roundEnd").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else {
      V = null;
      $("#handoff").hidden = true; $("#roundEnd").hidden = true;
      showScreen("home"); renderHome();
    }
    UI.update();
  }

  // where the opponents sit, in seating order starting with the player after me
  const SEATS = {
    1: ["t"], 2: ["l", "r"], 3: ["l", "t", "r"], 4: ["l", "tl", "tr", "r"], 5: ["l", "tl", "t", "tr", "r"],
    6: ["bl", "l", "tl", "tr", "r", "br"], 7: ["bl", "l", "tl", "t", "tr", "r", "br"],
    8: ["bl", "l", "tl", "t", "t", "tr", "r", "br"], 9: ["bl", "l", "tl", "t", "t", "t", "tr", "r", "br"],
    10: ["bl", "l", "tl", "t", "t", "t", "tr", "r", "br", "br"]
  };
  function renderSeats() {
    const n = V.players.length, members = mode === "online" && R ? R.members : null;
    // a spectator has no seat of their own: everybody sits around the table, starting with player 1
    const first = V.me >= 0 ? 1 : 0, from = V.me >= 0 ? V.me : 0;
    const slots = SEATS[n - first] || [], perSlot = {};
    slots.forEach((sl) => { perSlot[sl] = (perSlot[sl] || 0) + 1; });
    const tbl = $("#table"), W = tbl.clientWidth || innerWidth, H = tbl.clientHeight || innerHeight / 2;
    const big = matchMedia("(min-width: 900px) and (min-height: 700px)").matches;
    const cardLen = big ? 24 : 18, maxStep = big ? 20 : 13;
    const html = { tl: "", t: "", tr: "", l: "", r: "", bl: "", br: "" };
    for (let k = first; k < n; k++) {
      const i = (from + k) % n, p = V.players[i], slot = slots[k - first];
      const vertical = slot === "l" || slot === "r";
      // room for the fan: cards stay countable, they just overlap more when there are many
      const room = Math.max(40, vertical ? Math.min(big ? 260 : 190, H * 0.42)
        : slot === "t" ? Math.min(big ? 300 : 230, (W * 0.5) / perSlot.t - 14)
        : Math.min(big ? 220 : 160, W * 0.22 - 14));
      const cnt = p.count;
      const step = cnt > 1 ? Math.max(2.5, Math.min(maxStep, (room - cardLen) / (cnt - 1))) : 0;
      const away = members && !members[i].online;
      const cls = ["seat", vertical ? "v" : "h", i === V.cur && V.phase !== "roundEnd" ? "active" : "", away || p.out ? "away" : ""].join(" ");
      const badge = p.out ? '<span class="ouno out">RAUS</span>'
        : (V.unoWaits || []).some((w) => w.pi === i) ? '<span class="ouno wait">UNO?</span>'
        : p.count === 1 ? '<span class="ouno">UNO</span>' : "";
      html[slot] += `<div class="${cls}" data-seat="${i}" title="${esc(p.name)}: ${cnt} Karten${away ? " (offline)" : ""}" ` +
        `style="--step:${step.toFixed(1)}px;--lw:${vertical ? (big ? 110 : 76) : Math.round(room)}px">${badge}` +
        `<div class="sfan">${"<i></i>".repeat(Math.min(cnt, 60))}</div>` +
        `<div class="slabel"><span class="sname">${p.avatar || (p.bot ? "🤖" : "")} ${esc(p.name)}</span><span class="scount">${cnt}</span></div></div>`;
    }
    for (const sl of Object.keys(html)) { const el = tbl.querySelector(".s-" + sl); if (el.innerHTML !== html[sl]) el.innerHTML = html[sl]; }
  }

  function renderGame() {
    renderSeats();
    const meP = V.players[V.me];
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b>${V.goal ? ` · bis ${V.goal}` : ""}${meP ? ` · ${mode === "online" ? "du" : esc(meP.name)}: <b>${meP.score}</b> Pkt.` : ""}`;

    // table
    const disc = $("#discard");
    if (disc.dataset.top !== String(V.top.id)) {
      disc.innerHTML = cardHTML(V.top); disc.dataset.top = V.top.id;
      if (playFrom != null && playFrom !== V.me) flyFromSeat(playFrom, disc.firstElementChild);
    }
    playFrom = null;
    disc.style.setProperty("--ring", CVAR[V.color]);
    $("#colorTag").style.setProperty("--ring", CVAR[V.color]);
    $("#colorName").textContent = `Farbe: ${G.CNAME[V.color]}`;
    $("#deckCount").textContent = `${V.deckCount} Karten`;
    $("#dir").classList.toggle("ccw", V.dir < 0);
    $("#dirText").textContent = `Danach: ${pname(V.next)}`;
    $("#drawPile").classList.toggle("can", myTurn() && V.phase === "play");

    // dock
    const mine = myTurn();
    $("#dock").classList.toggle("myturn", mine);
    const drawn = V.drawnId != null ? V.hand.find((c) => c.id === V.drawnId) : null;
    let who, hint;
    if (V.phase === "roundEnd") { who = "Runde vorbei"; hint = ""; }
    else if (mode === "online" && V.me < 0) { who = `${V.players[V.cur].name} ist dran`; hint = "Du schaust zu."; }
    else if (V.players[V.me] && V.players[V.me].out) { who = "Du hast aufgegeben"; hint = "Nächste Runde bist du wieder dabei."; }
    else if (mine) {
      who = mode === "local" ? `${V.players[V.me].name}, du bist dran` : "Du bist dran";
      if (V.pending) hint = V.hand.some(fits)
        ? `Stapeln: leg eine ${V.top.v === "d2" ? "+2 oder +4" : "+4"} drauf, oder zieh ${V.pending} Karten vom Stapel.`
        : `Du musst ${V.pending} Karten ziehen: zieh vom Stapel zu dir.`;
      else if (V.phase === "drawn" && drawn) hint = `Gezogen: ${G.cardName(drawn)}. Leg sie auf den Stapel oder behalte sie.`;
      else hint = V.hand.some(fits) ? "Zieh eine helle Karte auf den Ablagestapel." : "Nichts passt. Zieh eine Karte vom Stapel zu dir.";
    } else {
      who = `${V.players[V.cur].name} ist dran`;
      hint = V.pending && V.cur !== V.me ? `${V.players[V.cur].name} muss ${V.pending} Karten ziehen${rules().stack ? " oder stapeln" : ""}.` : "Warte auf deinen Zug.";
    }
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    $("#keepBtn").hidden = !(mine && V.phase === "drawn");
    $("#hintBtn").hidden = !mine;
    $("#sortBtn").hidden = mode === "online" && V.me < 0;
    $("#sortBtn").textContent = sortMode === "value" ? "⇅ Zahl" : "⇅ Farbe";
    renderClock();
    $("#chaosTag").hidden = !rules().chaos;
    $("#pendingTag").hidden = !V.pending;
    $("#pendingTag").textContent = `+${V.pending} offen`;
    const lm = $("#lastMove"), lines = V.log.slice(-2), lmKey = lines.join("\n");
    if (lm.dataset.k !== lmKey) {
      lm.dataset.k = lmKey;
      lm.innerHTML = lines.map((l, i) => `<div${i < lines.length - 1 ? ' class="old"' : ""}>${esc(l)}</div>`).join("");
      lm.classList.remove("fresh"); void lm.offsetWidth; lm.classList.add("fresh");
    }
    $("#reactBtn").hidden = mode !== "online";

    // hand
    if (sel != null && !V.hand.some((c) => c.id === sel && playable(c))) sel = null;
    const hand = $("#hand");
    hand.innerHTML = sortHand(V.hand).map((c) => {
      const ok = playable(c);
      const cls = [mine && !ok ? "no" : "", mine && ok ? "ok" : "", !mine && ok ? "jump" : "", c.id === sel ? "sel" : "", c.id === V.drawnId ? "fresh" : ""].join(" ");
      return cardHTML(c, cls, "button");
    }).join("");
    layoutHand();

    // cards that just came from the pile fly in from it
    const ids = new Set(V.hand.map((c) => c.id));
    if (mode === "local") {
      if ((!hidden || hold === V.me) && incoming[V.me]) {
        flyIn(incoming[V.me].filter((id) => ids.has(id)));
        delete incoming[V.me];
      }
    } else if (prevHand && prevHand.me === V.me && prevHand.round === V.round && drawFx) {
      flyIn(V.hand.filter((c) => !prevHand.ids.has(c.id)).map((c) => c.id));
    }
    drawFx = false;
    prevHand = { me: V.me, round: V.round, ids };

    // turn change feedback
    const key = `${V.round}:${V.turn}`;
    if (mode === "online" && mine && lastTurn !== key && lastTurn !== null) { buzz([40, 60, 40]); sfx("turn"); }
    lastTurn = key;

    if (V.phase !== "roundEnd") reHidden = false;
    $("#roundEnd").hidden = V.phase !== "roundEnd" || reHidden;
    $("#reShow").hidden = !(V.phase === "roundEnd" && reHidden);
    if (V.phase === "roundEnd") {
      renderRoundEnd();
      const k = `${V.round}:${V.last.winner}:${V.players[V.last.winner].score}`;
      if (confettiFor !== k) { confettiFor = k; confetti(); sfx("win"); }
    }
  }

  // ---------- house rules ----------
  let localRules = G.normRules(store.get("passuno.rules") || {});
  const activeNames = (r) => G.RULES.filter((x) => r && r[x.k]).map((x) => x.name);
  function rulesHTML(r, editable, local) {
    return G.RULES.filter((x) => !(local && x.onlineOnly)).map((x) =>
      `<label class="toggle" for="rule-${local ? "l" : "o"}-${x.k}"><input type="checkbox" id="rule-${local ? "l" : "o"}-${x.k}" data-rule="${x.k}"` +
      `${r[x.k] ? " checked" : ""}${editable ? "" : " disabled"}><span>${x.name}<small>${x.desc}</small></span></label>`).join("");
  }
  function renderLocalRules() {
    const box = $("#rulesLocal");
    if (!box.firstChild) box.innerHTML = rulesHTML(localRules, true, true);
    const on = activeNames(localRules).filter((n) => n !== "Reinwerfen");
    $("#rulesLocalSum").textContent = on.length ? on.join(", ") : "keine";
  }
  $("#rulesLocal").addEventListener("change", (e) => {
    const k = e.target.dataset.rule; if (!k) return;
    localRules[k] = e.target.checked; store.set("passuno.rules", localRules); renderLocalRules();
  });
  $("#rulesLobby").addEventListener("change", (e) => {
    const k = e.target.dataset.rule; if (!k || !R || R.you !== R.host) return;
    const next = Object.assign({}, R.rules, { [k]: e.target.checked });
    store.set("passuno.rules", Object.assign(localRules, next));
    wsSend({ t: "rules", rules: next });
  });

  // ---------- confetti ----------
  let confettiFor = null;

  // ---------- reactions (online) ----------
  // reactions float above everything (fixed), so the top edge of the screen or a scrolling
  // player strip can't clip them; near the top they show up below the player instead
  function bubble(pi, e) {
    const host = pi === (R && R.you) ? $("#dock") : document.querySelector(`#table .seat[data-seat="${pi}"]`);
    if (!host) return;
    const b = document.createElement("span");
    b.className = e.length > 2 ? "bubble text" : "bubble"; b.textContent = e;
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

  // ---------- big UNO button ----------
  let unoKey = null, unoEnd = 0, unoTimer = null;
  function myUnoWait() {
    if (mode === "local" && L) {
      const w = (L.unoWaits || []).find((x) => !isBot(x.pi));
      const solo = L.players.filter((p) => !p.bot).length === 1;
      return w ? { pi: w.pi, ms: w.until - Date.now(), key: `${w.pi}:${w.until}`, name: solo ? "" : L.players[w.pi].name } : null;
    }
    const v = mode === "online" && R && R.view;
    if (v && v.unoWaits) {
      const w = v.unoWaits.find((x) => x.pi === v.me);
      return w ? { pi: w.pi, ms: w.ms, key: `${R.code}:${v.round}:${w.id}`, name: "" } : null;
    }
    return null;
  }
  function renderUnoCall() {
    const w = myUnoWait(), box = $("#unoCall"), big = $("#unoBig");
    if (!w || w.ms <= 0) { box.hidden = true; unoKey = null; clearInterval(unoTimer); return; }
    if (unoKey === w.key) return;
    unoKey = w.key;
    unoEnd = Date.now() + w.ms;
    big.dataset.pi = w.pi;
    $("#unoCallWho").textContent = w.name ? `${w.name}, nur noch eine Karte!` : "Nur noch eine Karte!";
    big.style.setProperty("--ms", Math.round(w.ms) + "ms");
    big.classList.remove("run"); void big.offsetWidth; big.classList.add("run");
    box.hidden = false;
    buzz([60, 40, 60]); sfx("alarm");
    const tickSec = () => {
      const left = unoEnd - Date.now();
      if (left <= 0) { clearInterval(unoTimer); box.hidden = true; return; }
      $("#unoSec").textContent = (left / 1000).toFixed(1).replace(".", ",") + " s";
    };
    clearInterval(unoTimer); unoTimer = setInterval(tickSec, 100); tickSec();
  }
  $("#unoBig").addEventListener("click", () => {
    const pi = +$("#unoBig").dataset.pi;
    $("#unoCall").hidden = true; clearInterval(unoTimer);
    if (mode === "local") doAct({ t: "uno" }, pi);
    else if (!wsSend({ t: "act", a: { t: "uno" } })) toast("Keine Verbindung zum Server.");
  });

  // turn clock (house rule, online): a bar that runs down for whoever is on turn
  let clockKey = null;
  function renderClock() {
    const bar = $("#turnBar"), left = mode === "online" && R ? R.turnLeft : 0;
    if (!left || !V || (V.phase !== "play" && V.phase !== "drawn")) { bar.hidden = true; clockKey = null; return; }
    const key = `${V.round}:${V.turn}`;
    if (clockKey === key) return;
    clockKey = key; bar.hidden = false;
    const i = bar.firstElementChild, total = G.TURN_MS;
    bar.classList.remove("low");
    i.getAnimations().forEach((a) => a.cancel());
    i.animate([{ transform: `scaleX(${left / total})` }, { transform: "scaleX(0)" }], { duration: left, easing: "linear", fill: "forwards" });
    clearTimeout(renderClock.t);
    renderClock.t = setTimeout(() => { if (clockKey === key) { bar.classList.add("low"); if (myTurn()) { toast("Noch 10 Sekunden!"); buzz(80); } } }, Math.max(0, left - 10000));
  }

  let prevHand = null, drawFx = false, playFrom = null, reHidden = false;
  // the result sheet can be moved aside to look at the table and the last card
  $("#reLook").addEventListener("click", () => { reHidden = true; render(); });
  $("#reShow").addEventListener("click", () => { reHidden = false; render(); });
  // someone else draws: card backs travel from the pile to their seat
  function flyToSeat(pi, n) {
    const seat = document.querySelector(`#table .seat[data-seat="${pi}"] .sfan`), deck = $("#drawPile .card:last-child");
    if (!seat || !deck || !deck.offsetWidth || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const d = deck.getBoundingClientRect(), s = seat.getBoundingClientRect(), sc = 0.4;
    const dx = s.left + s.width / 2 - d.left - (d.width * sc) / 2, dy = s.top + s.height / 2 - d.top - (d.height * sc) / 2;
    for (let k = 0; k < Math.min(n, 8); k++) {
      const wrap = document.createElement("div");
      wrap.className = "fly";
      wrap.style.cssText = `left:${d.left}px;top:${d.top}px;width:${d.width}px;height:${d.height}px`;
      const inner = document.createElement("div");
      inner.className = "fly-inner";
      const back = document.createElement("span");
      back.className = "card card-back";
      back.style.setProperty("--cw", d.width + "px");
      inner.append(back); wrap.append(inner); document.body.append(wrap);
      const a = wrap.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(${sc}) rotate(${k % 2 ? 12 : -12}deg)`, opacity: 0.85 }],
        { duration: 480, delay: k * 120, easing: "cubic-bezier(.3,.7,.3,1)", fill: "backwards" });
      a.onfinish = a.oncancel = () => wrap.remove();
    }
  }
  // where a player's cards are on screen: own hand at the bottom, everybody else at their seat
  function handSpot(pi) {
    const el = pi === V.me ? $("#hand") : document.querySelector(`#table .seat[data-seat="${pi}"] .sfan`);
    return el && el.getBoundingClientRect();
  }
  // 7 and 0: a bundle of card backs travels from one hand to another
  function flyHands(from, to, n, delay = 0) {
    const a = handSpot(from), b = handSpot(to);
    if (!a || !b || !a.width || !b.width || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cw = 34, ch = cw * 1.5;
    const ax = a.left + a.width / 2 - cw / 2, ay = a.top + a.height / 2 - ch / 2;
    const dx = b.left + b.width / 2 - a.left - a.width / 2, dy = b.top + b.height / 2 - a.top - a.height / 2;
    const dist = Math.hypot(dx, dy) || 1, nx = -dy / dist, ny = dx / dist, bow = Math.min(60, dist * 0.2);
    for (let k = 0; k < Math.min(n, 5); k++) {
      const wrap = document.createElement("div");
      wrap.className = "fly";
      wrap.style.cssText = `left:${ax}px;top:${ay}px;width:${cw}px;height:${ch}px`;
      const inner = document.createElement("div");
      inner.className = "fly-inner";
      const back = document.createElement("span");
      back.className = "card card-back";
      back.style.setProperty("--cw", cw + "px");
      inner.append(back); wrap.append(inner); document.body.append(wrap);
      const sw = (k - 2) * 5;
      const an = wrap.animate([
        { transform: `translate(${sw}px,0) rotate(${(k - 2) * 6}deg)`, opacity: 0 },
        { transform: `translate(${sw}px,0) rotate(${(k - 2) * 6}deg)`, opacity: 1, offset: 0.12 },
        { transform: `translate(${dx / 2 + nx * bow}px,${dy / 2 + ny * bow}px) rotate(${(k - 2) * 14}deg) scale(1.15)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx + sw}px,${dy}px) rotate(${(k - 2) * 6}deg)`, opacity: 1, offset: 0.9 },
        { transform: `translate(${dx + sw}px,${dy}px)`, opacity: 0 }
      ], { duration: 700, delay: delay + k * 70, easing: "ease-in-out", fill: "backwards" });
      an.onfinish = an.oncancel = () => wrap.remove();
    }
    if (to === V.me) {
      [...$("#hand").children].forEach((el, i) => el.animate([{ translate: "0 -18px", opacity: 0 }, { translate: "0 0", opacity: 1 }], { duration: 300, delay: delay + 480 + i * 35, fill: "backwards" }));
    }
  }
  // flights for what others just did, after the screen was redrawn (online and shared phone)
  function seatFlights(events) {
    if (!V || (mode === "local" && hidden && hold == null)) return;
    for (const ev of events || []) {
      if ((ev.t === "drew" || ev.t === "took" || ev.t === "penalty") && ev.pi !== V.me) flyToSeat(ev.pi, ev.n || (ev.t === "penalty" ? 2 : 1));
      if (ev.t === "swap") {
        flyHands(ev.pi, ev.with, V.players[ev.with].count);
        flyHands(ev.with, ev.pi, V.players[ev.pi].count, 60);
      }
      if (ev.t === "rotate") {
        const S = { players: V.players, dir: V.dir };
        V.players.forEach((p, k) => { if (!p.out) { const to = G.nextIdx(S, k); flyHands(k, to, V.players[to].count); } });
      }
    }
  }
  // someone else played: their card travels from their seat onto the pile
  function flyFromSeat(pi, el) {
    const seat = document.querySelector(`#table .seat[data-seat="${pi}"] .sfan`);
    if (!seat || !el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const s = seat.getBoundingClientRect(), d = el.getBoundingClientRect();
    el.style.animation = "none";
    el.animate([
      { transform: `translate(${s.left + s.width / 2 - d.left - d.width / 2}px,${s.top + s.height / 2 - d.top - d.height / 2}px) scale(.3) rotate(-25deg)`, opacity: 0.7 },
      { transform: "none", opacity: 1 }
    ], { duration: 430, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  function flyIn(ids) {
    if (!ids.length || ids.length > 12) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // phones with "reduce animations": no flight, just a short glow on the new cards
      ids.forEach((id) => { const el = document.querySelector(`#hand [data-id="${id}"]`); if (el) el.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 250 }); });
      return;
    }
    const deckEl = $("#drawPile .card:last-child");
    if (!deckEl || !deckEl.offsetWidth) return;
    const d = deckEl.getBoundingClientRect();
    ids.forEach((id, k) => {
      const el = document.querySelector(`#hand [data-id="${id}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const wrap = document.createElement("div");
      wrap.className = "fly";
      wrap.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
      const inner = document.createElement("div");
      inner.className = "fly-inner";
      const face = el.cloneNode(true);
      face.className = face.className.replace(/\b(no|ok|sel|fresh|jump|shake|lifted)\b/g, "");
      face.style.setProperty("--cw", r.width + "px");
      const back = document.createElement("span");
      back.className = "card card-back fly-back";
      back.style.setProperty("--cw", r.width + "px");
      inner.append(back, face); wrap.append(inner); document.body.append(wrap);
      el.style.opacity = "0"; // not visibility:hidden, so a quick tap still lands on this card
      const opts = { duration: 460, delay: k * 110, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" };
      wrap.animate([{ transform: `translate(${d.left - r.left}px,${d.top - r.top}px) scale(${d.width / r.width})` }, { transform: "none" }], opts);
      const a = inner.animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], opts);
      a.onfinish = a.oncancel = () => { wrap.remove(); el.style.opacity = ""; };
    });
  }

  function layoutHand() {
    const hand = $("#hand"), first = hand.querySelector(".card");
    if (!first) return;
    const n = V.hand.length, cw = first.offsetWidth, W = hand.clientWidth - 8;
    let step = cw + 6;
    if (n > 1 && n * cw + (n - 1) * 6 > W) step = Math.max((W - cw) / (n - 1), cw * 0.42);
    hand.style.setProperty("--step", step + "px");
    const s = hand.querySelector(".sel, .fresh");
    if (s && (s.offsetLeft < hand.scrollLeft || s.offsetLeft + cw > hand.scrollLeft + hand.clientWidth)) hand.scrollLeft = s.offsetLeft - W / 2;
  }
  window.addEventListener("resize", () => { if (V && !$("#game").hidden) { layoutHand(); renderSeats(); } });

  function renderHandoff() {
    $("#hoAvatar").textContent = V.players[V.me].avatar || "";
    $("#hoName").textContent = V.players[V.me].name;
    const others = V.players.filter((_, i) => i !== V.me).map((p) => `${p.name} ${p.count}`).join(" · ");
    $("#hoMeta").textContent = `Du hast ${V.hand.length} Karten. Die anderen: ${others}`;
    $("#hoLog").innerHTML = V.log.slice(-4).map((l) => `<li>${esc(l)}</li>`).join("");
    $("#hoBtn").textContent = `Ich bin ${V.players[V.me].name}, Karten zeigen`;
  }

  function scoreList(el, winner) {
    const ranked = V.players.map((p, i) => ({ ...p, i })).sort((a, b) => b.score - a.score);
    el.innerHTML = ranked.map((p) =>
      `<li class="${p.i === winner ? "win" : ""}"><span>${esc(p.name)}${p.i === V.me && mode === "online" ? " (du)" : ""}</span><b>${p.score} Pkt.</b></li>`).join("");
  }

  function histHTML() {
    const h = (V.history || []).slice().reverse();
    if (!h.length) return "";
    return `<tr><th>Runde</th><th>Sieger</th><th>Punkte</th></tr>` + h.map((r) => {
      const p = V.players[r.winner] || { name: "?" };
      return `<tr><td>${r.round}</td><td>${p.avatar || ""} ${esc(p.name)}</td><td>+${r.pts}</td></tr>`;
    }).join("");
  }
  function renderRoundEnd() {
    $("#reHist").innerHTML = histHTML();
    $("#reHistWrap").hidden = (V.history || []).length < 2;
    const last = V.last, w = V.players[last.winner];
    const winnerName = mode === "online" && last.winner === V.me ? "Du gewinnst" : `${w.name} gewinnt`;
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round} vorbei`;
    $("#reTitle").textContent = `${winnerName} ${last.over ? "das Spiel" : "die Runde"}!`;
    $("#reText").textContent = `${last.pts} Punkte aus den Karten der anderen.` + (V.goal > 0 && !last.over ? ` Gespielt wird bis ${V.goal}.` : "");
    scoreList($("#reScores"), last.winner);
    $("#reBtn").textContent = last.over ? "Revanche" : "Nächste Runde";
    if (mode === "online" && R && last.over) { // a rematch needs everyone still at the table
      const n = V.players.length, votes = R.rematch || [];
      const table = R.members.map((m, i) => i).filter((i) => i < n && !R.members[i].lobby && !R.members[i].bot && R.members[i].online);
      const yes = table.filter((i) => votes.includes(i)).length;
      $("#reBtn").textContent = votes.includes(R.you)
        ? (yes === table.length ? "Zu wenige für eine Revanche, warte auf Mitspieler" : `Warte auf die anderen (${yes}/${table.length})`)
        : `Revanche (${yes}/${table.length} bereit)`;
      $("#reBtn").hidden = V.me < 0;
      $("#reVotes").innerHTML = UI.rematchStatus(n, votes);
    }
    $("#reVotes").hidden = !(mode === "online" && R && last.over);
    const back = $("#reBack");
    if (mode === "local") { back.hidden = false; back.textContent = "Zurück zum Start"; }
    else { back.hidden = R.host !== V.me; back.textContent = "Zurück in den Warteraum"; }
    if (mode === "online" && last.over) back.hidden = !R.members[R.you]; // after a game everyone decides for themselves
  }

  function renderHome() {
    renderLocalRules();
    for (const b of document.querySelectorAll("#modeTabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
    // never hide the online form on a web address: a failed check (ad blocker, slow
    // network) must not lock people out; connecting will tell if there really is no server
    $("#onlinePanel").hidden = tab !== "online" || !webHost;
    $("#onlineOff").hidden = tab !== "online" || webHost;
    const sh = $("#serverHint");
    sh.hidden = serverState === "ok";
    sh.textContent = serverState === "checking" ? "Suche den Spiel-Server …"
      : "Unter dieser Adresse antwortet kein Pass-Uno-Server. Du kannst es trotzdem versuchen, „Einzelspieler“ geht immer.";
    $("#localPanel").hidden = tab !== "local";
    for (const b of document.querySelectorAll("#goalOnline button")) b.setAttribute("aria-pressed", String(+b.dataset.goal === goalOnline));
    for (const b of document.querySelectorAll("#goalLocal button")) b.setAttribute("aria-pressed", String(+b.dataset.goal === goalLocal));

    const saved = store.get(K.local);
    $("#resumePanel").hidden = !(saved && saved.players);
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => p.name).join(", ")} · Runde ${saved.round}`;
    HOME.render();
    $("#levelLocal").innerHTML = levelButtons(localLevel);
    $("#myAvatar").textContent = myAvatar;
    LOOK.render();
  }
  const levelButtons = (cur) => Object.entries(G.BOT_LEVELS).map(([k, n]) =>
    `<button type="button" data-level="${k}" aria-pressed="${k === cur}">${n}</button>`).join("");




  // connection pill: only after a short grace period, phones drop sockets all the time

  // ---------- online connection ----------
  function wsSend(m) { return UI.send(m); }
  // a room update from the server: sounds and notes for what just happened, then draw
  function onRoom(m) {
    R = m; mode = "online";
    if (m.view) {
      const v = m.view;
      for (const ev of m.events || []) {
        if ((ev.t === "drew" || ev.t === "took" || ev.t === "penalty") && ev.pi !== v.me) sfx("draw");
        if (ev.t === "played") { sfx("card"); playFrom = ev.pi; }
        if ((ev.t === "drew" || ev.t === "took") && ev.pi === v.me) sfx("draw");
        if ((ev.t === "drew" || ev.t === "took" || ev.t === "penalty") && ev.pi === v.me) drawFx = true;
        ruleEvent(ev, v.players, v.me);
        if (ev.t === "uno") { flashUno(ev.pi === v.me ? "" : v.players[ev.pi].name); sfx("uno"); }
        if (ev.t === "penalty") { toast(ev.pi === v.me ? "Zu langsam: 2 Strafkarten!" : `${v.players[ev.pi].name} war zu langsam: 2 Strafkarten!`); sfx("bad"); }
        if (ev.t === "drew" && ev.pi === v.me && v.drawnId == null) {
          const c = v.hand.find((x) => x.id === ev.id);
          if (c) toast(`Gezogen: ${G.cardName(c)}. Passt nicht, dein Zug ist vorbei.`);
        }
      }
    }
    render();
    if (m.view) seatFlights(m.events);
  }

  // ---------- events ----------
  $("#fan").innerHTML = [{ id: -1, c: "r", v: "7" }, { id: -2, c: "y", v: "skip" }, { id: -3, c: "g", v: "d2" }, { id: -4, c: "w", v: "d4" }].map((c) => cardHTML(c)).join("");
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; tabTouched = true; renderHome(); } });
  $("#goalOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-goal]"); if (b) { goalOnline = +b.dataset.goal; renderHome(); } });
  $("#goalLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-goal]"); if (b) { goalLocal = +b.dataset.goal; renderHome(); } });
  // ---------- waiting room and menu: shared (room-ui.js), plus this game's own parts ----------
  const UI = window.RoomUI({
    room: () => R, view: () => V, mode: () => mode, server: () => server,
    watching: (v) => (v === undefined ? watching : (watching = v)),
    onlineKey: K.online,
    on: {
      opened() { if (serverState !== "ok") { serverState = "ok"; server = server || {}; } },
      joined(m) { mode = "online"; wake(); },
      room: onRoom,
      react(m) { bubble(m.pi, m.e); },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text) => bubble(pi, text),
    toast, render: () => render(), maxPlayers: 10, watchers: true,
    cycleAvatar: () => { myAvatar = nextAvatar(myAvatar); store.set(K.avatar, myAvatar); return myAvatar; },
    // goal, computer strength and house rules; the host picks, everyone sees it
    renderSettings(host) {
      $("#levelLobbyBox").hidden = !R.members.some((m) => m.bot);
      $("#levelLobby").innerHTML = levelButtons(R.botLevel || "normal");
      $("#levelLobby").querySelectorAll("button").forEach((b) => { b.disabled = !host; });
      for (const b of document.querySelectorAll("#goalLobby button")) {
        b.setAttribute("aria-pressed", String(+b.dataset.goal === R.goal));
        b.disabled = !host;
      }
      const rl = $("#rulesLobby"), key = JSON.stringify(R.rules) + host;
      if (rl.dataset.k !== key) { rl.dataset.k = key; rl.innerHTML = rulesHTML(R.rules || {}, host, false); }
      const onR = activeNames(R.rules || {});
      $("#rulesLobbySum").textContent = onR.length ? onR.join(", ") : "keine";
      $("#rulesLobbyHint").textContent = host ? "Tippe an, was gelten soll. Alle sehen deine Auswahl." : `${R.members[R.host].name} legt die Hausregeln fest.`;
    },
    menu: {
      open() {
        scoreList($("#menuScores"), -1);
        const on = activeNames(rules());
        $("#menuRules").textContent = on.length ? `Hausregeln: ${on.join(", ")}.` : "Keine Hausregeln, es gelten die normalen Regeln.";
        $("#menuHist").innerHTML = V ? histHTML() : "";
        LOOK.render();
      },
      local(box) {
        box.append(
          UI.armed(`${L.players[localViewer()].name}: Runde aufgeben`, () => doAct({ t: "surrender" }, localViewer())),
          UI.armed("Runde neu mischen", () => { L.round--; G.startRound(L); hidden = false; store.set(K.local, L); render(); scheduleLocalUno(); }),
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; render(); })
        );
      },
      player(box) {
        if (V && V.phase !== "roundEnd" && !(V.players[V.me] || {}).out)
          box.append(UI.armed("Runde aufgeben", () => wsSend({ t: "act", a: { t: "surrender" } })));
      },
      skip: (v) => (v.phase === "play" || v.phase === "drawn") && v.cur !== v.me,
      standIn: true
    }
  });

  $("#goalLobby").addEventListener("click",(e) => { const b = e.target.closest("[data-goal]"); if (b && R && R.you === R.host) wsSend({ t: "goal", goal: +b.dataset.goal }); });

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
    wsSend({ t: "create", name: n, goal: goalOnline, rules: localRules, avatar: myAvatar });
  });

  $("#startLocal").addEventListener("click", () => {
    const { names, bots } = HOME.roster($("#myName").value);
    L = G.newGame(names, goalLocal, Object.assign({}, localRules, { jumpIn: false, turnTimer: false }));
    L.players.forEach((p, i) => { p.bot = bots[i]; p.avatar = p.bot ? "🤖" : myAvatar; });
    mode = "local"; viewer = 0; hidden = false;
    store.set(K.local, L); render(); wake();
  });
  $("#resumeBtn").addEventListener("click", () => {
    L = store.get(K.local); if (!L) return render();
    mode = "local"; viewer = 0; hidden = false;
    render(); wake(); scheduleLocalUno();
  });

  // ---------- waiting room: ready up, or watch the game that runs ----------

  // host closes the room for everyone; tap twice, like the menu actions

  $("#hoBtn").addEventListener("click", () => { hidden = false; viewer = L.cur; render(); });
  $("#keepBtn").addEventListener("click", () => doAct({ t: "keep" }));
  function showHint() {
    if (!myTurn()) return;
    const a = G.suggest(V);
    if (!a || a.t === "uno") return;
    if (a.t === "draw") { toast(V.pending ? `Tipp: zieh die ${V.pending} Karten.` : "Tipp: Nichts passt, zieh eine Karte vom Stapel."); return; }
    if (a.t === "keep") { toast("Tipp: Behalte die Karte."); return; }
    const c = V.hand.find((x) => x.id === a.id);
    const el = document.querySelector(`#hand [data-id="${a.id}"]`);
    if (el) { el.classList.remove("hint"); void el.offsetWidth; el.classList.add("hint"); el.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); }
    toast(`Tipp: ${G.cardName(c)}${a.color ? `, dann ${G.CNAME[a.color]} wünschen` : ""}.`);
  }
  function toggleSort() { sortMode = sortMode === "value" ? "color" : "value"; store.set("passuno.sort", sortMode); renderGame(); }
  $("#hintBtn").addEventListener("click", showHint);
  $("#sortBtn").addEventListener("click", toggleSort);
  $("#picker").addEventListener("click", (e) => {
    const b = e.target.closest("[data-color]"); if (!b) return;
    $("#picker").hidden = true;
    const id = pendingWild; pendingWild = null;
    if (id != null) doAct({ t: "play", id, color: b.dataset.color });
  });
  $("#pickCancel").addEventListener("click", () => { $("#picker").hidden = true; pendingWild = null; });

  $("#reBtn").addEventListener("click", () => doAct({ t: "next" }));
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; render(); }
    else if (R && R.members[R.you] && R.members[R.you].lobby) { watching = false; render(); }
    else if (V && V.phase === "roundEnd" && V.last && V.last.over) wsSend({ t: "lobby" });
    else wsSend({ t: "end" });
  });

  // leave the room from the menu's bottom row: first tap turns it red, the second leaves


  // keep the screen on while playing (needs HTTPS; silently skipped otherwise)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") { abortDrag(); return; }
    if (mode) wake();
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- look: table design and card size ----------
  // ---------- look: table design and size (shared, kit.js), applied before anything is drawn ----------
  const LOOK = Spieleabend.look({ key: "passuno.look", sizeLabel: "Kartengröße", onChange: () => { if (V && !$("#game").hidden) { layoutHand(); renderSeats(); } } });

  // avatar picker (online) and computer strength
  Spieleabend.avatarPicker({ avatars: G.AVATARS, get: () => myAvatar, set: (a) => { myAvatar = a; store.set("passuno.avatar", a); } });
  $("#levelLocal").addEventListener("click", (e) => {
    const b = e.target.closest("[data-level]"); if (!b) return;
    localLevel = b.dataset.level; store.set("passuno.level", localLevel); renderHome();
  });
  $("#levelLobby").addEventListener("click", (e) => {
    const b = e.target.closest("[data-level]"); if (!b || !R || R.you !== R.host) return;
    wsSend({ t: "botLevel", level: b.dataset.level });
  });

  // ---------- boot ----------
  const code = UI.roomCode();
  render();
  if (webHost && (store.get(K.online) && !code)) UI.resume();
  UI.detectServer("/pass-uno-server", "uno").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
