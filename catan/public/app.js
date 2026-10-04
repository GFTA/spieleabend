// Catan UI: single player (against the computer) and online rooms share one table renderer.
(() => {
  "use strict";
  const G = window.CatanGame, B = window.CatanBoard, FX = window.CatanFX, SH = window.CatanSheets;
  // An old cached game.js next to a new app.js: reload once without cache instead of breaking.
  if (!G || !G.botMove || !G.AVATARS || !B || !FX || !SH) {
    let tried = false;
    try { tried = sessionStorage.getItem("catan.reloaded") === "1"; sessionStorage.setItem("catan.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("catan.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const K = { local: "catan.v1", online: "catan.online", me: "catan.me", goal: "catan.goal", target: "catan.target", level: "catan.level",
    sound: "catan.sound", stats: "catan.stats", avatar: "catan.avatar", look: "catan.look" };
  const store = Spieleabend.store;
  const EMO = FX.EMO;

  // table design and size (shared, kit.js), applied before anything is drawn
  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Größe" });

  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");

  const TARGETS = Object.entries(G.TARGETS).map(([v, name]) => [+v, name]);
  const LEVELS = Object.entries(G.LEVELS).map(([v, name]) => [+v, name]);
  const GOALS = [[1, "Eine Runde"], [2, "Bis 2 Siege"], [3, "Bis 3 Siege"]];

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let R = null;           // last online room message
  let watching = false;   // in the waiting room, but watching the game that runs
  let V = null;           // view currently on screen
  let peek = false;       // round over, looking at the table
  let inflight = false;
  let armed = null;       // "road" | "settlement" | "city": the piece picked in the dock
  let freeRoad = null;    // the Road Building card: the edges chosen so far
  let server = null;      // server info once found ({} when only the WebSocket answered)
  let serverState = "checking"; // "checking" | "ok" | "none"
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "catan.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let goalLocal = G.normGoal(store.get(K.goal) || 1), targetLocal = G.normTarget(store.get(K.target) || 10);
  let levelLocal = G.normLevel(store.get(K.level) || 2);
  let confettiFor = null, wasMine = false, lastRound = null, aimKey = "", tradeEnd = 0, tradeKey = "";

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const pname = (i) => (i === V.me ? "Du" : V.players[i].name);
  const { toast, confetti, showBubble } = Spieleabend;
  const plateEl = (i) => document.querySelector(`#plates [data-seat="${i}"]`);
  const handEl = (r) => document.querySelector(`#hand [data-r="${r}"]`);
  const handText = (h) => G.RES.filter((r) => h[r]).map((r) => `${h[r]}${EMO[r]}`).join(" ");

  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound,
    effects: ({ tone, noise }) => ({
      roll: () => { noise(0.35, 0.1, 0.3, 1800); tone(300, 0.2, 0.08, "triangle", 0.1, 180); },
      coin: () => { tone(988, 0, 0.07, "triangle", 0.1); tone(1319, 0.07, 0.14, "triangle", 0.1); },
      road: () => { noise(0.08, 0, 0.1, 900); tone(220, 0, 0.1, "triangle", 0.12); },
      build: () => { tone(330, 0, 0.1, "triangle", 0.14); tone(494, 0.09, 0.1, "triangle", 0.14); tone(659, 0.18, 0.18, "triangle", 0.14); },
      robber: () => { tone(160, 0, 0.3, "sawtooth", 0.08, 90); noise(0.15, 0.25, 0.2, 400); },
      steal: () => { tone(500, 0, 0.08, "square", 0.05, 250); tone(300, 0.08, 0.14, "square", 0.05, 150); },
      card: () => { noise(0.1, 0, 0.12, 3000); tone(587, 0.08, 0.2, "triangle", 0.12); },
      yes: () => { tone(660, 0, 0.08, "sine", 0.1); tone(880, 0.08, 0.12, "sine", 0.1); },
      buy: () => { tone(523, 0, 0.09, "triangle", 0.12); tone(784, 0.1, 0.18, "triangle", 0.12); },
      award: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.1, 0.3, "triangle", 0.14)),
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16))
    })
  });

  FX.init({ view: () => V, sfx, buzz, toast, plate: plateEl, hand: handEl });
  FX.onIdle(() => render());
  SH.init({ view: () => V, act: (a) => doAct(a), freeRoads: () => startFreeRoads() });

  // ---------- actions ----------
  function doAct(a) {
    if (mode === "local") {
      const res = G.act(L, 0, a);
      if (!res.ok) { toast(res.error); sfx("bad"); return false; }
      armed = null;
      FX.push(res.events, G.view(L, 0));
      store.set(K.local, L);
      render(); scheduleBot();
      return true;
    }
    if (mode === "online") {
      if (inflight) return false;
      if (!wsSend({ t: "act", a })) { toast("Keine Verbindung zum Server."); return false; }
      armed = null;
      inflight = true; setTimeout(() => { inflight = false; }, 2500);
      return true;
    }
    return false;
  }

  // the computer in single player (online the server moves it)
  let botT = null, tickT = null;
  function scheduleBot(wait) {
    clearTimeout(botT); clearTimeout(tickT);
    if (mode !== "local" || !L || L.phase !== "play") return;
    const dl = G.nextDeadline(L);
    if (dl >= 0) {
      tickT = setTimeout(() => {
        if (mode !== "local" || !L) return;
        const ev = G.tick(L);
        if (ev.length) { FX.push(ev, G.view(L, 0)); store.set(K.local, L); render(); }
        scheduleBot();
      }, dl + 30);
    }
    const plan = G.botPlan(L);
    if (!plan) return;
    botT = setTimeout(() => {
      if (mode !== "local" || !L || L.phase !== "play") return;
      if (!$("#menu").hidden || FX.busy() || (window.Tutorial && Tutorial.held())) { scheduleBot(300); return; }
      const now = G.botPlan(L);
      if (!now || now.key !== plan.key) { scheduleBot(); return; }
      const a = G.botMove(L, now.pi), res = a ? G.act(L, now.pi, a) : null;
      if (res && res.ok) { FX.push(res.events, G.view(L, 0)); store.set(K.local, L); render(); }
      scheduleBot();
    }, wait || plan.delay);
  }

  // ---------- what the board offers right now ----------
  const left = (kind) => (V.players[V.me] ? V.players[V.me].left[kind] : 0);
  function probe() { const p = { vert: V.vert, edge: V.edge.slice() }; for (const e of freeRoad || []) p.edge[e] = V.me; return p; }
  function pieceSpots(kind) {
    const me = V.me;
    if (kind === "road") return freeRoad ? G.spots(probe(), me, "road") : G.spots(V, me, "road", null);
    return G.spots(V, me, kind);
  }
  function pickFree(id) {
    freeRoad.push(id);
    const free = Math.min(2, left("road"));
    if (freeRoad.length >= free || !G.spots(probe(), V.me, "road").length) {
      const edges = freeRoad.slice();
      if (!doAct({ t: "play", card: "road", edges })) { freeRoad = null; }
      else freeRoad = null;
    } else { sfx("pop"); toast("Erste Straße gewählt, jetzt die zweite."); }
    render();
  }
  function startFreeRoads() {
    if (!V || V.cur !== V.me || !pieceSpots("road").length) { toast("Es ist keine Straße möglich."); return; }
    freeRoad = []; armed = null; render();
  }
  function robberAt(hex) {
    if (hex === V.robber) { toast("Der Räuber muss auf ein anderes Feld."); sfx("bad"); return; }
    const c = G.victimsAt(V, hex, V.me).filter((o) => V.players[o].n > 0);
    if (c.length > 1) SH.open("victim", { hex, victims: c });
    else doAct({ t: "robber", hex });
  }
  function aim() {
    if (!V || V.phase !== "play" || V.me < 0 || V.cur !== V.me) return null;
    const me = V.me;
    if (V.step === "settle") return { kind: "vertex", piece: "settlement", ids: G.spots(V, me, "settlement", "setup"), go: (id) => doAct({ t: "build", k: "settlement", id }) };
    if (V.step === "sroad") return { kind: "edge", piece: "road", ids: G.spots(V, me, "road", V.setupV), go: (id) => doAct({ t: "build", k: "road", id }) };
    if (V.step === "robber") return { kind: "hex", piece: "robber", ids: V.hexes.map((h, i) => i).filter((i) => i !== V.robber), go: robberAt };
    if (V.step === "main" && !V.trade) {
      if (freeRoad) return { kind: "edge", piece: "road", ids: pieceSpots("road"), marks: freeRoad, go: pickFree };
      if (armed) return aimFor(armed);
    }
    return null;
  }
  function aimFor(kind) {
    return { kind: kind === "road" ? "edge" : "vertex", piece: kind, ids: pieceSpots(kind), go: (id) => doAct({ t: "build", k: kind, id }) };
  }
  function syncSpots(force) {
    const a = aim(), k = a ? `${a.kind}:${a.ids.join()}:${(a.marks || []).join()}` : "";
    if (!force && k === aimKey) return;
    aimKey = k;
    if (!a) { B.clearSpots(); return; }
    B.spots(a.kind, a.ids, a.go, a.piece, a.marks);
  }

  // ---------- drag & drop of pieces (and tap as the alternative) ----------
  const pieceSVG = (kind, i) => {
    const c = B.PC[i >= 0 ? i : 0], d = B.PD[i >= 0 ? i : 0];
    if (kind === "road") return `<svg viewBox="-.5 -.3 1 .6" aria-hidden="true"><line x1="-.34" y1=".14" x2=".34" y2="-.14" stroke="${d}" stroke-width=".3" stroke-linecap="round"/><line x1="-.34" y1=".14" x2=".34" y2="-.14" stroke="${c}" stroke-width=".19" stroke-linecap="round"/></svg>`;
    if (kind === "robber") return `<svg viewBox="-.3 -.38 .6 .8" aria-hidden="true"><path d="M-.2 .32C-.2 .05 -.1 -.02 -.1 -.1H.1C.1 -.02 .2 .05 .2 .32Z" fill="#262633" stroke="#fff" stroke-width=".04"/><circle cy="-.2" r=".14" fill="#262633" stroke="#fff" stroke-width=".04"/></svg>`;
    return `<svg viewBox="-.34 -.34 .68 .68" aria-hidden="true"><path d="${kind === "city" ? B.CITY : B.HOUSE}" fill="${c}" stroke="${d}" stroke-width=".07" stroke-linejoin="round"/></svg>`;
  };
  let dragging = false;
  function startDrag(ev, piece, kind, ids, onDrop, onTap) {
    if (ev.button > 0 || dragging) return;
    const sx = ev.clientX, sy = ev.clientY;
    let ghost = null, moved = false, hotId = null;
    const cur = aim(), showSpots = !(cur && cur.piece === piece && cur.kind === kind);
    const move = (e) => {
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) {
        moved = true; dragging = true;
        ghost = document.createElement("div"); ghost.className = "ghost"; ghost.innerHTML = pieceSVG(piece, V.me);
        document.body.append(ghost);
        if (showSpots) B.spots(kind, ids, null, piece);
      }
      if (!moved) return;
      e.preventDefault();
      ghost.style.left = e.clientX + "px"; ghost.style.top = e.clientY + "px";
      const n = B.nearest(kind, ids, e.clientX, e.clientY);
      if (n !== hotId) { hotId = n; B.hot(n); if (n != null) buzz(6); }
    };
    const end = (e) => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end);
      if (ghost) ghost.remove();
      dragging = false;
      if (!moved) { onTap && onTap(); return; }
      const id = e.type === "pointercancel" ? null : B.nearest(kind, ids, e.clientX, e.clientY);
      B.hot(null); if (showSpots) B.clearSpots();
      if (id != null) onDrop(id);
      else { sfx("bad"); syncSpots(true); }
    };
    addEventListener("pointermove", move, { passive: false }); addEventListener("pointerup", end); addEventListener("pointercancel", end);
  }
  function pieceDown(e) {
    const el = e.target.closest("[data-piece]"); if (!el || !V) return;
    const piece = el.dataset.piece, a = aim();
    if (piece === "dev") return;
    if (piece === "robber") { if (a && a.piece === "robber") startDrag(e, "robber", "hex", a.ids, a.go, () => toast("Tippe auf das Feld, auf das der Räuber soll.")); return; }
    const setup = V.step === "settle" || V.step === "sroad" || !!freeRoad;
    const ok = setup ? { ok: !!a && a.piece === piece } : canBuild(piece);
    if (!ok.ok) { if (!setup) { toast(ok.why); sfx("bad"); } return; }
    const ids = a && a.piece === piece ? a.ids : pieceSpots(piece), go = a && a.piece === piece ? a.go : aimFor(piece).go;
    e.preventDefault();
    startDrag(e, piece, piece === "road" ? "edge" : "vertex", ids, go, () => {
      if (setup) { toast("Tippe auf einen leuchtenden Punkt oder ziehe das Teil aufs Brett."); return; }
      armed = armed === piece ? null : piece; render();
    });
  }
  // keyboard / assistive tech: a click without a pointer press arms the piece
  function pieceClick(e) {
    const el = e.target.closest("[data-piece]"); if (!el) return;
    const piece = el.dataset.piece;
    if (piece === "dev") return buyDev();
    if (e.detail !== 0 || piece === "robber") return;
    const ok = canBuild(piece); if (!ok.ok) { toast(ok.why); return; }
    armed = armed === piece ? null : piece; render();
  }
  function canBuild(kind) {
    if (!V || V.me < 0) return { ok: false, why: "Du schaust zu." };
    const setup = V.step === "settle" || V.step === "sroad";
    if (setup) return { ok: V.cur === V.me && ((V.step === "settle") === (kind === "settlement")), why: "Das ist gerade nicht dran." };
    if (freeRoad) return { ok: kind === "road", why: "Wähle erst die Straßen." };
    if (V.cur !== V.me || V.step !== "main" || V.trade) return { ok: false, why: V.cur !== V.me ? "Du bist nicht dran." : "Gerade nicht möglich." };
    if (!left(kind)) return { ok: false, why: kind === "road" ? "Du hast keine Straßen mehr." : kind === "city" ? "Du hast keine Städte mehr." : "Du hast keine Siedlungen mehr." };
    if (!G.canPay(V.hand, G.COST[kind])) return { ok: false, why: `Dir fehlen Rohstoffe (${handText(G.COST[kind])}).` };
    if (!pieceSpots(kind).length) return { ok: false, why: kind === "city" ? "Du hast keine Siedlung zum Ausbauen." : "Dafür gibt es gerade keinen Platz." };
    return { ok: true };
  }
  function buyDev() {
    if (!V || V.cur !== V.me || V.step !== "main" || V.trade) return toast("Gerade nicht möglich.");
    if (!V.deck) return toast("Der Stapel ist leer.");
    if (!G.canPay(V.hand, G.COST.dev)) return toast(`Dir fehlen Rohstoffe (${handText(G.COST.dev)}).`);
    doAct({ t: "buyDev" });
  }
  document.addEventListener("pointerdown", (e) => { if (e.target.closest("#dock [data-piece]")) pieceDown(e); });
  document.addEventListener("click", (e) => { if (e.target.closest("#dock [data-piece]")) pieceClick(e); });
  $("#board").addEventListener("pointerdown", (e) => {
    const a = aim();
    if (e.target.closest(".robber") && a && a.piece === "robber") { e.preventDefault(); startDrag(e, "robber", "hex", a.ids, a.go, () => toast("Tippe auf das Feld, auf das der Räuber soll.")); }
  });

  // ---------- rendering ----------
  function showScreen(id) {
    for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id;
  }

  function render() {
    if (mode === "local" && L) {
      V = G.view(L, 0);
      showScreen("game");
      renderGame();
    } else if (mode === "online" && R) {
      const meM = R.members[R.you], waiting = !!(R.view && meM && meM.lobby);
      if (!waiting) watching = false;
      if (!R.view || (waiting && !watching)) { V = null; leaveTable(); showScreen("lobby"); UI.renderLobby(); $("#roundEnd").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else {
      V = null; leaveTable();
      $("#roundEnd").hidden = true;
      showScreen("home"); renderHome();
    }
    UI.update();
  }
  function leaveTable() { Spieleabend.mine(false); wasMine = false; SH.close(); armed = freeRoad = null; if (lastRound !== null) { lastRound = null; FX.skip(); } }

  const vpOf = (i) => V.players[i].vp + V.players[i].vpCards;
  function plateHTML(i) {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = members && members[i] && !members[i].online;
    const act = V.phase === "play" && V.actor === i;
    const cls = ["plate", act ? "active" : "", away ? "away" : ""].join(" ");
    const tag = p.bot ? " · Computer" : away ? " · offline" : i === V.me ? " · du" : "";
    const badges = (V.lr === i ? '<i class="bdg" title="Längste Handelsstraße">🛣️</i>' : "") + (V.la === i ? '<i class="bdg" title="Größte Rittermacht">⚔️</i>' : "");
    return `<div class="${cls}" data-seat="${i}" style="--pc:${B.PC[i]}"><span class="pav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="pinfo"><span class="pname">${esc(p.name)}<small>${tag}</small></span>` +
      `<span class="pmeta"><span title="Rohstoffkarten">🃏${p.n}</span><span title="Entwicklungskarten">📜${p.dev}</span><span title="Ritter">⚔${p.knights}</span><span title="Längste Straße">🛣${p.len}</span></span></span>` +
      `<span class="pscore">${vpOf(i)}<small>/${V.target}</small></span>${badges}` +
      (V.goal > 1 ? `<span class="pwins" title="Siege">${p.wins}</span>` : "") + `</div>`;
  }

  function renderGame() {
    const busy = FX.busy();
    if (V.phase !== "roundEnd") peek = false;
    if (!B.built() || !B.same(V) || lastRound !== V.round) {
      B.build($("#board"), V); aimKey = ""; lastRound = V.round; FX.drawDice(V.dice, false);
    }
    B.sync(V);
    FX.drawDice(V.dice, false);
    $("#plates").innerHTML = V.players.map((_, i) => plateHTML(i)).join("");
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> · Zug ${V.turn}`;
    if (V.phase !== "play") { armed = null; freeRoad = null; }
    else if (!(V.cur === V.me && V.step === "main") || V.trade) { if (V.step !== "main" || V.cur !== V.me) freeRoad = null; if (V.cur !== V.me || V.step !== "main" || V.trade) armed = null; }
    if (armed && !canBuild(armed).ok) armed = null;
    if (!busy) {
      const lm = $("#lastMove"), lines = V.log.slice(-2), k = lines.join("\n");
      if (lm.dataset.k !== k) { lm.dataset.k = k; lm.innerHTML = lines.map((l, i) => `<div${i < lines.length - 1 ? ' class="old"' : ""}>${esc(l)}</div>`).join(""); }
    }
    syncSpots();
    renderDock(busy);
    $("#reactBtn").hidden = mode !== "online";

    // the sheet for discarding opens by itself; the others refresh
    if (V.phase === "play" && V.me >= 0 && V.disc[V.me] > 0 && SH.name() !== "discard") SH.open("discard");
    else SH.refresh();

    $("#roundEnd").hidden = busy || V.phase !== "roundEnd" || peek;
    if (!busy && V.phase === "roundEnd") {
      if (!peek) renderRoundEnd();
      const k = `${V.round}:${V.last.winners.join(",")}:${V.players.map((p) => p.wins).join(",")}`;
      if (confettiFor !== k) { confettiFor = k; record(k); setTimeout(() => confetti(), 700); }
    }
  }

  // ---------- the dock: who is to move, my cards, the buttons ----------
  let dockFns = [];
  const stepMine = () => {
    if (V.phase !== "play" || V.me < 0) return false;
    if (V.step === "discard") return V.disc[V.me] > 0;
    if (V.trade && V.trade.from !== V.me && (V.trade.to == null || V.trade.to === V.me) && !V.trade.acc.includes(V.me) && !V.trade.dec.includes(V.me)) return true;
    return V.cur === V.me && !V.trade;
  };
  function costHTML(kind) { return G.RES.filter((r) => G.COST[kind][r]).map((r) => EMO[r].repeat(G.COST[kind][r])).join(""); }
  function offerHTML(btn) {
    const T = V.trade, who = V.players[T.from];
    const sum = `<span class="otext"><b>${esc(pname(T.from))}</b> ${T.from === V.me ? "bietest" : "bietet"} ${handText(T.give)} gegen ${handText(T.want)}${T.to != null ? ` an ${esc(pname(T.to))}` : ""}</span>`;
    const timer = T.left > 0 ? `<span class="otime" data-left>${Math.ceil(T.left / 1000)}s</span>` : "";
    if (T.from === V.me) {
      const row = V.players.map((p, i) => (i === V.me || (T.to != null && T.to !== i) ? "" :
        `<span class="ans ${T.acc.includes(i) ? "yes" : T.dec.includes(i) ? "no" : ""}" title="${esc(p.name)}">${p.avatar}${T.acc.includes(i) ? "✓" : T.dec.includes(i) ? "✗" : "…"}</span>`)).join("");
      const picks = T.acc.map((i) => btn(`Tausch mit ${esc(V.players[i].name)}`, "btn-primary", () => doAct({ t: "confirm", with: i })));
      return `<div class="offer">${sum}${timer}<div class="answers">${row}</div><div class="acts">${picks.join("")}${btn("Zurückziehen", "", () => doAct({ t: "cancel" }))}</div></div>`;
    }
    const mine = (T.to == null || T.to === V.me) && V.me >= 0;
    if (!mine) return `<div class="offer">${sum}${timer}</div>`;
    if (T.acc.includes(V.me)) return `<div class="offer">${sum}<span class="otext">Du hast zugesagt. ${esc(pname(T.from))} entscheidet.</span></div>`;
    if (T.dec.includes(V.me)) return `<div class="offer">${sum}<span class="otext">Du hast abgelehnt.</span></div>`;
    const can = G.canPay(V.hand, T.want);
    return `<div class="offer mine">${sum}${timer}${can ? "" : `<span class="otext">Dir fehlen die Karten.</span>`}<div class="acts">${btn("Annehmen", "btn-primary", () => doAct({ t: "accept" }), !can)}${btn("Ablehnen", "", () => doAct({ t: "decline" }))}</div></div>`;
  }

  function renderDock(busy) {
    dockFns = [];
    const btn = (label, cls, fn, off) => { dockFns.push(fn); return `<button type="button" class="btn ${cls || ""}" data-b="${dockFns.length - 1}"${off ? " disabled" : ""}>${label}</button>`; };
    const acts = [];
    let av = "", who = "", hint = "", pieces = "", offer = "";
    const me = V.me;
    if (V.phase === "roundEnd") {
      const w = V.last.winners[0];
      Spieleabend.mine(false); wasMine = false;
      av = V.players[w].avatar; who = `${pname(w)} ${w === me ? "gewinnst" : "gewinnt"}`; hint = "Runde vorbei.";
      if (!busy && peek) acts.push(btn("Ergebnis zeigen", "btn-primary", () => { peek = false; render(); }));
    } else {
      const mineNow = stepMine(), P = V.players[V.actor];
      const cue = mineNow && (mode === "online" || V.players.some((p) => p.bot));
      Spieleabend.mine(cue);
      if (cue && !wasMine && !busy) { sfx("turn"); buzz([40, 60, 40]); }
      wasMine = cue;
      av = mineNow && V.cur !== me ? V.players[me].avatar : P.avatar;
      who = mineNow ? "Du bist dran" : `${P.name} ist dran`;
      if (mineNow && V.step === "discard") who = "Du musst Karten abgeben";
      if (mineNow && V.step !== "discard" && V.cur !== me) who = "Antworte auf das Angebot";
      const turnMine = V.cur === me;
      const waiting = P.bot ? "Der Computer überlegt …" : me < 0 ? "Du schaust zu." : "Warte auf den Zug.";
      hint = turnMine ? "" : waiting;
      const devReady = me >= 0 && V.devs.some((d) => d.ok && d.k !== "vp");
      const devBtn = () => btn(`Karten${V.devs.length ? ` (${V.devs.length})` : ""}`, "", () => SH.open("devs"), !V.devs.length);
      if (V.trade) offer = offerHTML(btn);
      else if (turnMine) {
        const st = V.step;
        if (freeRoad) { hint = `Straßenbau: wähle die ${freeRoad.length ? "zweite" : "erste"} Straße (${freeRoad.length + 1}/${Math.min(2, left("road"))}).`; acts.push(btn("Abbrechen", "", () => { freeRoad = null; render(); })); pieces = pieceRow(["road"]); }
        else if (st === "settle") { hint = "Setze eine Siedlung: ziehe sie aufs Brett oder tippe auf einen Punkt."; pieces = pieceRow(["settlement"]); }
        else if (st === "sroad") { hint = "Setze eine Straße an deine neue Siedlung."; pieces = pieceRow(["road"]); }
        else if (st === "roll") { hint = "Würfle! Oder spiele vorher einen Ritter."; acts.push(btn("Würfeln", "btn-primary", () => rollNow()), devReady ? devBtn() : ""); }
        else if (st === "discard") { hint = "Warte, bis alle ihre Karten abgegeben haben."; }
        else if (st === "robber") { hint = "Versetze den Räuber: ziehe ihn auf ein Feld oder tippe das Feld an."; pieces = pieceRow(["robber"]); }
        else if (st === "main") {
          hint = armed ? "Tippe auf einen leuchtenden Platz oder ziehe das Teil aufs Brett." : "Baue, handle oder beende deinen Zug.";
          pieces = pieceRow(["road", "settlement", "city", "dev"]);
          acts.push(btn("Handeln", "", () => SH.open("trade")), devBtn(), btn("Zug beenden", "btn-primary", () => doAct({ t: "end" })));
        }
      } else if (V.step === "discard") {
        const who2 = Object.keys(V.disc).map((i) => V.players[+i].name);
        hint = V.disc[me] > 0 ? "" : `${who2.join(", ")} ${who2.length > 1 ? "müssen" : "muss"} Karten abgeben.`;
      } else if (V.step === "main" && me >= 0 && V.devs.length) acts.push(devBtn());
      if (busy) hint = hint;
    }
    $("#whoAv").textContent = av; $("#whoName").textContent = who; $("#whoHint").textContent = hint;
    $("#dock").classList.toggle("myturn", stepMine() && !busy);
    $("#hand").innerHTML = me >= 0 && V.hand ? G.RES.map((r) => `<div class="hc${V.hand[r] ? "" : " z"}" data-r="${r}" title="${G.RES_NAMES[r]}"><span>${EMO[r]}</span><b>${V.hand[r]}</b></div>`).join("") : "";
    $("#hand").hidden = !(me >= 0 && V.hand);
    $("#pieces").innerHTML = pieces; $("#pieces").hidden = !pieces;
    $("#offerBox").innerHTML = offer; $("#offerBox").hidden = !offer;
    $("#acts").innerHTML = acts.join(""); $("#acts").hidden = !acts.some(Boolean);
    $("#keys").innerHTML = V.phase === "play" && V.cur === me ? "<kbd>Leertaste</kbd> würfeln · <kbd>E</kbd> Zug beenden · <kbd>Esc</kbd> schließt" : "";
    const T = V.trade;
    const k = T ? `${V.turn}:${T.from}:${T.acc.length + T.dec.length}` : "";
    if (k !== tradeKey) { tradeKey = k; tradeEnd = T && T.left ? Date.now() + T.left : 0; }
  }
  function pieceRow(list) {
    return list.map((k) => {
      if (k === "robber") return `<button type="button" class="piece armed" data-piece="robber" aria-label="Räuber ziehen">${pieceSVG("robber", V.me)}<span>Räuber</span></button>`;
      if (k === "dev") {
        const off = V.cur !== V.me || !V.deck || !G.canPay(V.hand, G.COST.dev) || V.step !== "main";
        return `<button type="button" class="piece${off ? " off" : ""}" data-piece="dev" aria-label="Entwicklungskarte kaufen"><span class="pi">📜</span><span>Karte <small>${V.deck}</small></span><small class="cost">${costHTML("dev")}</small></button>`;
      }
      const setup = V.step === "settle" || V.step === "sroad", ok = canBuild(k).ok;
      const nm = { road: "Straße", settlement: "Siedlung", city: "Stadt" }[k];
      return `<button type="button" class="piece${armed === k || setup || freeRoad ? " armed" : ""}${ok ? "" : " off"}" data-piece="${k}" aria-label="${nm} bauen">${pieceSVG(k, V.me)}<span>${nm} <small>${left(k)}</small></span>${setup || freeRoad ? "" : `<small class="cost">${costHTML(k)}</small>`}</button>`;
    }).join("");
  }
  $("#dock").addEventListener("click", (e) => {
    const b = e.target.closest("[data-b]"); if (!b || b.disabled) return;
    const fn = dockFns[+b.dataset.b]; if (fn) fn();
  });
  $("#offerBox").addEventListener("click", (e) => {
    const b = e.target.closest("[data-b]"); if (!b || b.disabled) return;
    const fn = dockFns[+b.dataset.b]; if (fn) fn();
  });
  setInterval(() => {
    if (!V || !V.trade || !tradeEnd) return;
    const s = Math.max(0, Math.ceil((tradeEnd - Date.now()) / 1000));
    for (const el of document.querySelectorAll("[data-left]")) el.textContent = s + "s";
  }, 400);
  function rollNow() { if (V && V.cur === V.me && V.step === "roll") { buzz(10); doAct({ t: "roll" }); } }

  // keys: space rolls, E ends the turn, Esc closes
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, button") || e.ctrlKey || e.metaKey || e.altKey) return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") { if (open) $(open).hidden = true; else if (SH.isOpen() && SH.name() !== "discard") SH.close(); else if (armed || freeRoad) { armed = null; freeRoad = null; render(); } return; }
    if (open || SH.isOpen() || $("#game").hidden || !$("#roundEnd").hidden || !V || V.cur !== V.me || V.phase !== "play") return;
    const k = e.key.toLowerCase();
    if ((k === " " || k === "r") && V.step === "roll") { e.preventDefault(); rollNow(); }
    else if (k === "e" && V.step === "main" && !V.trade) { e.preventDefault(); doAct({ t: "end" }); }
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

  function scoreList(el, winners, pts) {
    el.innerHTML = V.players.map((p, i) => {
      const you = i === V.me ? " (du)" : "";
      return `<li class="${winners.includes(i) ? "win" : ""}"><span>${avi(p.avatar)}${esc(p.name)}${you}<small>${pts ? pts[i] : vpOf(i)} Punkte</small></span>` +
        `<b>${p.wins} ${p.wins === 1 ? "Sieg" : "Siege"}</b></li>`;
    }).join("");
  }

  function renderRoundEnd() {
    const last = V.last, w = last.winners[0];
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round} vorbei`;
    $("#reTitle").textContent = `${w === V.me ? "Du gewinnst" : `${V.players[w].name} gewinnt`} ${last.over ? "das Spiel" : "die Runde"}!`;
    $("#reText").textContent = `${last.vp[w]} Punkte nach ${last.turns} Zügen.` +
      (last.over ? "" : ` Gespielt wird bis ${V.goal} Siege, als Nächstes beginnt ${V.players[V.nextStarter].name}.`);
    scoreList($("#reScores"), last.winners, last.vp);
    UI.roundEndFooter({ over: last.over, next: "Nächste Runde" });
  }

  // Statistik lebt im Profil (shared/profile.js, gilt für alle Spiele)
  const profile = Spieleabend.profile;
  function record(key) {
    const i = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
    if (i < 0) return;
    profile.result("catan", key, { won: V.last.winners.includes(i), draw: !V.last.winners.length, online: mode === "online" });
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
    $("#targetLocal").innerHTML = segHTML(TARGETS, targetLocal);
    $("#goalLocal").innerHTML = segHTML(GOALS, goalLocal);
    $("#levelLocal").innerHTML = segHTML(LEVELS, levelLocal);

    const saved = store.get(K.local);
    $("#resumePanel").hidden = !(saved && saved.players && saved.hexes);
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
      room(m) { R = m; mode = "online"; inflight = false; if (m.view && m.events && m.events.length) FX.push(m.events, m.view); render(); },
      react(m) { bubble(m.pi, m.e, m.name); },
      error(m) { inflight = false; },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text, name) => bubble(pi, text, name),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    // the settings the host picks in the waiting room; everyone sees them
    renderSettings(host) {
      for (const [id, list, cur] of [["#targetOnline", TARGETS, R.target], ["#goalOnline", GOALS, R.goal], ["#levelOnline", LEVELS, R.level || 2]]) {
        const el = $(id), k = cur + ":" + host;
        if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = segHTML(list, cur); for (const b of el.children) b.disabled = !host; }
      }
    },
    menu: {
      open() {
        LOOK.render();
        if (V) scoreList($("#menuScores"), []);
        $("#menuRules").textContent = V ? `Ziel: ${V.target} Punkte, ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}.` : "";
      },
      local(box) {
        box.append(
          UI.armed("Runde neu starten", () => { L.round--; L.starter = (L.starter + L.players.length - 1) % L.players.length; G.startRound(L); FX.skip(); peek = false; store.set(K.local, L); render(); scheduleBot(); }),
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearTimeout(tickT); FX.skip(); render(); })
        );
      },
      player() {},
      skip: (v) => v.phase === "play" && v.actor !== v.me && !v.players[v.actor].bot
    }
  });
  function wsSend(m) { return UI.send(m); }

  // avatar picker on the start screen
  Spieleabend.avatarPicker({ avatars: G.AVATARS, get: () => myAvatar, set: (a) => { myAvatar = a; store.set(K.avatar, a); } });

  // ---------- start screen ----------
  for (const [id, key] of [["target", "target"], ["goal", "goal"], ["level", "level"]]) {
    $(`#${id}Online`).addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", [key]: +b.dataset.v }); });
  }
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; tabTouched = true; renderHome(); } });
  $("#targetLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { targetLocal = +b.dataset.v; store.set(K.target, targetLocal); renderHome(); } });
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
    wsSend({ t: "create", name: n, goal: goalLocal, target: targetLocal, level: levelLocal, avatar: myAvatar });
  });

  function startLocal(state) {
    L = state; mode = "local"; peek = false; armed = freeRoad = null; FX.skip();
    store.set(K.local, L); render(); wake(); scheduleBot();
  }
  $("#startLocal").addEventListener("click", () => {
    const { names, bots } = HOME.roster($("#myName").value);
    const list = names.map((name, i) => ({ name, bot: bots[i], avatar: bots[i] ? G.BOT_AVATAR : myAvatar }));
    startLocal(G.newGame(list, goalLocal, targetLocal, levelLocal));
  });
  $("#resumeBtn").addEventListener("click", () => {
    const s = store.get(K.local); if (!s || !s.hexes) return render();
    startLocal(s);
  });

  // ---------- round end ----------
  $("#reBtn").addEventListener("click", () => { peek = false; doAct({ t: "next" }); });
  $("#reLook").addEventListener("click", () => { peek = true; render(); });
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearTimeout(tickT); render(); }
    else if (R && R.members[R.you] && R.members[R.you].lobby) { watching = false; render(); }
    else if (V && V.phase === "roundEnd" && V.last && V.last.over) wsSend({ t: "lobby" });
    else wsSend({ t: "end" });
  });

  // keep the screen on while playing (needs HTTPS; silently skipped otherwise)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (mode) { wake(); render(); }
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  Spieleabend.followTurn("#plates", ".plate.active");

  // ---------- boot ----------
  const code = UI.roomCode();
  render();
  if (webHost && (store.get(K.online) && !code)) UI.resume();
  UI.detectServer("/catan-server", "catan").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
