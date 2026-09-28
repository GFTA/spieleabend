// Würfelpoker UI: one-phone mode and online rooms share one table. All dice and holds are
// public, so there is no hand-off screen; everybody watches every roll.
(() => {
  "use strict";
  const G = window.DiceGame;
  // an old cached game.js next to a new app.js: reload once instead of breaking
  if (!G || !G.RULES || !G.evaluate) {
    let tried = false;
    try { tried = sessionStorage.getItem("wuerfelpoker.reloaded") === "1"; sessionStorage.setItem("wuerfelpoker.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    return;
  }
  try { sessionStorage.removeItem("wuerfelpoker.reloaded"); } catch (e) {}

  const $ = (s) => document.querySelector(s);
  const K = { local: "wuerfelpoker.v1", names: "wuerfelpoker.names", bots: "wuerfelpoker.bots", avatars: "wuerfelpoker.avatars",
    online: "wuerfelpoker.online", me: "wuerfelpoker.me", avatar: "wuerfelpoker.avatar", rules: "wuerfelpoker.rules",
    level: "wuerfelpoker.level", look: "wuerfelpoker.look", sound: "wuerfelpoker.sound" };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const GOALS = [[3, "3 Siege"], [5, "5 Siege"], [7, "7 Siege"], [0, "Eine Runde"]];

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let R = null;           // last online room message
  let V = null;           // view on screen
  let server = null, serverState = "checking";
  const webHost = /^https?:$/.test(location.protocol);
  let tab = webHost ? "online" : "local", tabTouched = false;
  let goalLocal = 5, goalOnline = 5;
  let names = store.get(K.names) || ["", ""];
  let localBots = store.get(K.bots) || [false, true];
  let localAvatars = store.get(K.avatars) || [];
  let localLevel = G.BOT_LEVELS[store.get(K.level)] ? store.get(K.level) : "normal";
  let localRules = G.normRules(store.get(K.rules) || {});
  let myAvatar = G.AVATARS.includes(store.get(K.avatar)) ? store.get(K.avatar) : G.AVATARS[Math.floor(Math.random() * G.AVATARS.length)];
  {
    // name and avatar picked on the games.cool-kidz.net start page (same hand-off as ?table=)
    const q = new URLSearchParams(location.search), qn = (q.get("name") || "").trim().slice(0, 18), qa = q.get("av");
    if (qa && G.AVATARS.includes(qa)) { myAvatar = qa; store.set(K.avatar, myAvatar); }
    if (qn) store.set(K.me, qn);
    if (q.has("name") || q.has("av")) {
      q.delete("name"); q.delete("av");
      history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : ""));
    }
  }
  const avatarFor = (i) => localAvatars[i] || G.AVATARS[i % G.AVATARS.length];
  const nextAvatar = (a) => G.AVATARS[(G.AVATARS.indexOf(a) + 1) % G.AVATARS.length];

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const isBot = (i) => !!(V && V.players[i] && V.players[i].bot);
  const myTurn = () => !!V && V.phase === "play" && V.cur === V.me && !isBot(V.cur) && !hold;
  const who = (i) => (mode === "online" && V && i === V.me ? "Du" : V.players[i].name);

  // pips on a 3x3 grid (cells 1-9); the one is red like on classic dice
  const FACES = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const pips = (v) => (FACES[v] || []).map((c) => `<i${v === 1 ? ' class="one"' : ""} style="grid-area:${Math.ceil(c / 3)}/${((c - 1) % 3) + 1}"></i>`).join("");
  const dieHTML = (v, cls = "") => `<span class="die ${cls}" data-v="${v}">${pips(v)}</span>`;
  const miniDice = (dice) => (dice || []).slice().sort((a, b) => b - a).map((v) => dieHTML(v, "mini")).join("");

  let toastT;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.remove("off");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("off"), 2800);
  }

  // ---------- sound ----------
  let soundOn = store.get(K.sound) !== false;
  const buzz = (ms) => { if (!soundOn) return; try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
  let actx = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (actx.state === "suspended") actx.resume().catch(() => {});
    return actx;
  }
  document.addEventListener("pointerdown", () => { if (soundOn) audio(); }, { once: true, capture: true });
  function tone(freq, start, dur, type = "sine", vol = 0.15) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + start, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const SFX = {
    rattle: (n) => { for (let i = 0; i < 5 + n * 2; i++) tone(160 + Math.random() * 260, i * 0.045 + Math.random() * 0.02, 0.03, "triangle", 0.12); },
    land: () => tone(220, 0, 0.06, "triangle", 0.18),
    hold: () => tone(760, 0, 0.05, "sine", 0.1),
    turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
    big: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.18, "square", 0.06)),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16)),
    pop: () => tone(740, 0, 0.06, "sine", 0.12)
  };
  const sfx = (k, ...a) => { if (soundOn && document.visibilityState === "visible") try { SFX[k](...a); } catch (e) {} };

  // ---------- one-phone mode ----------
  let viewer = null; // the human whose name the phone shows while a computer plays
  const lBot = (i) => !!(L && L.players[i] && L.players[i].bot);
  function localViewer() {
    if (!lBot(L.cur)) return L.cur;
    return viewer != null && !lBot(viewer) ? viewer : L.players.findIndex((p) => !p.bot);
  }
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
      const a = G.suggest(G.view(L, L.cur), localLevel) || { t: "stop" };
      if (!doAct(a, L.cur) && a.t !== "stop") doAct({ t: L.rolls ? "stop" : "roll" }, L.cur);
    }, wait + 750 + Math.random() * 650);
  }

  // ---------- actions ----------
  function doAct(a, actor) {
    if (mode === "local") {
      const pi = actor == null ? L.cur : actor;
      const res = G.act(L, pi, a);
      if (!res.ok) { if (!lBot(pi)) toast(res.error); return false; }
      if (!lBot(pi)) viewer = pi;
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

  // events drive the animations: a roll tumbles the dice that were not held, and a
  // finished turn stays on the table for a moment so everybody sees the result
  let rollAnim = null;      // { which, dice } for the next tray render
  let hold = null, holdUntil = 0, holdT = null;
  function handleEvents(events, players) {
    for (const ev of events || []) {
      if (ev.t === "rolled") {
        // the next player already rolls: stop showing the previous result
        if (hold && hold.pi !== ev.pi) { hold = null; clearTimeout(holdT); }
        rollAnim = { which: ev.which, dice: ev.dice }; sfx("rattle", ev.which.length); buzz(20);
      }
      if (ev.t === "hold") sfx("hold");
      if (ev.t === "done") {
        const ps = players || (L && L.players);
        const r = ps && ps[ev.pi] && ps[ev.pi].result;
        const rolled = events.find((e) => e.t === "rolled" && e.pi === ev.pi);
        const dice = rolled ? rolled.dice : r ? r.dice : null;
        if (dice) {
          hold = { pi: ev.pi, dice, keep: [false, false, false, false, false], rolls: r ? r.rolls : 0, label: r ? r.label : "" };
          const ms = (rolled ? 900 : 0) + 1500;
          holdUntil = Date.now() + ms;
          clearTimeout(holdT); holdT = setTimeout(() => { hold = null; render(); }, ms);
          if (r && r.cat >= 6) setTimeout(() => sfx("big"), rolled ? 800 : 0);
        }
      }
    }
  }

  function tryRoll() {
    if (!myTurn()) return;
    if (V.rolls >= V.maxRolls) return;
    if (V.rolls && V.hold.every(Boolean)) { toast("Du behältst alle Würfel. Tippe „Fertig“ oder lass einen los."); return; }
    doAct({ t: "roll" });
  }
  function tryStop() { if (myTurn() && V.rolls) doAct({ t: "stop" }); }
  function toggleHold(i) {
    if (!myTurn()) { if (V && V.phase === "play") toast(`${V.players[V.cur].name} ist dran.`); return; }
    if (!V.rolls) { toast("Erst würfeln, dann Würfel behalten."); return; }
    if (V.rolls >= V.maxRolls || rolling) return;
    // show it at once; the server confirms a moment later
    V.hold[i] = !V.hold[i]; renderTray();
    doAct({ t: "hold", i });
  }
  function showHint() {
    if (!myTurn()) return;
    const a = G.suggest(V, "normal");
    if (!a) return;
    if (a.t === "roll" && !V.rolls) return toast("Tipp: Einfach würfeln.");
    if (a.t === "stop") return toast(`Tipp: Aufhören, ${V.hand ? V.hand.name : "das"} ist gut.`);
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
      if (!R.view) { V = null; showScreen("lobby"); renderLobby(); $("#roundEnd").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else {
      V = null; $("#roundEnd").hidden = true;
      showScreen("home"); renderHome();
    }
    updateNet();
  }

  let lastTurnKey = null;
  function renderGame() {
    const me = V.players[V.me];
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b>${V.goal ? ` · bis ${V.goal} Siege` : " · eine Runde"}${me && mode === "online" ? ` · du: <b>${me.score}</b>` : ""}`;
    $("#reactBtn").hidden = mode !== "online";
    renderPlayers();
    renderTray();
    renderDock();
    const key = `${V.round}:${V.turn}`;
    if (key !== lastTurnKey && lastTurnKey !== null && myTurn()) { sfx("turn"); buzz([40, 60, 40]); }
    lastTurnKey = key;
    const showEnd = V.phase === "roundEnd" && !hold;
    $("#roundEnd").hidden = !showEnd;
    if (showEnd) renderRoundEnd();
  }

  function renderPlayers() {
    const members = mode === "online" && R ? R.members : null;
    const order = V.order && V.order.length ? V.order : V.players.map((_, i) => i);
    const winners = V.phase === "roundEnd" && V.last ? V.last.winners : [];
    const activePi = hold ? hold.pi : V.cur;
    $("#players").innerHTML = order.map((i) => {
      const p = V.players[i], active = V.phase === "play" && i === activePi;
      const away = members && members[i] && !members[i].online;
      let res = "", hand = "wartet";
      if (p.result) { res = miniDice(p.result.dice); hand = p.result.label; }
      else if (active) { hand = V.rolls ? `würfelt · Wurf ${V.rolls}/${V.maxRolls}` : "ist dran"; res = V.rolls ? miniDice(V.dice) : ""; }
      else if (V.phase === "roundEnd") hand = "hat nicht gewürfelt";
      return `<div class="pcard${active ? " active" : ""}${winners.includes(i) ? " win" : ""}" data-seat="${i}" style="${away ? "opacity:.5" : ""}">` +
        `<div class="who"><span class="av">${p.avatar || (p.bot ? "🤖" : "")}</span><span class="nm">${esc(i === V.me && mode === "online" ? `${p.name} (du)` : p.name)}</span><span class="wins" title="Siege">${p.score}</span></div>` +
        `<div class="res">${res}</div><div class="hand">${esc(hand)}</div></div>`;
    }).join("");
    const act = $("#players .pcard.active");
    if (act) { const box = $("#players"); box.scrollLeft = act.offsetLeft - (box.clientWidth - act.offsetWidth) / 2; }
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
    const p = V.players[src.pi];
    $("#turnWho").innerHTML = V.phase === "roundEnd" && !hold ? "Runde vorbei"
      : `<span class="av">${p.avatar || (p.bot ? "🤖" : "")}</span><span>${esc(src.pi === V.me && mode === "online" ? "Du" : p.name)}${hold ? "" : src.pi === V.me && mode === "online" ? " bist dran" : " ist dran"}</span>`;
    $("#pips").innerHTML = Array.from({ length: G.MAX_ROLLS }, (_, k) =>
      `<i class="${k < src.rolls ? "used" : ""}${k >= (hold ? G.MAX_ROLLS : V.maxRolls) ? " gone" : ""}"></i>`).join("");
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
    // hand name, shown after the dice have landed
    const handNow = hold ? { label: hold.label } : V.hand;
    const setHand = () => {
      const hn = $("#handName");
      const name = V.phase === "roundEnd" && !hold ? "" : blank ? "" : handNow ? handNow.label.replace(/ \(.*\)$/, "") : "";
      if (hn.textContent !== name) { hn.textContent = name; hn.classList.remove("pop"); void hn.offsetWidth; hn.classList.add("pop"); }
      const detail = handNow && /\((.*)\)/.exec(handNow.label);
      $("#handSub").textContent = blank ? (V.phase === "play" ? "Noch nicht gewürfelt" : "") : detail ? detail[1] : "";
    };
    if (anim) { rolling = true; clearTimeout(renderTray.t); renderTray.t = setTimeout(() => { rolling = false; setHand(); sfx("land"); renderDock(); }, 760 + 60 * anim.which.length); }
    else if (!rolling) setHand();
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
    if (V.phase === "roundEnd") { who_ = "Runde vorbei"; hint = ""; }
    else if (hold) { const p = V.players[hold.pi]; who_ = `${hold.pi === V.me && mode === "online" ? "Dein" : `${p.name}s`} Ergebnis`; hint = hold.label; }
    else if (mine) {
      who_ = mode === "local" ? `${V.players[V.cur].name}, du bist dran` : "Du bist dran";
      hint = !V.rolls ? "Tippe auf Würfeln." : left ? "Tippe Würfel an, die du behalten willst, dann würfle den Rest." : "";
    } else {
      who_ = `${V.players[V.cur].name} würfelt`;
      hint = V.rolls ? "Gelb markierte Würfel werden behalten." : "Gleich geht's los.";
    }
    $("#whoName").textContent = who_;
    $("#whoHint").textContent = hint;
    const rb = $("#rollBtn"), sb = $("#stopBtn");
    rb.disabled = !mine || left <= 0 || rolling;
    sb.disabled = !mine || !V.rolls || rolling;
    rb.textContent = !V.rolls || !mine ? "Würfeln" : left === 1 ? "Letzter Wurf" : `Würfeln (${left} übrig)`;
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

  function rankingHTML(withResults) {
    const idx = V.players.map((_, i) => i);
    idx.sort((a, b) => {
      const ra = V.players[a].result, rb = V.players[b].result;
      if (withResults) { if (ra && rb) return G.compare(rb, ra) || V.players[b].score - V.players[a].score; if (ra || rb) return ra ? -1 : 1; }
      return V.players[b].score - V.players[a].score;
    });
    const winners = V.last ? V.last.winners : [];
    return idx.map((i) => {
      const p = V.players[i], r = p.result;
      return `<li class="${withResults && winners.includes(i) ? "win" : ""}"><span class="av">${p.avatar || ""}</span><span class="nm">${esc(p.name)}${mode === "online" && i === V.me ? " (du)" : ""}</span>` +
        `<span class="w">${p.score} ${p.score === 1 ? "Sieg" : "Siege"}</span>` +
        `<span class="res">${withResults ? (r ? `${miniDice(r.dice)}<span class="lbl">${esc(r.label)}</span>` : "nicht gewürfelt") : ""}</span></li>`;
    }).join("");
  }
  function histHTML() {
    const h = (V.history || []).slice().reverse();
    if (!h.length) return "";
    return `<tr><th>Runde</th><th>Sieger</th><th>Hand</th></tr>` + h.map((r) =>
      `<tr><td>${r.round}</td><td>${r.winners.map((i) => `${V.players[i].avatar || ""} ${esc(V.players[i].name)}`).join(", ") || "–"}</td><td>${esc(r.label.replace(/ \(.*\)$/, ""))}</td></tr>`).join("");
  }
  let confettiFor = null;
  function renderRoundEnd() {
    const last = V.last || { winners: [] }, w = last.winners;
    const names_ = w.map((i) => (mode === "online" && i === V.me ? "Du" : V.players[i].name));
    const plural = w.length > 1 || (w.length === 1 && names_[0] === "Du");
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round} vorbei`;
    const champ = last.over ? V.players.map((p, i) => [p.score, i]).sort((a, b) => b[0] - a[0])[0][1] : null;
    $("#reTitle").textContent = last.over
      ? `${champ === V.me && mode === "online" ? "Du gewinnst" : `${V.players[champ].name} gewinnt`} das Spiel!`
      : w.length ? `${names_.join(" und ")} ${plural ? "gewinnen" : "gewinnt"} mit ${last.label.replace(/ \(.*\)$/, "")}!` : "Niemand hat gewürfelt.";
    $("#reRanking").innerHTML = rankingHTML(true);
    $("#reHist").innerHTML = histHTML();
    $("#reHistWrap").hidden = (V.history || []).length < 2;
    $("#reBtn").textContent = last.over ? "Revanche" : "Nächste Runde";
    const back = $("#reBack");
    if (mode === "local") { back.hidden = false; back.textContent = "Zur Spieler-Auswahl"; }
    else { back.hidden = R.host !== V.me; back.textContent = "Zurück in den Warteraum"; }
    const k = `${V.round}:${w.join(",")}:${V.players.map((p) => p.score).join(",")}`;
    if (confettiFor !== k) { confettiFor = k; confetti(); sfx("win"); }
  }

  // ---------- start screen ----------
  const levelButtons = (cur) => Object.entries(G.BOT_LEVELS).map(([k, n]) => `<button type="button" data-level="${k}" aria-pressed="${k === cur}">${n}</button>`).join("");
  const goalButtons = (cur) => GOALS.map(([g, n]) => `<button type="button" data-goal="${g}" aria-pressed="${g === cur}">${n}</button>`).join("");
  const activeNames = (r) => G.RULES.filter((x) => r && r[x.k]).map((x) => x.name);
  function rulesHTML(r, editable, local) {
    return G.RULES.filter((x) => !(local && x.onlineOnly)).map((x) =>
      `<label class="toggle" for="rule-${local ? "l" : "o"}-${x.k}"><input type="checkbox" id="rule-${local ? "l" : "o"}-${x.k}" data-rule="${x.k}"` +
      `${r[x.k] ? " checked" : ""}${editable ? "" : " disabled"}><span>${x.name}<small>${x.desc}</small></span></label>`).join("");
  }
  const botName = (i) => G.BOT_NAMES[names.slice(0, i).filter((_, k) => localBots[k] && !(names[k] || "").trim()).length];
  function renderHome() {
    for (const b of document.querySelectorAll("#modeTabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
    $("#onlinePanel").hidden = tab !== "online" || !webHost;
    $("#onlineOff").hidden = tab !== "online" || webHost;
    $("#localPanel").hidden = tab !== "local";
    const sh = $("#serverHint");
    sh.hidden = serverState === "ok";
    sh.textContent = serverState === "checking" ? "Suche den Spiel-Server …" : "Unter dieser Adresse antwortet kein Würfelpoker-Server. „Ein Handy für alle“ geht immer.";
    $("#goalOnline").innerHTML = goalButtons(goalOnline);
    $("#goalLocal").innerHTML = goalButtons(goalLocal);
    $("#myAvatar").textContent = myAvatar;
    const saved = store.get(K.local);
    $("#resumePanel").hidden = !(saved && saved.players);
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => p.name).join(", ")} · Runde ${saved.round}`;
    const list = $("#plist");
    if (!list.contains(document.activeElement)) {
      list.innerHTML = names.map((n, i) =>
        `<div class="prow"><button class="avbtn" type="button" data-av="${i}" aria-label="Avatar für Platz ${i + 1} wechseln">${localBots[i] ? "🤖" : avatarFor(i)}</button>` +
        `<input class="field" id="pname-${i}" data-i="${i}" maxlength="18" autocomplete="off" enterkeyhint="next" placeholder="${localBots[i] ? `${botName(i)} (Computer)` : `Spieler ${i + 1}`}" value="${esc(n)}">` +
        `<button class="botbtn" type="button" data-bot="${i}" aria-pressed="${!!localBots[i]}" title="Computer spielt diesen Platz" aria-label="Platz ${i + 1} vom Computer spielen lassen">🤖</button>` +
        (names.length > 2 ? `<button class="rm" type="button" data-rm="${i}" aria-label="Spieler ${i + 1} entfernen">×</button>` : "") + `</div>`).join("");
    }
    $("#addPlayer").hidden = names.length >= 8;
    $("#levelLocalBox").hidden = !names.some((_, i) => localBots[i]);
    $("#levelLocal").innerHTML = levelButtons(localLevel);
    const box = $("#rulesLocal");
    if (!box.firstChild) box.innerHTML = rulesHTML(localRules, true, true);
    const on = activeNames(localRules).filter((n) => !G.RULES.find((x) => x.name === n).onlineOnly);
    $("#rulesLocalSum").textContent = on.length ? on.join(", ") : "keine";
    renderLook();
    // the hero: five dice, two of them held
    if (!$("#heroDice").firstChild) $("#heroDice").innerHTML = [6, 6, 3, 6, 1].map((v, i) => dieHTML(v, i === 0 || i === 3 ? "held" : "")).join("");
  }

  // ---------- lobby ----------
  function joinUrl() {
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    const ip = server && server.ips && server.ips.find((x) => !/^172\.(1[6-9]|2\d|3[01])\./.test(x));
    const base = local && ip ? `${location.protocol}//${ip}:${location.port || server.port}/` : location.origin + location.pathname;
    return `${base}?r=${R.code}`;
  }
  let qrFor = null;
  function drawQr(url) {
    const box = $("#qr");
    const paint = () => {
      try { const q = window.qrcode(0, "M"); q.addData(url); q.make(); box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); box.hidden = false; }
      catch (e) { box.hidden = true; }
    };
    if (window.qrcode) return paint();
    const s = document.createElement("script");
    s.src = "vendor/qrcode.js"; s.onload = paint; s.onerror = () => { box.hidden = true; };
    document.head.appendChild(s);
  }
  function renderLobby() {
    $("#roomCode").textContent = R.code;
    const url = joinUrl();
    $("#joinUrl").textContent = url;
    if (qrFor !== url) { qrFor = url; drawQr(url); }
    const lan = /^http:\/\/(\d+\.){3}\d+[:/]/.test(url);
    $("#joinHint").textContent = "Die anderen scannen den QR-Code oder öffnen den Link und geben den Code ein." + (lan ? " Alle müssen im selben WLAN sein." : "");
    const host = R.you === R.host;
    $("#closeLobby").hidden = !host;
    $("#membersLabel").textContent = `Spieler (${R.members.length}/8)`;
    $("#members").innerHTML = R.members.map((m, i) =>
      `<li class="${i === R.you ? "me" : ""}"><span class="on${m.online ? "" : " off"}"></span>` +
      (i === R.you && !m.bot ? `<button class="av" type="button" data-myav="1" title="Avatar wechseln">${m.avatar}</button>` : `<span class="av">${m.avatar || ""}</span>`) +
      `<span class="nm">${esc(m.name)}</span>${m.bot ? '<span class="tag">Computer</span>' : ""}${i === R.host ? '<span class="tag">Host</span>' : ""}${i === R.you ? '<span class="tag">du</span>' : ""}` +
      `${m.bot && host ? `<button class="rmbot" type="button" data-rmbot="${i}" aria-label="${esc(m.name)} entfernen">×</button>` : ""}</li>`).join("");
    $("#addBot").hidden = !host || R.members.length >= 8;
    $("#levelLobbyBox").hidden = !R.members.some((m) => m.bot);
    $("#levelLobby").innerHTML = levelButtons(R.botLevel || "normal");
    $("#levelLobby").querySelectorAll("button").forEach((b) => { b.disabled = !host; });
    const rl = $("#rulesLobby"), key = JSON.stringify(R.rules) + host;
    if (rl.dataset.k !== key) { rl.dataset.k = key; rl.innerHTML = rulesHTML(R.rules || {}, host, false); }
    const onR = activeNames(R.rules || {});
    $("#rulesLobbySum").textContent = onR.length ? onR.join(", ") : "keine";
    $("#rulesLobbyHint").textContent = host ? "Tippe an, was gelten soll. Alle sehen deine Auswahl." : `${R.members[R.host].name} legt die Hausregeln fest.`;
    const start = $("#startOnline");
    start.hidden = !host;
    start.disabled = R.members.length < 2;
    start.textContent = R.members.length < 2 ? "Warte auf Mitspieler …" : `Spiel starten (${R.members.length} Spieler)`;
    const gl = $("#goalLobby"), glk = `${R.goal}:${host}`;
    if (gl.dataset.k !== glk) {
      gl.dataset.k = glk;
      gl.innerHTML = goalButtons(R.goal);
      gl.querySelectorAll("button").forEach((b) => { b.disabled = !host; });
    }
    const goalTxt = R.goal ? `Gespielt wird bis ${R.goal} Siege.` : "Gespielt wird eine Runde.";
    $("#lobbyHint").textContent = host ? goalTxt : `Warte, bis ${R.members[R.host].name} das Spiel startet. ${goalTxt}`;
  }

  // ---------- look ----------
  const TABLES = [["night", "Nacht", "#1a1426"], ["felt", "Filz", "#15372a"], ["ocean", "Ozean", "#15243a"], ["light", "Hell", "#eceff5"], ["blossom", "Blüte", "#f7c6d9"]];
  const SIZES = [["0.85", "Klein"], ["1", "Normal"], ["1.15", "Groß"]];
  let look = Object.assign({ table: "night", size: "1" }, store.get(K.look) || {});
  {
    // came here from the games.cool-kidz.net start page with a design already picked there
    const params = new URLSearchParams(location.search), qTable = params.get("table");
    if (qTable && TABLES.some((x) => x[0] === qTable)) {
      look.table = qTable; store.set(K.look, look);
      params.delete("table");
      history.replaceState(null, "", location.pathname + (params.toString() ? `?${params}` : ""));
    }
  }
  function applyLook() {
    const root = document.documentElement, t = TABLES.find((x) => x[0] === look.table) || TABLES[0];
    if (t[0] === "night") delete root.dataset.table; else root.dataset.table = t[0];
    root.style.setProperty("--cs", look.size);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t[2]);
  }
  function renderLook() {
    const html = `<div class="label">Tisch</div><div class="seg tables">${TABLES.map(([k, n, c]) =>
      `<button type="button" data-table="${k}" aria-pressed="${look.table === k}"><span class="swatch" style="background:${c}"></span>${n}</button>`).join("")}</div>` +
      `<div class="label">Würfelgröße</div><div class="seg">${SIZES.map(([k, n]) => `<button type="button" data-size="${k}" aria-pressed="${look.size === k}">${n}</button>`).join("")}</div>`;
    for (const id of ["#lookHome", "#lookMenu"]) if ($(id).innerHTML !== html) $(id).innerHTML = html;
    $("#lookSum").textContent = `${(TABLES.find((x) => x[0] === look.table) || TABLES[0])[1]} · ${(SIZES.find((x) => x[0] === look.size) || SIZES[1])[1]}`;
  }
  for (const id of ["#lookHome", "#lookMenu"]) $(id).addEventListener("click", (e) => {
    const t = e.target.closest("[data-table]"), z = e.target.closest("[data-size]");
    if (!t && !z) return;
    if (t) look.table = t.dataset.table;
    if (z) look.size = z.dataset.size;
    store.set(K.look, look); applyLook(); renderLook();
  });
  applyLook();

  // ---------- confetti ----------
  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cv = $("#confetti"), ctx = cv.getContext("2d"), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; cv.hidden = false;
    const cols = ["#e0393e", "#f2c230", "#2fa35b", "#2d6fd6", "#ffffff"];
    const ps = Array.from({ length: 140 }, () => ({ x: Math.random() * cv.width, y: -Math.random() * cv.height * 0.5, w: (6 + Math.random() * 6) * dpr, h: (10 + Math.random() * 8) * dpr,
      vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: cols[(Math.random() * 5) | 0] }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of ps) { p.x += p.vx; p.y += p.vy; p.vy += 0.05 * dpr; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); }
      if (t - t0 < 3200) requestAnimationFrame(frame); else { ctx.clearRect(0, 0, cv.width, cv.height); cv.hidden = true; }
    })(t0);
  }

  // ---------- reactions ----------
  // reactions float above everything (fixed), so the top edge of the screen or a scrolling
  // player strip can't clip them; near the top they show up below the player instead
  function showBubble(host, b) {
    const r = host.getBoundingClientRect(), down = r.top < 110;
    b.style.top = (down ? r.bottom + 6 : r.top - 6) + "px";
    if (down) b.classList.add("down");
    document.body.appendChild(b);
    const w = b.offsetWidth / 2 + 8;
    b.style.left = Math.min(innerWidth - w, Math.max(w, r.left + r.width / 2)) + "px";
  }
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
  let netT = null;
  function updateNet() {
    const down = mode === "online" && wantOnline && !(ws && ws.readyState === 1);
    if (!down) { clearTimeout(netT); netT = null; $("#net").hidden = true; return; }
    if (!netT && $("#net").hidden) netT = setTimeout(() => { netT = null; if (mode === "online" && !(ws && ws.readyState === 1)) $("#net").hidden = false; }, 2000);
  }
  let ws = null, wantOnline = false, retry = 0, queue = [], giveUpT = null;
  function connect() {
    if (ws && ws.readyState <= 1) return;
    // each socket only touches itself, so a late close of an old one cannot drop a new one
    const sock = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) { sock.close(); return; }
      retry = 0; clearTimeout(giveUpT);
      if (serverState !== "ok") { serverState = "ok"; server = server || {}; }
      const s = store.get(K.online);
      if (s && !queue.some((m) => m.t === "create" || m.t === "join")) sock.send(JSON.stringify({ t: "resume", code: s.code, secret: s.secret }));
      for (const m of queue.splice(0)) sock.send(JSON.stringify(m));
      render();
    };
    sock.onmessage = (e) => { if (ws !== sock) return; try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    sock.onclose = () => { if (ws !== sock) return; ws = null; if (wantOnline) setTimeout(connect, Math.min(8000, 400 * 2 ** retry++)); render(); };
  }
  function wsSend(m) {
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; }
    if (m.t === "create" || m.t === "join") {
      queue.push(m); wantOnline = true; retry = 0; connect();
      clearTimeout(giveUpT);
      giveUpT = setTimeout(() => {
        if (ws && ws.readyState === 1) return;
        queue = []; wantOnline = false; if (ws) ws.close();
        toast("Der Spiel-Server antwortet nicht. Prüf die Adresse oder die Internetverbindung."); render();
      }, 8000);
      return true;
    }
    return false;
  }
  function onMsg(m) {
    if (m.t === "joined") {
      store.set(K.online, { code: m.code, secret: m.secret }); wantOnline = true; mode = "online";
      if (location.search) history.replaceState(null, "", location.pathname);
      wake();
    } else if (m.t === "room") {
      R = m; mode = "online";
      if (m.view) handleEvents(m.events, m.view.players);
      render();
    } else if (m.t === "react") {
      bubble(m.pi, m.e);
    } else if (m.t === "error") {
      toast(m.msg);
      if (V) render(); // undo an optimistic hold
    } else if (m.t === "gone" || m.t === "left") {
      store.del(K.online); R = null; mode = null;
      if (m.t === "gone") toast(m.reason === "idle" ? "Raum wegen Inaktivität geschlossen." : m.reason === "closed" ? "Der Raum wurde geschlossen." : "Diesen Raum gibt es nicht mehr.");
      render();
    }
  }

  // ---------- events ----------
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; tabTouched = true; renderHome(); } });
  $("#goalOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-goal]"); if (b) { goalOnline = +b.dataset.goal; renderHome(); } });
  $("#goalLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-goal]"); if (b) { goalLocal = +b.dataset.goal; renderHome(); } });
  $("#goalLobby").addEventListener("click", (e) => { const b = e.target.closest("[data-goal]"); if (b && R && R.you === R.host) wsSend({ t: "goal", goal: +b.dataset.goal }); });
  $("#myName").value = store.get(K.me) || "";
  $("#myName").addEventListener("input", (e) => store.set(K.me, e.target.value));
  $("#joinCode").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ""); });
  $("#myAvatar").addEventListener("click", () => {
    const g = $("#avatarGrid");
    g.innerHTML = G.AVATARS.map((a) => `<button type="button" data-pick="${a}" aria-pressed="${a === myAvatar}">${a}</button>`).join("");
    g.hidden = !g.hidden;
  });
  $("#avatarGrid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]"); if (!b) return;
    myAvatar = b.dataset.pick; store.set(K.avatar, myAvatar); $("#avatarGrid").hidden = true; $("#myAvatar").textContent = myAvatar;
  });
  const myName = () => { const n = $("#myName").value.trim(); if (!n) { toast("Bitte gib zuerst deinen Namen ein."); $("#myName").focus(); } return n; };
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

  $("#plist").addEventListener("input", (e) => { if (e.target.dataset.i != null) { names[+e.target.dataset.i] = e.target.value; store.set(K.names, names); } });
  $("#plist").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]"), av = e.target.closest("[data-av]"), bt = e.target.closest("[data-bot]");
    if (rm) { const i = +rm.dataset.rm; names.splice(i, 1); localBots.splice(i, 1); localAvatars.splice(i, 1); }
    else if (av) { const i = +av.dataset.av; if (localBots[i]) return; localAvatars[i] = nextAvatar(avatarFor(i)); }
    else if (bt) { const i = +bt.dataset.bot; localBots[i] = !localBots[i]; }
    else return;
    store.set(K.names, names); store.set(K.bots, localBots); store.set(K.avatars, localAvatars); renderHome();
  });
  $("#plist").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const nx = document.getElementById(`pname-${+e.target.dataset.i + 1}`);
    if (nx) nx.focus(); else e.target.blur();
  });
  $("#addPlayer").addEventListener("click", () => {
    if (names.length >= 8) return;
    names.push(""); localBots.push(false); store.set(K.names, names); store.set(K.bots, localBots); renderHome();
    const el = document.getElementById(`pname-${names.length - 1}`); if (el) el.focus();
  });
  $("#levelLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-level]"); if (!b) return; localLevel = b.dataset.level; store.set(K.level, localLevel); renderHome(); });
  $("#rulesLocal").addEventListener("change", (e) => {
    const k = e.target.dataset.rule; if (!k) return;
    localRules[k] = e.target.checked; store.set(K.rules, localRules); renderHome();
  });
  $("#startLocal").addEventListener("click", () => {
    if (names.every((_, i) => localBots[i])) { toast("Mindestens ein Mensch muss mitspielen."); return; }
    L = G.newGame(names.map((n, i) => (n || "").trim() || (localBots[i] ? botName(i) : `Spieler ${i + 1}`)), goalLocal, Object.assign({}, localRules, { turnTimer: false }));
    L.players.forEach((p, i) => { p.bot = !!localBots[i]; p.avatar = p.bot ? "🤖" : avatarFor(i); });
    mode = "local"; viewer = null; hold = null; lastTurnKey = null;
    store.set(K.local, L); render(); wake();
  });
  $("#resumeBtn").addEventListener("click", () => {
    L = store.get(K.local); if (!L) return render();
    mode = "local"; viewer = null; hold = null; render(); wake();
  });

  $("#startOnline").addEventListener("click", () => wsSend({ t: "start" }));
  // rules to read in the waiting room: the same text as in the game menu, copied once
  {
    const src = [...document.querySelectorAll("#menu summary")].find((s) => /Spielregeln/.test(s.textContent));
    if (src) $("#rulesHelpLobby").innerHTML = [...src.parentElement.children].filter((e) => e !== src).map((e) => e.outerHTML).join("");
  }
  // back to the Spieleabend start page: games.cool-kidz.net behind the tunnel, port 8090 of the same box in the LAN
  if (/^https?:$/.test(location.protocol) && !/(^|\.)cool-kidz\.net$/.test(location.hostname))
    for (const a of document.querySelectorAll("[data-start-link]")) a.href = `${location.protocol}//${location.hostname}:8090/`;
  $("#leaveLobby").addEventListener("click", () => wsSend({ t: "leave" }));
  // host closes the room for everyone; tap twice, like the menu actions
  let closeArm = null;
  $("#closeLobby").addEventListener("click", (e) => {
    const b = e.currentTarget, reset = () => { closeArm = null; b.textContent = "Raum für alle schließen"; b.classList.remove("btn-danger"); };
    if (closeArm) { clearTimeout(closeArm); reset(); wsSend({ t: "close" }); return; }
    b.textContent = "Sicher? Nochmal tippen"; b.classList.add("btn-danger");
    closeArm = setTimeout(reset, 3500);
  });
  $("#addBot").addEventListener("click", () => wsSend({ t: "addBot" }));
  $("#members").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rmbot]");
    if (b) return wsSend({ t: "removeBot", seat: +b.dataset.rmbot });
    if (e.target.closest("[data-myav]")) { myAvatar = nextAvatar(myAvatar); store.set(K.avatar, myAvatar); wsSend({ t: "avatar", avatar: myAvatar }); }
  });
  $("#levelLobby").addEventListener("click", (e) => { const b = e.target.closest("[data-level]"); if (b && R && R.you === R.host) wsSend({ t: "botLevel", level: b.dataset.level }); });
  $("#rulesLobby").addEventListener("change", (e) => {
    const k = e.target.dataset.rule; if (!k || !R || R.you !== R.host) return;
    const next = Object.assign({}, R.rules, { [k]: e.target.checked });
    store.set(K.rules, Object.assign(localRules, next));
    wsSend({ t: "rules", rules: next });
  });
  $("#copyBtn").addEventListener("click", () => {
    const url = $("#joinUrl").textContent;
    const fallback = () => { const r = document.createRange(); r.selectNodeContents($("#joinUrl")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Link markiert, jetzt kopieren."); };
    try { navigator.clipboard.writeText(url).then(() => toast("Link kopiert."), fallback); } catch (e) { fallback(); }
  });

  $("#dice").addEventListener("click", (e) => { const s = e.target.closest(".slot"); if (s) toggleHold(+s.dataset.i); });
  $("#rollBtn").addEventListener("click", tryRoll);
  $("#stopBtn").addEventListener("click", tryStop);
  $("#hintBtn").addEventListener("click", showHint);
  $("#reBtn").addEventListener("click", () => doAct({ t: "next" }));
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; render(); }
    else wsSend({ t: "end" });
  });
  // desktop: space rolls, enter stops, 1-5 hold dice, H hint
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey || $("#game").hidden) return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") { if (open) $(open).hidden = true; return; }
    if (open || !$("#roundEnd").hidden) return;
    if (e.key === " " || e.key.toLowerCase() === "w") { e.preventDefault(); tryRoll(); }
    else if (e.key === "Enter" || e.key.toLowerCase() === "f") { e.preventDefault(); tryStop(); }
    else if (/^[1-5]$/.test(e.key)) toggleHold(+e.key - 1);
    else if (e.key.toLowerCase() === "h") showHint();
  });

  // menu with two-step confirmation
  function armed(label, run) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn btn-ghost btn-block"; b.textContent = label;
    let t = null;
    b.addEventListener("click", () => {
      if (t) { clearTimeout(t); t = null; $("#menu").hidden = true; run(); return; }
      b.textContent = "Sicher? Nochmal tippen"; b.classList.add("btn-danger");
      t = setTimeout(() => { t = null; b.textContent = label; b.classList.remove("btn-danger"); }, 3500);
    });
    return b;
  }
  $("#menuBtn").addEventListener("click", () => {
    $("#menuScores").innerHTML = rankingHTML(false);
    const on = activeNames(V.rules);
    $("#menuRules").textContent = on.length ? `Hausregeln: ${on.join(", ")}.` : "Keine Hausregeln.";
    $("#menuHist").innerHTML = histHTML();
    $("#menuLog").innerHTML = V.log.slice().reverse().map((l) => `<li>${esc(l)}</li>`).join("");
    const box = $("#menuActions"); box.innerHTML = "";
    if (mode === "local") {
      box.append(
        armed("Runde neu starten", () => { L.round--; G.startRound(L); hold = null; store.set(K.local, L); render(); }),
        armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; render(); })
      );
    } else if (mode === "online" && R) {
      if (R.you === R.host && V.phase === "play" && V.cur !== V.me) box.append(armed(`${V.players[V.cur].name} überspringen`, () => wsSend({ t: "act", a: { t: "skip" } })));
      if (R.you === R.host) R.members.forEach((m, i) => { if (!m.bot && !m.online) box.append(armed(`🤖 Computer spielt für ${m.name}`, () => wsSend({ t: "standIn", seat: i }))); });
      if (R.you === R.host) box.append(armed("Spiel beenden, zurück in den Warteraum", () => wsSend({ t: "end" })));
      if (R.you === R.host) box.append(armed("Raum für alle schließen", () => wsSend({ t: "close" })));
      box.append(armed("Raum verlassen", () => wsSend({ t: "leave" })));
    }
    renderLook();
    $("#menu").hidden = false;
  });
  $("#menuClose").addEventListener("click", () => { $("#menu").hidden = true; });
  $("#soundOn").checked = soundOn;
  $("#soundOn").addEventListener("change", (e) => { soundOn = e.target.checked; store.set(K.sound, soundOn); if (soundOn) { audio(); sfx("pop"); } });
  // best hand first, with an example throw
  const EXAMPLES = [[6, 6, 6, 6, 6], [4, 4, 4, 4, 2], [5, 5, 5, 3, 3], [2, 3, 4, 5, 6], [1, 2, 3, 4, 5], [3, 3, 3, 6, 1], [6, 6, 2, 2, 4], [5, 5, 1, 3, 6], [1, 3, 4, 5, 6]];
  $("#rankList").innerHTML = G.HANDS.slice().reverse().map((h, k) => `<li><b>${h}</b> <span class="res" style="display:inline-flex;gap:2px;vertical-align:middle">${EXAMPLES[k].map((v) => dieHTML(v, "mini")).join("")}</span></li>`).join("");

  // keep the screen on while playing (needs HTTPS)
  let lock = null;
  async function wake() { try { if ("wakeLock" in navigator && !lock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } } catch (e) {} }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (mode) wake();
    if (wantOnline && !(ws && ws.readyState <= 1)) { retry = 0; connect(); }
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- boot ----------
  async function getJson(path, ms) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(path, { cache: "no-store", signal: ctl.signal }); const j = await r.json(); return j && j.wuerfelpoker ? j : null; }
    catch (e) { return null; } finally { clearTimeout(t); }
  }
  function probeSocket(ms) {
    return new Promise((res) => {
      let w;
      try { w = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws"); } catch (e) { return res(false); }
      const t = setTimeout(() => { w.close(); res(false); }, ms);
      w.onopen = () => { clearTimeout(t); w.close(); res(true); };
      w.onerror = () => { clearTimeout(t); res(false); };
    });
  }
  async function detectServer() {
    if (!webHost) return null;
    return (await getJson("/wuerfelpoker-server", 6000)) || (await getJson("/info", 4000)) || ((await probeSocket(6000)) ? {} : null);
  }
  const code = new URLSearchParams(location.search).get("r");
  if (code) $("#joinCode").value = code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  render();
  if (webHost && store.get(K.online) && !code) { wantOnline = true; connect(); }
  detectServer().then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
