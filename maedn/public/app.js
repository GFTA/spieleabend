// Mensch ärgere dich nicht UI: one shared device and online rooms share one table renderer.
(() => {
  "use strict";
  const G = window.MaednGame;
  // An old cached game.js next to a new app.js: reload once without cache instead of breaking.
  if (!G || !G.botMove || !G.AVATARS || !window.MaednBoard) {
    let tried = false;
    try { tried = sessionStorage.getItem("maedn.reloaded") === "1"; sessionStorage.setItem("maedn.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("maedn.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const K = { local: "maedn.v1", online: "maedn.online", me: "maedn.me", rules: "maedn.rules", goal: "maedn.goal", sound: "maedn.sound", level: "maedn.level", stats: "maedn.stats",
    avatar: "maedn.avatar", look: "maedn.look" };
  const store = Spieleabend.store;
  const BOT_MS = 750, STEP_MS = 120;

  // ---------- look: table design and board size (applied before anything is drawn) ----------
  // ---------- look: table design and size (shared, kit.js), applied before anything is drawn ----------
  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Größe", onChange: () => { if (V && !$("#game").hidden) layoutBoard(); } });

  // ---------- avatars ----------
  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");

  const LEVELS = [[1, "Leicht"], [2, "Normal"], [3, "Profi"], [0, "Zufällig"]];
  const GOALS = [[1, "Erster gewinnt", "wer zuerst fertig ist"], [2, "Alle Plätze", "bis zum letzten"]];
  const ICON = {
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6" /></svg>'
  };

  // ---------- board geometry: a star with 4, 6 or 8 arms (board.js), the track runs clockwise ----------
  const geoOf = (v) => window.MaednBoard.geometry(v.arms || 4);
  // per seat on the classic board: the name tag next to the yard, and where the die lies when it is that player's turn
  const BADGE_AT = [[0.08, 2.2], [7.08, 2.2], [7.08, 7.1], [0.08, 7.1]];
  const DICE_AT = [[2.25, 0.18], [7.05, 0.18], [7.05, 9.18], [2.25, 9.18]];
  function cellOf(geo, seat, rel, k) {
    const home = geo.track.length;
    if (rel < 0) return geo.yard[seat][k];
    if (rel >= home) return geo.goal[seat][rel - home];
    return geo.track[(seat * 10 + rel) % home];
  }

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let R = null;           // last online room message
  let watching = false; // in the waiting room, but watching the game that runs
  let V = null;           // view currently on screen
  let anim = null;        // move to animate on the next board render
  let rollAnim = false;   // the die just rolled
  let peek = false;       // round over, looking at the board
  let sel = null;         // desktop: piece picked with the arrow keys (index into V.moves)
  let inflight = false;
  let server = null;      // server info once found ({} when only the WebSocket answered)
  let serverState = "checking"; // "checking" | "ok" | "none"
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "maedn.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let goalLocal = G.normGoal(store.get(K.goal) || 1);
  let localRules = G.normRules(store.get(K.rules));
  let levelLocal = G.normLevel(store.get(K.level));
  let lastTurn = null;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const humans = (st) => st.players.map((_, i) => i).filter((i) => !st.players[i].bot);
  // whose moves this screen makes: online your seat; on a shared device whoever is on (people only)
  const canPlay = () => !!V && V.phase === "play" && V.cur >= 0 && (mode === "local" ? !V.players[V.cur].bot : V.cur === V.me);
  const pname = (i) => (mode === "online" && i === V.me ? "Du" : V.players[i].name);
  const colorOf = (v, i) => G.COLORS[v.players[i].seat];
  const inGoal = (p) => p.pieces.filter((r) => r >= V.track).length;

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
      roll: () => { for (let i = 0; i < 5; i++) noise(i * 0.07, 0.05, 0.3, 2400 - i * 250); },
      steps: (n) => { for (let i = 0; i < n; i++) tone(520 + i * 30, i * STEP_MS / 1000, 0.05, "triangle", 0.1); },
      hit: () => { tone(420, 0, 0.12, "sawtooth", 0.1, 180); noise(0.05, 0.3, 0.3, 700); },
      goal: () => { tone(784, 0, 0.12); tone(1047, 0.12, 0.2); },
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16)),
      tick: () => tone(1200, 0, 0.05, "square", 0.06)
    })
  });

  // ---------- events → feedback ----------
  const steps = (m) => (m.from < 0 ? 1 : m.to - m.from);
  function handleEvents(events, v) {
    if (!v) return;
    for (const ev of events || []) {
      if (ev.t === "roll") { rollAnim = true; sfx("roll"); }
      if (ev.t === "move") { anim = ev; setTimeout(() => sfx("steps", steps(ev)), 80); }
      if (ev.t === "hit") {
        const me = mode === "online" && ev.victim === v.me;
        setTimeout(() => { flash("Rausgeworfen!", me ? `${v.players[ev.pi].name} wirft dich raus` : `${pname2(v, ev.pi)} wirft ${v.players[ev.victim].name} raus`); sfx("hit"); buzz(me ? [60, 40, 120] : 30); }, 250);
      }
      if (ev.t === "goal") setTimeout(() => sfx("goal"), 400);
      if (ev.t === "penalty") { flash("Drei Sechsen!", "Die dritte verfällt.", "blue"); sfx("bad"); }
      if (ev.t === "pass" && (mode === "local" ? !v.players[ev.pi].bot : ev.pi === v.me)) toast(`Eine ${ev.d}: kein Zug möglich.`);
      if (ev.t === "timeout") { toast(mode === "online" && ev.pi === v.me ? "Zu langsam! Das Spiel hat für dich gespielt." : `${v.players[ev.pi].name} war zu langsam.`); sfx("bad"); }
      if (ev.t === "giveup") toast(mode === "online" && ev.pi === v.me ? "Du hast aufgegeben." : `${v.players[ev.pi].name} gibt auf.`);
      if (ev.t === "finish" && v.phase === "play") setTimeout(() => flash("Alle im Ziel!", `${pname2(v, ev.pi)}: Platz ${ev.place}`, "blue"), 500);
    }
  }
  const pname2 = (v, i) => (mode === "online" && i === v.me ? "Du" : v.players[i].name);

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
  function notYou() {
    toast(mode === "online" && V.me < 0 ? "Du schaust zu." : `Warte, ${V.players[V.cur].name} ist dran.`);
  }
  function roll() {
    if (!V || V.phase !== "play") return;
    if (!canPlay()) return notYou();
    if (V.need !== "roll" || inflight) return;
    if (mode === "online") { inflight = true; setTimeout(() => { inflight = false; }, 3000); }
    buzz(10);
    doAct({ t: "roll" });
  }
  function move(k) {
    if (!V || V.phase !== "play") return;
    if (!canPlay()) return notYou();
    if (V.need !== "move" || inflight) return;
    if (!V.moves.some((m) => m.k === k)) { toast("Diese Figur darf gerade nicht ziehen."); shakeBoard(); sfx("bad"); return; }
    if (mode === "online") { inflight = true; setTimeout(() => { inflight = false; }, 3000); }
    sel = null;
    buzz(10);
    doAct({ t: "move", k });
  }

  // computer players in the shared-device mode (online the server moves them)
  let botT = null;
  function scheduleBot(extra) {
    clearTimeout(botT);
    if (mode !== "local" || !L || L.phase !== "play" || !L.players[L.cur].bot) return;
    botT = setTimeout(() => {
      if (mode !== "local" || !L || L.phase !== "play" || !L.players[L.cur].bot) return;
      if (!$("#menu").hidden) { scheduleBot(); return; } // paused while the menu is open
      const pi = L.cur, a = G.botMove(L, pi);
      const res = a ? G.act(L, pi, a) : null;
      if (res && res.ok) { handleEvents(res.events, G.view(L, localMe())); store.set(K.local, L); render(); }
      const mv = res && res.events.find((e) => e.t === "move");
      scheduleBot(mv ? steps(mv) * STEP_MS : 0);
    }, BOT_MS + (extra || 0));
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
      $("#clock").classList.toggle("urgent", left < 4000);
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
  // shared device: with one person against computers that person is "me", with more nobody is
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

  const DIE = '<b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b>';
  const at = ([x, y]) => `--x:${x};--y:${y}`;
  // v: { players: [{ seat, pieces }] }; o: { moves, owner, sel, last, dice, used }
  function boardHTML(v, o) {
    o = o || {};
    const geo = geoOf(v), arms = geo.arms, used = new Set(v.players.map((p) => p.seat));
    let h = `<div class="in"><svg class="path" viewBox="0 0 ${geo.w} ${geo.h}" aria-hidden="true"><polygon points="${geo.track.map(([x, y]) => `${x + 0.5},${y + 0.5}`).join(" ")}"/></svg>`;
    const targets = new Map(); // "x,y" -> k
    const owner = o.moves && o.moves.length ? v.players[o.owner] : null;
    if (owner) for (const m of o.moves) targets.set(cellOf(geo, owner.seat, m.to, m.k).join(","), m.k);
    const field = (xy, cls) => {
      const t = targets.get(xy.join(","));
      return `<span class="spot ${cls}${t != null ? " target" : ""}" style="${at(xy)}"${t != null ? ` data-k="${t}"` : ""}></span>`;
    };
    for (let s = 0; s < arms; s++) {
      const off = used.has(s) ? "" : " off";
      h += `<span class="yard c${s}${o.yardOn === s ? " on" : ""}${off}" style="${at(geo.yard[s][0])}"></span>`;
      for (const xy of geo.yard[s]) h += field(xy, `c${s}${off}`);
      for (const xy of geo.goal[s]) h += field(xy, `c${s}${off}`);
    }
    geo.track.forEach((xy, i) => { h += field(xy, i % 10 === 0 ? `start c${i / 10}${used.has(i / 10) ? "" : " off"}` : ""); });
    if (o.extra) h += o.extra;
    if (o.dice != null && o.diceSeat != null) {
      const d = `class="die${o.canRoll ? " go" : ""}" data-f="${o.dice}" style="${at(DICE_AT[o.diceSeat])}"`;
      h += o.canRoll ? `<button type="button" ${d} data-roll aria-label="Würfeln">${DIE}</button>` : `<span ${d}>${DIE}</span>`;
    }
    const can = new Map((o.moves || []).map((m, i) => [m.k, i]));
    v.players.forEach((p, i) => p.pieces.forEach((r, k) => {
      if (r < -1) return;
      const mine = owner && i === o.owner && can.has(k);
      const cls = ["piece", "p" + p.seat, mine ? "can" : "", mine && o.sel === can.get(k) ? "sel" : "", o.last && o.last.o === i && o.last.k === k ? "last" : ""].join(" ");
      h += `<span class="${cls}" style="${at(cellOf(geo, p.seat, r, k))}" data-o="${i}" data-k="${k}"${mine ? ` role="button" aria-label="Figur ${can.get(k) + 1}"` : ""}>` +
        `<i></i>${mine ? `<span class="n">${can.get(k) + 1}</span>` : ""}</span>`;
    }));
    return h + "</div>";
  }

  // walk a piece along its path, and send a hit piece back to its yard afterwards
  function animateMove(ev) {
    const board = $("#board"), el = board.querySelector(`.piece[data-o="${ev.o}"][data-k="${ev.k}"]`);
    if (!el || !el.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cell = parseFloat(board.style.getPropertyValue("--cell")) || 32, seat = V.players[ev.o].seat;
    const geo = geoOf(V), path = [cellOf(geo, seat, ev.from, ev.k)];
    if (ev.from < 0) path.push(cellOf(geo, seat, 0, ev.k));
    else for (let r = ev.from + 1; r <= ev.to; r++) path.push(cellOf(geo, seat, r, ev.k));
    const end = path[path.length - 1], n = path.length - 1;
    const frames = [];
    path.forEach(([x, y], i) => {
      const tx = (x - end[0]) * cell, ty = (y - end[1]) * cell;
      frames.push({ transform: `translate(${tx}px,${ty}px)`, offset: i / n });
      if (i < n) {
        const [x2, y2] = path[i + 1];
        frames.push({ transform: `translate(${((x + x2) / 2 - end[0]) * cell}px,${((y + y2) / 2 - end[1]) * cell - cell * 0.35}px)`, offset: (i + 0.5) / n });
      }
    });
    el.animate(frames, { duration: Math.max(260, n * STEP_MS), easing: "linear" });
    if (ev.hit) {
      const vic = board.querySelector(`.piece[data-o="${ev.hit.pi}"][data-k="${ev.hit.k}"]`);
      if (vic) {
        const home = cellOf(geo, V.players[ev.hit.pi].seat, -1, ev.hit.k);
        vic.animate([
          { transform: `translate(${(end[0] - home[0]) * cell}px,${(end[1] - home[1]) * cell}px)` },
          { transform: `translate(${(end[0] - home[0]) * cell * 0.5}px,${(end[1] - home[1]) * cell * 0.5 - cell * 1.5}px) rotate(200deg)`, offset: 0.5 },
          { transform: "none" }
        ], { duration: 520, delay: n * STEP_MS, easing: "ease-in-out", fill: "backwards" });
      }
    }
  }
  let spinning = false;
  function spinDie() {
    const d = $("#dieBtn");
    if (!V || !V.dice) return;
    const final = V.dice;
    d.classList.remove("roll"); void d.offsetWidth; d.classList.add("roll");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let n = 0;
    clearInterval(spinDie.t);
    spinning = true;
    spinDie.t = setInterval(() => {
      n++;
      d.dataset.f = n >= 7 ? final : 1 + Math.floor(Math.random() * 6);
      if (n >= 7) { clearInterval(spinDie.t); spinning = false; }
    }, 60);
  }
  function renderDie() {
    const d = $("#dieBtn"), play = canPlay() && V.phase === "play";
    // the die also carries out a move that is the only one possible, so a quick
    // second tap after a 6 brings the piece out instead of doing nothing
    const forced = play && V.need === "move" && V.moves.length === 1;
    d.disabled = !play;
    d.classList.toggle("go", play && (V.need === "roll" || forced));
    d.setAttribute("aria-label", play && V.need === "move" ? (forced ? "Figur ziehen" : "Figur wählen") : "Würfeln");
    if (!spinning) d.dataset.f = V.phase === "play" ? V.dice || 0 : 0;
  }
  function tapDie() {
    if (!V || V.phase !== "play") return;
    if (!canPlay()) return notYou();
    if (V.need === "roll") return roll();
    if (V.moves.length === 1) return move(V.moves[0].k);
    toast("Tippe auf eine leuchtende Figur.");
    const pieces = document.querySelectorAll("#board .piece.can");
    for (const p of pieces) { p.classList.remove("hint"); void p.offsetWidth; p.classList.add("hint"); }
  }

  // the board fills the room the arena has left; the size setting (--cs) scales it
  const desktop = matchMedia("(min-width:900px) and (min-height:700px)");
  function layoutBoard() {
    const arena = $("#arena"), b = $("#board");
    if (!V || !arena.offsetParent) return;
    const st = getComputedStyle(arena);
    const W0 = arena.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
    const geo = geoOf(V), strip = $("#pstrip"), side = desktop.matches && !strip.hidden && arena.clientWidth >= 1150;
    arena.classList.toggle("side", side); // wide screens: the name tags stand beside the board
    const H = arena.clientHeight - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom) - $("#lastMove").offsetHeight - (strip.hidden || side ? 0 : strip.offsetHeight + 10) - 10 - 4;
    const cs = parseFloat(LOOK.get().size) || 1, bw = geo.w + 0.5, bh = geo.h + 0.5;
    const W = W0 - (side ? 580 : 0);
    const fit = Math.min(W / bw, H / bh, desktop.matches ? 104 : 64);
    const maxW = cs > 1 ? (arena.clientWidth - 4) / bw : W / bw; // a big board may use the side margins
    const cell = Math.max(geo.arms > 4 ? 14 : 18, Math.floor(Math.min(maxW, fit * cs)));
    b.style.setProperty("--cell", cell + "px");
    b.style.setProperty("--bw", bw);
    b.style.setProperty("--bh", bh);
  }
  desktop.addEventListener && desktop.addEventListener("change", () => { if (V) render(); });
  window.addEventListener("resize", () => { if (V) layoutBoard(); });
  if (window.ResizeObserver) new ResizeObserver(() => layoutBoard()).observe($("#arena"));

  function badgeHTML(i) {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = members && members[i] && !members[i].online;
    const cls = ["badge", "c" + p.seat, V.phase === "play" && V.cur === i ? "on" : "", away || p.out ? "away" : "", p.done ? "done" : ""].join(" ");
    const tag = p.out ? "aufgegeben" : p.done ? `Platz ${p.place}` : away ? "offline" : mode === "online" && i === V.me ? "du" : G.COLORS[p.seat];
    const g = inGoal(p);
    return `<div class="${cls}" data-seat="${i}" ${V.arms > 4 ? "" : ` style="${at(BADGE_AT[p.seat])}"`}><span class="bav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="binfo"><b>${esc(p.name)}</b><small><span class="pgoal" title="${g} von 4 im Ziel">${[0, 1, 2, 3].map((j) => `<i class="${j < g ? "on" : ""}"></i>`).join("")}</span>${tag}</small></span>` +
      `<span class="bwins" title="Siege">${p.wins}</span></div>`;
  }

  function renderGame() {
    if (V.phase !== "roundEnd") peek = false;
    const play = canPlay();
    if (!play || V.need !== "move") sel = null;
    if (sel != null && sel >= V.moves.length) sel = null;
    const teams = V.rules.teams ? " · Teams" : "";
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> · ${V.goal === 1 ? "Erster gewinnt" : "alle Plätze"}${teams}`;

    // board
    const board = $("#board"), lm = V.lastMove;
    board.innerHTML = boardHTML(V, {
      moves: play && V.need === "move" ? V.moves : null, owner: V.owner, sel,
      last: lm && V.phase === "play" ? lm : null, extra: V.arms > 4 ? "" : V.players.map((_, i) => badgeHTML(i)).join(""),
      yardOn: V.phase === "play" && V.cur >= 0 ? V.players[V.cur].seat : null
    });
    // a big board has no room for name tags on it: they line up below instead
    const strip = $("#pstrip");
    strip.hidden = V.arms <= 4;
    strip.innerHTML = V.arms > 4 ? V.players.map((_, i) => badgeHTML(i)).join("") : "";
    layoutBoard();
    if (anim) { animateMove(anim); anim = null; }

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
      const w = V.last.winners;
      who = !w.length ? "Spiel vorbei" : w.length > 1 ? `${w.map((i) => V.players[i].name).join(" und ")} gewinnen` : `${pname(w[0])} ${mode === "online" && w[0] === V.me ? "gewinnst" : "gewinnt"}`;
      av = w.length ? V.players[w[0]].avatar : "🏁";
      hint = "Spiel vorbei.";
    } else {
      const P = V.players[V.cur];
      av = P.avatar;
      const forWhom = V.owner !== V.cur ? ` Du ziehst für ${V.players[V.owner].name}.` : "";
      if (play) {
        who = mode === "local" && humans(V).length > 1 ? `${P.name}, du bist dran` : "Du bist dran";
        if (V.need === "roll") hint = (V.three ? `Tippe auf den Würfel, Versuch ${V.tries + 1} von 3.` : V.dice === 6 ? "Eine 6! Du darfst nochmal würfeln." : "Tippe auf den Würfel.") + forWhom;
        else hint = `Eine ${V.dice}. ${V.moves.length === 1 ? "Tippe auf den Würfel oder die leuchtende Figur." : "Tippe auf eine leuchtende Figur, der Ring zeigt das Ziel."}${forWhom}`;
      } else {
        who = `${P.name} ist dran`;
        hint = P.bot ? (V.need === "roll" ? "Der Computer würfelt …" : `Eine ${V.dice}, der Computer überlegt …`)
          : mode === "online" && V.me < 0 ? "Du schaust zu." : V.need === "move" ? `Hat eine ${V.dice} gewürfelt.` : "Warte auf den Wurf.";
      }
    }
    $("#whoAv").textContent = av;
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    $("#dock").classList.toggle("myturn", play);
    $("#tries").hidden = !(V.phase === "play" && V.three);
    $("#tries").innerHTML = [0, 1, 2].map((i) => `<i class="${i < V.tries ? "on" : ""}"></i>`).join("");
    renderDie();
    if (rollAnim) { rollAnim = false; spinDie(); }
    $("#resultBtn").hidden = !(V.phase === "roundEnd" && peek);
    $("#reactBtn").hidden = mode !== "online";
    $("#keys").innerHTML = play ? (V.need === "roll" ? "<kbd>Leertaste</kbd> würfeln" : `<kbd>1</kbd>–<kbd>${V.moves.length}</kbd> ziehen · <kbd>←</kbd><kbd>→</kbd> + <kbd>Enter</kbd>`) : "";
    renderClock();

    // turn change feedback
    const key = `${V.round}:${V.turn}:${V.cur}`;
    if (play && lastTurn !== key && lastTurn !== null && (mode === "online" || V.players.some((p) => p.bot))) { buzz([40, 60, 40]); sfx("turn"); }
    lastTurn = key;

    $("#roundEnd").hidden = V.phase !== "roundEnd" || peek;
    if (V.phase === "roundEnd") {
      if (!peek) renderRoundEnd();
      const k = `${V.round}:${V.last.winners.join(",")}:${V.players.map((p) => p.wins).join(",")}`;
      if (confettiFor !== k) {
        confettiFor = k; record(k);
        if (V.last.winners.length) setTimeout(() => { confetti(); sfx("win"); }, 700);
      }
    }
  }

  $("#dieBtn").addEventListener("click", tapDie);
  $("#board").addEventListener("click", (e) => {
    const t = e.target.closest("[data-k]");
    if (t && canPlay() && V.need === "move") move(+t.dataset.k);
  });
  $("#resultBtn").addEventListener("click", () => { peek = false; render(); });

  // keys: space rolls, 1-4 or arrows + Enter move, Esc closes
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") {
      if (open) $(open).hidden = true;
      else if (sel != null) { sel = null; if (V) renderGame(); }
      return;
    }
    if (open || $("#game").hidden || !$("#roundEnd").hidden || !canPlay()) return;
    const k = e.key.toLowerCase();
    if (V.need === "roll") {
      if (k === " " || k === "enter" || k === "r") { e.preventDefault(); roll(); }
      return;
    }
    if (/^[1-4]$/.test(k)) { const m = V.moves[+k - 1]; if (m) { e.preventDefault(); move(m.k); } return; }
    if (k === "arrowleft" || k === "arrowright" || k === "tab") {
      e.preventDefault();
      const n = V.moves.length;
      sel = sel == null ? 0 : (sel + (k === "arrowleft" ? n - 1 : 1)) % n;
      renderGame();
    } else if (k === "enter" || k === " ") {
      e.preventDefault();
      const m = V.moves[sel == null ? 0 : sel];
      if (m && (sel != null || V.moves.length === 1)) move(m.k);
    }
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
    const t = box.querySelector('[data-rule="teams"]');
    if (t) t.closest(".toggle").classList.toggle("na", 1 + HOME.opp() !== 4);
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
    const host = pi >= 0 ? document.querySelector(`#arena [data-seat="${pi}"]`) : $("#dock");
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

  const statLine = (p) => [p.hits ? `${p.hits}× rausgeworfen` : "", p.lost ? `${p.lost}× erwischt` : "", p.sixes ? `${p.sixes} Sechsen` : ""].filter(Boolean).join(" · ");
  function scoreList(el, order, winners) {
    el.innerHTML = order.map((i, n) => {
      const p = V.players[i], you = i === V.me && mode === "online" ? " (du)" : "";
      const place = V.phase === "roundEnd" ? `${n + 1}. ` : "";
      const info = [G.COLORS[p.seat], p.out ? "aufgegeben" : `${inGoal(p)}/4 im Ziel`, statLine(p)].filter(Boolean).join(" · ");
      return `<li class="${winners.includes(i) ? "win" : ""}"><span>${place}${avi(p.avatar)}${esc(p.name)}${you}<small>${info}</small></span>` +
        `<b>${p.wins} ${p.wins === 1 ? "Sieg" : "Siege"}</b></li>`;
    }).join("");
  }

  function renderRoundEnd() {
    const last = V.last, w = last.winners;
    $("#reLabel").textContent = "Spiel vorbei";
    const you = mode === "online" && w.includes(V.me);
    $("#reTitle").textContent = !w.length ? "Spiel vorbei" : w.length > 1 ? `${you ? "Ihr gewinnt" : `${w.map((i) => V.players[i].name).join(" und ")} gewinnen`}!` :
      `${you ? "Du gewinnst" : `${V.players[w[0]].name} gewinnt`}!`;
    const fin = w.filter((i) => V.players[i].done).length;
    $("#reText").textContent = (!fin ? "Alle anderen haben aufgegeben." : w.length > 1 ? `Beide haben alle Figuren im Ziel, nach ${last.turns} ${last.turns === 1 ? "Zug" : "Zügen"}.` : `Alle vier Figuren im Ziel nach ${last.turns} ${last.turns === 1 ? "Zug" : "Zügen"}.`) +
      ` Als Nächstes beginnt ${V.players[V.nextStarter].name}.`;
    scoreList($("#reScores"), last.places, w);
    UI.roundEndFooter({ over: last.over, next: "Revanche" });
  }

  // Statistik lebt im Profil (shared/profile.js, gilt für alle Spiele); die alte Bilanz dieses Browsers wird einmal übernommen
  const profile = Spieleabend.profile;
  { const old = (store.get(K.stats) || {})[profile.get().name]; if (old) profile.importLegacy("maedn", { rounds: old.rounds || old.games, wins: old.wins }); }
  function record(key) {
    const i = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
    if (i < 0) return;
    profile.result("maedn", key, { won: V.last.winners.includes(i), draw: !V.last.winners.length, online: mode === "online" });
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
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => p.name).join(", ")} · Runde ${saved.round}`;
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
    memberExtra: (m, i) => { const seats = G.SEATS[Math.max(2, R.members.length)] || G.SEATS[4]; return `<i class="dot c${seats[i]}" title="${G.COLORS[seats[i]]}"></i>`; },
    // goal, computer strength and house rules; the host picks, everyone sees it
    renderSettings(host) {
      for (const [id, list, cur] of [["#goalOnline", GOALS, R.goal], ["#levelOnline", LEVELS, R.level == null ? 2 : R.level]]) {
        const el = $(id), k = cur + ":" + host;
        if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = segHTML(list, cur); for (const b of el.children) b.disabled = !host; }
      }
      const rl = $("#rulesLobby"), key = JSON.stringify(R.rules) + host;
      if (rl.dataset.k !== key) { rl.dataset.k = key; rl.innerHTML = rulesHTML(R.rules || {}, host, "o"); }
      const t = rl.querySelector('[data-rule="teams"]');
      if (t) t.closest(".toggle").classList.toggle("na", R.members.length !== 4);
      const onR = activeNames(R.rules);
      $("#rulesLobbySum").textContent = onR.length ? onR.join(", ") : "keine";
      $("#rulesLobbyHint").textContent = host ? "Tippe an, was gelten soll. Alle sehen deine Auswahl." : `${R.members[R.host].name} legt die Regeln fest.`;
    },
    menu: {
      open() {
        LOOK.render();
        if (V) scoreList($("#menuScores"), V.players.map((_, i) => i), []);
        const on = activeNames(V ? V.rules : {});
        const goal = V ? `${V.goal === 1 ? "Wer zuerst fertig ist, gewinnt." : "Alle Plätze werden ausgespielt."}` : "";
        $("#menuRules").textContent = `${goal} ${on.length ? `Hausregeln: ${on.join(", ")}.` : "Keine Hausregeln."}`;
      },
      local(box) {
        if (V && V.phase === "play" && !V.players[V.cur].bot && humans(V).length > 1)
          box.append(UI.armed(`${V.players[V.cur].name} gibt auf`, () => doAct({ t: "giveup" })));
        box.append(
          UI.armed("Spiel neu starten", () => { L.round--; L.starter = (L.starter + L.players.length - 1) % L.players.length; G.startRound(L); peek = false; store.set(K.local, L); render(); scheduleBot(); }),
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; clearTimeout(botT); clearTimeout(clockT); render(); })
        );
      },
      player(box) {
        if (V && V.phase === "play" && V.me >= 0 && !V.players[V.me].out)
          box.append(UI.armed("Aufgeben", () => wsSend({ t: "act", a: { t: "giveup" } })));
      },
      skip: (v) => v.phase === "play" && v.cur !== v.me && !v.players[v.cur].bot
    }
  });

  // avatar picker in the online form
  Spieleabend.avatarPicker({ avatars: G.AVATARS, get: () => myAvatar, set: (a) => { myAvatar = a; store.set(K.avatar, a); } });

  // look settings on the start screen and in the menu
  $("#goalOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", goal: +b.dataset.v }); });
  $("#levelOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", level: +b.dataset.v }); });


  // connection pill: only after a short grace period, phones drop sockets all the time

  // ---------- online connection ----------
  function wsSend(m) { return UI.send(m); }

  // ---------- events ----------
  // a small board on the start screen, mid-game
  $("#heroBoard").innerHTML = boardHTML({ players: [
    { seat: 0, pieces: [-1, 7, 41, -1] }, { seat: 1, pieces: [3, -1, -1, 22] },
    { seat: 2, pieces: [-1, -1, 15, 0] }, { seat: 3, pieces: [42, 12, -1, -1] }
  ] }, { dice: 6, diceSeat: 0 });
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
    L = state; mode = "local"; peek = false; sel = null;
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
  UI.detectServer("/maedn-server", "maedn").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
