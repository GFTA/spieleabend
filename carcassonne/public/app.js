// Carcassonne UI: single player and online rooms share one board renderer.
(() => {
  "use strict";
  const G = window.CarcassonneGame;
  if (!G || !G.botMove || !G.AVATARS) {
    let tried = false;
    try { tried = sessionStorage.getItem("carcassonne.reloaded") === "1"; sessionStorage.setItem("carcassonne.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden.</p>');
    return;
  }
  try { sessionStorage.removeItem("carcassonne.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const K = { local: "carcassonne.v1", online: "carcassonne.online", me: "carcassonne.me", goal: "carcassonne.goal", level: "carcassonne.level",
    sound: "carcassonne.sound", stats: "carcassonne.stats", avatar: "carcassonne.avatar", look: "carcassonne.look" };
  const store = Spieleabend.store;
  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Größe", onChange: () => { if (V) drawBoard(true); } });
  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");
  const LEVELS = Object.entries(G.LEVELS).map(([v, name]) => [+v, name]);
  const GOALS = Object.entries(G.GOALS).map(([v, name]) => [+v, name]);

  let mode = null, L = null, R = null, watching = false, V = null, peek = false, inflight = false;
  let server = null, serverState = "checking";
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "carcassonne.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, min: 1, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let goalLocal = G.normGoal(store.get(K.goal) || 1);
  let levelLocal = G.normLevel(store.get(K.level) || 2);
  let lastTurn = null, confettiFor = null;
  let preview = null; // {x,y,r}
  let flashTile = null, flashMeeple = null, scorePulse = null;
  let pan = { x: 0, y: 0, scale: 1 };
  const TS = 56; // tile size in svg units

  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const canPlay = () => !!V && (V.phase === "place" || V.phase === "meeple") && V.cur === V.me;
  const pname = (i) => (i === V.me ? "Du" : V.players[i].name);
  const { toast, confetti, showBubble } = Spieleabend;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound,
    effects: ({ tone, noise }) => ({
      draw: () => { noise(0.2, 0.08, 0.25, 1200); tone(400, 0.1, 0.08, "triangle", 0.1); },
      place: () => { tone(520, 0, 0.1, "triangle", 0.12); tone(660, 0.08, 0.12, "triangle", 0.1); },
      discard: () => { tone(280, 0, 0.12, "sawtooth", 0.08); },
      meeple: () => { tone(740, 0, 0.08, "sine", 0.12); },
      score: () => { tone(660, 0, 0.1); tone(880, 0.1, 0.14); },
      endScore: () => { [523, 659, 784].forEach((f, i) => tone(f, i * 0.1, 0.2, "triangle", 0.14)); },
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16))
    })
  });

  // ---- tile SVG ----
  const GRASS = "#6b8f3c", CITY = "#c4a35a", CITYD = "#8b5a2b", ROAD = "#d9c7a0", ROADL = "#5a4a32";
  function sidePath(side, inset) {
    // returns polygon points for a side band
  }
  function tileSVG(id, r, size, meeple) {
    const type = G.TYPES[id]; if (!type) return "";
    const s = size || TS;
    const sides = [];
    for (let i = 0; i < 4; i++) sides.push(type.sides[(i - (r || 0) + 4) % 4]);
    let parts = `<rect width="${s}" height="${s}" fill="${GRASS}"/>`;
    // draw sides as trapezoids
    const band = s * 0.28;
    const drawSide = (si, terr) => {
      const c = terr[0]; // uniform per side for rendering
      if (c === "F") return;
      const col = c === "C" ? CITY : ROAD;
      let pts;
      if (si === 0) pts = `0,0 ${s},0 ${s - band},${band} ${band},${band}`;
      else if (si === 1) pts = `${s},0 ${s},${s} ${s - band},${s - band} ${s - band},${band}`;
      else if (si === 2) pts = `0,${s} ${s},${s} ${s - band},${s - band} ${band},${s - band}`;
      else pts = `0,0 0,${s} ${band},${s - band} ${band},${band}`;
      parts += `<polygon points="${pts}" fill="${col}"/>`;
      if (c === "C") parts += `<polygon points="${pts}" fill="${CITYD}" opacity=".25"/>`;
      if (c === "R") {
        // road center line
        const m = s / 2, w = s * 0.1;
        if (si === 0) parts += `<rect x="${m - w / 2}" y="0" width="${w}" height="${band}" fill="${ROADL}"/>`;
        if (si === 1) parts += `<rect x="${s - band}" y="${m - w / 2}" width="${band}" height="${w}" fill="${ROADL}"/>`;
        if (si === 2) parts += `<rect x="${m - w / 2}" y="${s - band}" width="${w}" height="${band}" fill="${ROADL}"/>`;
        if (si === 3) parts += `<rect x="0" y="${m - w / 2}" width="${band}" height="${w}" fill="${ROADL}"/>`;
      }
    };
    sides.forEach(drawSide);
    // road connections through center for straight/curve approx
    const hasR = sides.map((x) => x.includes("R"));
    if (hasR[1] && hasR[3]) parts += `<rect x="0" y="${s / 2 - s * 0.05}" width="${s}" height="${s * 0.1}" fill="${ROADL}"/>`;
    if (hasR[0] && hasR[2]) parts += `<rect x="${s / 2 - s * 0.05}" y="0" width="${s * 0.1}" height="${s}" fill="${ROADL}"/>`;
    if (hasR[1] && hasR[2] && !hasR[0] && !hasR[3]) {
      parts += `<path d="M${s / 2},${s} Q${s / 2},${s / 2} ${s},${s / 2}" stroke="${ROADL}" stroke-width="${s * 0.1}" fill="none"/>`;
    }
    // cloister
    if (type.feats.some((f) => f.k === "K")) {
      parts += `<rect x="${s * 0.32}" y="${s * 0.32}" width="${s * 0.36}" height="${s * 0.36}" fill="${CITYD}" rx="${s * 0.04}"/>`;
      parts += `<polygon points="${s * 0.3},${s * 0.36} ${s / 2},${s * 0.18} ${s * 0.7},${s * 0.36}" fill="#6b3f1d"/>`;
    }
    // shields
    if (type.feats.some((f) => f.s)) {
      parts += `<circle cx="${s * 0.72}" cy="${s * 0.28}" r="${s * 0.08}" fill="#e0393e"/>`;
    }
    parts += `<rect width="${s}" height="${s}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.5"/>`;
    if (meeple) {
      const col = (V && V.players[meeple.p] && V.players[meeple.p].color) || "#fff";
      parts += `<circle class="meeple-pop" cx="${s / 2}" cy="${s / 2}" r="${s * 0.16}" fill="${col}" stroke="#fff" stroke-width="2"/>`;
    }
    return parts;
  }

  function handleEvents(events, v) {
    if (!v) return;
    for (const ev of events || []) {
      if (ev.t === "draw") { sfx("draw"); }
      if (ev.t === "place") {
        flashTile = { x: ev.x, y: ev.y }; sfx("place"); buzz(10);
        centerOn(ev.x, ev.y);
      }
      if (ev.t === "discard") { sfx("discard"); toast("Plättchen abgelegt — neu gezogen."); }
      if (ev.t === "meeple") { if (ev.feature != null) { flashMeeple = { x: ev.x, y: ev.y }; sfx("meeple"); } }
      if (ev.t === "score") { scorePulse = { pi: ev.pi }; sfx("score"); toast(`+${ev.points} für ${pname(ev.pi)}`); }
      if (ev.t === "endScore") sfx("endScore");
      if (ev.t === "giveup") toast(ev.pi === v.me ? "Du hast aufgegeben." : `${v.players[ev.pi].name} gibt auf.`);
      if (ev.t === "end") setTimeout(() => sfx("win"), 400);
    }
  }

  function doAct(a) {
    if (mode === "local") {
      const res = G.act(L, L.cur, a);
      if (!res.ok) { toast(res.error); sfx("bad"); return false; }
      handleEvents(res.events, G.view(L, 0));
      store.set(K.local, L);
      preview = null;
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

  let botT = null;
  function scheduleBot() {
    clearTimeout(botT);
    const plan = mode === "local" && L ? G.botPlan(L) : null;
    if (!plan) return;
    botT = setTimeout(() => {
      if (mode !== "local" || !L || (L.phase !== "place" && L.phase !== "meeple")) return;
      if (!$("#menu").hidden) { scheduleBot(); return; }
      const a = G.botMove(L, plan.pi);
      const res = a ? G.act(L, plan.pi, a) : null;
      if (res && res.ok) { handleEvents(res.events, G.view(L, 0)); store.set(K.local, L); render(); }
      scheduleBot();
    }, plan.delay);
  }

  function showScreen(id) {
    for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id;
  }

  function centerOn(x, y) {
    const wrap = $("#boardWrap"); if (!wrap) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    pan.x = w / 2 - (x + 0.5) * TS * pan.scale;
    pan.y = h / 2 - (y + 0.5) * TS * pan.scale;
  }

  function drawBoard(forceCenter) {
    if (!V) return;
    const svg = $("#boardSvg");
    const wrap = $("#boardWrap");
    if (!svg || !wrap) return;
    if (forceCenter && V.lastPlace) centerOn(V.lastPlace.x, V.lastPlace.y);
    else if (forceCenter && V.board.length) {
      const last = V.board[V.board.length - 1];
      centerOn(last.x, last.y);
    }
    const animCls = reduced() ? "" : " tile-flash";
    let body = `<g transform="translate(${pan.x},${pan.y}) scale(${pan.scale})">`;
    // highlights
    if (canPlay() && V.phase === "place" && V.current && mode === "local") {
      const places = G.legalPlaces(L, V.current);
      const seen = Object.create(null);
      for (const m of places) {
        if (preview && preview.r !== undefined && m.r !== preview.r) continue;
        const k = m.x + "," + m.y;
        if (seen[k]) continue;
        seen[k] = true;
        const sel = preview && preview.x === m.x && preview.y === m.y ? " sel" : "";
        body += `<rect class="hl${sel}" data-x="${m.x}" data-y="${m.y}" x="${m.x * TS}" y="${m.y * TS}" width="${TS}" height="${TS}" rx="4"/>`;
      }
    } else if (canPlay() && V.phase === "place" && V.current && mode === "online" && preview) {
      body += `<rect class="hl sel" x="${preview.x * TS}" y="${preview.y * TS}" width="${TS}" height="${TS}" rx="4"/>`;
    }
    for (const t of V.board) {
      const flash = flashTile && flashTile.x === t.x && flashTile.y === t.y ? animCls : "";
      body += `<g class="${flash.trim()}" transform="translate(${t.x * TS},${t.y * TS})">${tileSVG(t.id, t.r, TS, t.m)}</g>`;
    }
    // preview ghost
    if (preview && V.current && V.phase === "place") {
      body += `<g opacity=".7" transform="translate(${preview.x * TS},${preview.y * TS})">${tileSVG(V.current, preview.r, TS)}</g>`;
    }
    body += "</g>";
    svg.innerHTML = body;
    flashTile = null; flashMeeple = null;
  }

  function plateHTML(i) {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = members && members[i] && !members[i].online;
    const cls = ["plate", (V.phase === "place" || V.phase === "meeple") && V.cur === i ? "active" : "", away ? "away" : "", scorePulse && scorePulse.pi === i ? "pulse" : ""].join(" ");
    const tag = p.bot ? "Computer" : away ? "offline" : i === V.me ? "du" : "";
    return `<div class="${cls}" data-seat="${i}"><span class="pav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="pinfo"><span class="pname">${esc(p.name)}</span><span class="pmeta">${tag || "&nbsp;"} · ${p.meeples} ♟</span></span>` +
      `<span class="pscore" style="color:${p.color}">${p.score}</span>` +
      `<span class="pwins" title="Siege">${p.wins}</span></div>`;
  }

  function renderGame() {
    if (V.phase !== "roundEnd") peek = false;
    scorePulse = null;
    $("#plates").innerHTML = V.players.map((_, i) => plateHTML(i)).join("");
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> · Stapel <b>${V.stackLeft}</b>`;
    $("#stockInfo").innerHTML = `♟ <b>${V.me >= 0 ? V.players[V.me].meeples : "–"}</b>`;

    const play = canPlay();
    // dock tile
    const cur = $("#curTile");
    if (V.current && (V.phase === "place" || preview)) {
      cur.innerHTML = `<svg viewBox="0 0 ${TS} ${TS}">${tileSVG(V.current, preview ? preview.r : 0, TS)}</svg>`;
    } else cur.innerHTML = "";

    $("#placeActs").hidden = V.phase !== "place";
    $("#meepleActs").hidden = V.phase !== "meeple";
    $("#rotBtn").disabled = !play || V.phase !== "place";
    $("#placeBtn").disabled = !play || V.phase !== "place" || !preview;

    if (V.phase === "meeple" && play) {
      const feats = mode === "local" ? G.legalMeeples(L) : [];
      const box = $("#meepleChoices");
      const labels = { R: "Straße", C: "Stadt", K: "Kloster", F: "Wiese" };
      if (mode === "local") {
        box.innerHTML = feats.map((fi) => {
          const f = G.TYPES[V.lastPlace.id].feats[fi];
          return `<button type="button" class="btn" data-feat="${fi}">${labels[f.k] || f.k}</button>`;
        }).join("");
      } else {
        // online: show generic feature buttons 0..n from last tile type
        const type = G.TYPES[V.lastPlace && V.lastPlace.id];
        box.innerHTML = type ? type.feats.map((f, fi) => {
          if (f.k === "F" && !V.meadows) return "";
          if (f.k !== "R" && f.k !== "C" && f.k !== "K" && f.k !== "F") return "";
          return `<button type="button" class="btn" data-feat="${fi}">${labels[f.k] || f.k}</button>`;
        }).join("") : "";
      }
    }

    let who = "", hint = "", av = "";
    if (V.phase === "roundEnd") {
      const w = V.last.winners;
      who = w.length > 1 ? "Gleichstand!" : `${pname(w[0])} ${w[0] === V.me ? "gewinnst" : "gewinnt"}`;
      av = V.players[w[0]].avatar;
      hint = "Runde vorbei.";
    } else {
      const P = V.players[V.cur];
      av = P.avatar;
      if (play && V.phase === "place") { who = "Du bist dran"; hint = preview ? "Legen bestätigen oder drehen." : "Tippe eine Position an."; }
      else if (play && V.phase === "meeple") { who = "Gefolgsmann?"; hint = "Merkmal wählen oder ohne setzen."; }
      else { who = `${P.name} ist dran`; hint = P.bot ? "Der Computer überlegt …" : V.me < 0 ? "Du schaust zu." : "Warte auf den Zug."; }
    }
    $("#whoAv").textContent = av;
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    $("#dock").classList.toggle("myturn", play);
    $("#resultBtn").hidden = !(V.phase === "roundEnd" && peek);
    $("#reactBtn").hidden = mode !== "online";
    $("#keys").innerHTML = play && V.phase === "place" ? "<kbd>R</kbd> drehen · Tippen = Vorschau · <kbd>Enter</kbd> legen" : "";

    const lmEl = $("#lastMove"), lines = V.log.slice(-2), lmKey = lines.join("\n");
    if (lmEl.dataset.k !== lmKey) {
      lmEl.dataset.k = lmKey;
      lmEl.innerHTML = lines.map((l, i) => `<div${i < lines.length - 1 ? ' class="old"' : ""}>${esc(l)}</div>`).join("");
    }

    const key = `${V.round}:${V.turn}:${V.cur}:${V.phase}`;
    if (play && lastTurn !== key && lastTurn !== null && (mode === "online" || V.players.some((p) => p.bot))) { buzz([40, 60, 40]); sfx("turn"); }
    lastTurn = key;

    drawBoard(!pan._init);
    pan._init = true;

    $("#roundEnd").hidden = V.phase !== "roundEnd" || peek;
    if (V.phase === "roundEnd") {
      if (!peek) renderRoundEnd();
      const k = `${V.round}:${V.last.winners.join(",")}:${V.players.map((p) => p.wins).join(",")}`;
      if (confettiFor !== k) {
        confettiFor = k; record(k);
        if (V.last.winners.includes(V.me) || (mode === "local" && V.last.winners.some((i) => !V.players[i].bot)))
          setTimeout(() => confetti(), 700);
      }
    }
  }

  function render() {
    if (mode === "local" && L) { V = G.view(L, 0); showScreen("game"); renderGame(); }
    else if (mode === "online" && R) {
      const meM = R.members[R.you], waiting = !!(R.view && meM && meM.lobby);
      if (!waiting) watching = false;
      if (!R.view || (waiting && !watching)) { V = null; showScreen("lobby"); UI.renderLobby(); $("#roundEnd").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else { V = null; $("#roundEnd").hidden = true; showScreen("home"); renderHome(); }
    UI.update();
  }

  // board interaction
  $("#boardWrap").addEventListener("click", (e) => {
    const hl = e.target.closest(".hl");
    if (!hl || !canPlay() || V.phase !== "place") return;
    const x = +hl.dataset.x, y = +hl.dataset.y;
    let r = preview && preview.x === x && preview.y === y ? preview.r : 0;
    if (mode === "local") {
      const opts = G.legalPlaces(L).filter((m) => m.x === x && m.y === y);
      if (!opts.length) return;
      if (preview && preview.x === x && preview.y === y) {
        const i = opts.findIndex((m) => m.r === preview.r);
        r = opts[(i + 1) % opts.length].r;
      } else r = opts[0].r;
    }
    preview = { x, y, r };
    renderGame();
  });

  // pan/zoom
  (function () {
    const wrap = $("#boardWrap");
    let dragging = false, lx = 0, ly = 0;
    wrap.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".hl")) return;
      dragging = true; lx = e.clientX; ly = e.clientY; wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      pan.x += e.clientX - lx; pan.y += e.clientY - ly; lx = e.clientX; ly = e.clientY; drawBoard();
    });
    wrap.addEventListener("pointerup", () => { dragging = false; });
    wrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      const f = e.deltaY > 0 ? 0.9 : 1.1;
      pan.scale = Math.min(2.5, Math.max(0.35, pan.scale * f));
      drawBoard();
    }, { passive: false });
  })();

  $("#rotBtn").addEventListener("click", () => {
    if (!preview || !canPlay()) return;
    if (mode === "local") {
      const opts = G.legalPlaces(L).filter((m) => m.x === preview.x && m.y === preview.y);
      if (!opts.length) return;
      const i = opts.findIndex((m) => m.r === preview.r);
      preview.r = opts[(i + 1) % opts.length].r;
    } else preview.r = (preview.r + 1) % 4;
    renderGame();
  });
  $("#placeBtn").addEventListener("click", () => {
    if (!preview || !canPlay() || V.phase !== "place") return;
    if (mode === "online") { inflight = true; setTimeout(() => { inflight = false; }, 3000); }
    buzz(10);
    doAct({ t: "place", x: preview.x, y: preview.y, r: preview.r });
  });
  $("#skipMeepleBtn").addEventListener("click", () => {
    if (!canPlay() || V.phase !== "meeple") return;
    doAct({ t: "meeple", feature: null });
  });
  $("#meepleChoices").addEventListener("click", (e) => {
    const b = e.target.closest("[data-feat]"); if (!b || !canPlay()) return;
    doAct({ t: "meeple", feature: +b.dataset.feat });
  });
  $("#resultBtn").addEventListener("click", () => { peek = false; render(); });

  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, button") || e.ctrlKey || e.metaKey || e.altKey) return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") { if (open) $(open).hidden = true; return; }
    if (open || $("#game").hidden || !$("#roundEnd").hidden || !canPlay()) return;
    const k = e.key.toLowerCase();
    if (k === "r" && V.phase === "place") { e.preventDefault(); $("#rotBtn").click(); }
    else if (k === "enter" && V.phase === "place") { e.preventDefault(); $("#placeBtn").click(); }
  });

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
      const you = i === V.me ? " (du)" : "";
      return `<li class="${winners.includes(i) ? "win" : ""}"><span>${avi(p.avatar)}${esc(p.name)}${you}<small>${p.score} Punkte · ${p.meeples} ♟</small></span>` +
        `<b>${p.wins} ${p.wins === 1 ? "Sieg" : "Siege"}</b></li>`;
    }).join("");
  }
  function renderRoundEnd() {
    const last = V.last, w = last.winners;
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round} vorbei`;
    $("#reTitle").textContent = w.length > 1
      ? `Gleichstand: ${w.map(pname).join(", ")}!`
      : `${w[0] === V.me ? "Du gewinnst" : `${V.players[w[0]].name} gewinnt`} ${last.over ? "das Spiel" : "die Runde"}!`;
    $("#reText").textContent = last.over ? "" : `Bis ${V.goal} Siege. Als Nächstes beginnt ${V.players[V.nextStarter].name}.`;
    scoreList($("#reScores"), last.winners);
    UI.roundEndFooter({ over: last.over, next: "Nächste Runde" });
  }

  const profile = Spieleabend.profile;
  { const old = (store.get(K.stats) || {})[profile.get().name]; if (old) profile.importLegacy("carcassonne", { rounds: old.rounds || old.games, wins: old.wins }); }
  function record(key) {
    const i = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
    if (i < 0) return;
    profile.result("carcassonne", key, { won: V.last.winners.includes(i), draw: V.last.winners.length > 1 && V.last.winners.includes(i), online: mode === "online" });
  }

  function segHTML(list, cur) {
    return list.map(([v, a, b]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${a}${b ? `<small>${b}</small>` : ""}</button>`).join("");
  }
  function renderHome() {
    LOOK.render();
    $("#myAvatar").textContent = myAvatar;
    for (const b of document.querySelectorAll("#modeTabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
    $("#onlinePanel").hidden = tab !== "online" || !webHost;
    $("#onlineOff").hidden = tab !== "online" || webHost;
    const sh = $("#serverHint");
    sh.hidden = serverState === "ok";
    sh.textContent = serverState === "checking" ? "Suche den Spiel-Server …"
      : "Unter dieser Adresse antwortet kein Spiel-Server. „Einzelspieler“ geht immer.";
    $("#localPanel").hidden = tab !== "local";
    $("#goalLocal").innerHTML = segHTML(GOALS, goalLocal);
    $("#levelLocal").innerHTML = segHTML(LEVELS, levelLocal);
    const saved = store.get(K.local);
    $("#resumePanel").hidden = !(saved && saved.players);
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => p.name).join(" gegen ")} · Runde ${saved.round}`;
    HOME.render();
  }

  const UI = window.RoomUI({
    room: () => R, view: () => V, mode: () => mode, server: () => server,
    watching: (v) => (v === undefined ? watching : (watching = v)),
    onlineKey: K.online,
    on: {
      opened() { if (serverState !== "ok") { serverState = "ok"; server = server || {}; } },
      joined(m) { mode = "online"; wake(); },
      room(m) { R = m; mode = "online"; inflight = false; if (m.view) handleEvents(m.events, m.view); preview = null; pan._init = false; render(); },
      react(m) { bubble(m.pi, m.e, m.name); },
      error(m) { inflight = false; },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text, name) => bubble(pi, text, name),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    renderSettings(host) {
      for (const [id, list, cur] of [["#goalOnline", GOALS, R.goal], ["#levelOnline", LEVELS, R.level || 2]]) {
        const el = $(id); if (!el) continue;
        const k = cur + ":" + host;
        if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = segHTML(list, cur); for (const b of el.children) b.disabled = !host; }
      }
    },
    menu: {
      open() {
        LOOK.render();
        if (V) scoreList($("#menuScores"), []);
        $("#menuRules").textContent = V ? `${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}, Stufe ${G.LEVELS[V.level] || V.level}.` : "";
      },
      local(box) {
        box.append(
          UI.armed("Runde neu starten", () => { L.round--; L.starter = (L.starter + L.players.length - 1) % L.players.length; G.startRound(L); peek = false; preview = null; pan._init = false; store.set(K.local, L); render(); scheduleBot(); }),
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; clearTimeout(botT); render(); })
        );
      },
      player(box) {
        if (V && (V.phase === "place" || V.phase === "meeple") && V.me >= 0) box.append(UI.armed("Aufgeben", () => wsSend({ t: "act", a: { t: "giveup" } })));
      },
      skip: (v) => (v.phase === "place" || v.phase === "meeple") && v.cur !== v.me && !v.players[v.cur].bot
    }
  });
  function wsSend(m) { return UI.send(m); }

  Spieleabend.avatarPicker({ avatars: G.AVATARS, get: () => myAvatar, set: (a) => { myAvatar = a; store.set(K.avatar, a); } });

  for (const [id, key] of [["goal", "goal"], ["level", "level"]]) {
    const el = $(`#${id}Online`);
    if (el) el.addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", [key]: +b.dataset.v }); });
  }
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
    wsSend({ t: "create", name: n, goal: goalLocal, level: levelLocal, avatar: myAvatar });
  });

  function startLocal(state) {
    L = state; mode = "local"; peek = false; preview = null; pan._init = false;
    store.set(K.local, L); render(); wake(); scheduleBot();
  }
  $("#startLocal").addEventListener("click", () => {
    const { names, bots } = HOME.roster($("#myName").value);
    const list = names.map((name, i) => ({ name, bot: bots[i], avatar: bots[i] ? G.BOT_AVATAR : myAvatar }));
    startLocal(G.newGame(list, goalLocal, levelLocal, { meadows: true }));
  });
  $("#resumeBtn").addEventListener("click", () => {
    const s = store.get(K.local); if (!s) return render();
    startLocal(s);
  });

  $("#reBtn").addEventListener("click", () => { peek = false; doAct({ t: "next" }); });
  $("#reLook").addEventListener("click", () => { peek = true; render(); });
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; clearTimeout(botT); render(); }
    else if (R && R.members[R.you] && R.members[R.you].lobby) { watching = false; render(); }
    else if (V && V.phase === "roundEnd" && V.last && V.last.over) wsSend({ t: "lobby" });
    else wsSend({ t: "end" });
  });

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && mode) wake(); });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  const code = UI.roomCode();
  render();
  if (webHost && (store.get(K.online) && !code)) UI.resume();
  UI.detectServer("/carcassonne-server", "carcassonne").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
