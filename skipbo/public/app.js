// Skip-Bo UI: single player (against the computer) and online rooms share one table renderer.
(() => {
  "use strict";
  const G = window.SkipboGame;
  // An old cached game.js next to a new app.js: reload once without cache instead of breaking.
  if (!G || !G.botMove || !G.AVATARS) {
    let tried = false;
    try { tried = sessionStorage.getItem("skipbo.reloaded") === "1"; sessionStorage.setItem("skipbo.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("skipbo.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const K = { local: "skipbo.v1", online: "skipbo.online", me: "skipbo.me", goal: "skipbo.goal", stock: "skipbo.stock", level: "skipbo.level",
    sound: "skipbo.sound", stats: "skipbo.stats", avatar: "skipbo.avatar", look: "skipbo.look" };
  const store = Spieleabend.store;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  // table design and size (shared, kit.js), applied before anything is drawn
  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Kartengröße" });

  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");

  const STOCKS = [[10, "Kurz", "10 Karten"], [20, "Mittel", "20 Karten"], [0, "Standard", "30, ab 5: 20"]];
  const LEVELS = Object.entries(G.LEVELS).map(([v, name]) => [+v, name]);
  const GOALS = [[1, "Eine Runde"], [2, "Bis 2 Siege"], [3, "Bis 3 Siege"]];

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let R = null;           // last online room message
  let watching = false;   // in the waiting room, but watching the game that runs
  let V = null;           // view currently on screen
  let peek = false;       // round over, looking at the table
  let server = null;      // server info once found ({} when only the WebSocket answered)
  let serverState = "checking"; // "checking" | "ok" | "none"
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "skipbo.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let goalLocal = G.normGoal(store.get(K.goal) || 1), stockLocal = G.normStock(store.get(K.stock) || 0);
  let levelLocal = G.normLevel(store.get(K.level) || 2);
  let lastTurn = null, confettiFor = null;
  let sel = null;         // { from: "hand"|"stock"|"disc", c, i, idx } the tapped card
  let selfSrc = null;     // where my own dragged card was let go, so the flight starts there
  let trackHand = [];     // my hand as last known, to see which cards were just drawn
  let deckShake = false;
  let reSeen = "", reAt = 0, reT = null; // when the round-end card may appear

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const canPlay = () => !!V && V.phase === "play" && V.cur >= 0 && V.cur === V.me;
  const pname = (i) => (i === V.me ? "Du" : V.players[i].name);
  const { toast, confetti, showBubble } = Spieleabend;
  const mine = () => (V && V.me >= 0 ? V.players[V.me] : null);
  const rectOf = Cards.rectOf;
  const remove1 = (a, c) => { const k = a.indexOf(c); if (k >= 0) a.splice(k, 1); };

  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound,
    effects: ({ tone, noise }) => ({
      place: () => { noise(0, 0.07, 0.22, 2400); tone(520, 0, 0.07, "triangle", 0.1, 380); },
      deal: () => { noise(0, 0.12, 0.16, 3200); tone(700, 0.02, 0.06, "sine", 0.06, 500); },
      shuffle: () => { for (let i = 0; i < 6; i++) noise(i * 0.06, 0.06, 0.16, 1800 + i * 200); },
      clear: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.18, "triangle", 0.13)),
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16))
    })
  });

  // ---------- cards ----------
  const tone = (c) => (c === 0 ? "w" : "c" + Math.ceil(c / 4));
  function cardHTML(c, o = {}) {
    const wild = c === 0;
    const face = wild ? (o.v ? `<b>${o.v}</b>` : '<b class="sb">SB</b>') : `<b>${c}</b>`;
    return `<div class="card ${tone(c)}" data-n="${wild ? "SB" : c}" data-v="${c}"${o.attrs ? " " + o.attrs : ""}${o.style ? ` style="${o.style}"` : ""}>${face}</div>`;
  }
  const backHTML = () => '<div class="card back"></div>';
  // a pile of cards, cascading downwards so every number stays readable
  function pileHTML(arr, o = {}) {
    const n = arr.length, { f, H } = Cards.cascade(n, o);
    const cards = arr.map((c, k) => cardHTML(c, { style: `--i:${k};--f:${f.toFixed(3)}`, attrs: k === n - 1 && o.src ? `data-src="${o.src}" data-i="${o.i || 0}"` : "" })).join("");
    return `<div class="cd-pile${n ? "" : " empty"}${o.cls ? " " + o.cls : ""}" style="--H:${H.toFixed(3)}"${o.attrs ? " " + o.attrs : ""}>${cards}${o.count ? `<span class="cnt">${o.count}</span>` : ""}</div>`;
  }

  // ---------- events → feedback (every move is animated, also the computer's and other people's) ----------

  function seatEl(pi) { return document.querySelector(`#opps [data-seat="${pi}"]`); }
  // a mini card sized rectangle in the middle of somebody's "cards in hand" badge
  function handRect(pi) {
    const seat = seatEl(pi); if (!seat) return null;
    const badge = seat.querySelector(".ohand .card"), pile = seat.querySelector(".cd-pile");
    if (!badge) return null;
    const b = rectOf(badge), w = pile ? pile.getBoundingClientRect().width : 30;
    return { left: b.left + b.width / 2 - w / 2, top: b.top + b.height / 2 - w * 0.7, width: w, height: w * 1.4 };
  }
  function srcRect(pi, from, c, i, me) {
    if (pi === me) {
      if (selfSrc) { const r = selfSrc; selfSrc = null; return r; }
      let el = null;
      if (from === "hand") el = $$("#hand .card").find((e) => +e.dataset.v === c && !e.dataset.taken);
      else if (from === "stock") el = $("#myStock .card");
      else el = $(`#myDisc .card[data-src="disc"][data-i="${i}"]`);
      if (el) { el.dataset.taken = "1"; return rectOf(el); }
      return null;
    }
    const seat = seatEl(pi); if (!seat) return null;
    if (from === "hand") return handRect(pi);
    const el = from === "stock" ? seat.querySelector(".ostock .card") : seat.querySelector(`[data-d="${i}"] .card:last-of-type`);
    return el ? rectOf(el) : handRect(pi);
  }

  function handleEvents(events, v) {
    if (!v || !events || !events.length) return;
    const me = v.me;
    let h = trackHand.slice(), t = 0;
    const later = (fn, ms) => (ms > 0 ? setTimeout(fn, ms) : fn());
    const nth = {};
    for (const ev of events) {
      if (ev.t === "play") {
        const src = srcRect(ev.pi, ev.from, ev.c, ev.i, me);
        if (ev.pi === me && ev.from === "hand") remove1(h, ev.c);
        const sweep = events.some((x) => x.t === "clear" && x.to === ev.to);
        fl.add({ src, html: cardHTML(ev.c, { v: ev.v }), dst: { k: "build", i: ev.to }, delay: t, dur: sweep ? 1150 : 420, sweep: sweep ? sweepRect : null });
        later(() => sfx("place"), t);
        t += 400;
      } else if (ev.t === "discard") {
        const src = srcRect(ev.pi, "hand", ev.c, 0, me);
        if (ev.pi === me) remove1(h, ev.c);
        fl.add({ src, html: cardHTML(ev.c), dst: { k: "disc", pi: ev.pi, i: ev.to }, delay: t, dur: 420 });
        later(() => sfx("place"), t);
        t += 400;
      } else if (ev.t === "draw") {
        const deck = $("#deck .card");
        const src = deck ? rectOf(deck) : null;
        if (ev.pi === me && v.hand) {
          const rest = h.slice(), add = [];
          for (const c of v.hand) { const k = rest.indexOf(c); if (k >= 0) rest.splice(k, 1); else add.push(c); }
          const got = add.slice(0, ev.n);
          h = h.concat(got);
          got.forEach((c, k) => {
            nth[c] = (nth[c] || 0) + 1;
            fl.add({ html: backHTML(), flipTo: cardHTML(c), src, dst: { k: "hand", c, nth: got.filter((x, j) => x === c && j > k).length }, delay: t + k * 110, dur: 380 });
          });
        } else {
          for (let k = 0; k < ev.n; k++) fl.add({ html: backHTML(), src, dst: { k: "ohand", pi: ev.pi }, delay: t + k * 90, dur: 360 });
        }
        later(() => sfx("deal"), t);
        t += 120 + ev.n * 100;
      } else if (ev.t === "reshuffle") {
        deckShake = true; toast("Der Stapel ist leer und wird neu gemischt.");
        later(() => sfx("shuffle"), t);
      } else if (ev.t === "clear") {
        later(() => { sfx("clear"); buzz(30); }, t + 300);
      } else if (ev.t === "pass") {
        toast(ev.pi === me ? "Du kannst nichts mehr tun." : `${v.players[ev.pi].name} kann nichts mehr tun.`);
      } else if (ev.t === "skip") {
        toast(ev.pi === me ? "Du wurdest übersprungen." : `${v.players[ev.pi].name} wird übersprungen.`);
      } else if (ev.t === "giveup") {
        toast(ev.pi === me ? "Du hast aufgegeben." : `${v.players[ev.pi].name} gibt auf.`);
      } else if (ev.t === "end") {
        setTimeout(() => sfx("win"), 500);
      }
    }
    trackHand = v.hand ? v.hand.slice() : [];
  }

  // where a flight lands: { rect, hide } looked up in the freshly drawn table
  function resolve(d) {
    if (d.k === "build") {
      const p = $(`#builds [data-build="${d.i}"] .cd-pile`);
      return p ? { rect: rectOf(p), hide: p.querySelector(".card") } : null;
    }
    if (d.k === "disc") {
      const scope = V && d.pi === V.me ? "#myDisc" : `#opps [data-seat="${d.pi}"]`;
      const p = $(`${scope} [data-d="${d.i}"]`);
      if (!p) return null;
      const cards = p.querySelectorAll(".card"), top = cards[cards.length - 1];
      return { rect: rectOf(top || p), hide: top || null };
    }
    if (d.k === "hand") {
      const cards = $$("#hand .card").filter((e) => +e.dataset.v === d.c), el = cards[cards.length - 1 - d.nth];
      return el ? { rect: rectOf(el), hide: el } : null;
    }
    if (d.k === "ohand") return handRect(d.pi) ? { rect: handRect(d.pi), hide: null } : null;
    return null;
  }
  const fl = Cards.flights({
    resolve, off: () => $("#game").hidden,
    onLand(f) {
      if (f.dst.k !== "ohand") return;
      const e = handRect(f.dst.pi) && seatEl(f.dst.pi);
      if (e) { e.classList.remove("pulse"); void e.offsetWidth; e.classList.add("pulse"); }
    }
  });
  const sweepRect = () => { const deck = $("#deck"); return deck ? rectOf(deck) : null; };

  // ---------- actions ----------
  function doAct(a) {
    if (mode === "local") {
      const res = G.act(L, 0, a);
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

  const srcOf = (el) => {
    const from = el.dataset.src, c = +el.dataset.v;
    return from === "hand" ? { from, c, i: 0, idx: [...el.parentNode.children].indexOf(el) } : { from, c, i: +el.dataset.i || 0 };
  };
  const sameSrc = (a, b) => a && b && a.from === b.from && a.c === b.c && a.i === b.i && (a.from !== "hand" || a.idx === b.idx);
  const srcEl = (s) => {
    if (s.from === "hand") return $("#hand").children[s.idx] || null;
    if (s.from === "stock") return $("#myStock .card");
    return $(`#myDisc .card[data-src="disc"][data-i="${s.i}"]`);
  };
  const fitsBuild = (c, to) => G.fits(c, { length: V.build[to] });

  function markSent(s) { const el = srcEl(s); if (el && mode === "online") el.classList.add("cd-sent"); }

  function playTo(s, to, fromRect) {
    if (!canPlay()) return false;
    if (!fitsBuild(s.c, to)) { toast(`Auf Haufen ${to + 1} kommt jetzt die ${V.build[to] + 1}.`); sfx("bad"); return false; }
    selfSrc = fromRect || null;
    markSent(s);
    sel = null;
    buzz(10);
    if (!doAct({ t: "play", from: s.from, c: s.c, i: s.i || 0, to })) { selfSrc = null; paintSel(); return false; }
    return true;
  }
  function discardTo(c, to, fromRect) {
    if (!canPlay()) return false;
    selfSrc = fromRect || null;
    const s = { from: "hand", c, i: 0, idx: sel && sel.from === "hand" && sel.c === c ? sel.idx : V.hand.indexOf(c) };
    markSent(s);
    sel = null;
    buzz(10);
    if (!doAct({ t: "discard", c, to })) { selfSrc = null; paintSel(); return false; }
    return true;
  }
  // a second tap on the chosen card plays it where it fits best
  function autoPlay(s) {
    const fits = [0, 1, 2, 3].filter((b) => fitsBuild(s.c, b));
    if (!fits.length) {
      toast(s.from === "hand" ? "Passt auf keinen Haufen. Tippe einen Ablagestapel an, um die Karte abzulegen." : "Die Karte passt gerade auf keinen Haufen.");
      sfx("bad"); return;
    }
    const to = s.c === 0 ? fits.sort((a, b) => V.build[b] - V.build[a])[0] : fits[0];
    playTo(s, to);
  }

  // ---------- selection, tap and drag ----------
  function validateSel() {
    if (!sel) return;
    const m = mine();
    let ok = canPlay() && !!m;
    if (ok && sel.from === "hand") {
      if (V.hand[sel.idx] !== sel.c) { const k = V.hand.indexOf(sel.c); if (k < 0) ok = false; else sel.idx = k; }
    } else if (ok && sel.from === "stock") ok = m.stockTop === sel.c;
    else if (ok) { const d = m.disc[sel.i]; ok = !!d && d.length > 0 && d[d.length - 1] === sel.c; }
    if (!ok) sel = null;
  }
  function paintSel() {
    for (const e of $$(".card.sel")) e.classList.remove("sel");
    const s = dnd.src || sel;
    for (const el of $$("#builds .slot")) el.classList.toggle("cd-drop", !!s && fitsBuild(s.c, +el.dataset.build));
    for (const el of $$("#myDisc .cd-pile")) el.classList.toggle("cd-drop", !!s && s.from === "hand");
    if (sel) { const el = srcEl(sel); if (el) el.classList.add("sel"); }
  }

  const dnd = Cards.dnd({
    root: "#game",
    grab(e) {
      const c = e.target.closest("[data-src]");
      return c && canPlay() ? Object.assign(srcOf(c), { el: c }) : null;
    },
    onStart() { sel = null; paintSel(); },
    // what lies under the finger: a build pile, or one of my discard piles for a hand card
    target(el, s) {
      const b = el.closest("#builds .slot");
      if (b) return { el: b, build: +b.dataset.build, ok: fitsBuild(s.c, +b.dataset.build) };
      const d = el.closest("#myDisc .cd-pile");
      return d ? { el: d, disc: +d.dataset.disc, ok: s.from === "hand" } : null;
    },
    drop(s, t, rect) {
      if (t.build != null) return playTo(s, t.build, rect);
      if (t.ok) return discardTo(s.c, t.disc, rect);
      toast("Nur Handkarten kommen auf die Ablage.");
      return false;
    },
    onEnd(dirty) { if (dirty) render(); else paintSel(); },
    tap: (e) => onTap(e)
  });

  function onTap(e) {
    if (!V || V.phase !== "play") return;
    const srcE = e.target.closest("[data-src]"), build = e.target.closest("#builds .slot"), disc = e.target.closest("#myDisc .cd-pile");
    if (!srcE && !build && !disc) return;
    if (!canPlay()) { toast(V.me < 0 ? "Du schaust zu." : `Warte, ${V.players[V.cur].name} ist dran.`); return; }
    if (sel && sel.from === "hand" && disc) { discardTo(sel.c, +disc.dataset.disc); return; }
    if (srcE) {
      const s = srcOf(srcE);
      if (sameSrc(sel, s)) { autoPlay(s); return; }
      sel = s; paintSel(); sfx("pop"); buzz(8);
      return;
    }
    if (build) {
      if (!sel) { toast("Tippe zuerst eine Karte an."); return; }
      playTo(sel, +build.dataset.build);
      return;
    }
    toast(sel ? "Auf die Ablage kommen nur Handkarten." : "Tippe zuerst eine Handkarte an, die du ablegen willst.");
  }
  $("#passBtn").addEventListener("click", () => { if (canPlay()) doAct({ t: "pass" }); });
  $("#resultBtn").addEventListener("click", () => { peek = false; render(); });

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
      if (!R.view || (waiting && !watching)) { V = null; showScreen("lobby"); UI.renderLobby(); $("#roundEnd").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else {
      V = null;
      $("#roundEnd").hidden = true;
      showScreen("home"); renderHome();
    }
    UI.update();
  }

  function oppHTML(i) {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = !!(members && members[i] && !members[i].online && !p.bot);
    const cls = ["obox", V.phase === "play" && V.cur === i ? "active" : "", away ? "away" : ""].join(" ");
    const stock = pileHTML(p.stockN ? [p.stockTop] : [], { cls: "mini ostock", count: p.stockN || "" });
    const disc = p.disc.map((d, j) => pileHTML(d, { cls: "mini", attrs: `data-d="${j}"`, fmax: 0.3, room: 1.3 })).join("");
    return `<div class="${cls}" data-seat="${i}"><div class="ohead"><span class="pav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="pname">${esc(p.name)}${p.bot ? " 🤖" : ""}${away ? " (offline)" : ""}</span><span class="owins" title="Siege">${p.wins}</span>` +
      `<span class="ohand" title="Handkarten">${backHTML()}${p.handN}</span></div>` +
      `<div class="orow">${stock}<span class="sep"></span>${disc}</div></div>`;
  }

  function renderGame() {
    if (V.phase !== "roundEnd") peek = false;
    const m = mine(), play = canPlay();
    validateSel();
    const stockN = G.stockSize(V.players.length, V.stockOpt);
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> · ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`} · Vorrat ${stockN}`;

    // opponents
    const opps = V.players.map((_, i) => i).filter((i) => i !== V.me);
    const oppsEl = $("#opps");
    oppsEl.classList.toggle("scroll", opps.length > 1);
    oppsEl.innerHTML = opps.map(oppHTML).join("");

    // build piles and the draw pile
    $("#builds").innerHTML = V.build.map((n, i) => {
      const card = n ? cardHTML(V.wild[i] ? 0 : n, { v: V.wild[i] ? n : 0, style: "--i:0;--f:0" }) : "";
      return `<div class="slot" data-build="${i}"><div class="cd-pile${n ? "" : " empty"}" style="--H:1" data-hint="${n + 1}">${card}</div></div>`;
    }).join("");
    const deckN = V.deckN;
    $("#deck").className = "deck" + (deckShake ? " shake" : "");
    $("#deck").innerHTML = deckN ? `<div class="cd-pile" style="--H:1">${backHTML()}<span class="cnt">${deckN}</span></div>` : '<div class="cd-pile empty"></div>';
    if (deckShake) { deckShake = false; const dk = $("#deck"); dk.animate([{ transform: "rotate(-6deg)" }, { transform: "rotate(6deg)" }, { transform: "rotate(-4deg)" }, { transform: "none" }], { duration: 420 }); }

    // my board and hand
    $("#myBoard").hidden = $("#hand").hidden = !m;
    if (m) {
      $("#myStock").innerHTML = pileHTML(m.stockN ? [m.stockTop] : [], { src: "stock", count: m.stockN || "" });
      $("#myDisc").innerHTML = m.disc.map((d, j) => pileHTML(d, { src: "disc", i: j, attrs: `data-disc="${j}" data-d="${j}"`, fmax: 0.28, room: 1.1 })).join("");
      $("#hand").innerHTML = V.hand.map((c) => cardHTML(c, { attrs: 'data-src="hand"' })).join("");
    }
    trackHand = V.hand ? V.hand.slice() : [];

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
        if (!V.hand.length) hint = "Keine Karten mehr. Beende den Zug.";
        else {
          const tops = [m.stockTop, ...m.disc.filter((d) => d.length).map((d) => d[d.length - 1]), ...V.hand];
          const any = tops.some((c) => c >= 0 && V.build.some((n) => G.fits(c, { length: n })));
          hint = any ? "Karten auf die Haufen legen. Dein Zug endet, wenn du eine Handkarte ablegst." : "Nichts passt mehr. Lege eine Handkarte auf einen Ablagestapel.";
        }
      } else {
        who = `${P.name} ist dran`;
        hint = P.bot ? "Der Computer überlegt …" : V.me < 0 ? "Du schaust zu." : "Warte auf den nächsten Zug.";
      }
    }
    $("#whoAv").textContent = av;
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    $("#dock").classList.toggle("myturn", play);
    $("#passBtn").hidden = !(play && !V.hand.length);
    $("#resultBtn").hidden = !(V.phase === "roundEnd" && peek);
    $("#reactBtn").hidden = mode !== "online";

    // turn change feedback
    const key = `${V.round}:${V.turn}:${V.cur}`;
    if (play && lastTurn !== key && lastTurn !== null && (mode === "online" || V.players.some((p) => p.bot))) { buzz([40, 60, 40]); sfx("turn"); }
    lastTurn = key;

    // the result card waits until the last cards have landed
    let showEnd = V.phase === "roundEnd" && !peek;
    if (showEnd) {
      const rk = `${V.round}:${V.last.winners}:${V.mv}`;
      if (reSeen !== rk) { reSeen = rk; reAt = Date.now() + (reduce.matches ? 0 : 1000); }
      const wait = reAt - Date.now();
      if (wait > 0) { showEnd = false; clearTimeout(reT); reT = setTimeout(render, wait + 20); }
    }
    $("#roundEnd").hidden = !showEnd;
    if (V.phase === "roundEnd") {
      if (showEnd) renderRoundEnd();
      const k = `${V.round}:${V.last.winners.join(",")}:${V.players.map((p) => p.wins).join(",")}`;
      if (confettiFor !== k) {
        confettiFor = k; record(k);
        setTimeout(() => confetti(), 700);
      }
    }
    paintSel();
    fl.hide();
    fl.run();
  }

  // ---------- reactions (online) ----------
  function bubble(pi, e, who) {
    const host = pi >= 0 && pi !== (V && V.me) ? seatEl(pi) : $("#dock");
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
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (open) $(open).hidden = true; else if (sel) { sel = null; paintSel(); }
  });

  function scoreList(el, winners) {
    const left = V.last ? V.last.left : null;
    el.innerHTML = V.players.map((p, i) => {
      const you = i === V.me ? " (du)" : "";
      const info = left ? `${left[i]} im Vorrat` : `${p.stockN} im Vorrat`;
      return `<li class="${winners.includes(i) ? "win" : ""}"><span>${avi(p.avatar)}${esc(p.name)}${you}<small>${info}</small></span>` +
        `<b>${p.wins} ${p.wins === 1 ? "Sieg" : "Siege"}</b></li>`;
    }).join("");
  }

  function renderRoundEnd() {
    const last = V.last, w = last.winners[0];
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round} vorbei`;
    $("#reTitle").textContent = `${w === V.me ? "Du gewinnst" : `${V.players[w].name} gewinnt`} ${last.over ? "das Spiel" : "die Runde"}!`;
    const how = last.how === "giveup" ? "Jemand hat aufgegeben." : last.how === "stall" ? "Niemand kommt mehr weiter, der kleinste Vorrat gewinnt." : "Vorratsstapel leer gespielt.";
    $("#reText").textContent = `${how} ${last.moves} Karten gelegt.` +
      (last.over ? "" : ` Gespielt wird bis ${V.goal} Siege, als Nächstes beginnt ${V.players[V.nextStarter].name}.`);
    scoreList($("#reScores"), last.winners);
    UI.roundEndFooter({ over: last.over, next: "Nächste Runde" });
  }

  // Statistik lebt im Profil (shared/profile.js, gilt für alle Spiele); die alte Bilanz dieses Browsers wird einmal übernommen
  const profile = Spieleabend.profile;
  { const old = (store.get(K.stats) || {})[profile.get().name]; if (old) profile.importLegacy("skipbo", { rounds: old.rounds || old.games, wins: old.wins }); }
  function record(key) {
    const i = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
    if (i < 0) return;
    profile.result("skipbo", key, { won: V.last.winners.includes(i), draw: !V.last.winners.length, online: mode === "online" });
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
    $("#stockLocal").innerHTML = segHTML(STOCKS, stockLocal);
    $("#goalLocal").innerHTML = segHTML(GOALS, goalLocal);
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
      room(m) { R = m; mode = "online"; if (m.view) handleEvents(m.events, m.view); render(); },
      react(m) { bubble(m.pi, m.e, m.name); },
      error(m) { if (V) render(); },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text, name) => bubble(pi, text, name),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    // the settings the host picks in the waiting room; everyone sees them
    renderSettings(host) {
      for (const [id, list, cur] of [["#stockOnline", STOCKS, R.stock || 0], ["#goalOnline", GOALS, R.goal], ["#levelOnline", LEVELS, R.level || 2]]) {
        const el = $(id), k = cur + ":" + host;
        if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = segHTML(list, cur); for (const b of el.children) b.disabled = !host; }
      }
    },
    menu: {
      open() {
        LOOK.render();
        if (V) scoreList($("#menuScores"), []);
        $("#menuRules").textContent = V ? `${G.stockSize(V.players.length, V.stockOpt)} Karten im Vorrat, ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}.` : "";
      },
      local(box) {
        box.append(
          UI.armed("Runde neu starten", () => { L.round--; L.starter = (L.starter + L.players.length - 1) % L.players.length; G.startRound(L); peek = false; sel = null; store.set(K.local, L); render(); scheduleBot(); }),
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
  for (const [id, key] of [["stock", "stock"], ["goal", "goal"], ["level", "level"]]) {
    $(`#${id}Online`).addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", [key]: +b.dataset.v }); });
  }
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; tabTouched = true; renderHome(); } });
  $("#stockLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { stockLocal = +b.dataset.v; store.set(K.stock, stockLocal); renderHome(); } });
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
    wsSend({ t: "create", name: n, goal: goalLocal, stock: stockLocal, level: levelLocal, avatar: myAvatar });
  });

  function startLocal(state) {
    L = state; mode = "local"; peek = false; sel = null; trackHand = []; fl.clear();
    store.set(K.local, L); render(); wake(); scheduleBot();
  }
  $("#startLocal").addEventListener("click", () => {
    const { names, bots } = HOME.roster($("#myName").value);
    const list = names.map((name, i) => ({ name, bot: bots[i], avatar: bots[i] ? G.BOT_AVATAR : myAvatar }));
    startLocal(G.newGame(list, goalLocal, stockLocal, levelLocal));
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

  Spieleabend.followTurn("#opps", ".obox.active");
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- boot ----------
  const code = UI.roomCode();
  render();
  if (webHost && (store.get(K.online) && !code)) UI.resume();
  UI.detectServer("/skipbo-server", "skipbo").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
