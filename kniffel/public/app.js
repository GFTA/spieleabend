// Kniffel UI: single player and online rooms share one table. All dice and holds are
// public, so everybody watches every roll.
(() => {
  "use strict";
  const G = window.KniffelGame;
  // an old cached game.js next to a new app.js: reload once instead of breaking
  if (!G || !G.RULES || !G.CATS) {
    let tried = false;
    try { tried = sessionStorage.getItem("kniffel.reloaded") === "1"; sessionStorage.setItem("kniffel.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    return;
  }
  try { sessionStorage.removeItem("kniffel.reloaded"); } catch (e) {}

  const $ = (s) => document.querySelector(s);
  const K = { local: "kniffel.v1",
    online: "kniffel.online", me: "kniffel.me", avatar: "kniffel.avatar", rules: "kniffel.rules",
    level: "kniffel.level", look: "kniffel.look", sound: "kniffel.sound" };
  const store = Spieleabend.store;

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let R = null;           // last online room message
  let watching = false; // in the waiting room, but watching the game that runs
  let V = null;           // view on screen
  let server = null, serverState = "checking";
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "kniffel.opp", max: 8, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let localLevel = G.BOT_LEVELS[store.get(K.level)] ? store.get(K.level) : "normal";
  let localRules = G.normRules(store.get(K.rules) || {});
  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const isBot = (i) => !!(V && V.players[i] && V.players[i].bot);
  const myTurn = () => !!V && V.phase === "play" && V.cur === V.me && !isBot(V.cur) && !hold;
  const who = (i) => (mode === "online" && V && i === V.me ? "Du" : V.players[i].name);

  // pips on a 3x3 grid (cells 1-9); the one is red like on classic dice
  const FACES = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const pips = (v) => (FACES[v] || []).map((c) => `<i${v === 1 ? ' class="one"' : ""} style="grid-area:${Math.ceil(c / 3)}/${((c - 1) % 3) + 1}"></i>`).join("");
  const dieHTML = (v, cls = "") => `<span class="die ${cls}" data-v="${v}">${pips(v)}</span>`;
  
  const { toast, confetti, showBubble } = Spieleabend;
  Spieleabend.followTurn("#sheetWrap", "#sheet thead th.act"); // the player on turn scrolls into view

  // ---------- sound ----------
  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound, vol: 0.15,
    effects: ({ tone }) => ({
      rattle: (n) => { for (let i = 0; i < 5 + n * 2; i++) tone(160 + Math.random() * 260, i * 0.045 + Math.random() * 0.02, 0.03, "triangle", 0.12); },
      land: () => tone(220, 0, 0.06, "triangle", 0.18),
      hold: () => tone(760, 0, 0.05, "sine", 0.1),
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      big: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.18, "square", 0.06)),
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16)),
      pop: () => tone(740, 0, 0.06, "sine", 0.12)
    })
  });

  // ---------- single player (with computers) ----------
  const lBot = (i) => !!(L && L.players[i] && L.players[i].bot);
  const localViewer = () => L.players.findIndex((p) => !p.bot);
  let botT = null, botKey = null;
  function scheduleLocalBot() {
    if (mode !== "local" || !L || L.phase !== "play" || !lBot(L.cur)) { clearTimeout(botT); botKey = null; return; }
    const key = `${L.round}:${L.turn}:${L.seq}`;
    if (key === botKey) return;
    clearTimeout(botT); botKey = key;
    const wait = Math.max(0, holdUntil - Date.now());
    botT = setTimeout(() => {
      botKey = null;
      if (mode !== "local" || !L || !lBot(L.cur)) return;
      const a = G.suggest(G.view(L, L.cur), G.botLevel(L, L.cur, localLevel)) || { t: "stop" };
      if (!doAct(a, L.cur) && a.t !== "stop") doAct({ t: L.rolls ? "stop" : "roll" }, L.cur);
    }, wait + 750 + Math.random() * 650);
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

  // events drive the animations: a roll tumbles the dice that were not held, and an entry
  // stays on the table for a moment so everybody sees what was written down
  let rollAnim = null;      // { which, dice } for the next tray render
  let hold = null, holdUntil = 0, holdT = null;
  function handleEvents(events) {
    for (const ev of events || []) {
      if (ev.t === "rolled") {
        // the next player already rolls: stop showing the previous entry
        if (hold && hold.pi !== ev.pi) { hold = null; clearTimeout(holdT); }
        pending = null;
        rollAnim = { which: ev.which, dice: ev.dice }; sfx("rattle", ev.which.length); buzz(20);
      }
      if (ev.t === "hold") sfx("hold");
      if (ev.t === "scored") {
        pending = null;
        const rolled = events.find((e) => e.t === "rolled" && e.pi === ev.pi);
        hold = { pi: ev.pi, dice: ev.dice, keep: [false, false, false, false, false], rolls: ev.rolls, c: ev.c, points: ev.points, bonus: ev.bonus };
        const ms = (rolled ? 900 : 0) + 1700;
        holdUntil = Date.now() + ms;
        clearTimeout(holdT); holdT = setTimeout(() => { hold = null; render(); }, ms);
        if (ev.c === "kniffel" && ev.points === 50) { confetti(); setTimeout(() => sfx("big"), rolled ? 800 : 0); }
        else sfx("pop");
      }
    }
  }

  function tryRoll() {
    if (!myTurn() || rolling) return;
    if (V.rolls >= V.maxRolls) { toast("Keine Würfe mehr übrig. Trage jetzt ein Feld ein."); flashSheet(); return; }
    if (V.rolls && V.hold.every(Boolean)) { toast("Du behältst alle Würfel. Trage ein Feld ein oder lass einen los."); return; }
    pending = null;
    doAct({ t: "roll" });
  }
  // "Eintragen": writes the picked box; without a pick it takes the only possible box or says what to do
  function tryScore() {
    if (!myTurn() || rolling) return;
    if (!V.rolls) { toast("Würfle zuerst."); return; }
    const keys = Object.keys(V.options);
    if (pending && V.options[pending] != null) return doScore(pending);
    if (keys.length === 1) return doScore(keys[0]);
    toast("Tippe im Block das Feld an, das du eintragen willst."); flashSheet();
  }
  function doScore(c) { pending = null; doAct({ t: "score", c }); }
  function pickBox(c) {
    if (!myTurn() || rolling || !V.rolls || V.options[c] == null) return;
    if (pending === c) return doScore(c);
    pending = c; sfx("hold"); renderSheet(); renderDock();
  }
  function flashSheet() { const w = $("#sheetWrap"); w.classList.remove("flash"); void w.offsetWidth; w.classList.add("flash"); }
  function toggleHold(i) {
    if (!myTurn()) { if (V && V.phase === "play") toast(`${V.players[V.cur].name} ist dran.`); return; }
    if (!V.rolls) { toast("Erst würfeln, dann Würfel behalten."); return; }
    if (V.rolls >= V.maxRolls) { toast("Keine Würfe mehr übrig. Trage jetzt ein Feld ein."); flashSheet(); return; }
    if (rolling) return;
    // show it at once; the server confirms a moment later
    V.hold[i] = !V.hold[i]; renderTray();
    doAct({ t: "hold", i });
  }
  function showHint() {
    if (!myTurn()) return;
    const a = G.suggest(V, "hard");
    if (!a) return;
    if (a.t === "roll" && !V.rolls) return toast("Tipp: Einfach würfeln.");
    if (a.t === "score") { pending = a.c; renderSheet(); renderDock(); return toast(`Tipp: Trage ${G.CAT[a.c].name} ein (${V.options[a.c]} Punkte).`); }
    const keep = a.t === "hold" ? a.keep : V.hold;
    const vals = V.dice.filter((_, i) => keep[i]);
    toast(vals.length ? `Tipp: Behalte ${vals.join(", ")} und würfle den Rest neu.` : "Tipp: Alles neu würfeln.");
    document.querySelectorAll("#dice .die").forEach((d, i) => { if (keep[i]) d.animate([{ transform: "translateY(-6px)" }, { transform: "translateY(0)" }], { duration: 300, iterations: 3 }); });
  }

  // ---------- rendering ----------
  function showScreen(id) { for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id; }

  function render() {
    if (mode === "local" && L) {
      V = G.view(L, localViewer());
      showScreen("game"); renderGame();
      scheduleLocalBot();
    } else if (mode === "online" && R) {
      const meM = R.members[R.you], waiting = !!(R.view && meM && meM.lobby);
      if (!waiting) watching = false;
      if (!R.view || (waiting && !watching)) { V = null; showScreen("lobby"); UI.renderLobby(); $("#roundEnd").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else {
      V = null; $("#roundEnd").hidden = true;
      showScreen("home"); renderHome();
    }
    UI.update();
  }

  let pending = null;       // the box picked but not yet written down
  let lastTurnKey = null;
  function renderGame() {
    const me = V.players[V.me];
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> von ${V.rounds}${me && mode === "online" ? ` · du: <b>${me.tot.total}</b>` : ""}`;
    $("#reactBtn").hidden = mode !== "online";
    const key = `${V.round}:${V.turn}`;
    if (key !== lastTurnKey) pending = null;
    renderTray();
    renderSheet();
    renderDock();
    if (key !== lastTurnKey && lastTurnKey !== null && myTurn()) { sfx("turn"); buzz([40, 60, 40]); }
    lastTurnKey = key;
    const showEnd = V.phase === "roundEnd" && !hold;
    $("#roundEnd").hidden = !showEnd;
    if (showEnd) renderRoundEnd();
  }

  // the score sheet: one column per player, the one on turn highlighted; boxes that may be
  // written down now show their points and are tapped (twice: pick, then confirm)
  function renderSheet() {
    const order = V.order && V.order.length ? V.order : V.players.map((_, i) => i);
    const activePi = V.phase === "play" ? (hold ? hold.pi : V.cur) : -1;
    const mine = myTurn() && V.rolls > 0;
    const members = mode === "online" && R ? R.members : null;
    const tots = V.players.map((p) => p.tot.total), top = Math.max(...tots);
    const cell = (i, c) => {
      const p = V.players[i], v = p.sheet[c.k], act = i === activePi ? " act" : "", me = mode === "online" && i === V.me ? " me" : "";
      if (v != null) {
        const just = hold && hold.pi === i && hold.c === c.k;
        return just ? `<td class="just${act}${me}"><b>${v}</b></td>` : `<td class="${v === 0 ? "zero-filled" : ""}${act}${me}">${v}</td>`;
      }
      if (mine && i === V.cur && V.options[c.k] != null) {
        const pts = V.options[c.k];
        return `<td class="pick${pts === 0 ? " zero" : ""}${pending === c.k ? " sel" : ""}${act}${me}" data-c="${c.k}"><b>${pts}</b></td>`;
      }
      return `<td class="${act.trim()}${me}"></td>`;
    };
    const row = (c) => `<tr><th class="cat" scope="row">${c.name}${c.note ? `<small>${c.note}</small>` : ""}</th>${order.map((i) => cell(i, c)).join("")}</tr>`;
    const sub = (label, f, cls = "sub") => `<tr class="${cls}"><th class="cat" scope="row">${label}</th>${order.map((i) => `<td class="${i === activePi ? "act" : ""}">${f(V.players[i], i)}</td>`).join("")}</tr>`;
    const head = `<thead><tr><th class="cat"></th>${order.map((i) => {
      const p = V.players[i], away = members && members[i] && !members[i].online;
      return `<th data-seat="${i}" class="${i === activePi ? "act" : ""}" style="${away ? "opacity:.5" : ""}"><span class="av">${p.avatar || (p.bot ? "🤖" : "")}</span><span class="nm">${esc(mode === "online" && i === V.me ? `${p.name} (du)` : p.name)}</span></th>`;
    }).join("")}</tr></thead>`;
    const up = G.CATS.filter((c) => c.up), low = G.CATS.filter((c) => !c.up);
    $("#sheet").innerHTML = head + "<tbody>" + up.map(row).join("") +
      sub(`Summe oben <small>ab ${G.BONUS_AT}: +${G.BONUS}</small>`, (p) => {
        const b = G.bonusState(p);
        const chip = b.done ? "" : b.out ? `<span class="pace out" title="Bonus nicht mehr zu schaffen">Bonus weg</span>`
          : b.open < 6 && b.open > 0 ? `<span class="pace ${b.pace >= 0 ? "up" : "dn"}" title="Gegenüber dreimal jede Zahl">${b.pace > 0 ? "+" : b.pace < 0 ? "−" : "±"}${Math.abs(b.pace)}</span>` : "";
        return `${p.tot.up}/${G.BONUS_AT}${chip}`;
      }) +
      sub("Bonus", (p) => p.tot.bonus ? `<b>+${p.tot.bonus}</b>` : G.bonusState(p).out ? "✗" : "–") +
      low.map(row).join("") +
      (V.rules.joker ? sub(`Kniffel-Bonus <small>je ${G.EXTRA_KNIFFEL}</small>`, (p) => p.tot.extra || "–") : "") +
      sub("Gesamt", (p) => p.tot.total, "total") + "</tbody>";
    // mark the leader in the total row
    const cells = $("#sheet").querySelectorAll("tr.total td");
    order.forEach((i, k) => { if (V.players.some((p) => p.tot.total > 0) && tots[i] === top) cells[k].classList.add("lead"); });
  }

  // the five big dice; built once, then only faces and classes change so animations run
  let rolling = false;
  function renderTray() {
    const src = hold || { pi: V.cur, dice: V.dice, keep: V.hold, rolls: V.rolls };
    const box = $("#dice");
    if (box.children.length !== G.DICE) {
      box.innerHTML = Array.from({ length: G.DICE }, (_, i) => `<div class="slot" data-i="${i}">${dieHTML(1)}<span class="keep">BEHALTEN</span></div>`).join("");
    }
    const blank = !src.rolls && !hold;
    const p = V.players[src.pi], you = src.pi === V.me && mode === "online";
    $("#turnWho").innerHTML = V.phase === "roundEnd" && !hold ? "Spiel vorbei"
      : hold ? `<span class="av">${p.avatar || (p.bot ? "🤖" : "")}</span><span>${esc(you ? "Du" : p.name)}: ${G.CAT[hold.c].name} <b>${hold.points}</b>${hold.bonus ? " + 100" : ""}</span>`
      : `<span class="av">${p.avatar || (p.bot ? "🤖" : "")}</span><span>${esc(you ? "Du" : p.name)}${you ? " bist dran" : " ist dran"}</span>`;
    $("#pips").innerHTML = Array.from({ length: V.maxRolls || G.MAX_ROLLS }, (_, k) => `<i class="${k < src.rolls ? "used" : ""}"></i>`).join("");
    const can = myTurn() && V.rolls > 0 && V.rolls < V.maxRolls;
    const anim = rollAnim; rollAnim = null;
    [...box.children].forEach((slot, i) => {
      const d = slot.firstElementChild, v = src.dice[i];
      slot.classList.toggle("held", !!src.keep[i] && !blank);
      d.classList.toggle("held", !!src.keep[i] && !blank);
      d.classList.toggle("can", can);
      d.classList.toggle("blank", blank);
      if (anim && anim.which.includes(i) && !matchMedia("(prefers-reduced-motion: reduce)").matches) tumble(d, anim.dice[i], anim.which.indexOf(i));
      else if (!d.classList.contains("rolling") && d.dataset.v !== String(v)) { d.dataset.v = v; d.innerHTML = pips(v); }
      d.setAttribute("aria-label", blank ? "Würfel" : `${v}${src.keep[i] ? ", behalten" : ""}`);
    });
    renderOdds(!!anim);
    if (anim) { rolling = true; clearTimeout(renderTray.t); renderTray.t = setTimeout(() => { rolling = false; sfx("land"); renderDock(); renderSheet(); renderOdds(); }, 760 + 60 * anim.which.length); }
  }
  // live chances for the next roll of the loose dice (only for the one on turn, not when watching)
  function renderOdds(tumbling) {
    const box = $("#odds");
    const src = { dice: V.dice, keep: V.hold };
    const show = !hold && myTurn() && V.rolls > 0 && V.rolls < V.maxRolls && !rolling && !tumbling;
    let html = "";
    if (show) {
      html = G.odds(src.dice, src.keep, V.players[V.cur].sheet).slice(0, 3)
        .map((o) => `<span class="${o.p >= 0.5 ? "hot" : ""}">${G.CAT[o.c].name}<b>${o.p >= 0.995 ? "sicher" : Math.max(1, Math.round(o.p * 100)) + " %"}</b></span>`).join("");
    }
    if (box.dataset.k !== html) { box.dataset.k = html; box.innerHTML = html; }
  }
  function tumble(d, finalV, k) {
    const dur = 650 + k * 60;
    d.style.setProperty("--rt", dur + "ms");
    d.classList.remove("rolling"); void d.offsetWidth; d.classList.add("rolling");
    clearInterval(d._flick);
    d._flick = setInterval(() => { const r = 1 + Math.floor(Math.random() * 6); d.innerHTML = pips(r); }, 70);
    setTimeout(() => { clearInterval(d._flick); d.classList.remove("rolling"); d.dataset.v = finalV; d.innerHTML = pips(finalV); }, dur);
  }

  function renderDock() {
    const mine = myTurn();
    $("#dock").classList.toggle("myturn", mine);
    const left = V.maxRolls - V.rolls;
    let who_, hint;
    if (V.phase === "roundEnd") { who_ = "Spiel vorbei"; hint = ""; }
    else if (hold) { const p = V.players[hold.pi]; who_ = `${hold.pi === V.me && mode === "online" ? "Dein" : `${p.name}s`} Eintrag`; hint = `${G.CAT[hold.c].name}: ${hold.points} Punkte`; }
    else if (mine) {
      who_ = mode === "local" ? `${V.players[V.cur].name}, du bist dran` : "Du bist dran";
      hint = !V.rolls ? "Tippe auf Würfeln."
        : pending ? `${G.CAT[pending].name}: ${V.options[pending]} Punkte. Tippe nochmal zum Eintragen.`
        : left ? "Würfel zum Behalten antippen, oder gleich ein Feld im Block eintragen." : "Tippe im Block das Feld an, das du eintragen willst.";
    } else {
      who_ = `${V.players[V.cur].name} würfelt`;
      hint = mode === "online" && V.me < 0 ? "Du schaust zu." : V.rolls ? "Gelb markierte Würfel werden behalten." : "Gleich geht's los.";
    }
    $("#whoName").textContent = who_;
    $("#whoHint").textContent = hint;
    const rb = $("#rollBtn"), sb = $("#stopBtn");
    rb.hidden = sb.hidden = mode === "online" && V.me < 0;
    rb.disabled = !mine || left <= 0 || rolling;
    sb.disabled = !mine || !V.rolls || rolling;
    rb.textContent = !V.rolls || !mine ? "Würfeln" : left === 1 ? "Letzter Wurf" : `Würfeln (${left} übrig)`;
    sb.textContent = mine && pending ? `${G.CAT[pending].short} eintragen` : "Eintragen";
    sb.classList.toggle("btn-primary", mine && (left <= 0 || !!pending));
    $("#hintBtn").hidden = !mine || !V.rolls;
    renderClock();
  }

  // online house rule: 30 s per turn, shown as a shrinking bar
  let clockKey = null;
  function renderClock() {
    const bar = $("#turnBar"), left = mode === "online" && R ? R.turnLeft : 0;
    if (!left || !V || V.phase !== "play") { bar.hidden = true; clockKey = null; return; }
    const key = `${V.round}:${V.turn}`;
    if (clockKey === key) return;
    clockKey = key; bar.hidden = false; bar.classList.remove("low");
    const i = bar.firstElementChild;
    i.getAnimations().forEach((a) => a.cancel());
    i.animate([{ transform: `scaleX(${left / G.TURN_MS})` }, { transform: "scaleX(0)" }], { duration: left, easing: "linear", fill: "forwards" });
    clearTimeout(renderClock.t);
    renderClock.t = setTimeout(() => { if (clockKey === key) { bar.classList.add("low"); if (myTurn()) { toast("Noch 10 Sekunden!"); buzz(80); } } }, Math.max(0, left - 10000));
  }

  function rankingHTML(final) {
    const idx = V.players.map((_, i) => i).sort((a, b) => V.players[b].tot.total - V.players[a].tot.total);
    const winners = V.last ? V.last.winners : [];
    return idx.map((i) => {
      const p = V.players[i], t = p.tot;
      return `<li class="${final && winners.includes(i) ? "win" : ""}"><span class="av">${p.avatar || ""}</span><span class="nm">${esc(p.name)}${mode === "online" && i === V.me ? " (du)" : ""}</span>` +
        `<span class="w">${t.total} P.</span>` +
        `<span class="res">Oben ${t.up}${t.bonus ? ` + ${t.bonus} Bonus` : ""} · Unten ${t.low}${t.extra ? ` · Kniffel-Bonus ${t.extra}` : ""} · ${t.filled}/${V.rounds} Felder</span></li>`;
    }).join("");
  }
  let confettiFor = null;
  function renderRoundEnd() {
    const last = V.last || { winners: [] }, w = last.winners;
    const names_ = w.map((i) => (mode === "online" && i === V.me ? "Du" : V.players[i].name));
    const verb = w.length > 1 ? "gewinnen" : names_[0] === "Du" ? "gewinnst" : "gewinnt";
    $("#reLabel").textContent = "Spiel vorbei";
    $("#reTitle").textContent = `${names_.join(" und ")} ${verb} mit ${last.label}!`;
    $("#reRanking").innerHTML = rankingHTML(true);
    UI.roundEndFooter({ over: true });
    const k = `${V.turn}:${w.join(",")}`;
    if (confettiFor !== k) { confettiFor = k; if (w.some((i) => mode === "online" ? V.me < 0 || i === V.me : !V.players[i].bot)) { confetti(); sfx("win"); } const me = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot); if (me >= 0) Spieleabend.profile.result("kniffel", k, { won: w.includes(me), draw: !w.length, online: mode === "online" }); }
  }

  // ---------- start screen ----------
  const levelButtons = (cur) => Object.entries(G.BOT_LEVELS).map(([k, n]) => `<button type="button" data-level="${k}" aria-pressed="${k === cur}">${n}</button>`).join("");
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
    sh.textContent = serverState === "checking" ? "Suche den Spiel-Server …" : "Unter dieser Adresse antwortet kein Kniffel-Server. „Einzelspieler“ geht immer.";
    $("#myAvatar").textContent = myAvatar;
    const saved = store.get(K.local);
    $("#resumePanel").hidden = !(saved && saved.players);
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => p.name).join(", ")} · Runde ${saved.round} von ${saved.rounds}`;
    HOME.render();
    $("#levelLocal").innerHTML = levelButtons(localLevel);
    const box = $("#rulesLocal");
    if (!box.firstChild) box.innerHTML = rulesHTML(localRules, true, true);
    const on = activeNames(localRules).filter((n) => !G.RULES.find((x) => x.name === n).onlineOnly);
    $("#rulesLocalSum").textContent = on.length ? on.join(", ") : "keine";
    LOOK.render();
    // the hero: five dice, two of them held
    if (!$("#heroDice").firstChild) $("#heroDice").innerHTML = [5, 5, 5, 2, 5].map((v, i) => dieHTML(v, i !== 3 ? "held" : "")).join("");
  }

  // ---------- lobby ----------

  // ---------- look ----------
  // ---------- look: table design and size (shared, kit.js), applied before anything is drawn ----------
  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Würfelgröße" });

  // ---------- confetti ----------

  // ---------- reactions ----------
  // reactions float above everything (fixed), so the top edge of the screen or a scrolling
  // player strip can't clip them; near the top they show up below the player instead
  function bubble(pi, e) {
    const host = pi === (R && R.you) ? $("#dock") : document.querySelector(`#sheet thead th[data-seat="${pi}"]`);
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
      error() { if (V) render(); }, // undo an optimistic hold
      left() { R = null; mode = null; }
    },
    bubble: (pi, text) => bubble(pi, text),
    toast, render: () => render(), maxPlayers: 8, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    // goal, computer strength and house rules; the host picks, everyone sees it
    renderSettings(host) {
      $("#levelLobbyBox").hidden = !R.members.some((m) => m.bot);
      $("#levelLobby").innerHTML = levelButtons(R.botLevel || "normal");
      $("#levelLobby").querySelectorAll("button").forEach((b) => { b.disabled = !host; });
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
        $("#menuRules").textContent = on.length ? `Hausregeln: ${on.join(", ")}.` : "Keine Hausregeln.";
        LOOK.render();
      },
      local(box) {
        box.append(
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; render(); })
        );
      },
      player() {},
      skip: (v) => v.phase === "play" && v.cur !== v.me,
      standIn: true
    }
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
    L = G.newGame(names, Object.assign({}, localRules, { turnTimer: false }));
    L.players.forEach((p, i) => { p.bot = bots[i]; p.avatar = p.bot ? "🤖" : myAvatar; });
    mode = "local"; hold = null; lastTurnKey = null;
    store.set(K.local, L); render(); wake();
  });
  $("#resumeBtn").addEventListener("click", () => {
    L = store.get(K.local); if (!L) return render();
    mode = "local"; hold = null; render(); wake();
  });

  // ---------- waiting room: ready up, or watch the game that runs ----------

  // host closes the room for everyone; tap twice, like the menu actions
  $("#levelLobby").addEventListener("click", (e) => { const b = e.target.closest("[data-level]"); if (b && R && R.you === R.host) wsSend({ t: "botLevel", level: b.dataset.level }); });
  $("#rulesLobby").addEventListener("change", (e) => {
    const k = e.target.dataset.rule; if (!k || !R || R.you !== R.host) return;
    const next = Object.assign({}, R.rules, { [k]: e.target.checked });
    store.set(K.rules, Object.assign(localRules, next));
    wsSend({ t: "rules", rules: next });
  });

  $("#dice").addEventListener("click", (e) => { const s = e.target.closest(".slot"); if (s) toggleHold(+s.dataset.i); });
  $("#rollBtn").addEventListener("click", tryRoll);
  $("#stopBtn").addEventListener("click", tryScore);
  $("#sheet").addEventListener("click", (e) => { const td = e.target.closest("td.pick"); if (td) pickBox(td.dataset.c); });
  $("#hintBtn").addEventListener("click", showHint);
  $("#reBtn").addEventListener("click", () => doAct({ t: "next" }));
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; render(); }
    else if (R && R.members[R.you] && R.members[R.you].lobby) { watching = false; render(); }
    else if (V && V.phase === "roundEnd") wsSend({ t: "lobby" });
    else wsSend({ t: "end" });
  });
  // desktop: space rolls, enter writes down the picked box, 1-5 hold dice, H hint
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey || $("#game").hidden) return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") { if (open) $(open).hidden = true; return; }
    if (open || !$("#roundEnd").hidden) return;
    if (e.key === " " || e.key.toLowerCase() === "w") { e.preventDefault(); tryRoll(); }
    else if (e.key === "Enter" || e.key.toLowerCase() === "f") { e.preventDefault(); tryScore(); }
    else if (/^[1-5]$/.test(e.key)) toggleHold(+e.key - 1);
    else if (e.key.toLowerCase() === "h") showHint();
  });

  // leave the room from the menu's bottom row: first tap turns it red, the second leaves

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
  UI.detectServer("/kniffel-server", "kniffel").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
