// Poker UI: single player (with computers) and online rooms
// share one table. The hole cards are private; everything else is on the table.
(() => {
  "use strict";
  const G = window.PokerGame;
  // an old cached game.js next to a new app.js: reload once instead of breaking
  if (!G || !G.RULES || !G.best) {
    let tried = false;
    try { tried = sessionStorage.getItem("poker.reloaded") === "1"; sessionStorage.setItem("poker.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    return;
  }
  try { sessionStorage.removeItem("poker.reloaded"); } catch (e) {}

  const $ = (s) => document.querySelector(s);
  const K = { local: "poker.v1",
    online: "poker.online", me: "poker.me", avatar: "poker.avatar", rules: "poker.rules",
    level: "poker.level", look: "poker.look", sound: "poker.sound", chips: "poker.chips" };
  const store = Spieleabend.store;

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let R = null;           // last online room message
  let watching = false;   // in the waiting room, but watching the game that runs
  let V = null;           // view on screen
  let server = null, serverState = "checking";
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "poker.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let chipsLocal = G.normChips(store.get(K.chips));
  let localLevel = G.BOT_LEVELS[store.get(K.level)] ? store.get(K.level) : "normal";
  let localRules = G.normRules(store.get(K.rules) || {});
  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const money = G.money;
  const isBot = (i) => !!(V && V.players[i] && V.players[i].bot);
  const myTurn = () => !!V && V.phase === "play" && V.cur === V.me && V.me >= 0 && !isBot(V.cur) && !!V.opts;

  const RANKS = { 10: "10", 11: "B", 12: "D", 13: "K", 14: "A" };
  const cardHTML = (id, cls = "") => id == null
    ? `<span class="card back ${cls}"></span>`
    : `<span class="card s${G.suitOf(id)} ${cls}" data-id="${id}"><b>${RANKS[G.rankOf(id)] || G.rankOf(id)}</b><i>${G.SUITS[G.suitOf(id)]}</i></span>`;
  const { toast, confetti, showBubble } = Spieleabend;
  Spieleabend.followTurn("#players", ".pcard.active"); // the player on turn scrolls into view

  // ---------- sound ----------
  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound, vol: 0.15,
    effects: ({ tone }) => ({
      deal: (n = 1) => { for (let i = 0; i < n; i++) tone(300 + Math.random() * 120, i * 0.07, 0.04, "triangle", 0.1); },
      chip: () => { tone(1300, 0, 0.04, "square", 0.05); tone(1700, 0.05, 0.05, "square", 0.05); },
      check: () => { tone(200, 0, 0.05, "triangle", 0.2); tone(200, 0.09, 0.05, "triangle", 0.2); },
      fold: () => tone(180, 0, 0.12, "sawtooth", 0.05),
      allin: () => [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.06, 0.16, "square", 0.06)),
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16)),
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      hint: () => tone(760, 0, 0.05, "sine", 0.1),
      thump: () => { tone(75, 0, 0.14, "sine", 0.35); tone(75, 0.2, 0.16, "sine", 0.3); }
    })
  });

  // ---------- animation helpers ----------
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const seatEl = (i) => document.querySelector(`#players .pcard[data-seat="${i}"]`);
  const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const coins = (amount) => Math.max(1, Math.min(9, Math.round(amount / (V ? V.blinds.bb : 20))));
  // chips flying from one element to another
  function fly(from, to, n, opts = {}) {
    if (!from || !to || calm()) return;
    const [x0, y0] = center(from), [x1, y1] = center(to);
    for (let k = 0; k < n; k++) {
      const c = document.createElement("span");
      c.className = "flycoin"; document.body.append(c);
      const jx = (Math.random() - 0.5) * 24, jy = (Math.random() - 0.5) * 14;
      const a = c.animate([
        { transform: `translate(${x0 + jx}px,${y0 + jy}px) scale(.5)`, opacity: 0 },
        { transform: `translate(${x0 + jx}px,${y0 + jy}px) scale(1)`, opacity: 1, offset: 0.12 },
        { transform: `translate(${(x0 + x1) / 2 + jx}px,${Math.min(y0, y1) - 30}px) scale(1.15)`, offset: 0.55 },
        { transform: `translate(${x1 + jx * 0.4}px,${y1 + jy * 0.4}px) scale(.85)`, opacity: 1 }
      ], { duration: (opts.dur || 620) + Math.random() * 160, delay: (opts.delay || 0) + k * 70, easing: "cubic-bezier(.35,.1,.3,1)", fill: "both" });
      a.onfinish = () => c.remove();
      if (opts.tick) setTimeout(() => sfx("chip"), (opts.delay || 0) + k * 70 + (opts.dur || 620) * 0.9);
    }
  }
  // a card slides in from a point and turns face up while it lands
  function dealFrom(el, pt, delay, dur = 480) {
    if (!el || calm()) return;
    const [x, y] = center(el);
    el.animate([{ transform: `translate(${pt[0] - x}px,${pt[1] - y}px) rotate(-120deg) scale(.5)`, opacity: 0 }], { duration: dur, delay, easing: "cubic-bezier(.2,.8,.3,1)", fill: "backwards" });
  }
  function flipIn(el, delay, dur = 520) {
    if (!el || calm()) return;
    el.animate([{ transform: "perspective(500px) rotateY(90deg) translateY(-24px) scale(.9)", opacity: 0 }], { duration: dur, delay, easing: "cubic-bezier(.2,.8,.3,1)", fill: "backwards" });
  }
  // the folded cards sail toward the middle and disappear
  function foldAway(pi) {
    if (calm() || !V) return;
    const cards = pi === V.me ? [...document.querySelectorAll("#hole .card")] : [...document.querySelectorAll(`#players .pcard[data-seat="${pi}"] .cards .card`)];
    const [tx, ty] = center($("#felt"));
    cards.forEach((el, k) => {
      const r = el.getBoundingClientRect(), c = el.cloneNode(true);
      c.classList.add("flycard");
      Object.assign(c.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px" });
      c.style.setProperty("--cw", r.width + "px");
      document.body.append(c);
      const a = c.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${tx - (r.left + r.width / 2)}px,${ty - (r.top + r.height / 2)}px) rotate(${(Math.random() - 0.5) * 200}deg) scale(.7)`, opacity: 0 }], { duration: 650, delay: k * 60, easing: "ease-in", fill: "forwards" });
      a.onfinish = () => c.remove();
    });
  }
  function shoveFx(pi) {
    const el = seatEl(pi);
    if (!el) return;
    el.classList.remove("shove"); void el.offsetWidth; el.classList.add("shove");
    const b = document.createElement("span");
    b.className = "bubble text allin"; b.textContent = "ALL-IN!";
    showBubble(el, b); setTimeout(() => b.remove(), 2200);
    const f = $("#felt"); f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake");
    buzz([60, 40, 90]);
  }
  // the animated count of a stack
  let stackShown = {}, stackTok = {};
  function syncStacks() {
    V.players.forEach((p, i) => {
      if (stackShown[i] == null) { stackShown[i] = p.chips; return; }
      if (stackShown[i] === p.chips || (V.phase === "roundEnd" && waiting())) return;
      const a = stackShown[i], b = p.chips, tok = (stackTok[i] = (stackTok[i] || 0) + 1), t0 = performance.now();
      if (calm()) { stackShown[i] = b; return; }
      const step = (now) => {
        if (stackTok[i] !== tok) return;
        const t = Math.min(1, (now - t0) / 800), v = t >= 1 ? b : Math.round(a + (b - a) * (1 - Math.pow(1 - t, 3)));
        stackShown[i] = v;
        const el = document.querySelector(`.sv[data-seat="${i}"]`);
        if (el) el.textContent = money(v);
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  // ---------- the drama of a finished hand ----------
  // the cards of the others are turned over one after another, then the pot goes to the winner
  let suspenseUntil = 0, handTimer = null;
  const revealing = new Set();
  const waiting = () => Date.now() < suspenseUntil;
  let afterRender = [];
  function scheduleReveals(seats, start, step) {
    seats.forEach((i, k) => {
      revealing.add(i);
      setTimeout(() => {
        revealing.delete(i);
        if (!V) return;
        renderPlayers();
        const el = seatEl(i);
        if (el) el.querySelectorAll(".cards .card").forEach((c, j) => flipIn(c, j * 110, 560));
        sfx("deal", 2);
      }, start + k * step);
    });
  }
  const unseen = (i) => !V || !V.players[i] || V.players[i].hole.length === 0 || V.players[i].hole[0] == null;
  function payout(hand) {
    if (!V || V.phase !== "roundEnd" || V.hand !== hand || !V.last) return;
    const pay = V.last.kind === "show" ? V.last.hands.filter((h) => h.won).map((h) => [h.i, h.won]) : V.last.winners.map((i) => [i, V.last.pot]);
    pay.forEach(([i, amount], k) => fly($("#potLine"), seatEl(i), coins(amount) + 2, { dur: 760, delay: k * 120, tick: true }));
    sfx(pay.some(([i]) => i === V.me) ? "win" : "chip");
  }
  function handEnded(st) {
    const last = st && st.last;
    if (!last) return;
    const show = last.kind === "show";
    const seats = show ? last.hands.map((h) => h.i).filter((i) => i !== (V && V.me) && unseen(i)) : [];
    scheduleReveals(seats, 500, 750);
    // a little pause after the last card is turned, then the winner is announced
    const wait = show ? 900 + 750 * Math.max(1, seats.length) : 450;
    suspenseUntil = Date.now() + wait;
    const hand = st.hand;
    clearTimeout(handTimer);
    handTimer = setTimeout(() => { payout(hand); render(); }, wait);
  }


  const lBot = (i) => !!(L && L.players[i] && L.players[i].bot);

  // ---------- single player (with computers) ----------
  let botT = null, botKey = null, tickT = null;
  function scheduleLocal() {
    clearTimeout(tickT);
    if (mode !== "local" || !L) { clearTimeout(botT); botKey = null; return; }
    const ms = G.nextDeadline(L);
    if (ms >= 0) tickT = setTimeout(() => {
      if (mode !== "local" || !L) return;
      const ev = G.tick(L);
      if (ev.length) { handleEvents(ev); store.set(K.local, L); render(); } else scheduleLocal();
    }, ms + 30);
    if (L.phase !== "play" || !lBot(L.cur)) { clearTimeout(botT); botKey = null; return; }
    const key = `${L.hand}:${L.turn}:${L.seq}`;
    if (key === botKey) return;
    clearTimeout(botT); botKey = key;
    botT = setTimeout(() => {
      botKey = null;
      if (mode !== "local" || !L || L.phase !== "play" || !lBot(L.cur)) return;
      const a = G.suggest(G.view(L, L.cur), localLevel);
      if (!a || !doAct(a, L.cur)) { const o = G.options(L); doAct({ t: o && o.canCheck ? "check" : "call" }, L.cur) || doAct({ t: "fold" }, L.cur); }
    }, 900 + Math.random() * 900);
  }

  // ---------- actions ----------
  function doAct(a, actor) {
    if (mode === "local") {
      const pi = actor == null ? L.cur : actor;
      const res = G.act(L, pi, a);
      if (!res.ok) { if (!lBot(pi)) toast(res.error); return false; }
      handleEvents(res.events);
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

  // events: sounds, chips that fly, cards that are dealt or turned over
  let confettiFor = null;
  function handleEvents(events) {
    for (const ev of events || []) {
      if (ev.t === "deal") {
        sfx("deal", 4); raiseOpen = false; suspenseUntil = 0; revealing.clear(); clearTimeout(handTimer);
        afterRender.push(dealAnimation);
      } else if (ev.t === "board") sfx("deal", ev.n);
      else if (ev.t === "bet") {
        if (ev.kind === "fold") { sfx("fold"); foldAway(ev.pi); }
        else if (ev.kind === "check") sfx("check");
        else {
          sfx(ev.kind === "allin" ? "allin" : "chip");
          fly(seatEl(ev.pi), $("#potLine"), coins(ev.amount));
          if (ev.kind === "allin") afterRender.push(() => shoveFx(ev.pi));
        }
      } else if (ev.t === "runout") {
        const st = mode === "local" ? L : R && R.view;
        const seats = st ? st.players.map((p, i) => i).filter((i) => !st.players[i].folded && !st.players[i].out && i !== (V && V.me) && unseen(i)) : [];
        scheduleReveals(seats, 700, 450);
        sfx("thump");
      } else if (ev.t === "handEnd") handEnded(mode === "local" ? L : R && R.view);
    }
    if (events && events.some((e) => e.t === "board") && ((mode === "local" ? L : R && R.view) || {}).phase === "runout") sfx("thump");
  }

  // the cards fly out of the middle to every seat, and the blinds go into the pot
  function dealAnimation() {
    if (!V || calm()) return;
    const from = center($("#felt")), seats = V.players.map((p, i) => i).filter((i) => !V.players[i].out);
    seats.forEach((i, k) => {
      const el = seatEl(i);
      if (el) el.querySelectorAll(".cards .card").forEach((c, j) => dealFrom(c, from, (j * seats.length + k) * 70));
      if (i === V.me) document.querySelectorAll("#hole .card").forEach((c, j) => dealFrom(c, from, (j * seats.length + k) * 70, 560));
    });
    [V.sbSeat, V.bbSeat].forEach((i, k) => fly(seatEl(i), $("#potLine"), 1, { delay: seats.length * 140 + 200 + k * 120 }));
  }

  // ---------- the player's own moves ----------
  let armedFold = 0, raiseOpen = false, raiseVal = 0;
  function tryFold() {
    if (!myTurn()) return;
    if (V.opts.canCheck && Date.now() - armedFold > 2500) { armedFold = Date.now(); toast("Du kannst gratis checken. Tippe nochmal, um trotzdem zu passen."); return; }
    raiseOpen = false; doAct({ t: "fold" });
  }
  function tryCall() {
    if (!myTurn()) return;
    raiseOpen = false;
    doAct({ t: V.opts.canCheck ? "check" : "call" });
  }
  function toggleRaise() {
    if (!myTurn()) return;
    if (!V.opts.canRaise) { toast(V.opts.call >= V.players[V.me].chips ? "Du kannst nur noch mitgehen oder passen." : "Die letzte Erhöhung war zu klein, um noch einmal zu erhöhen."); return; }
    raiseOpen = !raiseOpen;
    if (raiseOpen) raiseVal = clampRaise(V.opts.minTo);
    renderDock();
  }
  const clampRaise = (x) => Math.max(V.opts.minTo, Math.min(V.opts.maxTo, Math.round(x)));
  const presetTo = (frac) => clampRaise(V.cbet + frac * (V.pot + V.opts.call));
  function sendRaise() {
    if (!myTurn() || !raiseOpen) return;
    const to = clampRaise(raiseVal);
    raiseOpen = false;
    doAct(to >= V.opts.maxTo ? { t: "allin" } : { t: "raise", to });
  }
  function showHint() {
    if (!myTurn()) return;
    const a = G.suggest(V, "hard");
    if (!a) return;
    sfx("hint");
    if (a.t === "fold") toast("Tipp: Passen, die Hand ist zu schwach für diesen Einsatz.");
    else if (a.t === "check") toast("Tipp: Checken.");
    else if (a.t === "call") toast(`Tipp: Mitgehen (${money(V.opts.call)}).`);
    else toast(a.t === "allin" ? "Tipp: All-in." : `Tipp: Auf ${money(a.to)} erhöhen.`);
  }

  // ---------- rendering ----------
  function showScreen(id) { for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id; }

  function render() {
    if (mode === "local" && L) {
      V = G.view(L, 0);
      showScreen("game"); renderGame();
      scheduleLocal();
    } else if (mode === "online" && R) {
      const meM = R.members[R.you], waiting = !!(R.view && meM && meM.lobby);
      if (!waiting) watching = false;
      if (!R.view || (waiting && !watching)) { V = null; showScreen("lobby"); UI.renderLobby(); $("#roundEnd").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else {
      V = null; $("#roundEnd").hidden = true;
      clearTimeout(botT); clearTimeout(tickT); botKey = null; stackShown = {}; suspenseUntil = 0;
      showScreen("home"); renderHome();
    }
    UI.update();
    const q = afterRender; afterRender = [];
    if (V) q.forEach((f) => f());
  }

  let lastTurnKey = null, lastHand = null, lastBoard = 0, overReady = 0, overKey = null;
  function renderGame() {
    const me = V.players[V.me];
    $("#roundInfo").innerHTML = `Hand <b>${V.hand}</b> · Blinds <b>${money(V.blinds.sb)}/${money(V.blinds.bb)}</b>` +
      `${V.nextBlinds === 1 ? " · steigen nach dieser Hand" : ""}${me && mode === "online" ? ` · du: <b>${money(me.chips)}</b>` : ""}`;
    $("#reactBtn").hidden = mode !== "online";
    if (V.hand !== lastHand) { lastHand = V.hand; lastBoard = 0; raiseOpen = false; }
    renderPlayers();
    renderBoard();
    renderDock();
    $("#felt").classList.toggle("tense", V.phase === "runout");
    const key = `${V.hand}:${V.turn}`;
    if (key !== lastTurnKey && lastTurnKey !== null && myTurn() && (mode === "online" || V.players.some((p) => p.bot))) { sfx("turn"); buzz([40, 60, 40]); }
    lastTurnKey = key;
    const over = V.phase === "roundEnd" && V.last && V.last.over;
    if (over && overKey !== `${V.hand}:${V.turn}:${V.seq}`) { overKey = `${V.hand}:${V.turn}:${V.seq}`; overReady = Math.max(Date.now(), suspenseUntil) + 2800; setTimeout(render, overReady - Date.now() + 100); }
    const showEnd = !!over && Date.now() >= overReady;
    $("#roundEnd").hidden = !showEnd;
    if (showEnd) renderFinal();
  }

  const ACT = { fold: "Passt", check: "Check", call: "Mitgegangen", bet: "Setzt", raise: "Erhöht auf", allin: "All-in", sb: "Blind", bb: "Blind" };
  let eqKey = "", eqVal = [];
  function renderPlayers() {
    const members = mode === "online" && R ? R.members : null;
    const wait = V.phase === "roundEnd" && !!V.last && waiting();
    const ended = V.phase === "roundEnd" && !!V.last && !wait;
    const winners = ended ? V.last.winners : [];
    const hands = V.phase === "roundEnd" && V.last && V.last.hands ? V.last.hands : [];
    const won = {};
    for (const h of hands) won[h.i] = h;
    // all-in with the cards open: everybody's chance to win, updated with every card
    let eq = {};
    if (V.phase === "runout" && revealing.size === 0) {
      const inHand = V.players.map((p, i) => i).filter((i) => !V.players[i].folded && !V.players[i].out && V.players[i].hole[0] != null);
      if (inHand.length >= 2) {
        const key = inHand.join() + "|" + V.board.join() + "|" + inHand.map((i) => V.players[i].hole.join()).join(";");
        if (key !== eqKey) { eqKey = key; eqVal = G.equities(inHand.map((i) => V.players[i].hole), V.board, 500); }
        inHand.forEach((i, k) => { eq[i] = eqVal[k]; });
      }
    }
    $("#players").innerHTML = V.players.map((p, i) => {
      const active = V.phase === "play" && i === V.cur;
      const away = members && members[i] && !members[i].online && !p.bot;
      let act = "", cls = "";
      if (p.out) act = `ausgeschieden${p.place ? `, Platz ${p.place}` : ""}`;
      else if (ended && won[i]) { act = G.HANDS[won[i].cat] + (won[i].won ? ` · +${money(won[i].won)}` : ""); if (winners.includes(i)) cls = " good"; }
      else if (ended && winners.includes(i)) { act = `+${money(V.last.pot)}`; cls = " good"; }
      else if (wait && won[i] && !revealing.has(i)) act = G.HANDS[won[i].cat];
      else if (eq[i] != null) { act = `${Math.round(eq[i] * 100)} % Chance`; cls = ` eq ${eq[i] >= 0.5 ? "hi" : "lo"}`; }
      else if (active) act = "ist dran";
      else if (p.act) act = ACT[p.act] + (p.act === "bet" || p.act === "raise" ? ` ${money(p.actTo)}` : "");
      const tags = (i === V.dealer ? '<span class="tag" title="Dealer">D</span>' : "") + (i === V.sbSeat && !p.out ? '<span class="tag blind">SB</span>' : "") + (i === V.bbSeat && !p.out ? '<span class="tag blind">BB</span>' : "");
      const faces = revealing.has(i) ? [null, null] : p.hole;
      const cards = faces.map((c) => cardHTML(c, "mini" + (p.folded ? " dim" : ""))).join("");
      const shown = stackShown[i] == null ? p.chips : stackShown[i];
      return `<div class="pcard${active ? " active" : ""}${ended && winners.includes(i) ? " win" : ""}${p.folded && !p.out ? " fold" : ""}${p.out ? " out" : ""}" data-seat="${i}" style="${away ? "opacity:.5" : ""}">` +
        `<div class="who"><span class="av">${p.avatar || (p.bot ? "🤖" : "")}</span><span class="nm">${esc(i === V.me && mode === "online" ? `${p.name} (du)` : p.name)}</span><span class="tags">${tags}</span></div>` +
        `<div class="stack"><span class="coin"></span><span class="sv" data-seat="${i}">${money(shown)}</span></div>` +
        `<div class="cards">${cards}</div><div class="act${cls}">${esc(act)}</div>` +
        (p.bet ? `<span class="bet">${money(p.bet)}</span>` : "") + `</div>`;
    }).join("");
    syncStacks();
  }

  const STREET = { pre: "Vor dem Flop", flop: "Flop", turn: "Turn", river: "River" };
  function renderBoard() {
    const box = $("#board");
    if (box.children.length !== 5) box.innerHTML = Array.from({ length: 5 }, () => `<span class="card slot" data-w="slot"></span>`).join("");
    const new0 = V.board.length > lastBoard ? lastBoard : V.board.length;
    const hit = new Set();
    if (V.phase === "roundEnd" && V.last && V.last.kind === "show" && !waiting()) {
      // highlight the five cards of the first winner's hand
      const h = (V.last.hands || []).find((x) => x.i === V.last.winners[0]);
      if (h) bestFive(h.hole.concat(V.board)).forEach((c) => hit.add(c));
    }
    for (let i = 0; i < 5; i++) {
      const el = box.children[i], id = V.board[i], want = id == null ? "slot" : `${id}`;
      if (el.dataset.w === want) continue;
      const tmp = document.createElement("div");
      tmp.innerHTML = id == null ? `<span class="card slot"></span>` : cardHTML(id);
      const ne = tmp.firstElementChild;
      ne.dataset.w = want;
      box.replaceChild(ne, el);
      // the flop drops in together, turn and river are turned slowly (more so when everybody is all-in)
      if (id != null && i >= new0) flipIn(ne, (i - new0) * 170, V.phase === "runout" && i >= 3 ? 1000 : 520);
    }
    [...box.children].forEach((el) => { el.classList.toggle("hit", hit.has(+el.dataset.id)); el.classList.toggle("dim", hit.size > 0 && el.dataset.w !== "slot" && !hit.has(+el.dataset.id)); });
    lastBoard = V.board.length;
    const potNow = V.phase === "roundEnd" && V.last && waiting() ? V.last.pot : V.pot;
    $("#potLine").innerHTML = potNow ? `<span><span class="coin"></span>Pot ${money(potNow)}</span>` : V.phase === "roundEnd" ? `<small>Hand ${V.hand} beendet</small>` : "";
    $("#streetLine").textContent = V.phase === "runout" ? "Alle All-in: Karten werden aufgedeckt …" : V.phase === "roundEnd" ? (waiting() ? "Showdown" : "") : STREET[V.street];
  }
  // the five cards of the best hand, for highlighting
  function bestFive(ids) {
    let top = null, pick = [], out = [];
    (function rec(start) {
      if (pick.length === 5) { const k = G.best(pick.map((i) => ids[i])); if (!top || G.cmpKey(k, top) > 0) { top = k; out = pick.map((i) => ids[i]); } return; }
      for (let i = start; i < ids.length; i++) { pick.push(i); rec(i + 1); pick.pop(); }
    })(0);
    return out;
  }

  let nextT = null;
  function renderDock() {
    const mine = myTurn();
    const p = V.players[V.me];
    $("#dock").classList.toggle("myturn", mine);
    const spectator = V.me < 0;
    // own cards
    $("#hole").innerHTML = spectator ? "" : V.hole.map((c) => cardHTML(c, p && p.folded ? "dim" : "")).join("");
    $("#hole").hidden = spectator;
    const hi = V.handNow, live = !spectator && hi && !(p && (p.folded || p.out)) && (V.phase === "play" || V.phase === "runout");
    $("#handNow").textContent = live ? G.label(hi.key) + (hi.tableOnly ? " · liegt am Tisch" : "") : "";
    const meter = $("#meter");
    meter.hidden = !live;
    if (live) {
      meter.style.setProperty("--mc", hi.power >= 4 ? "var(--green)" : hi.power === 3 ? "var(--accent)" : "var(--red)");
      [...meter.children].forEach((d, k) => { d.style.transitionDelay = `${k * 70}ms`; d.classList.toggle("on", k < hi.power); });
      meter.title = `Handstärke ${hi.power} von 5`;
    }
    let who_, hint;
    const wait = V.phase === "roundEnd" && !!V.last && waiting();
    const ended = V.phase === "roundEnd" && !!V.last && !wait;
    if (wait) { who_ = "Showdown"; hint = "Die Karten werden aufgedeckt …"; }
    else if (ended) {
      const w = V.last.winners, nm = (i) => (mode === "online" && i === V.me ? "Du" : V.players[i].name);
      const total = V.last.pots.reduce((s, x) => s + x.amount, 0);
      const first = V.last.pots[0];
      who_ = V.last.over ? `${V.players[V.last.champ].name} hat alle Chips` : w.length === 1 ? `${nm(w[0])} ${nm(w[0]) === "Du" ? "gewinnst" : "gewinnt"} ${money(total)}` : `${w.map(nm).join(" und ")} teilen sich ${money(total)}`;
      hint = first ? first.label + (V.last.pots.length > 1 ? " (Hauptpot)" : "") : "";
    } else if (V.phase === "runout") { who_ = "Alle All-in"; hint = "Die restlichen Karten kommen einzeln."; }
    else if (spectator) { who_ = `${V.players[V.cur].name} ist dran`; hint = "Du schaust zu."; }
    else if (p && (p.folded || p.out)) { who_ = p.out ? "Du bist ausgeschieden" : "Du hast gepasst"; hint = `${V.players[V.cur].name} ist dran.`; }
    else if (mine) {
      who_ = mode === "local" ? `${p.name}, du bist dran` : "Du bist dran";
      hint = V.opts.canCheck ? "Checken oder setzen." : `${money(V.opts.call)} mitgehen, erhöhen oder passen.`;
    } else if (V.phase === "play") { who_ = `${V.players[V.cur].name} überlegt`; hint = p && p.allin ? "Du bist All-in." : "Warte, bis du dran bist."; }
    $("#whoName").textContent = who_ || "";
    $("#whoHint").textContent = hint || "";

    // buttons
    const canAct = !spectator && !ended && V.phase === "play";
    $("#actsPlay").hidden = !!(ended || wait) || spectator;
    $("#actsNext").hidden = !ended || V.last.over || spectator;
    const o = V.opts;
    const fb = $("#foldBtn"), cb = $("#callBtn"), rb = $("#raiseBtn");
    fb.disabled = !mine; cb.disabled = !mine; rb.disabled = !mine || !(o && o.canRaise);
    cb.textContent = !mine || !o ? "Check" : o.canCheck ? "Check" : o.call >= p.chips ? `All-in ${money(p.chips)}` : `Mitgehen ${money(o.call)}`;
    rb.textContent = V.cbet === 0 ? "Setzen" : "Erhöhen";
    rb.classList.toggle("btn-primary", raiseOpen);
    $("#hintBtn").hidden = !mine;
    // raise panel
    const box = $("#raiseBox");
    box.hidden = !(mine && raiseOpen);
    if (!box.hidden) {
      const range = $("#raiseRange");
      raiseVal = clampRaise(raiseVal);
      range.min = o.minTo; range.max = o.maxTo; range.step = o.maxTo - o.minTo > 400 ? V.blinds.sb : 1; range.value = raiseVal;
      $("#raiseOut").textContent = money(raiseVal);
      const opts = [["Min", o.minTo], ["½ Pot", presetTo(0.5)], ["¾ Pot", presetTo(0.75)], ["Pot", presetTo(1)], ["All-in", o.maxTo]];
      $("#presets").innerHTML = opts.map(([n, to]) => `<button type="button" data-to="${to}">${n}</button>`).join("");
      $("#raiseGo").textContent = raiseVal >= o.maxTo ? `All-in ${money(o.maxTo)}` : `${V.cbet === 0 ? "Setzen auf" : "Erhöhen auf"} ${money(raiseVal)}`;
    }
    // next hand: skip the wait, or tap when it is one phone
    clearInterval(nextT);
    if (ended && !V.last.over) {
      const nb = $("#nextBtn");
      if (mode === "online" && V.nextIn) {
        const end = Date.now() + V.nextIn;
        const step = () => { const s = Math.max(0, Math.ceil((end - Date.now()) / 1000)); nb.textContent = `Nächste Hand${s ? ` (${s})` : ""}`; };
        step(); nextT = setInterval(step, 250);
      } else nb.textContent = "Nächste Hand";
    }
    renderClock();
  }

  // online house rule: 30 s per turn, shown as a shrinking bar
  let clockKey = null;
  function renderClock() {
    const bar = $("#turnBar"), left = mode === "online" && R ? R.turnLeft : 0;
    if (!left || !V || V.phase !== "play") { bar.hidden = true; clockKey = null; return; }
    const key = `${V.hand}:${V.turn}`;
    if (clockKey === key) return;
    clockKey = key; bar.hidden = false; bar.classList.remove("low");
    const i = bar.firstElementChild;
    i.getAnimations().forEach((a) => a.cancel());
    i.animate([{ transform: `scaleX(${left / G.TURN_MS})` }, { transform: "scaleX(0)" }], { duration: left, easing: "linear", fill: "forwards" });
    clearTimeout(renderClock.t);
    renderClock.t = setTimeout(() => { if (clockKey === key) { bar.classList.add("low"); if (myTurn()) { toast("Noch 10 Sekunden!"); buzz(80); } } }, Math.max(0, left - 10000));
  }

  function rankingHTML(final) {
    const idx = V.players.map((_, i) => i).sort((a, b) => {
      const pa = V.players[a], pb = V.players[b];
      return (pa.out ? pa.place : 0) - (pb.out ? pb.place : 0) || pb.chips - pa.chips;
    });
    const win = V.last && V.last.over ? V.last.champ : -1;
    return idx.map((i) => {
      const p = V.players[i];
      return `<li class="${final && i === win ? "win" : ""}"><span class="av">${p.avatar || ""}</span><span class="nm">${esc(p.name)}${mode === "online" && i === V.me ? " (du)" : ""}</span>` +
        `<span class="w">${money(p.chips)}</span><span class="res">${p.out ? `Platz ${p.place}, ausgeschieden` : p.folded && V.phase === "play" ? "hat gepasst" : i === win ? "Turniersieger" : ""}</span></li>`;
    }).join("");
  }
  function renderFinal() {
    const c = V.last.champ, you = mode === "online" && c === V.me;
    $("#reLabel").textContent = "Turnier vorbei";
    $("#reTitle").textContent = `${you ? "Du gewinnst" : `${V.players[c].name} gewinnt`} das Turnier!`;
    $("#reRanking").innerHTML = rankingHTML(true);
    UI.roundEndFooter({ over: true });
    const k = `${V.hand}:${c}`;
    if (confettiFor !== k) { confettiFor = k; confetti(); sfx("win"); const me = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot); if (me >= 0) Spieleabend.profile.result("poker", k, { won: c === me, online: mode === "online" }); }
  }

  // ---------- start screen ----------
  const levelButtons = (cur) => Object.entries(G.BOT_LEVELS).map(([k, n]) => `<button type="button" data-level="${k}" aria-pressed="${k === cur}">${n}</button>`).join("");
  const chipButtons = (cur) => G.CHIPS.map((c) => `<button type="button" data-chips="${c}" aria-pressed="${c === cur}">${money(c)}</button>`).join("");
  const activeNames = (r) => G.RULES.filter((x) => r && r[x.k]).map((x) => x.name);
  function rulesHTML(r, editable, local) {
    return G.RULES.filter((x) => !(local && x.onlineOnly)).map((x) =>
      `<label class="toggle" for="rule-${local ? "l" : "o"}-${x.k}"><input type="checkbox" id="rule-${local ? "l" : "o"}-${x.k}" data-rule="${x.k}"` +
      `${r[x.k] ? " checked" : ""}${editable ? "" : " disabled"}><span>${x.name}<small>${x.desc}</small></span></label>`).join("");
  }
  function renderHome() {
    for (const b of document.querySelectorAll("#modeTabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
    $("#onlinePanel").hidden = tab !== "online" || !webHost;
    $("#onlineOff").hidden = tab !== "online" || webHost;
    $("#localPanel").hidden = tab !== "local";
    const sh = $("#serverHint");
    sh.hidden = serverState === "ok";
    sh.textContent = serverState === "checking" ? "Suche den Spiel-Server …" : "Unter dieser Adresse antwortet kein Poker-Server. „Einzelspieler“ geht immer.";
    $("#chipsLocal").innerHTML = chipButtons(chipsLocal);
    $("#myAvatar").textContent = myAvatar;
    const saved = store.get(K.local);
    $("#resumePanel").hidden = !(saved && saved.players);
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => p.name).join(", ")} · Hand ${saved.hand}`;
    HOME.render();
    $("#levelLocal").innerHTML = levelButtons(localLevel);
    const box = $("#rulesLocal");
    if (!box.firstChild) box.innerHTML = rulesHTML(localRules, true, true);
    const on = activeNames(localRules).filter((n) => !G.RULES.find((x) => x.name === n).onlineOnly);
    $("#rulesLocalSum").textContent = on.length ? on.join(", ") : "keine";
    LOOK.render();
    // the hero: pocket aces
    if (!$("#heroDice").firstChild) $("#heroDice").innerHTML = cardHTML(13 * 0 + 12) + cardHTML(13 * 1 + 12);
  }

  // ---------- look: table design and size (shared, kit.js), applied before anything is drawn ----------
  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Kartengröße" });

  // ---------- reactions ----------
  // reactions float above everything (fixed), so the top edge of the screen or a scrolling
  // player strip can't clip them; near the top they show up below the player instead
  function bubble(pi, e) {
    const host = pi === (R && R.you) ? $("#dock") : document.querySelector(`#players .pcard[data-seat="${pi}"]`);
    if (!host) return;
    const b = document.createElement("span");
    b.className = e.length > 2 ? "bubble text" : "bubble"; b.textContent = e;
    showBubble(host, b); setTimeout(() => b.remove(), 2800); sfx("pop");
  }
  $("#reactBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#reactBar").hidden = !$("#reactBar").hidden; });
  $("#reactBar").addEventListener("click", (e) => { const b = e.target.closest("[data-e]"); if (!b) return; $("#reactBar").hidden = true; wsSend({ t: "react", e: b.dataset.e }); });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#reactBar, #reactBtn")) $("#reactBar").hidden = true; });

  // ---------- online connection ----------
  function wsSend(m) { return UI.send(m); }

  // ---------- events ----------
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; tabTouched = true; renderHome(); } });
  const pickChips = (e, set) => { const b = e.target.closest("[data-chips]"); if (b) { set(+b.dataset.chips); store.set(K.chips, +b.dataset.chips); renderHome(); } };
  $("#chipsLocal").addEventListener("click", (e) => pickChips(e, (c) => { chipsLocal = c; }));

  // ---------- waiting room and menu: shared (room-ui.js), plus this game's own parts ----------
  const UI = window.RoomUI({
    room: () => R, view: () => V, mode: () => mode, server: () => server,
    watching: (v) => (v === undefined ? watching : (watching = v)),
    onlineKey: K.online,
    on: {
      opened() { if (serverState !== "ok") { serverState = "ok"; server = server || {}; } },
      joined(m) { mode = "online"; wake(); },
      room(m) { R = m; mode = "online"; if (m.view) handleEvents(m.events); render(); },
      react(m) { bubble(m.pi, m.e); },
      error() { if (V) render(); },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text) => bubble(pi, text),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    // start chips, computer strength and house rules; the host picks, everyone sees it
    renderSettings(host) {
      $("#levelLobbyBox").hidden = !R.members.some((m) => m.bot);
      $("#levelLobby").innerHTML = levelButtons(R.botLevel || "normal");
      $("#levelLobby").querySelectorAll("button").forEach((b) => { b.disabled = !host; });
      $("#chipsLobby").innerHTML = chipButtons(R.chips);
      $("#chipsLobby").querySelectorAll("button").forEach((b) => { b.disabled = !host; });
      const rl = $("#rulesLobby"), key = JSON.stringify(R.rules) + host;
      if (rl.dataset.k !== key) { rl.dataset.k = key; rl.innerHTML = rulesHTML(R.rules || {}, host, false); }
      const onR = activeNames(R.rules || {});
      $("#rulesLobbySum").textContent = onR.length ? onR.join(", ") : "keine";
      $("#rulesLobbyHint").textContent = host ? "Tippe an, was gelten soll. Alle sehen deine Auswahl." : `${R.members[R.host].name} legt die Hausregeln fest.`;
    },
    menu: {
      open() {
        $("#menuScores").innerHTML = rankingHTML(false);
        const on = activeNames(V.rules);
        $("#menuRules").textContent = `Start mit ${money(V.startChips)} Chips.${on.length ? ` Hausregeln: ${on.join(", ")}.` : " Keine Hausregeln."}`;
        LOOK.render();
      },
      local(box) {
        box.append(UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; render(); }));
      },
      player() {},
      skip: (v) => v.phase === "play" && v.cur !== v.me,
      standIn: true
    }
  });

  $("#chipsLobby").addEventListener("click", (e) => { const b = e.target.closest("[data-chips]"); if (b && R && R.you === R.host) wsSend({ t: "settings", chips: +b.dataset.chips }); });
  $("#levelLobby").addEventListener("click", (e) => { const b = e.target.closest("[data-level]"); if (b && R && R.you === R.host) wsSend({ t: "settings", botLevel: b.dataset.level }); });
  $("#rulesLobby").addEventListener("change", (e) => {
    const k = e.target.dataset.rule; if (!k || !R || R.you !== R.host) return;
    const next = Object.assign({}, R.rules, { [k]: e.target.checked });
    store.set(K.rules, Object.assign(localRules, next));
    wsSend({ t: "settings", rules: next });
  });

  $("#myName").value = store.get(K.me) || "";
  $("#myName").addEventListener("input", (e) => store.set(K.me, e.target.value));
  Spieleabend.avatarPicker({ avatars: G.AVATARS, get: () => myAvatar, set: (a) => { myAvatar = a; store.set(K.avatar, a); } });
  const myName = () => { const n = $("#myName").value.trim(); if (!n) { toast("Bitte gib zuerst deinen Namen ein."); $("#myName").focus(); } return n; };

  $("#levelLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-level]"); if (!b) return; localLevel = b.dataset.level; store.set(K.level, localLevel); renderHome(); });
  $("#rulesLocal").addEventListener("change", (e) => {
    const k = e.target.dataset.rule; if (!k) return;
    localRules[k] = e.target.checked; store.set(K.rules, localRules); renderHome();
  });
  $("#startLocal").addEventListener("click", () => {
    const { names, bots } = HOME.roster($("#myName").value);
    const list = names.map((n, i) => ({ name: n, bot: bots[i], avatar: bots[i] ? "🤖" : myAvatar }));
    L = G.newGame(list, chipsLocal, Object.assign({}, localRules, { turnTimer: false }), false);
    mode = "local"; lastTurnKey = null; lastHand = null;
    store.set(K.local, L); render(); wake();
  });
  $("#resumeBtn").addEventListener("click", () => {
    L = store.get(K.local); if (!L) return render();
    mode = "local"; render(); wake();
  });

  $("#foldBtn").addEventListener("click", tryFold);
  $("#callBtn").addEventListener("click", tryCall);
  $("#raiseBtn").addEventListener("click", toggleRaise);
  $("#raiseGo").addEventListener("click", sendRaise);
  $("#raiseRange").addEventListener("input", (e) => { raiseVal = +e.target.value; renderDock(); });
  $("#presets").addEventListener("click", (e) => { const b = e.target.closest("[data-to]"); if (b) { raiseVal = +b.dataset.to; sfx("hint"); renderDock(); } });
  $("#nextBtn").addEventListener("click", () => doAct({ t: "next" }));
  $("#hintBtn").addEventListener("click", showHint);
  $("#reBtn").addEventListener("click", () => doAct({ t: "next" }));
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; render(); }
    else if (R && R.members[R.you] && R.members[R.you].lobby) { watching = false; render(); }
    else if (V && V.phase === "roundEnd") wsSend({ t: "lobby" });
    else wsSend({ t: "end" });
  });
  // desktop: F folds, C/space checks or calls, R raises (Enter confirms), H hint
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey || $("#game").hidden) return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") { if (open) $(open).hidden = true; else if (raiseOpen) { raiseOpen = false; renderDock(); } return; }
    if (open || !$("#roundEnd").hidden) return;
    const k = e.key.toLowerCase();
    if (k === "f") tryFold();
    else if (k === "c" || e.key === " ") { e.preventDefault(); tryCall(); }
    else if (k === "r") toggleRaise();
    else if (e.key === "Enter") { e.preventDefault(); if (raiseOpen) sendRaise(); else if (V && V.phase === "roundEnd" && !V.last.over) doAct({ t: "next" }); }
    else if (k === "h") showHint();
  });

  // best hand first, with an example
  const EXAMPLES = ["As Ks Qs Js Ts", "9h 9d 9s 9c 2d", "3h 3d 3s 8c 8d", "2s 7s 9s Js Ks", "5h 6d 7s 8c 9d", "Qh Qd Qs 8c 2d", "Qh Qd 8s 8c 2d", "Qh Qd 7s 8c 2d", "Ah Qd 7s 8c 2d"];
  const cardOf = (t) => "shdc".indexOf(t[1]) * 13 + "23456789TJQKA".indexOf(t[0]);
  const RANKNAMES = ["Royal Flush / Straight Flush", "Vierling", "Full House", "Flush", "Straße", "Drilling", "Zwei Paare", "Ein Paar", "Hohe Karte"];
  for (const ol of document.querySelectorAll(".ranklist")) ol.innerHTML = EXAMPLES.map((t, k) => `<li><b>${RANKNAMES[k]}</b> <span style="display:inline-flex;gap:2px;vertical-align:middle">${t.split(" ").map((c) => cardHTML(cardOf(c), "mini")).join("")}</span></li>`).join("");

  // keep the screen on while playing (needs HTTPS)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (mode) wake();
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- boot ----------
  const code = UI.roomCode();
  render();
  if (webHost && store.get(K.online) && !code) UI.resume();
  UI.detectServer("/poker-server", "poker").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
