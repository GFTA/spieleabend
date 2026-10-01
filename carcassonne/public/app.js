// Carcassonne UI: single player and online rooms share one board renderer.
(() => {
  "use strict";
  const G = window.CarcassonneGame;
  if (!G || !G.botMove || !G.AVATARS || !window.CarcTiles) {
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
  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Größe", onChange: () => { if (V) { drawBoard(); camSync(true); } } });
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
  const cam = { x: 0, y: 0, s: 1, auto: true, init: false, tgt: null, raf: 0 };
  let dragMoved = 0;
  let drag = null; // tile drag & drop: {src,pid,sx,sy,r,active,el,px,py,hot,raf}
  const TS = 56; // tile size in svg units
  const LABEL = { R: "Straße", C: "Stadt", K: "Kloster", F: "Wiese" };
  const MEEPLE_ICON = (c) => `<svg class="mi" viewBox="0 0 24 26" style="color:${c}" aria-hidden="true"><use href="#ccMeeple"/></svg>`;

  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const canPlay = () => !!V && (V.phase === "place" || V.phase === "meeple") && V.cur === V.me;
  const pname = (i) => (i === V.me ? "Du" : V.players[i].name);
  const { toast, confetti, showBubble } = Spieleabend;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const botMsOverride = (() => {
    try { const n = +new URLSearchParams(location.search).get("botms"); return Number.isFinite(n) && n >= 0 ? n : 0; }
    catch (e) { return 0; }
  })();
  let scoreHighlight = null; // { tiles:[{x,y}], until }

  function tileScreenRect(x, y) {
    const wrap = $("#boardWrap"); if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    return { left: r.left + cam.x + (x + 0.5) * TS * cam.s, top: r.top + cam.y + (y + 0.5) * TS * cam.s };
  }
  function flyMeepleHome(fromXY, pi, delay) {
    if (reduced() || !V || !V.players[pi]) return;
    const from = tileScreenRect(fromXY.x, fromXY.y);
    const plate = document.querySelector(`#plates [data-seat="${pi}"]`);
    if (!from || !plate) return;
    const to = plate.getBoundingClientRect();
    const el = document.createElement("span");
    el.className = "meeple-flyer";
    el.innerHTML = MEEPLE_ICON(V.players[pi].color || "#fff");
    el.style.left = (from.left - 11) + "px";
    el.style.top = (from.top - 12) + "px";
    document.body.appendChild(el);
    const dx = to.left + to.width / 2 - from.left;
    const dy = to.top + to.height / 2 - from.top;
    setTimeout(() => {
      el.style.transition = "transform .6s ease-in, opacity .6s ease-in";
      el.style.transform = `translate(${dx}px,${dy}px) scale(.6)`;
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 650);
    }, delay || 30);
  }
  function scorePop(tile, points, pi) {
    if (reduced() || !V || !V.players[pi]) return;
    const at = tileScreenRect(tile.x, tile.y); if (!at) return;
    const el = document.createElement("span");
    el.className = "score-pop";
    el.textContent = "+" + points;
    el.style.left = at.left + "px"; el.style.top = at.top + "px";
    el.style.setProperty("--pc", V.players[pi].color || "#fff");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

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

  // ---- tiles: art lives in tiles.js (<symbol>-like defs, one per tile type) ----
  document.body.insertAdjacentHTML("afterbegin", `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${window.CarcTiles.defs()}</defs></svg>`);
  const tileUse = (id, r) => `<use href="#ct-${id}" transform="scale(${TS / 100})${r ? ` rotate(${90 * r} 50 50)` : ""}"/>`;
  const dockTileSVG = (id, r) => `<svg viewBox="0 0 100 100"><use href="#ct-${id}"${r ? ` transform="rotate(${90 * r} 50 50)"` : ""}/></svg>`;
  const MW = TS * 0.3, MH = MW * 26 / 24;
  function meepleAt(tile, fi, color, cls) {
    const a = window.CarcTiles.anchor(tile.id, fi, tile.r);
    const cx = tile.x * TS + a[0] * TS / 100, cy = tile.y * TS + a[1] * TS / 100;
    return `<g${cls ? ` class="${cls}"` : ""}><ellipse cx="${cx}" cy="${cy + 1}" rx="${MW * 0.42}" ry="${MW * 0.14}" fill="rgba(0,0,0,.3)"/>` +
      `<use href="#ccMeeple" x="${cx - MW / 2}" y="${cy - MH * 0.88}" width="${MW}" height="${MH}" style="color:${color}"/></g>`;
  }

  function handleEvents(events, v) {
    if (!v) return;
    for (const ev of events || []) {
      if (ev.t === "draw") { sfx("draw"); }
      if (ev.t === "place") {
        flashTile = { x: ev.x, y: ev.y }; sfx("place"); buzz(10);
      }
      if (ev.t === "discard") { sfx("discard"); toast("Plättchen abgelegt — neu gezogen."); }
      if (ev.t === "meeple") { if (ev.feature != null) { flashMeeple = { x: ev.x, y: ev.y }; sfx("meeple"); } }
      if (ev.t === "score") {
        scorePulse = { pi: ev.pi };
        sfx("score");
        if (ev.tiles && ev.tiles.length) {
          scoreHighlight = { tiles: ev.tiles.map((t) => ({ x: t.x, y: t.y })), until: Date.now() + 800 };
          ev.tiles.forEach((t, i) => flyMeepleHome(t, ev.pi, 40 + i * 50));
          scorePop(ev.tiles[(ev.tiles.length / 2) | 0], ev.points, ev.pi);
          setTimeout(() => { if (V) drawBoard(); }, 850);
        } else toast(`+${ev.points} für ${pname(ev.pi)}`);
      }
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
    }, botMsOverride || plan.delay);
  }

  function showScreen(id) {
    for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id;
  }

  // ---- camera: auto-fit (follows the game) until the player pans/zooms; smooth moves ----
  const clampS = (v) => Math.min(3.2, Math.max(0.3, v));
  function camTarget() {
    const wrap = $("#boardWrap");
    const w = wrap ? wrap.clientWidth : 0, h = wrap ? wrap.clientHeight : 0;
    if (!V || !w || !h || !V.board.length) return null;
    const wide = window.innerWidth >= 900;
    const lm = $("#lastMove"), top = lm && lm.offsetHeight ? lm.offsetHeight + 16 : 0, h2 = h - top, cy = top + h2 / 2;
    const maxS = (wide ? 150 : 108) / TS, minS = (V.phase === "roundEnd" ? 0.3 : 44 / TS);
    if (canPlay() && V.phase === "meeple" && V.lastPlace) {
      const s = Math.min(180, Math.min(w, h2) * 0.55) / TS;
      return { s, x: w / 2 - (V.lastPlace.x + 0.5) * TS * s, y: cy - (V.lastPlace.y + 0.5) * TS * s };
    }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const t of V.board) { x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y); }
    const pad = 1.15;
    const bw = (x1 - x0 + 1 + pad * 2) * TS, bh = (y1 - y0 + 1 + pad * 2) * TS;
    const fit = Math.min(w / bw, h2 / bh);
    if (fit < minS && V.lastPlace) {
      return { s: minS, x: w / 2 - (V.lastPlace.x + 0.5) * TS * minS, y: cy - (V.lastPlace.y + 0.5) * TS * minS };
    }
    const s = Math.min(maxS, Math.max(minS, fit));
    return { s, x: w / 2 - ((x0 + x1 + 1) / 2) * TS * s, y: cy - ((y0 + y1 + 1) / 2) * TS * s };
  }
  function camApply() {
    const g = $("#cam"); if (!g) return;
    g.setAttribute("transform", `translate(${cam.x} ${cam.y}) scale(${cam.s})`);
    const wrap = $("#boardWrap");
    wrap.style.backgroundSize = `${TS * cam.s}px ${TS * cam.s}px`;
    wrap.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
  }
  function camGo(t, instant) {
    cancelAnimationFrame(cam.raf);
    cam.tgt = t;
    if (instant || reduced() || !cam.init) { cam.x = t.x; cam.y = t.y; cam.s = t.s; cam.init = true; camApply(); return; }
    const f = { x: cam.x, y: cam.y, s: cam.s }, t0 = performance.now(), D = 420;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
      cam.x = f.x + (t.x - f.x) * e; cam.y = f.y + (t.y - f.y) * e; cam.s = f.s + (t.s - f.s) * e;
      camApply();
      if (k < 1) cam.raf = requestAnimationFrame(step);
    };
    cam.raf = requestAnimationFrame(step);
  }
  function camSync(force) {
    if (!cam.auto) return;
    const t = camTarget(); if (!t) return;
    const c = cam.tgt;
    if (!force && cam.init && c && Math.abs(c.x - t.x) < 1 && Math.abs(c.y - t.y) < 1 && Math.abs(c.s - t.s) < 0.002) return;
    camGo(t, force);
  }
  function camReset() { cam.init = false; cam.auto = true; cam.tgt = null; }
  function userCam() { cam.auto = false; cancelAnimationFrame(cam.raf); }
  function zoomAt(mx, my, ns) {
    ns = clampS(ns);
    cam.x = mx - (mx - cam.x) * (ns / cam.s); cam.y = my - (my - cam.y) * (ns / cam.s); cam.s = ns;
    camApply();
  }

  // ---- legal placements (same for single player and online: derived from the public board) ----
  let legalKey = "", legalCache = [];
  function legalNow() {
    if (!V || !V.current) return [];
    const key = `${V.round}:${V.turn}:${V.current}:${V.board.length}`;
    if (key !== legalKey) {
      const board = {};
      for (const t of V.board) board[t.x + "," + t.y] = { id: t.id, r: t.r };
      legalCache = G.legalPlaces({ board }, V.current); legalKey = key;
    }
    return legalCache;
  }
  const optsAt = (x, y) => legalNow().filter((m) => m.x === x && m.y === y);

  function drawBoard() {
    if (!V) return;
    const lyT = $("#lyT"), lyM = $("#lyM"), lyH = $("#lyH");
    if (!lyT) return;
    const anim = !reduced();
    let t = "", m = "", h = "";
    const hlTiles = scoreHighlight && Date.now() < scoreHighlight.until ? scoreHighlight.tiles : null;
    if (scoreHighlight && !hlTiles) scoreHighlight = null;
    for (const tile of V.board) {
      const flash = anim && flashTile && flashTile.x === tile.x && flashTile.y === tile.y;
      t += `<g transform="translate(${tile.x * TS} ${tile.y * TS})">${flash ? '<g class="tile-flash">' : ""}${tileUse(tile.id, tile.r)}${flash ? "</g>" : ""}</g>`;
      if (tile.m && V.players[tile.m.p]) {
        const pop = anim && flashMeeple && flashMeeple.x === tile.x && flashMeeple.y === tile.y ? "meeple-pop" : "";
        m += meepleAt(tile, tile.m.f, V.players[tile.m.p].color, pop);
      }
    }
    if (V.lastPlace && V.phase !== "roundEnd") t += `<rect class="last-tile" x="${V.lastPlace.x * TS + 1.5}" y="${V.lastPlace.y * TS + 1.5}" width="${TS - 3}" height="${TS - 3}" rx="3"/>`;
    if (hlTiles) for (const q of hlTiles) t += `<rect class="sc-hl" x="${q.x * TS}" y="${q.y * TS}" width="${TS}" height="${TS}"/>`;

    if (canPlay() && V.phase === "place" && V.current) {
      const seen = Object.create(null);
      for (const o of legalNow()) {
        const k = o.x + "," + o.y;
        if (seen[k] || (preview && preview.x === o.x && preview.y === o.y)) continue;
        seen[k] = true;
        const x = o.x * TS, y = o.y * TS, c = TS / 2;
        h += `<g class="spotg${preview ? " dim" : ""}" data-x="${o.x}" data-y="${o.y}"><rect class="spot" x="${x + 3}" y="${y + 3}" width="${TS - 6}" height="${TS - 6}" rx="7"/>` +
          `<path class="plus" d="M${x + c - 7} ${y + c}H${x + c + 7}M${x + c} ${y + c - 7}V${y + c + 7}"/></g>`;
      }
      if (preview) {
        h += `<g class="ghost" data-x="${preview.x}" data-y="${preview.y}" transform="translate(${preview.x * TS} ${preview.y * TS})"><g class="ghost-in">${tileUse(V.current, preview.r)}</g>` +
          `<rect class="edge" width="${TS}" height="${TS}" rx="2"/></g>`;
      }
    }
    if (canPlay() && V.phase === "meeple" && V.lastPlace) {
      const me = V.players[V.me], last = V.lastPlace;
      const Rr = Math.max(TS * 0.1, 12 / cam.s);
      for (const fi of V.legal || []) {
        const a = window.CarcTiles.anchor(last.id, fi, last.r);
        const cx = last.x * TS + a[0] * TS / 100, cy = last.y * TS + a[1] * TS / 100;
        const f = G.TYPES[last.id].feats[fi];
        const w = Rr * 1.25, hh = w * 26 / 24;
        h += `<g class="mspot" data-feat="${fi}" style="--mc:${me.color};color:${me.color}" role="button" aria-label="Gefolgsmann auf ${LABEL[f.k] || f.k}"><title>${LABEL[f.k] || f.k}</title>` +
          `<circle class="ring" cx="${cx}" cy="${cy - Rr * 0.25}" r="${Rr}"/><use href="#ccMeeple" x="${cx - w / 2}" y="${cy - Rr * 0.25 - hh * 0.55}" width="${w}" height="${hh}"/></g>`;
      }
    }
    lyT.innerHTML = t; lyM.innerHTML = m; lyH.innerHTML = h;
    flashTile = null; flashMeeple = null;
    if (drag && drag.active) markHot();
  }

  function plateHTML(i) {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = members && members[i] && !members[i].online;
    const cls = ["plate", (V.phase === "place" || V.phase === "meeple") && V.cur === i ? "active" : "", away ? "away" : "", scorePulse && scorePulse.pi === i ? "pulse" : ""].join(" ");
    const tag = p.bot ? "Computer" : away ? "offline" : i === V.me ? "du" : "";
    return `<div class="${cls}" data-seat="${i}" style="--pc:${p.color}"><span class="pav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="pinfo"><span class="pname">${esc(p.name)}</span><span class="pmeta">${MEEPLE_ICON(p.color)} ${p.meeples}${tag ? `<span class="ptag"> · ${tag}</span>` : ""}</span></span>` +
      `<span class="pscore">${p.score}</span>` +
      `<span class="pwins" title="Siege">${p.wins}</span></div>`;
  }

  function renderGame() {
    if (V.phase !== "roundEnd") peek = false;
    const pl = $("#plates");
    pl.dataset.n = V.players.length; pl.style.setProperty("--n", V.players.length);
    pl.innerHTML = V.players.map((_, i) => plateHTML(i)).join("");
    scorePulse = null;
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> · Stapel <b>${V.stackLeft}</b>`;
    $("#stockInfo").innerHTML = V.me >= 0 ? `${MEEPLE_ICON(V.players[V.me].color)}<b>${V.players[V.me].meeples}</b>` : "";

    const play = canPlay();
    const cur = $("#curTile");
    if (V.phase === "place" && V.current) cur.innerHTML = dockTileSVG(V.current, preview ? preview.r : 0);
    else if (V.phase === "meeple" && V.lastPlace) cur.innerHTML = dockTileSVG(V.lastPlace.id, V.lastPlace.r);
    else cur.innerHTML = "";
    cur.classList.toggle("dim", !play);
    cur.classList.toggle("drag", play && V.phase === "place");

    const opts = play && V.phase === "place" && preview ? optsAt(preview.x, preview.y) : [];
    $("#placeActs").hidden = V.phase !== "place";
    $("#meepleActs").hidden = V.phase !== "meeple";
    $("#endActs").hidden = !(V.phase === "roundEnd" && peek);
    $("#rotBtn").disabled = opts.length < 2;
    $("#placeBtn").disabled = !play || V.phase !== "place" || !preview;
    $("#skipMeepleBtn").disabled = !play;

    let who = "", hint = "";
    if (V.phase === "roundEnd") {
      const w = V.last.winners;
      who = (V.players[w[0]].avatar + " ") + (w.length > 1 ? "Gleichstand!" : `${pname(w[0])} ${w[0] === V.me ? "gewinnst" : "gewinnt"}`);
      hint = "Runde vorbei.";
    } else {
      const P = V.players[V.cur];
      const pre = P.avatar + " ";
      if (play && V.phase === "place") { who = pre + "Du bist dran"; hint = preview ? (opts.length > 1 ? "Tippe das Plättchen zum Drehen, ziehe es woandershin oder „Legen“." : "Passt so. Jetzt „Legen“.") : "Ziehe das Plättchen aufs Brett oder tippe eine gestrichelte Stelle."; }
      else if (play && V.phase === "meeple") { who = pre + "Gefolgsmann setzen?"; hint = V.legal && V.legal.length ? "Tippe eine Stelle auf dem Plättchen oder setze keinen." : "Hier ist nichts frei."; }
      else { who = pre + `${P.name} ist dran`; hint = P.bot ? "Der Computer überlegt …" : V.me < 0 ? "Du schaust zu." : "Warte auf den Zug."; }
    }
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    $("#dock").classList.toggle("myturn", play);
    $("#reactBtn").hidden = mode !== "online";
    $("#keys").innerHTML = play && V.phase === "place" ? "<kbd>R</kbd> drehen · <kbd>Enter</kbd> legen · Brett ziehen und zoomen mit der Maus" : play && V.phase === "meeple" ? "<kbd>Enter</kbd> ohne Gefolgsmann" : "";

    const lmEl = $("#lastMove"), lines = V.log.slice(-2), lmKey = lines.join("\n");
    if (lmEl.dataset.k !== lmKey) {
      lmEl.dataset.k = lmKey;
      lmEl.innerHTML = lines.map((l, i) => `<div${i < lines.length - 1 ? ' class="old"' : ""}>${esc(l)}</div>`).join("");
    }

    const key = `${V.round}:${V.turn}:${V.cur}:${V.phase}`;
    if (play && lastTurn !== key && lastTurn !== null && (mode === "online" || V.players.some((p) => p.bot))) { buzz([40, 60, 40]); sfx("turn"); }
    if (lastTurn !== key) cam.auto = true;
    lastTurn = key;
    if (V.board.length <= 1) { cam.init = false; cam.tgt = null; }

    drawBoard();
    camSync();

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
    if (dragMoved > 6 || !canPlay()) return;
    const ms = e.target.closest("[data-feat]");
    if (ms && V.phase === "meeple") { doAct({ t: "meeple", feature: +ms.dataset.feat }); return; }
    const sp = e.target.closest("[data-x]");
    if (!sp || V.phase !== "place") return;
    const x = +sp.dataset.x, y = +sp.dataset.y;
    const opts = optsAt(x, y);
    if (!opts.length) return;
    if (preview && preview.x === x && preview.y === y) {
      const i = opts.findIndex((o) => o.r === preview.r);
      preview.r = opts[(i + 1) % opts.length].r;
    } else {
      const keep = preview ? opts.find((o) => o.r === preview.r) : null;
      preview = { x, y, r: (keep || opts[0]).r };
    }
    sfx("pop");
    renderGame();
  });

  // pan / zoom: drag, wheel, pinch and the buttons
  (function () {
    const wrap = $("#boardWrap");
    const ptrs = new Map();
    let pinch = null;
    const local = (cx, cy) => { const r = wrap.getBoundingClientRect(); return [cx - r.left, cy - r.top]; };
    const pair = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
    wrap.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".zoomctl")) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) dragMoved = 0;
      if (ptrs.size === 2) { const p = pair(); pinch = { d: p.d, s: cam.s, mx: p.mx, my: p.my }; dragMoved = 99; }
    });
    window.addEventListener("pointermove", (e) => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 1) {
        dragMoved += Math.abs(dx) + Math.abs(dy);
        if (dragMoved > 6) { userCam(); cam.x += dx; cam.y += dy; camApply(); wrap.classList.add("grab"); }
      } else if (ptrs.size === 2 && pinch) {
        const q = pair(); userCam();
        const [mx, my] = local(pinch.mx, pinch.my);
        zoomAt(mx, my, pinch.s * q.d / pinch.d);
        cam.x += q.mx - pinch.mx; cam.y += q.my - pinch.my; camApply();
        pinch.mx = q.mx; pinch.my = q.my;
      }
    });
    const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) wrap.classList.remove("grab"); };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    wrap.addEventListener("wheel", (e) => {
      e.preventDefault(); userCam();
      const [mx, my] = local(e.clientX, e.clientY);
      zoomAt(mx, my, cam.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)));
    }, { passive: false });
    const step = (f) => { userCam(); zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, cam.s * f); };
    $("#zoomIn").addEventListener("click", () => step(1.3));
    $("#zoomOut").addEventListener("click", () => step(1 / 1.3));
    $("#zoomFit").addEventListener("click", () => { cam.auto = true; cam.tgt = null; camSync(); });
    if (window.ResizeObserver) new ResizeObserver(() => { if (V && cam.auto) camSync(true); else camApply(); }).observe(wrap);
  })();

  // drag & drop of the current tile (from the dock or from the ghost) onto a legal spot
  function markHot() {
    const ly = $("#lyH"); if (!ly) return;
    ly.querySelectorAll(".spotg.hot").forEach((n) => n.classList.remove("hot"));
    if (drag && drag.hot) { const n = ly.querySelector(`.spotg[data-x="${drag.hot.x}"][data-y="${drag.hot.y}"]`); if (n) n.classList.add("hot"); }
  }
  function dragPlace() {
    const wrap = $("#boardWrap"), rc = wrap.getBoundingClientRect();
    const size = Math.max(44, Math.min(150, TS * cam.s));
    const lift = drag.touch ? size * 0.75 + 14 : 0;
    const cx = drag.px, cy = drag.py - lift;
    const bx = (cx - rc.left - cam.x) / cam.s / TS - 0.5, by = (cy - rc.top - cam.y) / cam.s / TS - 0.5;
    let best = null, bd = 0.8;
    for (const o of legalNow()) {
      const d = Math.hypot(o.x - bx, o.y - by);
      if (d < bd && cx > rc.left && cx < rc.right && cy > rc.top && cy < rc.bottom) { bd = d; best = o; }
    }
    let r = drag.r;
    if (best) {
      const opts = optsAt(best.x, best.y);
      r = (opts.find((o) => o.r === drag.r) || opts[0]).r;
      drag.hot = { x: best.x, y: best.y, r };
    } else drag.hot = null;
    const el = drag.el;
    let sx = cx, sy = cy;
    if (drag.hot) { sx = rc.left + cam.x + (drag.hot.x + 0.5) * TS * cam.s; sy = rc.top + cam.y + (drag.hot.y + 0.5) * TS * cam.s; }
    el.style.width = el.style.height = (drag.hot ? Math.max(TS * cam.s, 30) : size) + "px";
    el.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-50%)`;
    el.classList.toggle("snap", !!drag.hot);
    if (drag.shownR !== r) { el.innerHTML = dockTileSVG(V.current, r); drag.shownR = r; }
    markHot();
  }
  function dragLoop() {
    if (!drag || !drag.active) return;
    const rc = $("#boardWrap").getBoundingClientRect(), m = 46;
    let vx = 0, vy = 0;
    if (drag.px < rc.left + m) vx = 1; else if (drag.px > rc.right - m) vx = -1;
    const py = drag.py - (drag.touch ? 40 : 0);
    if (py < rc.top + m) vy = 1; else if (py > rc.bottom - m) vy = -1;
    if (vx || vy) { userCam(); cam.x += vx * 7; cam.y += vy * 7; camApply(); dragPlace(); }
    drag.raf = requestAnimationFrame(dragLoop);
  }
  function dragEnd(commit) {
    if (!drag) return;
    const d = drag; drag = null;
    cancelAnimationFrame(d.raf);
    if (d.el) d.el.remove();
    document.body.classList.remove("dragging");
    $("#curTile").classList.remove("lifted");
    const g = $("#lyH .ghost"); if (g) g.classList.remove("lifted");
    $("#lyH").querySelectorAll(".spotg.hot").forEach((n) => n.classList.remove("hot"));
    if (d.active && commit && d.hot && canPlay() && V.phase === "place") {
      preview = { x: d.hot.x, y: d.hot.y, r: d.hot.r };
      sfx("pop"); buzz(8);
      renderGame();
    }
  }
  document.addEventListener("pointerdown", (e) => {
    if (drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (!canPlay() || V.phase !== "place" || !V.current) return;
    let src = null;
    if (e.target.closest("#curTile")) src = "dock";
    else if (preview && e.target.closest("#boardWrap .ghost")) src = "ghost";
    if (!src) return;
    if (src === "ghost") { e.stopPropagation(); dragMoved = 0; }
    drag = { src, pid: e.pointerId, sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY, r: preview ? preview.r : 0, active: false, touch: e.pointerType !== "mouse", hot: null, el: null, shownR: -1 };
  }, true);
  window.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    drag.px = e.clientX; drag.py = e.clientY;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 8) return;
      if (!canPlay()) { dragEnd(false); return; }
      drag.active = true; dragMoved = 99;
      const el = document.createElement("div"); el.className = "dragtile"; document.body.append(el); drag.el = el;
      document.body.classList.add("dragging");
      if (drag.src === "dock") $("#curTile").classList.add("lifted"); else { const g = $("#lyH .ghost"); if (g) g.classList.add("lifted"); }
      buzz(6);
      drag.raf = requestAnimationFrame(dragLoop);
    }
    if (!canPlay() || V.phase !== "place") { dragEnd(false); return; }
    e.preventDefault();
    dragPlace();
  }, { passive: false });
  window.addEventListener("pointerup", (e) => { if (drag && e.pointerId === drag.pid) dragEnd(true); });
  window.addEventListener("pointercancel", (e) => { if (drag && e.pointerId === drag.pid) dragEnd(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drag) dragEnd(false); });

  $("#rotBtn").addEventListener("click", () => {
    if (!preview || !canPlay()) return;
    const opts = optsAt(preview.x, preview.y);
    if (opts.length < 2) return;
    const i = opts.findIndex((o) => o.r === preview.r);
    preview.r = opts[(i + 1) % opts.length].r;
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
  $("#resultBtn").addEventListener("click", () => { peek = false; render(); });

  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, button") || e.ctrlKey || e.metaKey || e.altKey) return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") { if (open) $(open).hidden = true; return; }
    if (open || $("#game").hidden || !$("#roundEnd").hidden || !canPlay()) return;
    const k = e.key.toLowerCase();
    if (k === "r" && V.phase === "place") { e.preventDefault(); $("#rotBtn").click(); }
    else if (k === "enter" && V.phase === "place") { e.preventDefault(); $("#placeBtn").click(); }
    else if (k === "enter" && V.phase === "meeple") { e.preventDefault(); $("#skipMeepleBtn").click(); }
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
      room(m) { R = m; mode = "online"; inflight = false; if (m.view) handleEvents(m.events, m.view); preview = null; render(); },
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
          UI.armed("Runde neu starten", () => { L.round--; L.starter = (L.starter + L.players.length - 1) % L.players.length; G.startRound(L); peek = false; preview = null; camReset(); store.set(K.local, L); render(); scheduleBot(); }),
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
    L = state; mode = "local"; peek = false; preview = null; camReset();
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
