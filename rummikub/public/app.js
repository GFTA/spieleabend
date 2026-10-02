// Rummikub UI: single player (against the computer) and online rooms share one table renderer.
(() => {
  "use strict";
  const G = window.RummikubGame;
  // An old cached game.js next to a new app.js: reload once without cache instead of breaking.
  if (!G || !G.botMove || !G.AVATARS) {
    let tried = false;
    try { tried = sessionStorage.getItem("rummikub.reloaded") === "1"; sessionStorage.setItem("rummikub.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("rummikub.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const K = { local: "rummikub.v1", online: "rummikub.online", me: "rummikub.me", goal: "rummikub.goal", meld: "rummikub.meld", level: "rummikub.level",
    sound: "rummikub.sound", stats: "rummikub.stats", avatar: "rummikub.avatar", look: "rummikub.look", sort: "rummikub.sort" };
  const store = Spieleabend.store;
  const { rectOf } = Cards;

  // table design and size (shared, kit.js), applied before anything is drawn
  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Größe" });

  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");

  const MELDS = [30, 20, 0].map((v) => [v, G.MELDS[v]]);
  const LEVELS = Object.entries(G.LEVELS).map(([v, name]) => [+v, name]);
  const GOALS = [[1, "Eine Runde"], [2, "Bis 2 Siege"], [3, "Bis 3 Siege"]];

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let R = null;           // last online room message
  let watching = false;   // in the waiting room, but watching the game that runs
  let V = null;           // view currently on screen
  let W = null;           // my working copy of the table and rack during my turn: { key, sets, rack, orig, start, sel }
  let pulse = null;       // { pi } who just moved
  let fresh = new Set();  // tiles the last other player put on the table
  let peek = false;       // round over, looking at the table
  let inflight = false;
  let endHold = 0;        // the round-end sheet waits until the last move has been seen
  let sortMode = store.get(K.sort) === "num" ? "num" : "color";
  let pend = { old: null, plays: [], draws: [] }; // what the next redraw has to animate
  let dealKey = null, prevRack = new Set();
  let server = null;      // server info once found ({} when only the WebSocket answered)
  let serverState = "checking"; // "checking" | "ok" | "none"
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "rummikub.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let goalLocal = G.normGoal(store.get(K.goal) || 1), meldLocal = G.normMeld(store.get(K.meld) || 30);
  let levelLocal = G.normLevel(store.get(K.level) || 2);
  let lastTurn = null, confettiFor = null;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const canPlay = () => !!V && V.phase === "play" && V.cur >= 0 && V.cur === V.me;
  const pname = (i) => (i === V.me ? "Du" : V.players[i].name);
  const { toast, confetti, showBubble } = Spieleabend;

  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound,
    effects: ({ tone, noise }) => ({
      place: () => { tone(520, 0, 0.05, "triangle", 0.12); tone(390, 0.04, 0.06, "triangle", 0.08); },
      draw: () => noise(0.22, 0.05, 0.2, 2200),
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16))
    })
  });

  // ---------- tiles ----------
  const SYM = ["●", "■", "▲", "◆"], CNAME = ["Schwarz", "Blau", "Rot", "Orange"];
  function tileHTML(id, cls, withId = true) {
    const d = withId ? ` data-id="${id}"` : "";
    if (G.isJoker(id)) return `<span class="tile joker ${cls || ""}"${d} role="img" aria-label="Joker"><b>☺</b></span>`;
    const c = G.colorOf(id);
    return `<span class="tile t${c} ${cls || ""}"${d} role="img" aria-label="${CNAME[c]} ${G.numOf(id)}"><b>${G.numOf(id)}</b><i>${SYM[c]}</i></span>`;
  }
  const backHTML = '<span class="tile back"><b>R</b></span>';
  const sortKey = (id) => (G.isJoker(id) ? 1e6 + id : sortMode === "num" ? (G.numOf(id) * 4 + G.colorOf(id)) * 2 + (id % 2) : (G.colorOf(id) * 14 + G.numOf(id)) * 2 + (id % 2));
  const sorted = (ids) => ids.slice().sort((a, b) => sortKey(a) - sortKey(b));

  // ---------- my turn: a working copy of the table ----------
  const me = () => V.players[V.me];
  const locked = (id) => !!W && !me().melded && W.orig.has(id); // before the first meld the table stays as it is
  const lockedSet = (s) => !!s.length && locked(s[0]);
  function newW() {
    return { key: `${V.round}:${V.turn}`, sets: V.table.map((s) => s.slice()), rack: V.rack.slice(), orig: new Set(V.table.flat()), start: new Set(V.rack), sel: null };
  }
  function norm() { // a valid set shows in its proper order, an unfinished one stays as it was laid
    W.sets = W.sets.filter((s) => s.length).map((s) => { const a = G.analyze(s); return a ? a.order.slice() : s; });
  }
  function check() {
    const bad = W.sets.some((s) => !G.analyze(s));
    const added = W.start.size - W.rack.length;
    let value = 0;
    for (const s of W.sets) { const a = G.analyze(s); if (a && !s.every((id) => W.orig.has(id))) value += a.value; }
    let msg = "";
    if (!added) msg = "Leg erst mindestens einen Stein aus deinem Ständer auf den Tisch. Oder zieh einen.";
    else if (bad) msg = "Ein Satz ist noch ungültig (rot). Reihe: mind. 3 Zahlen in Folge, eine Farbe. Gruppe: 3 oder 4 gleiche Zahlen, alle Farben verschieden.";
    else if (!me().melded && V.meld > 0 && value < V.meld) msg = `Zum ersten Auslegen brauchst du mindestens ${V.meld} Punkte, bisher ${value}.`;
    return { ok: !msg, msg, added, value, bad };
  }
  const dirtyW = () => !!W && (W.rack.length !== W.start.size || JSON.stringify(W.sets) !== JSON.stringify(V.table));

  const tileEl = (id) => document.querySelector(`#sets .tile[data-id="${id}"], #rack .tile[data-id="${id}"]`);
  const tileRect = (id) => { const el = tileEl(id); return el ? rectOf(el) : null; };
  function tileRects() {
    const o = {};
    if ($("#game").hidden) return o;
    for (const el of document.querySelectorAll("#sets .tile[data-id]")) o[el.dataset.id] = rectOf(el);
    return o;
  }
  const tileSize = () => { const t = document.querySelector("#rack .tile, #sets .tile"); const w = t ? t.getBoundingClientRect().width : 36; return { w, h: w * 1.38 }; };
  const around = (el) => { // a tile-sized rect centred on an element
    if (!el || $("#game").hidden) return null;
    const r = el.getBoundingClientRect(), { w, h } = tileSize();
    return { left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - h / 2, width: w, height: h };
  };
  const plateEl = (pi) => document.querySelector(`#plates [data-seat="${pi}"] .pav`);

  // where a flight lands: a tile on the table or in my rack, or a player's plate
  const fl = Cards.flights({
    off: () => $("#game").hidden,
    resolve(dst) {
      if (typeof dst === "number") { const el = tileEl(dst); return el ? { rect: rectOf(el), hide: el } : null; }
      const el = plateEl(dst.seat);
      return el ? { rect: rectOf(el), hide: null } : null;
    }
  });

  // move one tile: to a set (at position pos), to a new set, or back to the rack
  function moveTile(id, kind, i, pos, srcRect) {
    if (!W || !V) return false;
    const dest = kind === "set" ? W.sets[i] : null;
    if (kind === "set" && (!dest || lockedSet(dest))) return false;
    if (kind === "rack" && !W.start.has(id)) return false;
    if (locked(id)) return false;
    const src = srcRect || tileRect(id);
    for (const s of W.sets) { const k = s.indexOf(id); if (k >= 0) s.splice(k, 1); }
    const rk = W.rack.indexOf(id); if (rk >= 0) W.rack.splice(rk, 1);
    if (kind === "rack") W.rack.push(id);
    else if (kind === "new") W.sets.push([id]);
    else dest.splice(pos == null ? dest.length : Math.min(pos, dest.length), 0, id);
    W.sel = null;
    norm();
    if (src) fl.add({ src, dst: id, html: tileHTML(id, "", false), delay: 0, dur: srcRect ? 160 : 280 });
    sfx("place"); buzz(8);
    render();
    return true;
  }
  // insert position inside a set for a tile let go at rect (ignores the dragged tile itself)
  function posIn(setEl, rect, id) {
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let n = 0;
    for (const t of setEl.querySelectorAll(".tile")) {
      if (+t.dataset.id === id) continue;
      const r = t.getBoundingClientRect();
      if (cy < r.top || (cy <= r.bottom && cx < r.left + r.width / 2)) return n;
      n++;
    }
    return n;
  }

  const dnd = Cards.dnd({
    root: "#game",
    grab(e) {
      if (!W || inflight) return null;
      const el = e.target.closest("#rack .tile, #sets .tile");
      if (!el) return null;
      const id = +el.dataset.id;
      return locked(id) ? null : { el, id };
    },
    target(under, s) {
      const set = under.closest("#sets .set");
      if (set) return { el: set, ok: !lockedSet(W.sets[+set.dataset.i] || []), kind: "set", i: +set.dataset.i };
      if (under.closest("#rack")) return { el: $("#rack"), ok: W.start.has(s.id), kind: "rack" };
      if (under.closest("#arena")) return { el: $("#newSet"), ok: true, kind: "new" };
      return null;
    },
    drop(s, t, rect) {
      if (!t.ok) return false;
      if (t.kind === "set") return moveTile(s.id, "set", t.i, posIn(t.el, rect, s.id), rect);
      return moveTile(s.id, t.kind, 0, null, rect);
    },
    onStart() { if (W) W.sel = null; },
    onEnd(dirty) { if (dirty) render(); },
    tap(e) {
      if (!W || inflight || e.target.closest("button, a")) return;
      const tile = e.target.closest("#rack .tile, #sets .tile");
      if (tile) {
        const id = +tile.dataset.id, inRack = !!tile.closest("#rack");
        if (W.sel != null && W.sel !== id && !(inRack && W.rack.includes(W.sel))) {
          if (inRack) { if (!moveTile(W.sel, "rack")) toast("Dieser Stein lag schon auf dem Tisch und bleibt dort."); return; }
          const set = tile.closest(".set"), i = +set.dataset.i;
          if (lockedSet(W.sets[i])) { toast("Vor dem ersten Auslegen bleibt der Tisch, wie er ist."); return; }
          moveTile(W.sel, "set", i, [...set.querySelectorAll(".tile")].filter((t) => +t.dataset.id !== W.sel).indexOf(tile) + 1);
          return;
        }
        if (locked(id)) { toast("Vor dem ersten Auslegen bleibt der Tisch, wie er ist."); return; }
        W.sel = W.sel === id ? null : id;
        render();
        return;
      }
      if (W.sel == null) return;
      const set = e.target.closest("#sets .set");
      if (set) { if (!moveTile(W.sel, "set", +set.dataset.i)) toast("Vor dem ersten Auslegen bleibt der Tisch, wie er ist."); }
      else if (e.target.closest("#rack")) { if (!moveTile(W.sel, "rack")) toast("Dieser Stein lag schon auf dem Tisch und bleibt dort."); }
      else if (e.target.closest("#arena")) moveTile(W.sel, "new");
    }
  });

  // ---------- events → feedback (every move is animated, also the computer's and other people's) ----------
  function handleEvents(events, v) {
    if (!v) return;
    let played = 0;
    for (const ev of events || []) {
      if (ev.t === "play") {
        if (!pend.old) pend.old = tileRects();
        pend.plays.push({ pi: ev.pi, added: ev.added });
        fresh = ev.pi === v.me ? new Set() : new Set(ev.added);
        pulse = { pi: ev.pi };
        played = Math.max(played, ev.added.length);
        sfx("place"); if (ev.added.length > 1) setTimeout(() => sfx("place"), 160);
      }
      if (ev.t === "draw") { pend.draws.push({ pi: ev.pi, empty: ev.empty }); pulse = { pi: ev.pi }; if (!ev.empty) sfx("draw"); }
      if (ev.t === "giveup") toast(ev.pi === v.me ? "Du hast aufgegeben." : `${v.players[ev.pi].name} gibt auf.`);
      if (ev.t === "end") {
        setTimeout(() => sfx("win"), 500);
        if (played) { endHold = Date.now() + 700 + played * 90; setTimeout(render, endHold - Date.now() + 40); }
      }
    }
  }

  // the animations of the last events, started after the redraw (tiles already stand where they land)
  function queueFlights() {
    const p = pend; pend = { old: null, plays: [], draws: [] };
    const poolEl = $("#pool"), first = V.turn <= 1 && dealKey !== V.round;
    if (V.phase === "play" && first) {
      dealKey = V.round; fresh = new Set();
      sorted(V.rack).forEach((id, k) => fl.add({ src: around(poolEl), dst: id, html: backHTML, flipTo: tileHTML(id, "", false), delay: k * 45, dur: 520 }));
    } else if (dealKey === null) dealKey = V.round;
    for (const pl of p.plays) {
      if (pl.pi === V.me) continue;
      const from = around(plateEl(pl.pi));
      pl.added.forEach((id, k) => fl.add({ src: from, dst: id, html: tileHTML(id, "", false), delay: 100 + k * 90, dur: 520 }));
    }
    if (p.old) {
      for (const el of document.querySelectorAll("#sets .tile[data-id]")) {
        const id = +el.dataset.id, o = p.old[id];
        if (!o) continue;
        const n = rectOf(el);
        if (Math.abs(n.left - o.left) + Math.abs(n.top - o.top) > 6) fl.add({ src: o, dst: id, html: tileHTML(id, "", false), delay: 0, dur: 450 });
      }
    }
    for (const d of p.draws) {
      if (d.empty) continue;
      if (d.pi === V.me) {
        const mine = V.rack.filter((id) => !prevRack.has(id));
        mine.forEach((id) => fl.add({ src: around(poolEl), dst: id, html: backHTML, flipTo: tileHTML(id, "", false), delay: 0, dur: 600 }));
      } else fl.add({ src: around(poolEl), dst: { seat: d.pi }, html: backHTML, delay: 0, dur: 520 });
    }
    prevRack = new Set(V.rack);
  }

  // ---------- actions ----------
  function doAct(a) {
    if (mode === "local") {
      const res = G.act(L, L.cur, a);
      if (!res.ok) { toast(res.error); sfx("bad"); return false; }
      handleEvents(res.events, G.view(L, 0));
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
  function play(t) {
    if (!V || V.phase !== "play") return;
    if (!canPlay()) { toast(V.me < 0 ? "Du schaust zu." : `Warte, ${V.players[V.cur].name} ist dran.`); return; }
    if (inflight) return;
    let a = { t: "draw" };
    if (t === "done") {
      const c = check();
      if (!c.ok) { toast(c.msg); sfx("bad"); return; }
      a = { t: "commit", table: W.sets.map((s) => s.slice()) };
    }
    if (mode === "online") { inflight = true; setTimeout(() => { inflight = false; }, 3000); }
    buzz(10);
    doAct(a);
  }

  // the computer in single player (online the server moves it); pacing comes from the engine
  let botT = null;
  function scheduleBot() {
    clearTimeout(botT);
    const plan = mode === "local" && L ? G.botPlan(L) : null;
    if (!plan) return;
    botT = setTimeout(() => {
      if (mode !== "local" || !L || L.phase !== "play" || !L.players[L.cur].bot) return;
      if (!$("#menu").hidden || dnd.busy) { scheduleBot(); return; } // paused while the menu is open
      const pi = L.cur, a = G.botMove(L, pi);
      const res = a ? G.act(L, pi, a) : null;
      if (res && res.ok) { handleEvents(res.events, G.view(L, 0)); store.set(K.local, L); render(); }
      scheduleBot();
    }, plan.delay);
  }

  // ---------- rendering ----------
  function showScreen(id) {
    for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id;
  }

  function render() {
    if (mode && dnd.defer()) return;
    if (mode === "local" && L) {
      V = G.view(L, 0);
      showScreen("game");
      renderGame();
    } else if (mode === "online" && R) {
      const meM = R.members[R.you], waiting = !!(R.view && meM && meM.lobby);
      if (!waiting) watching = false;
      if (!R.view || (waiting && !watching)) { V = null; W = null; showScreen("lobby"); UI.renderLobby(); $("#roundEnd").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else {
      V = null; W = null;
      $("#roundEnd").hidden = true;
      showScreen("home"); renderHome();
    }
    UI.update();
  }

  function plateHTML(i) {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = members && members[i] && !members[i].online;
    const cls = ["plate", V.phase === "play" && V.cur === i ? "active" : "", away ? "away" : "", pulse && pulse.pi === i ? "pulse" : ""].join(" ");
    const tag = p.bot ? "Computer" : away ? "offline" : i === V.me ? "du" : "";
    const meta = [tag, V.meld > 0 && p.melded ? "ausgelegt" : ""].filter(Boolean).join(" · ");
    return `<div class="${cls}" data-seat="${i}"><span class="pav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="pinfo"><span class="pname">${esc(p.name)}</span><span class="pmeta">${meta || "&nbsp;"}</span></span>` +
      `<span class="pscore">${p.count}<small> Stk.</small></span>` +
      `<span class="pwins" title="Siege">${p.wins}</span></div>`;
  }

  function renderGame() {
    if (V.phase !== "roundEnd") peek = false;
    if (V.round !== (renderGame.round || 0)) { renderGame.round = V.round; fresh = new Set(); }
    const play = canPlay();
    if (!play) W = null;
    else if (!W || W.key !== `${V.round}:${V.turn}`) W = newW();
    else if (W.sel != null && !W.rack.includes(W.sel) && !W.sets.some((s) => s.includes(W.sel))) W.sel = null;

    $("#plates").innerHTML = V.players.map((_, i) => plateHTML(i)).join("");
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> · ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}`;
    pulse = null;

    // the table
    const sets = W ? W.sets : V.table;
    let html = sets.map((s, i) => {
      const bad = W && !G.analyze(s);
      const tiles = s.map((id) => tileHTML(id, [W && !locked(id) ? "cd-draggable" : "", W && W.sel === id ? "sel" : "", W && W.start.has(id) ? "mine" : "", fresh.has(id) ? "fresh" : ""].join(" "))).join("");
      return `<div class="set${bad ? " bad" : ""}" data-i="${i}">${tiles}</div>`;
    }).join("");
    if (W) html += `<div class="newset" id="newSet">+ Neuer Satz</div>`;
    else if (!sets.length) html = `<div class="empty-note">Noch nichts auf dem Tisch.</div>`;
    $("#sets").innerHTML = html;

    // my rack
    $(".rackrow").hidden = V.me < 0;
    const rackIds = sorted(W ? W.rack : V.rack);
    $("#rack").innerHTML = rackIds.map((id) => tileHTML(id, [W ? "cd-draggable" : "", W && W.sel === id ? "sel" : ""].join(" "))).join("");
    $("#sortColor").setAttribute("aria-pressed", String(sortMode === "color"));
    $("#sortNum").setAttribute("aria-pressed", String(sortMode === "num"));
    $("#pool b").textContent = V.pool;
    $("#pool").title = `${V.pool} Steine im Vorrat`;

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
      who = `${pname(w)} ${w === V.me ? "gewinnst" : "gewinnt"}`;
      av = V.players[w].avatar;
      hint = "Runde vorbei.";
    } else {
      const P = V.players[V.cur];
      av = P.avatar;
      if (play) {
        who = "Du bist dran";
        const c = check();
        if (!me().melded && V.meld > 0) hint = `Erstes Auslegen: ${c.value} von ${V.meld} Punkten${c.value >= V.meld ? " ✓" : ""}.`;
        else hint = c.bad ? "Rot markierte Sätze sind noch ungültig." : "Leg Steine an, bau um oder zieh einen.";
      } else {
        who = `${P.name} ist dran`;
        hint = P.bot ? "Der Computer überlegt …" : V.me < 0 ? "Du schaust zu." : "Warte auf den nächsten Zug.";
      }
    }
    $("#whoAv").textContent = av;
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    $("#dock").classList.toggle("myturn", play);
    const acts = V.phase === "play" && V.me >= 0;
    $("#doneBtn").hidden = $("#resetBtn").hidden = $("#drawBtn").hidden = !acts;
    if (acts) {
      const c = play ? check() : { ok: false };
      $("#doneBtn").classList.toggle("off", !c.ok);
      $("#resetBtn").disabled = !play || !dirtyW();
      $("#drawBtn").classList.toggle("off", !play);
      $("#drawBtn").textContent = V.pool ? "Ziehen" : "Aussetzen";
    }
    $("#resultBtn").hidden = !(V.phase === "roundEnd" && peek);
    $("#reactBtn").hidden = mode !== "online";
    $("#keys").innerHTML = play ? "<kbd>Enter</kbd> fertig · <kbd>Z</kbd> ziehen" : "";

    // turn change feedback
    const key = `${V.round}:${V.turn}:${V.cur}`;
    if (play && lastTurn !== key && lastTurn !== null && (mode === "online" || V.players.some((p) => p.bot))) { buzz([40, 60, 40]); sfx("turn"); }
    lastTurn = key;

    queueFlights();
    fl.run(); fl.hide();

    $("#roundEnd").hidden = V.phase !== "roundEnd" || peek || Date.now() < endHold;
    if (V.phase === "roundEnd") {
      if (!$("#roundEnd").hidden) renderRoundEnd();
      const k = `${V.round}:${V.last.winners.join(",")}:${V.players.map((p) => p.wins).join(",")}`;
      if (confettiFor !== k) {
        confettiFor = k; record(k);
        setTimeout(() => confetti(), 700);
      }
    }
  }

  $("#doneBtn").addEventListener("click", () => play("done"));
  $("#drawBtn").addEventListener("click", () => play("draw"));
  $("#resetBtn").addEventListener("click", () => { if (canPlay() && !inflight) { W = null; sfx("pop"); render(); } });
  $("#resultBtn").addEventListener("click", () => { peek = false; render(); });
  for (const [id, m] of [["#sortColor", "color"], ["#sortNum", "num"]]) $(id).addEventListener("click", () => { sortMode = m; store.set(K.sort, m); if (V) render(); });

  // keys: Enter is done, Z draws, Esc closes
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, button") || e.ctrlKey || e.metaKey || e.altKey) return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") { if (open) $(open).hidden = true; return; }
    if (open || $("#game").hidden || !$("#roundEnd").hidden || !canPlay()) return;
    const k = e.key.toLowerCase();
    if (k === "enter") { e.preventDefault(); play("done"); }
    else if (k === "z") { e.preventDefault(); play("draw"); }
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

  function scoreList(el, winners, racks) {
    const last = racks && V.last;
    el.innerHTML = V.players.map((p, i) => {
      const you = i === V.me ? " (du)" : "";
      let delta = "";
      if (last) {
        const d = winners.includes(i) ? last.pts.reduce((s, v) => s + v, 0) - last.pts[i] : -last.pts[i];
        delta = `<b>${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}</b>`;
      } else delta = `<b>${p.wins} ${p.wins === 1 ? "Sieg" : "Siege"}</b>`;
      const rest = last && last.racks[i].length ? `<div class="minirack">${sorted(last.racks[i]).map((id) => tileHTML(id, "mini", false)).join("")}</div>` : "";
      const sub = last ? `${last.racks[i].length ? `${last.racks[i].length} Steine übrig` : "Ständer leer"} · ${p.wins} ${p.wins === 1 ? "Sieg" : "Siege"} · ${p.score} Punkte` : `${p.score} Punkte`;
      return `<li class="${winners.includes(i) ? "win" : ""}"><span>${avi(p.avatar)}${esc(p.name)}${you}<small>${sub}</small></span>${delta}${rest}</li>`;
    }).join("");
  }

  function renderRoundEnd() {
    const last = V.last, w = last.winners[0];
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round} vorbei`;
    $("#reTitle").textContent = `${w === V.me ? "Du gewinnst" : `${V.players[w].name} gewinnt`} ${last.over ? "das Spiel" : "die Runde"}!`;
    const how = last.how === "blocked" ? "Der Vorrat ist leer und nichts geht mehr: die wenigsten Restpunkte gewinnen."
      : last.how === "giveup" ? "Jemand hat aufgegeben." : `Der Ständer ist leer nach ${last.moves} ${last.moves === 1 ? "Zug" : "Zügen"}.`;
    $("#reText").textContent = how + (last.over ? "" : ` Gespielt wird bis ${V.goal} Siege, als Nächstes beginnt ${V.players[V.nextStarter].name}.`);
    scoreList($("#reScores"), last.winners, true);
    UI.roundEndFooter({ over: last.over, next: "Nächste Runde" });
  }

  // Statistik lebt im Profil (shared/profile.js, gilt für alle Spiele)
  const profile = Spieleabend.profile;
  function record(key) {
    const i = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
    if (i < 0) return;
    profile.result("rummikub", key, { won: V.last.winners.includes(i), draw: !V.last.winners.length, online: mode === "online" });
  }

  function segHTML(list, cur) {
    return list.map(([v, a, b]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${a}${b ? `<small>${b}</small>` : ""}</button>`).join("");
  }

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
    $("#meldLocal").innerHTML = segHTML(MELDS, meldLocal);
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
      error(m) { inflight = false; render(); },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text, name) => bubble(pi, text, name),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    // the settings the host picks in the waiting room; everyone sees them
    renderSettings(host) {
      for (const [id, list, cur] of [["#goalOnline", GOALS, R.goal], ["#meldOnline", MELDS, R.meld], ["#levelOnline", LEVELS, R.level || 2]]) {
        const el = $(id), k = cur + ":" + host;
        if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = segHTML(list, cur); for (const b of el.children) b.disabled = !host; }
      }
    },
    menu: {
      open() {
        LOOK.render();
        if (V) scoreList($("#menuScores"), []);
        $("#menuRules").textContent = V ? `${V.goal === 1 ? "Eine Runde" : `Bis ${V.goal} Siege`}, erstes Auslegen ${V.meld ? `ab ${V.meld} Punkten` : "ohne Mindestwert"}.` : "";
      },
      local(box) {
        box.append(
          UI.armed("Runde neu starten", () => { L.round--; L.starter = (L.starter + L.players.length - 1) % L.players.length; G.startRound(L); peek = false; W = null; store.set(K.local, L); render(); scheduleBot(); }),
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; clearTimeout(botT); render(); })
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
  for (const [id, key] of [["goal", "goal"], ["meld", "meld"], ["level", "level"]]) {
    $(`#${id}Online`).addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", [key]: +b.dataset.v }); });
  }
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; tabTouched = true; renderHome(); } });
  $("#goalLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { goalLocal = +b.dataset.v; store.set(K.goal, goalLocal); renderHome(); } });
  $("#meldLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { meldLocal = +b.dataset.v; store.set(K.meld, meldLocal); renderHome(); } });
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
    wsSend({ t: "create", name: n, goal: goalLocal, meld: meldLocal, level: levelLocal, avatar: myAvatar });
  });

  function startLocal(state) {
    L = state; mode = "local"; peek = false; W = null; dealKey = null; prevRack = new Set();
    store.set(K.local, L); render(); wake(); scheduleBot();
  }
  $("#startLocal").addEventListener("click", () => {
    const { names, bots } = HOME.roster($("#myName").value);
    const list = names.map((name, i) => ({ name, bot: bots[i], avatar: bots[i] ? G.BOT_AVATAR : myAvatar }));
    startLocal(G.newGame(list, goalLocal, meldLocal, levelLocal));
  });
  $("#resumeBtn").addEventListener("click", () => {
    const s = store.get(K.local); if (!s) return render();
    startLocal(s);
  });

  // ---------- round end ----------
  $("#reBtn").addEventListener("click", () => { peek = false; doAct({ t: "next" }); });
  $("#reLook").addEventListener("click", () => { peek = true; render(); });
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; clearTimeout(botT); render(); }
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
  UI.detectServer("/rummikub-server", "rummikub").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
