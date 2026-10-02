// Phase 10 UI: one shared device and online rooms share one table renderer.
(() => {
  "use strict";
  const G = window.Phase10Game;
  // An old cached game.js next to a new app.js: reload once without cache instead of breaking.
  if (!G || !G.botMove || !G.AVATARS) {
    let tried = false;
    try { tried = sessionStorage.getItem("phase10.reloaded") === "1"; sessionStorage.setItem("phase10.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("phase10.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const K = { local: "phase10.v1", online: "phase10.online", me: "phase10.me", rules: "phase10.rules", goal: "phase10.goal", sound: "phase10.sound", level: "phase10.level", stats: "phase10.stats",
    avatar: "phase10.avatar", look: "phase10.look", sort: "phase10.sort" };
  const store = Spieleabend.store;
  const BOT_MS = 950;

  // ---------- look: table design and card size (shared, kit.js), applied before anything is drawn ----------
  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Kartengröße" });

  // ---------- avatars ----------
  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");

  const LEVELS = [[1, "Leicht"], [2, "Normal"], [3, "Profi"], [0, "Zufällig"]];
  const GOALS = [[10, "Alle 10 Phasen", "das ganze Spiel"], [5, "Phasen 1–5", "kurze Partie"]];
  const ICON = {
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6" /></svg>',
    skip: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></svg>'
  };

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let R = null;           // last online room message
  let watching = false;   // in the waiting room, but watching the game that runs
  let V = null;           // view currently on screen
  let sel = null;         // selected hand card id
  let peek = false;       // round over, looking at the table
  let inflight = false;
  let sortMode = store.get(K.sort) === "color" ? "color" : "value";
  let server = null, serverState = "checking";
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "phase10.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let goalLocal = G.normGoal(store.get(K.goal) || 10);
  let localRules = G.normRules(store.get(K.rules));
  let levelLocal = G.normLevel(store.get(K.level));
  let lastTurn = null, dealtFor = null, freshId = null;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const humans = (st) => st.players.map((_, i) => i).filter((i) => !st.players[i].bot);
  const myTurn = () => !!V && V.phase === "play" && V.me >= 0 && V.cur === V.me && (mode === "online" || !V.players[V.cur].bot);
  const pname = (i) => (mode === "online" && i === V.me ? "Du" : V.players[i].name);
  const me = () => (V && V.me >= 0 ? V.players[V.me] : null);
  const COL = "rygbws";
  const sorted = (h) => [...h].sort((a, b) => sortMode === "color"
    ? COL.indexOf(a.c) - COL.indexOf(b.c) || a.v - b.v
    : (a.v || 99 + COL.indexOf(a.c)) - (b.v || 99 + COL.indexOf(b.c)) || COL.indexOf(a.c) - COL.indexOf(b.c));

  function cardHTML(c, extra = "", tag = "span") {
    const face = G.isWild(c) ? "J" : G.isSkip(c) ? ICON.skip : c.v;
    const cor = G.isWild(c) ? "J" : G.isSkip(c) ? "" : c.v;
    const attrs = tag === "button" ? ` type="button" aria-label="${G.cardName(c)}"` : ` role="img" aria-label="${G.cardName(c)}"`;
    return `<${tag} class="card c-${c.c}${c.v >= 10 ? " two" : ""} ${extra}" data-id="${c.id}"${attrs}>${cor !== "" ? `<span class="cor">${cor}</span><span class="cor br">${cor}</span>` : ""}<span class="num">${face}</span></${tag}>`;
  }
  const backHTML = () => '<span class="card back"></span>';

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
  function shake() { const h = $("#hand"); h.classList.remove("shake"); void h.offsetWidth; h.classList.add("shake"); }
  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound, noiseFilter: "bandpass",
    effects: ({ tone, noise }) => ({
      card: () => noise(0, 0.12, 0.25, 2400),
      throw: () => { noise(0, 0.08, 0.3, 1800); tone(180, 0.02, 0.08, "triangle", 0.1); },
      lay: () => [392, 494, 587, 784].forEach((f, i) => tone(f, i * 0.06, 0.22, "triangle", 0.12)),
      hit: () => { tone(660, 0, 0.08, "triangle", 0.12); tone(880, 0.07, 0.12, "triangle", 0.1); },
      skip: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      bad: () => tone(220, 0, 0.18, "sawtooth", 0.07),
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16)),
      tick: () => tone(1200, 0, 0.05, "square", 0.06)
    })
  });

  // ---------- animation: cards fly from where they were to where they are now ----------
  const rectOf = (el) => (el ? el.getBoundingClientRect() : null);
  const visible = (r) => r && r.width > 0 && r.bottom > 0 && r.top < innerHeight;
  // a pile scrolled out of the arena: the card still flies, towards (or in from) the screen edge on that side
  const edgeRect = (r) => ({ left: r.left, top: r.bottom <= 0 ? -r.height - 24 : innerHeight + 24, width: r.width, height: r.height });
  const topCardEl = () => $("#discardBtn .card:last-child");
  let dropFrom = null; // a card just let go of in a drag: the next flight of it starts there
  // where everything is before an update: hand and spread, cards on the table, seats
  function snap() {
    const s = { deck: rectOf($("#deckBtn .card:last-child")), discard: rectOf($("#discardBtn")), plates: {}, hand: {}, meld: {} };
    for (const p of document.querySelectorAll("#plates .plate")) s.plates[p.dataset.seat] = rectOf(p);
    for (const c of document.querySelectorAll("#hand .card, #myZone .slots .card")) s.hand[c.dataset.id] = rectOf(c);
    for (const c of document.querySelectorAll(".meld .card")) s.meld[c.dataset.id] = rectOf(c);
    s.top = V && V.top;
    if (dropFrom && Date.now() - dropFrom.at < 4000) {
      if (dropFrom.id != null) s.hand[dropFrom.id] = dropFrom.rect; else s.drawFrom = dropFrom.rect;
      dropFrom = null;
    }
    return s;
  }
  // a card (face or back) flies from rect `from` onto element `to`, which shows up when it lands
  // on a smooth curve that bows sideways; long flights (phone: stack → hand) take a little longer
  function fly(html, from, to, delay = 0, dur = 420) {
    const tr0 = rectOf(to);
    if (!from || from.width <= 0 || !tr0 || tr0.width <= 0 || (!visible(from) && !visible(tr0))) return;
    const tr = visible(tr0) ? tr0 : edgeRect(tr0);
    if (!visible(from)) from = edgeRect(from);
    const sx = from.width / tr.width;
    const dx = tr.left - from.left, dy = tr.top - from.top, dist = Math.hypot(dx, dy) || 1;
    dur += Math.min(240, Math.max(0, dist - 250) * 0.3);
    let nx = -dy / dist, ny = dx / dist;
    if (Math.abs(ny) < 0.5 ? nx * (innerWidth / 2 - from.left) < 0 : ny > 0) { nx = -nx; ny = -ny; }
    const bow = Math.min(46, dist * 0.14);
    const frames = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, lift = Math.sin(Math.PI * t);
      const x = dx * t + nx * bow * lift, y = dy * t + ny * bow * lift;
      frames.push({ transform: `translate(${x}px,${y}px) scale(${sx + (1 - sx) * t + lift * 0.06}) rotate(${-6 * lift * (nx < 0 ? -1 : 1)}deg)`, opacity: t < 0.15 ? 0.9 + t * 0.66 : 1 });
    }
    Cards.fly({ rect: { left: from.left, top: from.top, width: tr.width, height: tr.height }, html, frames, dur, delay, easing: "cubic-bezier(.35,.1,.25,1)", hide: to });
  }
  // a short straight glide, for cards snapping into place
  function glide(html, from, to, dur = 220) {
    const tr = rectOf(to);
    if (!visible(from) || !visible(tr)) return;
    Cards.fly({
      rect: { left: from.left, top: from.top, width: tr.width, height: tr.height }, html, dur, easing: "cubic-bezier(.2,.9,.3,1.15)", hide: to,
      frames: [{ transform: `scale(${from.width / tr.width})` }, { transform: `translate(${tr.left - from.left}px,${tr.top - from.top}px) scale(1)` }]
    });
  }
  const cardEl = (id) => document.querySelector(`#hand .card[data-id="${id}"], #myZone .slots .card[data-id="${id}"]`);
  function plateEl(i) { return document.querySelector(`#plates [data-seat="${i}"]`); }
  function bumpPlate(i) { const p = plateEl(i); if (p) { p.classList.remove("bump"); void p.offsetWidth; p.classList.add("bump"); } }
  // play the events of the last update as flights, using where things were before
  function animate(events, before, v) {
    if (!before || !v) return;
    let k = 0;
    for (const ev of events || []) {
      const mine = ev.pi === v.me;
      if (ev.t === "draw") {
        const src = (mine && before.drawFrom) || (ev.from === "discard" ? before.discard : before.deck);
        const face = mine ? v.hand.find((c) => c.id === ev.id) : ev.from === "discard" ? before.top : null;
        const dest = mine ? cardEl(ev.id) : plateEl(ev.pi);
        if (dest) fly(face ? cardHTML(face) : backHTML(), src, dest, k * 90, mine ? 420 : 440);
        if (!mine) bumpPlate(ev.pi);
        k++;
      } else if (ev.t === "discard") {
        const dest = topCardEl();
        if (v.top && v.top.id === ev.id && dest) fly(cardHTML(v.top), (mine && before.hand[ev.id]) || before.plates[ev.pi], dest, k * 90);
        k++;
        if (ev.target != null) setTimeout(() => { const s = document.querySelector(`#plates [data-seat="${ev.target}"] .stamp`); if (s) { s.classList.remove("hit"); void s.offsetWidth; s.classList.add("hit"); } }, 380 + k * 90);
      } else if (ev.t === "swap") {
        const dest = document.querySelector(`.meld .card[data-id="${ev.id}"]`), c = v.melds.flatMap((m) => m.cards).find((x) => x.id === ev.id);
        if (dest && c) fly(cardHTML(c), (mine && before.hand[ev.id]) || before.plates[ev.pi], dest, k * 90, 380);
        const jd = mine ? cardEl(ev.joker) : plateEl(ev.pi);
        if (jd && before.meld[ev.joker]) fly(cardHTML({ id: ev.joker, c: "w", v: 0 }), before.meld[ev.joker], jd, k * 90 + 120, 420);
        k++;
      } else if (ev.t === "lay" || ev.t === "hit") {
        // the cards that are new on the table fly there from the hand / spread (or the player's seat)
        const all = v.melds.flatMap((m) => m.cards);
        const ids = ev.t === "hit" ? [ev.id] : v.melds.filter((m) => m.owner === ev.pi).flatMap((m) => m.cards.map((c) => c.id)).filter((id) => !before.meld[id]);
        let j = 0;
        for (const id of ids) {
          const dest = document.querySelector(`.meld .card[data-id="${id}"]`), c = all.find((x) => x.id === id);
          if (dest && c) fly(cardHTML(c), (mine && before.hand[id]) || before.plates[ev.pi], dest, k * 90 + j++ * 50, mine ? 360 : 480);
        }
        k++;
      }
    }
  }
  // a new round: the hand is dealt from the stack, card by card
  function dealIn() {
    if (!V || V.me < 0 || V.phase !== "play") return;
    const key = `${mode}:${V.round}:${V.players.map((p) => p.score).join(",")}`;
    if (dealtFor === key) return;
    dealtFor = key;
    const deck = rectOf($("#deckBtn .card:last-child"));
    Cards.shuffle(deck, { html: backHTML(), n: 8 });
    [...document.querySelectorAll("#hand .card")].forEach((el, i) => fly(backHTML(), deck, el, 650 + i * 55, 360));
    sfx("card");
  }

  // ---------- events → sound and notes ----------
  function handleEvents(events, v) {
    if (!v) return;
    for (const ev of events || []) {
      const mine = ev.pi === v.me;
      if (ev.t === "draw") { sfx("card"); if (mine) freshId = ev.id; }
      if (ev.t === "discard") { sfx("throw"); if (ev.target != null) { setTimeout(() => sfx("skip"), 300); toast(ev.target === v.me && mode === "online" ? "Du musst aussetzen!" : `${v.players[ev.target].name} muss aussetzen!`); } }
      if (ev.t === "lay") { sfx("lay"); setTimeout(() => flash(`Phase ${ev.phase}!`, mine && mode === "online" ? "Deine Phase liegt" : `${v.players[ev.pi].name} hat sie`, "blue"), 350); }
      if (ev.t === "hit") sfx("hit");
      if (ev.t === "swap") { sfx("hit"); if (!mine) toast(`${pname(ev.pi)} tauscht einen Joker aus.`); }
      if (ev.t === "timeout") { toast(mine && mode === "online" ? "Zu langsam! Das Spiel hat für dich gezogen und abgeworfen." : `${v.players[ev.pi].name} war zu langsam.`); sfx("bad"); }
      if (ev.t === "end") setTimeout(() => flash(`${pname(ev.out)} ${mine && mode === "online" ? "bist" : "ist"} raus!`, ev.over ? "Spiel vorbei" : "Runde vorbei", "blue"), 500);
    }
  }

  // ---------- actions ----------
  function doAct(a, actor) {
    if (mode === "local") {
      const pi = actor == null ? L.cur : actor;
      const before = snap();
      const res = G.act(L, pi, a);
      if (!res.ok) { toast(res.error); sfx("bad"); shake(); return false; }
      const v = G.view(L, localViewerFor(pi));
      handleEvents(res.events, v);
      store.set(K.local, L);
      render();
      animate(res.events, before, V);
      scheduleBot();
      return true;
    }
    if (mode === "online") {
      if (!wsSend({ t: "act", a })) { toast("Keine Verbindung zum Server."); return false; }
      return true;
    }
    return false;
  }
  function draw(from) {
    if (!myTurn()) return notYou();
    if (V.step !== "draw") { toast("Du hast schon gezogen, jetzt abwerfen."); return; }
    if (from === "discard" && V.top && G.isSkip(V.top)) { toast("Ein Aussetzen darf man nicht aufnehmen."); sfx("bad"); return; }
    if (inflight) return;
    if (mode === "online") { inflight = true; setTimeout(() => { inflight = false; }, 3000); }
    buzz(10);
    doAct({ t: "draw", from });
  }
  function notYou() {
    if (!V || V.phase !== "play") return;
    toast(mode === "online" && V.me < 0 ? "Du schaust zu." : `Warte, ${V.players[V.cur].name} ist dran.`);
  }
  function discard(id, target) {
    if (!myTurn()) return notYou();
    if (V.step !== "act") { toast("Zieh zuerst eine Karte."); sfx("bad"); return; }
    const c = V.hand.find((x) => x.id === id);
    if (!c) { toast("Tippe zuerst die Karte an, die du abwerfen willst."); return; }
    if (G.isSkip(c) && target == null && V.players.length > 2) return openTargets(id);
    sel = null; staged.delete(id);
    doAct({ t: "discard", id, target });
  }
  function hit(meld) {
    if (!myTurn() || sel == null) return;
    doAct({ t: "hit", id: sel, meld });
    sel = null;
  }
  function swap(meld) {
    if (!myTurn() || sel == null) return;
    doAct({ t: "swap", id: sel, meld });
    sel = null;
  }
  function openTargets(id) {
    const box = $("#targets");
    box.innerHTML = V.players.map((p, i) => i === V.me ? "" :
      `<button class="btn btn-block" type="button" data-t="${i}"${p.skipped ? " disabled" : ""}>${p.avatar} ${esc(p.name)} · Phase ${p.phase}${p.skipped ? " · setzt schon aus" : ""}</button>`).join("");
    box.dataset.id = id;
    $("#targetPick").hidden = false;
  }
  $("#targets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-t]"); if (!b) return;
    $("#targetPick").hidden = true;
    discard(+$("#targets").dataset.id, +b.dataset.t);
  });
  $("#targetCancel").addEventListener("click", () => { $("#targetPick").hidden = true; });
  $("#ladderBtn").addEventListener("click", () => { $("#ladderPick").hidden = false; });
  $("#ladderClose").addEventListener("click", () => { $("#ladderPick").hidden = true; });
  $("#ladderPick").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });

  // ---------- your spread: drop the phase into its slots, then lay it ----------
  // card id -> group (1|2); only on this screen until "Auslegen"
  const staged = new Map();
  const phaseGroups = () => G.PHASES[me().phase];
  const stagedIn = (g) => V.hand.filter((c) => staged.get(c.id) === g);
  // could these cards still become the group? (numbers alike, a colour, a run without doubles)
  function partialOk(cards, def) {
    const nat = cards.filter((c) => !G.isWild(c));
    if (cards.some(G.isSkip)) return false;
    if (!nat.length) return true;
    if (def.k === "set") return nat.every((c) => c.v === nat[0].v);
    if (def.k === "color") return nat.every((c) => c.c === nat[0].c);
    const vals = nat.map((c) => c.v);
    return new Set(vals).size === vals.length && Math.max(...vals) - Math.min(...vals) < Math.max(def.n, cards.length);
  }
  // a group's cards in the order they lie: a run by number with the jokers in its gaps
  function groupCards(g) {
    const cards = stagedIn(g), def = phaseGroups()[g - 1];
    const m = cards.length && G.makeGroup(cards, def);
    if (m) return m.cards;
    return [...cards].sort((a, b) => (a.v || 99) - (b.v || 99) || COL.indexOf(a.c) - COL.indexOf(b.c));
  }
  function groupState(g) {
    const def = phaseGroups()[g - 1], cards = stagedIn(g);
    if (!cards.length) return "";
    if (G.makeGroup(cards, def)) return "ok";
    return cards.length >= def.n || !partialOk(cards, def) ? "bad" : "";
  }
  const spreadReady = () => phaseGroups().every((_, i) => groupState(i + 1) === "ok") && staged.size < V.hand.length;
  // move a card into group g (or back to the hand: g = 0); it glides from `from` into its new place
  function stage(id, g, from) {
    const c = V.hand.find((x) => x.id === id);
    if (!c) return;
    const r = from || rectOf(cardEl(id));
    if (g) staged.set(id, g); else staged.delete(id);
    if (sel === id) sel = null;
    renderGame();
    glide(cardHTML(c), r, cardEl(id));
    buzz(8);
  }
  function suggest() {
    const f = G.findPhase(V.hand, me().phase);
    if (!f) { toast("Mit diesen Karten geht die Phase noch nicht."); sfx("bad"); return; }
    const before = {};
    for (const c of V.hand) before[c.id] = rectOf(cardEl(c.id));
    staged.clear();
    f.forEach((g, i) => g.forEach((c) => staged.set(c.id, i + 1)));
    sel = null;
    renderGame();
    f.flat().forEach((c, i) => setTimeout(() => glide(cardHTML(c), before[c.id], cardEl(c.id), 260), i * 40));
  }
  function unstageAll() {
    const before = {};
    for (const id of staged.keys()) before[id] = rectOf(cardEl(id));
    const ids = [...staged.keys()];
    staged.clear();
    renderGame();
    ids.forEach((id) => { const c = V.hand.find((x) => x.id === id); if (c) glide(cardHTML(c), before[id], cardEl(id), 260); });
  }
  function layNow() {
    if (!myTurn() || V.step !== "act") { toast(V.step === "draw" && myTurn() ? "Zieh zuerst eine Karte." : "Auslegen geht, wenn du dran bist."); return; }
    if (!spreadReady()) { toast("Die Felder passen noch nicht, grün heißt fertig."); sfx("bad"); return; }
    doAct({ t: "lay", groups: phaseGroups().map((_, i) => groupCards(i + 1).map((c) => c.id)) });
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
      if (!a || !doAct(a, pi)) scheduleBot();
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
      $("#clock").classList.toggle("urgent", left < 8000);
      $("#clockSec").textContent = Math.ceil(left / 1000) + " s";
      const s = Math.ceil(left / 1000);
      if (myTurn() && left > 0 && s <= 3 && clockBeep !== `${V.turn}:${s}:${clockEnd}`) { clockBeep = `${V.turn}:${s}:${clockEnd}`; sfx("tick"); if (s === 1) buzz(30); }
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
      const before = snap();
      const ev = G.tick(L);
      if (ev.length) { handleEvents(ev, G.view(L, localViewerFor(L.cur))); store.set(K.local, L); render(); animate(ev, before, V); scheduleBot(); }
      else scheduleClock();
    }, ms + 30);
  }

  function localViewerFor() {
    const hs = humans(L);
    return hs.length ? hs[0] : -1;
  }

  // ---------- rendering ----------
  function showScreen(id) {
    for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id;
  }
  function render() {
    if (mode === "local" && L) {
      V = G.view(L, localViewerFor());
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

  const SEAT_COLORS = ["#ff6b6b", "#4dabf7", "#69db7c", "#ffd43b", "#da77f2", "#ff9f43"];
  const seatColor = (i) => SEAT_COLORS[i % SEAT_COLORS.length];

  function ladderHTML() {
    const goal = V.goal, rows = [];
    for (let ph = 1; ph <= goal; ph++) {
      const here = V.players.map((p, i) => i).filter((i) => V.players[i].phase === ph);
      const cls = ["lrow", V.me >= 0 && V.players[V.me].phase === ph ? "mine" : "", here.length ? "has" : "", V.players.every((p) => p.phase > ph) ? "past" : ""].join(" ");
      rows.push(`<div class="${cls}"><div class="lhead"><b>${ph}</b><span>${G.phaseName(ph)}</span></div><div class="lwho">` +
        here.map((i) => { const p = V.players[i]; return `<span class="lav${V.phase === "play" && V.cur === i ? " cur" : ""}" style="--pc:${seatColor(i)}" title="${esc(p.name)}${p.laid ? " · Phase liegt" : ""}">${p.avatar}${p.laid ? "<i>✓</i>" : ""}</span>`; }).join("") + "</div></div>");
    }
    const fin = V.players.map((p, i) => i).filter((i) => V.players[i].phase > goal);
    if (fin.length) rows.push(`<div class="lrow fin"><div class="lhead"><b>🏁</b><span>Alle Phasen geschafft</span></div><div class="lwho">` +
      fin.map((i) => `<span class="lav" style="--pc:${seatColor(i)}" title="${esc(V.players[i].name)}">${V.players[i].avatar}</span>`).join("") + "</div></div>");
    return rows.join("");
  }

  function plateHTML(i) {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = members && members[i] && !members[i].online;
    const cls = ["plate", V.phase === "play" && V.cur === i ? "active" : "", away ? "away" : ""].join(" ");
    const tag = p.bot ? " · 🤖" : away ? " · offline" : "";
    return `<div class="${cls}" data-seat="${i}" style="--pc:${seatColor(i)}"><span class="pav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="pinfo"><span class="pname">${esc(p.name)}${mode === "online" && i === V.me ? " (du)" : ""}</span>` +
      `<span class="pmeta">Phase ${p.phase}${p.laid ? ' <b class="ok">✓</b>' : ""} · ${p.count} 🂠${tag}</span></span>` +
      `<span class="pwins" title="Strafpunkte">${p.score}</span>${p.skipped ? '<span class="stamp">SETZT AUS</span>' : ""}</div>`;
  }

  const meldLabel = (m) => m.k === "set" ? `${m.cards.length}× ${m.value}` : m.k === "run" ? `${m.start}–${m.start + m.len - 1}` : G.CNAME[m.color];
  // swapAt: index of the joker the selected card could replace (or -1)
  const meldHTML = (m, mi, fits, tp, swapAt = -1) => `<button type="button" class="meld${fits ? " fits" : ""}${tp ? " tip" : ""}" data-meld="${mi}" aria-label="${G.groupName(m)}">${m.cards.map((c, i) => cardHTML(c, i === swapAt ? "swap" : "")).join("")}<span class="mlabel">${meldLabel(m)}</span></button>`;
  const swapIdx = (m, can, sc) => (can && sc ? G.swapSpot(m, sc) : -1);
  const swapTip = (mi) => tipNow() && tipNow().t === "swap" && tipNow().meld === mi;
  // the tip is only valid for the moment it was asked for: the same turn, step and hand
  let tipAsked = null;
  const tipKey = () => `${V.round}:${V.turn}:${V.step}:${V.hand.length}:${me() && me().laid}`;
  const tipNow = () => (V && V.tip && tipAsked === tipKey() ? V.tip : null);
  const selCard = () => (sel != null ? V.hand.find((c) => c.id === sel) : null);
  // what the others have laid (your own groups lie in your spread)
  function renderMelds(canHit) {
    const sc = selCard();
    const rows = V.players.map((p, i) => {
      if (i === V.me) return "";
      const ms = V.melds.map((m, mi) => [m, mi]).filter(([m]) => m.owner === i);
      if (!ms.length) return "";
      return `<div class="mrow"><div class="who">${p.avatar} ${esc(p.name)} <small>Phase ${p.phase} · ${G.phaseName(p.phase)}</small></div><div class="mgroups">` +
        ms.map(([m, mi]) => meldHTML(m, mi, canHit && sc && G.fitOnto(m, sc), tipNow() && (tipNow().t === "hit" || tipNow().t === "swap") && tipNow().meld === mi, swapIdx(m, canHit, sc))).join("") + "</div></div>";
    }).join("");
    $("#melds").innerHTML = rows;
  }
  // how close the hand is to the phase: one pip per card the phase needs
  function progHTML() {
    if (V.need == null) return "";
    const total = G.PHASES[me().phase].reduce((n, g) => n + g.n, 0), have = Math.max(0, total - V.need);
    return `<span class="prog" title="${V.need ? `Es fehlen noch ${V.need} Karten` : "Die Phase ist komplett"}">${[...Array(total)].map((_, i) => `<i class="${i < have ? "on" : ""}"></i>`).join("")}</span>`;
  }
  // your spread: the phase's slots (drop cards in), or once laid, your groups on the table
  function renderZone(turn) {
    const z = $("#myZone"), P = me();
    z.hidden = !P || (V.phase !== "play" && !P.laid);
    if (z.hidden) { z.innerHTML = ""; return; }
    const can = turn && V.step === "act";
    if (P.laid) {
      const sc = selCard();
      const mine = V.melds.map((m, mi) => [m, mi]).filter(([m]) => m.owner === V.me);
      z.innerHTML = `<div class="zhead"><span class="tag done">Phase ${P.phase} ✓</span><span>${G.phaseName(P.phase)}</span><small>${V.phase === "play" ? "liegt. Jetzt anlegen, bei dir und bei den anderen." : ""}</small></div>` +
        `<div class="mgroups">${mine.map(([m, mi]) => meldHTML(m, mi, can && sc && G.fitOnto(m, sc), tipNow() && (tipNow().t === "hit" || tipNow().t === "swap") && tipNow().meld === mi, swapIdx(m, can, sc))).join("")}</div>`;
      return;
    }
    const gs = phaseGroups(), ready = spreadReady();
    z.innerHTML = `<div class="zhead"><span class="tag">Phase ${P.phase}</span><span>${G.phaseName(P.phase)}</span>${progHTML()}<small>${can ? (ready ? "passt, jetzt auslegen!" : "Karten hierher ziehen, sie rasten ein") : "Du kannst schon planen: Karten hierher ziehen"}</small></div>` +
      `<div class="zgroups">${gs.map((g, i) => {
        const cards = groupCards(i + 1), st = groupState(i + 1);
        return `<div class="slotgroup ${st}" data-g="${i + 1}"><div class="glabel"><span>${G.groupName(g)}</span><span>${st === "ok" ? "✓ passt" : st === "bad" ? "passt nicht" : `${cards.length}/${g.n}`}</span></div>` +
          `<div class="slots">${cards.map((c) => cardHTML(c, "", "button")).join("")}${'<span class="ph"></span>'.repeat(Math.max(0, g.n - cards.length))}</div></div>`;
      }).join("")}</div>` +
      `<div class="zacts"><button class="btn" type="button" data-z="suggest">Vorschlag</button>` +
      `${staged.size ? '<button class="btn btn-ghost" type="button" data-z="clear">Zurück in die Hand</button>' : ""}` +
      `<button class="btn${ready && can ? " btn-primary" : ""}" type="button" data-z="lay"${ready && can ? "" : " disabled"}>Auslegen</button></div>`;
  }

  function layoutHand() {
    const hand = $("#hand"), first = hand.querySelector(".card");
    if (!first) return;
    const n = hand.children.length, cw = first.offsetWidth, W = hand.clientWidth - 8;
    let step = cw + 6;
    if (n > 1 && n * cw + (n - 1) * 6 > W) step = Math.max((W - cw) / (n - 1), cw * 0.38);
    hand.style.setProperty("--step", step + "px");
  }
  window.addEventListener("resize", () => { if (V && !$("#game").hidden) layoutHand(); });

  // the discard pile as a loose heap: every card lies a little turned, the same way each time
  const tilt = (c, i, n) => (i === n - 1 ? ((c.id * 37) % 9) - 4 : ((c.id * 53) % 21) - 10);
  function renderGame() {
    if (V.phase !== "roundEnd") peek = false;
    const turn = myTurn(), P = me();
    if (sel != null && !V.hand.some((c) => c.id === sel)) sel = null;
    for (const id of [...staged.keys()]) if (!V.hand.some((c) => c.id === id)) staged.delete(id);
    if (P && P.laid) staged.clear();
    $("#plates").innerHTML = V.players.map((_, i) => plateHTML(i)).join("");
    const lad = ladderHTML();
    $("#ladder").innerHTML = lad;
    $("#ladderSheet").innerHTML = lad;
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> · bis Phase ${V.goal}`;

    // piles
    const drawing = turn && V.step === "draw";
    const tp = tipNow();
    $("#deckPile").classList.toggle("can", drawing);
    $("#deckPile").classList.toggle("tip", !!tp && tp.t === "draw" && tp.from === "deck");
    $("#discardPile").classList.toggle("tip", !!tp && tp.t === "draw" && tp.from === "discard");
    $("#deckCap").textContent = `${V.deckCount} Karten`;
    const pile = V.pile || (V.top ? [V.top] : []);
    $("#discardBtn").innerHTML = pile.length ? pile.map((c, i) => cardHTML(c).replace('class="card', `style="transform:rotate(${tilt(c, i, pile.length)}deg) translate(${i === pile.length - 1 ? 0 : ((c.id * 7) % 9) - 4}px,${i === pile.length - 1 ? 0 : ((c.id * 11) % 7) - 3}px)" class="card`)).join("") : '<span class="empty"></span>';
    $("#discardPile").classList.toggle("can", drawing && V.top && !G.isSkip(V.top));
    const throwing = turn && V.step === "act" && sel != null;
    $("#discardPile").classList.toggle("target", throwing);
    $("#discardCap").textContent = throwing ? "hier abwerfen" : "Ablage";

    // log
    const lmEl = $("#lastMove"), lines = V.log.slice(-2), lmKey = lines.join("\n");
    if (lmEl.dataset.k !== lmKey) {
      lmEl.dataset.k = lmKey;
      lmEl.innerHTML = lines.map((l, i) => `<div${i < lines.length - 1 ? ' class="old"' : ""}>${esc(l)}</div>`).join("");
      lmEl.classList.remove("fresh"); void lmEl.offsetWidth; lmEl.classList.add("fresh");
    }
    renderMelds(turn && V.step === "act" && P && P.laid);
    renderZone(turn);

    // dock
    const end = V.phase === "roundEnd";
    let who = "", hint = "", av = "";
    if (end) {
      const o = V.last.out;
      who = `${pname(o)} ${mode === "online" && o === V.me ? "bist" : "ist"} raus`; av = V.players[o].avatar; hint = "Runde vorbei.";
    } else {
      const C = V.players[V.cur];
      av = C.avatar;
      if (turn) {
        who = mode === "local" && humans(V).length > 1 ? `${C.name}, du bist dran` : "Du bist dran";
        hint = V.step === "draw" ? "Zieh eine Karte: Stapel oder Ablage antippen oder auf deine Hand ziehen."
          : P.laid ? "Anlegen: Karte auf eine leuchtende Gruppe ziehen. Zum Schluss eine Karte auf die Ablage."
          : spreadReady() ? "Deine Phase passt: „Auslegen“, dann eine Karte abwerfen."
          : "Karten in deine Phasen-Felder ziehen, dann auslegen. Zum Schluss eine auf die Ablage.";
      } else {
        who = `${C.name} ist dran`;
        hint = C.bot ? "Der Computer überlegt …" : mode === "online" && V.me < 0 ? "Du schaust zu." : "Warte auf deinen Zug.";
      }
    }
    $("#whoAv").textContent = av;
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    $("#dock").classList.toggle("myturn", turn);
    const acts = $("#acts");
    if (end) acts.innerHTML = peek ? '<button class="btn btn-primary" type="button" data-a="result">Ergebnis zeigen</button>' : "";
    else if (!P) acts.innerHTML = "";
    else acts.innerHTML = (turn && V.step === "act" ? `<button class="btn btn-primary" type="button" data-a="discard"${sel == null ? " disabled" : ""}>Abwerfen</button>` : "") +
      (turn ? '<button class="btn btn-ghost small" type="button" data-a="tip">Tipp</button>' : "") +
      Spieleabend.sortToggleHTML(sortMode, 'data-a="sort"');

    // hand: everything that is not in the spread
    const hand = $("#hand");
    hand.innerHTML = sorted(V.hand.filter((c) => !staged.has(c.id)))
      .map((c) => cardHTML(c, [c.id === sel ? "sel" : "", c.id === freshId ? "fresh" : "", tp && (tp.t === "discard" || tp.t === "hit" || tp.t === "swap") && tp.id === c.id ? "tip" : ""].join(" "), "button")).join("");
    freshId = null;
    layoutHand();
    $("#reactBtn").hidden = mode !== "online";
    $("#keys").innerHTML = turn ? (V.step === "draw" ? "<kbd>D</kbd> Stapel · <kbd>A</kbd> Ablage · oder auf die Hand ziehen" : "Karten ziehen und ablegen · <kbd>←</kbd><kbd>→</kbd> Karte wählen · <kbd>Enter</kbd> abwerfen · <kbd>P</kbd> Phase auslegen · <kbd>S</kbd> sortieren") : "";
    renderClock();

    // turn change feedback
    const key = `${V.round}:${V.turn}:${V.cur}`;
    Spieleabend.mine(turn && (mode === "online" || V.players.some((p) => p.bot)));
    if (turn && lastTurn !== key && lastTurn !== null && (mode === "online" || V.players.some((p) => p.bot))) { buzz([40, 60, 40]); sfx("turn"); }
    lastTurn = key;

    $("#roundEnd").hidden = !end || peek;
    if (end) {
      if (!peek) renderRoundEnd();
      const k = `${V.round}:${V.players.map((p) => p.score).join(",")}`;
      if (confettiFor !== k) {
        confettiFor = k; if (V.last.over) record(k);
        const good = mode === "online" ? V.last.out === V.me || (V.last.over && V.last.winners.includes(V.me)) : !V.players[V.last.out] || !V.players[V.last.out].bot;
        if (good) setTimeout(() => { confetti(); sfx("win"); }, 700);
      }
    }
  }

  // ---------- taps ----------
  const afterDrag = () => dnd.since < 350;
  $("#hand").addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]"); if (!b || afterDrag()) return;
    const id = +b.dataset.id, P = me();
    if (!P) return;
    if (P.laid && !(myTurn() && V.step === "act")) return notYou();
    sel = sel === id ? null : id;
    buzz(8); renderGame();
  });
  $("#hand").addEventListener("dblclick", (e) => { const b = e.target.closest("[data-id]"); if (b && myTurn() && V.step === "act") discard(+b.dataset.id); });
  $("#myZone").addEventListener("click", (e) => {
    if (afterDrag()) return;
    const z = e.target.closest("[data-z]");
    if (z) { if (z.dataset.z === "suggest") suggest(); else if (z.dataset.z === "clear") unstageAll(); else layNow(); return; }
    const m = e.target.closest("[data-meld]");
    if (m) return tapMeld(m, e);
    const c = e.target.closest(".slots [data-id]");
    if (c) return stage(+c.dataset.id, 0); // a card in a slot goes back to the hand
    const g = e.target.closest(".slotgroup");
    if (g && sel != null) return stage(sel, +g.dataset.g);
    if (g) toast("Tippe zuerst eine Karte in der Hand an, dann das Feld, oder zieh sie hinein.");
  });
  $("#acts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const a = b.dataset.a;
    if (a === "discard") discard(sel);
    else if (a === "result") { peek = false; render(); }
    else if (a === "tip") showTip();
    else if (a === "sort") { sortMode = sortMode === "value" ? "color" : "value"; store.set(K.sort, sortMode); renderGame(); }
  });
  function showTip() {
    if (!V || !myTurn() || !V.tip) return;
    const t = V.tip;
    tipAsked = tipKey();
    if (t.t === "draw") toast(t.from === "discard" ? `Tipp: nimm ${G.cardName(V.top)} von der Ablage.` : "Tipp: zieh vom Stapel.");
    else if (t.t === "lay") { toast("Tipp: deine Phase lässt sich auslegen, tippe auf „Vorschlag“ und dann „Auslegen“."); }
    else if (t.t === "hit") toast(`Tipp: leg ${G.cardName(V.hand.find((c) => c.id === t.id))} an.`);
    else if (t.t === "swap") toast(`Tipp: tausche einen Joker gegen ${G.cardName(V.hand.find((c) => c.id === t.id))}, tippe auf den Joker.`);
    else toast(`Tipp: wirf ${G.cardName(V.hand.find((c) => c.id === t.id))} ab.`);
    sfx("pop");
    renderGame();
    if (t.t === "lay") { const b = document.querySelector('#myZone [data-z="suggest"]'); if (b) b.classList.add("tip"); }
  }
  $("#deckBtn").addEventListener("click", () => { if (!afterDrag()) draw("deck"); });
  $("#discardBtn").addEventListener("click", () => {
    if (!V || afterDrag()) return;
    if (myTurn() && V.step === "act") { if (sel != null) discard(sel); else toast("Tippe zuerst die Karte an, die du abwerfen willst, oder zieh sie hierher."); return; }
    draw("discard");
  });
  function tapMeld(b, e) {
    if (!myTurn() || V.step !== "act") return;
    if (!me().laid) { toast("Anlegen geht erst, wenn deine eigene Phase liegt."); return; }
    if (sel == null) { toast("Tippe zuerst eine Karte an, dann die Gruppe (anlegen) oder einen Joker darin (tauschen), oder zieh sie drauf."); return; }
    if (e && e.target.closest(".card.swap")) return swap(+b.dataset.meld);
    if (!b.classList.contains("fits")) { toast(b.querySelector(".card.swap") ? "Zum Tauschen tippe auf den Joker." : "Die Karte passt da nicht."); sfx("bad"); return; }
    hit(+b.dataset.meld);
  }
  $("#melds").addEventListener("click", (e) => { const b = e.target.closest("[data-meld]"); if (b && !afterDrag()) tapMeld(b, e); });

  // ---------- drag & drop: pick a card up, drop it where it should go; it snaps into place ----------
  function dropTargets(src) {
    const t = [], P = me(), turn = myTurn();
    if (src.kind === "pile") return [{ el: $("#dock"), kind: "draw" }];
    const c = V.hand.find((x) => x.id === src.id);
    if (!c || !P) return t;
    if (!P.laid && V.phase === "play") {
      for (const g of document.querySelectorAll("#myZone .slotgroup")) if (+g.dataset.g !== staged.get(src.id)) t.push({ el: g, kind: "slot", g: +g.dataset.g });
      if (src.kind === "staged") t.push({ el: $("#dock"), kind: "unstage" });
    }
    if (turn && V.step === "act") {
      t.push({ el: $("#discardPile"), kind: "discard", box: $("#discardBtn") });
      if (P.laid) {
        for (const m of document.querySelectorAll(".meld")) if (G.fitOnto(V.melds[+m.dataset.meld], c)) t.push({ el: m, kind: "hit", meld: +m.dataset.meld });
        for (const m of document.querySelectorAll(".meld")) { // a joker inside a group: swap (later in the list, so it wins over the group)
          const at = G.swapSpot(V.melds[+m.dataset.meld], c);
          if (at >= 0 && m.children[at]) t.push({ el: m.children[at], kind: "swap", meld: +m.dataset.meld });
        }
      }
    }
    return t;
  }
  Cards.autoFlip("#hand", ".card");
  const dnd = Cards.dnd({
    root: document, strip: ["fresh", "shake"],
    grab(e) {
      if (!V || $("#game").hidden) return null;
      const card = e.target.closest("#hand .card, #myZone .slots .card"), pileBtn = e.target.closest("#deckBtn, #discardBtn");
      let src = null;
      if (card) src = { kind: card.closest("#hand") ? "hand" : "staged", id: +card.dataset.id, el: card };
      else if (pileBtn && myTurn() && V.step === "draw") {
        if (pileBtn.id === "discardBtn" && (!V.top || G.isSkip(V.top))) return null;
        src = { kind: "pile", from: pileBtn.id === "deckBtn" ? "deck" : "discard", el: pileBtn.querySelector(".card:last-child") };
      }
      if (!src || !src.el) return null;
      src.touch = e.pointerType !== "mouse";
      return src;
    },
    // in the hand a sideways swipe scrolls on touch screens
    canStart: (s, dx, dy) => !(s.kind === "hand" && s.touch && Math.abs(dx) > Math.abs(dy)),
    onStart(s) {
      s.targets = dropTargets(s);
      for (const t of s.targets) t.el.classList.add("target");
      if (s.kind === "hand" && me() && me().laid && myTurn() && V.step === "act") { sel = s.id; for (const t of s.targets) if (t.kind === "hit") t.el.classList.add("fits"); }
    },
    target(_, s, e) {
      let over = null;
      for (const t of s.targets) {
        const b = rectOf(t.box || t.el);
        if (e.clientX >= b.left - 12 && e.clientX <= b.right + 12 && e.clientY >= b.top - 12 && e.clientY <= b.bottom + 12) over = t;
      }
      return over && Object.assign(over, { ok: true });
    },
    // at is where the card was let go: its flight into place starts there
    drop(s, t, at) {
      if (t.kind === "draw") { dropFrom = { rect: at, at: Date.now() }; draw(s.from); }
      else if (t.kind === "slot") stage(s.id, t.g, at);
      else if (t.kind === "unstage") stage(s.id, 0, at);
      else if (t.kind === "discard") { dropFrom = { id: s.id, rect: at, at: Date.now() }; staged.delete(s.id); discard(s.id); }
      else if (t.kind === "hit") { dropFrom = { id: s.id, rect: at, at: Date.now() }; sel = s.id; hit(t.meld); }
      else if (t.kind === "swap") { dropFrom = { id: s.id, rect: at, at: Date.now() }; sel = s.id; swap(t.meld); }
      return true;
    },
    onEnd(_, s, r) {
      for (const t of s.targets || []) t.el.classList.remove("target");
      s.el.classList.remove("cd-dragging");
      // no fitting place: the card flew back, and the selection made for the drag goes
      if (r.started && !r.dropped && s.kind === "hand" && me() && me().laid) { sel = null; renderGame(); }
    }
  });

  // keys: D/A draw, arrows pick a card, Enter throws it, P lays the phase (or suggests), S sorts, Esc cancels
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    const open = ["#menu", "#reactBar", "#targetPick", "#ladderPick"].find((s) => !$(s).hidden);
    if (e.key === "Escape") {
      if (open) $(open).hidden = true;
      else if (sel != null) { sel = null; renderGame(); }
      return;
    }
    if (open || $("#game").hidden || !$("#roundEnd").hidden || !myTurn()) return;
    const k = e.key.toLowerCase();
    if (k === "d") draw("deck");
    else if (k === "a") draw("discard");
    else if (k === "s") { sortMode = sortMode === "value" ? "color" : "value"; store.set(K.sort, sortMode); renderGame(); }
    else if (k === "p" && V.step === "act" && !me().laid) spreadReady() ? layNow() : suggest();
    else if ((k === "arrowleft" || k === "arrowright") && V.step === "act") {
      e.preventDefault();
      const ids = sorted(V.hand.filter((c) => !staged.has(c.id))).map((c) => c.id), i = ids.indexOf(sel);
      sel = ids[i < 0 ? (k === "arrowleft" ? ids.length - 1 : 0) : Math.max(0, Math.min(ids.length - 1, i + (k === "arrowleft" ? -1 : 1)))];
      renderGame();
    } else if (k === "enter" && sel != null && V.step === "act") { e.preventDefault(); discard(sel); }
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
    const host = pi >= 0 ? plateEl(pi) : $("#dock");
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

  // standings: furthest phase first, then fewest points
  const standings = () => V.players.map((_, i) => i).sort((a, b) => V.players[b].phase - V.players[a].phase || V.players[a].score - V.players[b].score);
  function scoreList(el, winners, res) {
    el.innerHTML = standings().map((i) => {
      const p = V.players[i], you = i === V.me && mode === "online" ? " (du)" : "", r = res && res[i];
      const note = r ? (r.done ? `<small class="ok">Phase ${r.phase} ✓</small>` : `<small>Phase ${r.phase} ✗</small>`) : `<small>Phase ${p.phase}</small>`;
      return `<li class="${winners.includes(i) ? "win" : ""}"><span>${avi(p.avatar)}${esc(p.name)}${you}${note}</span>` +
        `<b>${r && r.bonus ? `<span class="bon">−${r.bonus}</span>` : ""}${r && r.pen ? `<span class="pen">+${r.pen}</span>` : ""}${p.score} Pkt.</b></li>`;
    }).join("");
  }
  function histHTML() {
    if (!V.history.length) return "";
    return `<tr><th>Runde</th>${V.players.map((p) => `<th>${esc(p.name)}</th>`).join("")}</tr>` +
      V.history.map((h) => `<tr><td>${h.round}</td>${h.pens.map((n, i) => `<td class="${h.done[i] ? "ok" : ""}">${h.done[i] ? "✓ " : ""}${n}</td>`).join("")}</tr>`).join("");
  }

  function renderRoundEnd() {
    const last = V.last, o = last.out;
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round}`;
    const winners = last.winners.map((i) => (mode === "online" && i === V.me ? "Du" : V.players[i].name));
    $("#reTitle").textContent = last.over
      ? `${winners.join(" & ")} ${winners.length > 1 ? "gewinnen" : winners[0] === "Du" ? "gewinnst" : "gewinnt"} das Spiel!`
      : `${pname(o)} ${mode === "online" && o === V.me ? "bist" : "ist"} raus!`;
    const done = last.res.filter((r) => r.done).length;
    $("#reText").textContent = last.over ? `Als Erste${last.winners.length > 1 ? "" : "r"} durch alle ${V.goal} Phasen, bei Gleichstand zählen die wenigsten Punkte.`
      : `${done ? `${done} von ${V.players.length} haben ihre Phase geschafft und gehen weiter.` : "Keiner hat seine Phase geschafft."} Strafpunkte: 1–9 je 5, 10–12 je 10, Aussetzen 15, Joker 25.`;
    scoreList($("#reScores"), last.winners, last.res);
    UI.roundEndFooter({ over: last.over, next: "Nächste Runde" });
  }

  // Statistik lebt im Profil (shared/profile.js, gilt für alle Spiele); die alte Bilanz dieses Browsers wird einmal übernommen
  const profile = Spieleabend.profile;
  { const old = (store.get(K.stats) || {})[profile.get().name]; if (old) profile.importLegacy("phase10", { rounds: old.rounds || old.games, wins: old.wins }); }
  function record(key) {
    const i = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
    if (i < 0) return;
    profile.result("phase10", key, { won: V.last.winners.includes(i), draw: !V.last.winners.length, online: mode === "online" });
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
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => `${p.name} (Phase ${p.phase})`).join(", ")} · Runde ${saved.round}`;
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
      room(m) {
        const before = snap();
        R = m; mode = "online"; inflight = false;
        if (m.view) handleEvents(m.events, m.view);
        render();
        if (m.view && V) { animate(m.events, before, V); dealIn(); }
      },
      react(m) { bubble(m.pi, m.e, m.name); },
      error() { inflight = false; if (V) render(); },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text, name) => bubble(pi, text, name),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    // game length, computer strength and house rules; the host picks, everyone sees it
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
        scoreList($("#menuScores"), []);
        const on = activeNames(V ? V.rules : {});
        $("#menuRules").textContent = `${V ? (V.goal === 10 ? "Alle 10 Phasen." : "Kurze Partie bis Phase 5.") : ""} ${on.length ? `Hausregeln: ${on.join(", ")}.` : "Keine Hausregeln."}`;
        $("#menuHist").innerHTML = V ? histHTML() : "";
      },
      local(box) {
        box.append(
          UI.armed("Runde neu geben", () => { L.players.forEach((p) => { p.phase = p.phaseAtStart || p.phase; }); L.round--; L.dealer = (L.dealer + L.players.length - 1) % L.players.length; G.startRound(L); peek = false; store.set(K.local, L); render(); dealIn(); scheduleBot(); }),
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearTimeout(clockT); render(); })
        );
      },
      player() {},
      skip: (v) => v.phase === "play" && v.cur !== v.me && !v.players[v.cur].bot,
      standIn: true
    }
  });

  Spieleabend.avatarPicker({ avatars: G.AVATARS, get: () => myAvatar, set: (a) => { myAvatar = a; store.set(K.avatar, a); } });

  $("#goalOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", goal: +b.dataset.v }); });
  $("#levelOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", level: +b.dataset.v }); });

  // ---------- online connection (shared, room-ui.js) ----------
  function wsSend(m) { return UI.send(m); }

  // ---------- start screen ----------
  $("#heroFan").innerHTML = [{ c: "r", v: 7 }, { c: "b", v: 8 }, { c: "w", v: 0 }, { c: "y", v: 10 }, { c: "g", v: 11 }]
    .map((c, i) => cardHTML(Object.assign({ id: -1 - i }, c)).replace('class="card', `style="transform:rotate(${(i - 2) * 9}deg) translateY(${Math.abs(i - 2) * 6}px)" class="card`)).join("");
  $("#phaseListHome").innerHTML = G.PHASES.slice(1).map((_, i) => `<li>${G.phaseName(i + 1)}</li>`).join("");
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
    L = state; mode = "local"; peek = false; sel = null; staged.clear();
    if (L.phase === "play") G.resetClock(L);
    store.set(K.local, L); render(); dealIn(); wake(); scheduleBot();
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

  $("#reBtn").addEventListener("click", () => {
    peek = false;
    if (mode === "local") { doAct({ t: "next" }, 0); dealIn(); }
    else doAct({ t: "next" });
  });
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
  UI.detectServer("/phase10-server", "phase10").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
