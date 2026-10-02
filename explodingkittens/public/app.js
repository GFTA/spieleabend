// Exploding Kittens UI: single player (against the computer) and online rooms share one table renderer.
(() => {
  "use strict";
  const G = window.ExplodingkittensGame;
  // An old cached game.js next to a new app.js: reload once without cache instead of breaking.
  if (!G || !G.botMove || !G.AVATARS || !G.CARDS) {
    let tried = false;
    try { tried = sessionStorage.getItem("explodingkittens.reloaded") === "1"; sessionStorage.setItem("explodingkittens.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("explodingkittens.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const K = { local: "explodingkittens.v1", online: "explodingkittens.online", me: "explodingkittens.me", goal: "explodingkittens.goal", level: "explodingkittens.level",
    sound: "explodingkittens.sound", stats: "explodingkittens.stats", avatar: "explodingkittens.avatar", look: "explodingkittens.look" };
  const store = Spieleabend.store;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  // table design and size (shared, kit.js), applied before anything is drawn
  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Kartengröße" });

  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");

  const LEVELS = Object.entries(G.LEVELS).map(([v, name]) => [+v, name]);
  const GOALS = [[1, "Eine Runde"], [2, "Bis 2 Siege"], [3, "Bis 3 Siege"]];

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let R = null;           // last online room message
  let watching = false;   // in the waiting room, but watching the game that runs
  let V = null;           // view currently on screen
  let peek = false;       // round over, looking at the table
  let inflight = false;
  let server = null;      // server info once found ({} when only the WebSocket answered)
  let serverState = "checking"; // "checking" | "ok" | "none"
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "explodingkittens.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let goalLocal = G.normGoal(store.get(K.goal) || 1), levelLocal = G.normLevel(store.get(K.level) || 2);
  let lastTurn = null, confettiFor = null;
  let sel = null;         // the kind of card tapped in my hand
  let pick = null;        // { c, n, name, target } a played card that still needs a person
  let selfSrc = null;     // where my own dragged card was let go, so its flight starts there
  let trackHand = [];     // my hand as last known
  let dealPending = false, deckShake = false;
  let placeAt = 0, placeSent = "", placeInit = "";
  let stackKey = "", stackEnds = 0, prevStack = null;
  let reSeen = "", reAt = 0, reT = null; // when the round-end card may appear
  let naming = null;      // a triple waiting for the card the player wants

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const { toast, confetti, showBubble } = Spieleabend;
  const rectOf = Cards.rectOf;
  const remove1 = (a, c) => { const k = a.indexOf(c); if (k >= 0) a.splice(k, 1); };
  const mine = () => (V && V.me >= 0 ? V.players[V.me] : null);
  const isOut = () => { const m = mine(); return !m || m.out; };
  const count = (c) => (V && V.hand ? V.hand.filter((x) => x === c).length : 0);
  const pname = (i) => (i === V.me ? "Du" : V.players[i].name);
  const acc = (i) => (i === V.me ? "dich" : V.players[i].name);
  const verb = (i, a, b) => (i === V.me ? a : b);
  const actor = () => (!V ? -1 : V.phase === "place" ? V.place.pi : V.phase === "give" ? V.give.from : V.phase === "roundEnd" ? -1 : V.cur);
  const canAct = () => !!V && V.phase === "play" && V.me >= 0 && V.cur === V.me && !isOut();
  const canGive = () => !!V && V.phase === "give" && V.give.from === V.me && !isOut();
  const canNope = () => !!V && V.phase === "stack" && !!V.stack && !isOut() && V.stack.last !== V.me && count("nope") > 0 && Date.now() < stackEnds;
  const validTargets = () => V.players.map((p, i) => i).filter((i) => i !== V.me && !V.players[i].out && V.players[i].handN > 0);

  const SHORT = { kitten: "Katze", defuse: "Entschärfen", nope: "Nö!", attack: "Angriff", skip: "Aussetzen", favor: "Gefallen", shuffle: "Mischen", future: "Zukunft",
    cat1: "Taco", cat2: "Melone", cat3: "Kartoffel", cat4: "Regenbogen", cat5: "Bart" };

  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound,
    effects: ({ tone, noise }) => ({
      place: () => { noise(0, 0.07, 0.22, 2400); tone(520, 0, 0.07, "triangle", 0.1, 380); },
      deal: () => { noise(0, 0.12, 0.16, 3200); tone(700, 0.02, 0.06, "sine", 0.06, 500); },
      shuffle: () => { for (let i = 0; i < 6; i++) noise(i * 0.06, 0.06, 0.16, 1800 + i * 200); },
      boom: () => { noise(0, 0.5, 0.5, 400); tone(110, 0, 0.5, "sawtooth", 0.2, 40); tone(70, 0.05, 0.6, "square", 0.12, 30); },
      nope: () => { tone(420, 0, 0.08, "square", 0.1, 300); tone(300, 0.09, 0.16, "square", 0.1, 200); },
      defuse: () => [440, 554, 659, 880].forEach((f, i) => tone(f, i * 0.07, 0.14, "triangle", 0.13)),
      zap: () => { tone(900, 0, 0.18, "sawtooth", 0.07, 300); },
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16))
    })
  });

  // ---------- cards ----------
  function cardHTML(c, o = {}) {
    return `<div class="card k-${c}" data-c="${c}" data-i="${G.CARDS[c].icon}" title="${esc(G.cardName(c))}"${o.attrs ? " " + o.attrs : ""}${o.style ? ` style="${o.style}"` : ""}>` +
      `<b>${G.CARDS[c].icon}</b><span class="cn">${SHORT[c]}</span></div>`;
  }
  const backHTML = () => '<div class="card back"><b>🐱</b></div>';
  const pileCard = (inner, o = {}) => `<div class="cd-pile${o.empty ? " empty" : ""}" style="--H:1">${inner}${o.count ? `<span class="cnt">${o.count}</span>` : ""}</div>`;
  const setHTML = (el, html) => { if (el._h !== html) { el._h = html; el.innerHTML = html; return true; } return false; };

  // ---------- flights and feedback (every move is animated, also the computer's and other people's) ----------
  const seatEl = (pi) => document.querySelector(`#opps [data-seat="${pi}"]`);
  function fanRect(pi) {
    const seat = seatEl(pi); if (!seat) return null;
    const fan = seat.querySelector(".ofan"), first = fan && fan.querySelector(".card");
    const b = rectOf(fan || seat), w = first ? first.getBoundingClientRect().width || 24 : 24;
    return { left: b.left + b.width / 2 - w / 2, top: b.top + b.height / 2 - w * 0.7, width: w, height: w * 1.4 };
  }
  function handBoxRect() {
    const h = $("#hand"), b = rectOf(h), first = h.querySelector(".card"), w = first ? first.getBoundingClientRect().width : 56;
    return { left: b.left + b.width / 2 - w / 2, top: b.top + b.height / 2 - w * 0.7, width: w, height: w * 1.4 };
  }
  function myCardEl(c) {
    const el = $$("#hand .card").find((e) => e.dataset.c === c && !e.dataset.taken);
    if (el) el.dataset.taken = "1";
    return el;
  }
  // where a card of seat `pi` starts: my own card in the hand (or where I let go of it), somebody else's fan
  function srcRect(pi, c, me) {
    if (pi === me) {
      if (selfSrc) { const r = selfSrc; selfSrc = null; return r; }
      const el = myCardEl(c);
      return el ? rectOf(el) : handBoxRect();
    }
    return fanRect(pi);
  }
  const deckRect = () => { const e = $("#deck .card"); return e ? rectOf(e) : null; };

  function flash(emoji, big) {
    const old = $("#flash"); if (old) old.remove();
    const t = $("#table"); if (!t || $("#game").hidden) return;
    const r = t.getBoundingClientRect(), f = document.createElement("div");
    f.id = "flash"; f.textContent = emoji; if (big) f.className = "big";
    f.style.left = r.left + r.width / 2 + "px"; f.style.top = r.top + r.height / 2 + "px";
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1200);
  }

  function handleEvents(events, v) {
    if (!v || !events || !events.length) return;
    const me = v.me;
    let h = trackHand.slice(), t = 0;
    const later = (fn, ms) => (ms > 0 ? setTimeout(fn, ms) : fn());
    const name = (i) => (i === me ? "Du" : v.players[i].name);
    const hasDefuseNext = (k) => events.slice(k + 1).some((x) => x.t === "defuse");
    events.forEach((ev, k) => {
      if (ev.t === "start") { dealPending = true; h = []; trackHand = []; naming = null; pick = null; sel = null; placeAt = 0; }
      else if (ev.t === "draw") {
        const src = deckRect();
        if (ev.kitten) {
          if (ev.pi === me) h.push("kitten");
          const dst = hasDefuseNext(k) ? { k: "stack", i: 0 } : { k: "seat", pi: ev.pi };
          fl.add({ html: backHTML(), flipTo: cardHTML("kitten"), src, dst, delay: t, dur: 520 });
          later(() => { sfx("deal"); if (ev.pi === me) buzz(30); }, t);
          t += 560;
        } else if (ev.pi === me && v.hand) {
          const rest = h.slice(); let got = null;
          for (const c of v.hand) { const j = rest.indexOf(c); if (j >= 0) rest.splice(j, 1); else { got = c; break; } }
          if (got) { h.push(got); fl.add({ html: backHTML(), flipTo: cardHTML(got), src, dst: { k: "hand", c: got, nth: 0 }, delay: t, dur: 420 }); }
          later(() => sfx("deal"), t);
          t += 300;
        } else {
          fl.add({ html: backHTML(), src, dst: { k: "seat", pi: ev.pi }, delay: t, dur: 380 });
          later(() => sfx("deal"), t);
          t += 300;
        }
      } else if (ev.t === "defuse") {
        if (ev.pi === me) remove1(h, "defuse");
        fl.add({ html: cardHTML("defuse"), src: srcRect(ev.pi, "defuse", me), dst: { k: "disc" }, delay: t, dur: 450 });
        later(() => { sfx("defuse"); toast(ev.pi === me ? "Entschärft! Jetzt versteckst du die Katze." : `${name(ev.pi)} entschärft die Katze.`); }, t + 200);
        if (ev.pi === me) placeAt = Date.now() + (reduce.matches ? 0 : t + 1000);
        t += 500;
      } else if (ev.t === "boom") {
        const n = ev.pi === me ? Math.min(6, h.length) : Math.min(6, V && V.players[ev.pi] ? V.players[ev.pi].handN : 4);
        for (let i = 0; i < n; i++) {
          const c = ev.pi === me ? h[i] : null;
          fl.add({ html: c ? cardHTML(c) : backHTML(), src: ev.pi === me ? (myCardEl(c) ? rectOf($$("#hand .card").find((e) => e.dataset.taken && e.dataset.c === c)) : handBoxRect()) : fanRect(ev.pi), dst: { k: "disc" }, delay: t + 250 + i * 70, dur: 480 });
        }
        if (ev.pi === me) h = [];
        later(() => { flash("💥", true); sfx("boom"); buzz([80, 40, 120]); toast(ev.pi === me ? "BUMM! Du bist raus." : `BUMM! ${name(ev.pi)} ist raus.`); }, t + 100);
        t += 700;
      } else if (ev.t === "place") {
        fl.add({ html: cardHTML("kitten"), flipTo: backHTML(), src: (() => { const e = $("#stackCards .card"); return e ? rectOf(e) : null; })(), dst: { k: "deck" }, delay: t, dur: 520 });
        later(() => sfx("place"), t + 300);
        if (ev.pi !== me) later(() => toast(`${name(ev.pi)} versteckt die Katze im Stapel.`), t);
        placeAt = 0;
        t += 560;
      } else if (ev.t === "play" || ev.t === "combo") {
        const n = ev.t === "combo" ? ev.n : 1;
        for (let i = 0; i < n; i++) {
          if (ev.pi === me) remove1(h, ev.c);
          fl.add({ html: cardHTML(ev.c), src: srcRect(ev.pi, ev.c, me), dst: { k: "stack", i }, delay: t + i * 110, dur: 420 });
        }
        later(() => sfx("place"), t);
        t += 420 + (n - 1) * 110;
      } else if (ev.t === "nope") {
        if (ev.pi === me) remove1(h, "nope");
        fl.add({ html: cardHTML("nope"), src: srcRect(ev.pi, "nope", me), dst: { k: "nopes" }, delay: t, dur: 380 });
        later(() => { sfx("nope"); buzz(20); if (ev.pi !== me) bubble(ev.pi, "Nö!"); }, t + 100);
        t += 400;
      } else if (ev.t === "take") {
        const tx = v.txs.find((x) => x.k === ev.k), c = tx ? tx.c : null;
        if (ev.from === me && c) remove1(h, c);
        if (ev.to === me && c) h.push(c);
        const src = ev.from === me && c ? srcRect(me, c, me) : fanRect(ev.from);
        const dst = ev.to === me ? (c ? { k: "hand", c, nth: 0 } : { k: "seat", pi: me }) : { k: "seat", pi: ev.to };
        fl.add({ html: c ? cardHTML(c) : backHTML(), src, dst, delay: t, dur: 480 });
        later(() => sfx("deal"), t + 150);
        t += 520;
      } else if (ev.t === "attack") {
        later(() => { flash("⚔️"); sfx("zap"); toast(`${name(ev.pi)} ${verb(ev.pi, "greifst", "greift")} an! ${ev.to === me ? "Du musst" : `${name(ev.to)} muss`} zwei Züge machen.`); }, t);
      } else if (ev.t === "skip") {
        later(() => { flash("⏭️"); sfx("zap"); }, t);
      } else if (ev.t === "shuffle") {
        deckShake = true;
        later(() => { flash("🔀"); sfx("shuffle"); }, t);
      } else if (ev.t === "reshuffle") {
        deckShake = true; toast("Der Stapel war leer und wird neu gemischt.");
        later(() => sfx("shuffle"), t);
      } else if (ev.t === "future") {
        later(() => { flash("🔮"); if (ev.pi !== me) toast(`${name(ev.pi)} schaut in die Zukunft.`); }, t);
      } else if (ev.t === "favor") {
        later(() => flash("🎁"), t);
      } else if (ev.t === "steal") {
        if (ev.miss) later(() => toast(`${name(ev.pi)} ${verb(ev.pi, "hast", "hat")} danebengegriffen.`), t);
      } else if (ev.t === "fizzle") {
        later(() => { flash("🚫"); sfx("nope"); toast(ev.pi === me ? "Dein Zug wurde abgewehrt!" : `${name(ev.pi)} wurde abgewehrt!`); }, t);
      } else if (ev.t === "timeout") {
        toast(ev.pi === me ? "Zu langsam, das Spiel macht für dich weiter." : `${name(ev.pi)} war zu langsam.`);
      } else if (ev.t === "away") {
        toast(`${name(ev.pi)} wird übersprungen.`);
      } else if (ev.t === "end") {
        setTimeout(() => sfx("win"), 500);
      }
    });
    trackHand = v.hand ? v.hand.slice() : [];
  }

  // where a flight lands, looked up in the freshly drawn table: { rect, hide }
  function resolve(d) {
    if (d.k === "stack") { const e = $$("#stackCards .card")[d.i]; return e ? { rect: rectOf(e), hide: e } : null; }
    if (d.k === "nopes") { const e = $("#nopePile .card"); return e ? { rect: rectOf(e), hide: e } : null; }
    if (d.k === "disc") { const e = $("#disc .card"); return e ? { rect: rectOf(e), hide: e } : null; }
    if (d.k === "deck") { const e = $("#deck .card"); return e ? { rect: rectOf(e), hide: null } : null; }
    if (d.k === "hand") {
      const cards = $$("#hand .card").filter((e) => e.dataset.c === d.c), el = cards[cards.length - 1 - d.nth];
      return el ? { rect: rectOf(el), hide: el } : null;
    }
    if (d.k === "seat") {
      const r = V && d.pi === V.me ? handBoxRect() : fanRect(d.pi);
      return r ? { rect: r, hide: null } : null;
    }
    return null;
  }
  const fl = Cards.flights({
    resolve, off: () => $("#game").hidden,
    onLand(f) {
      if (f.dst.k !== "seat" || !V || f.dst.pi === V.me) return;
      const e = seatEl(f.dst.pi);
      if (e) { e.classList.remove("pulse"); void e.offsetWidth; e.classList.add("pulse"); }
    }
  });

  // ---------- actions ----------
  function localRun(fn) {
    const ticked = G.tick(L, Date.now()) || [];
    const res = fn();
    const ev = ticked.concat(res && res.ok ? res.events : []);
    if (ev.length) handleEvents(ev, G.view(L, 0));
    store.set(K.local, L);
    render();
    schedule();
    return res;
  }
  function doAct(a) {
    if (mode === "local") {
      const res = localRun(() => G.act(L, 0, a));
      if (!res.ok) { toast(res.error); sfx("bad"); return false; }
      return true;
    }
    if (mode === "online") {
      if (!wsSend({ t: "act", a })) { toast("Keine Verbindung zum Server."); return false; }
      inflight = true; setTimeout(() => { inflight = false; }, 2500);
      return true;
    }
    return false;
  }
  const send = (a, rect) => { selfSrc = rect || null; sel = null; pick = null; naming = null; buzz(10); const ok = doAct(a); if (!ok) selfSrc = null; paintSel(); return ok; };

  function draw() {
    if (!canAct()) { toast(!V || V.me < 0 ? "Du schaust zu." : isOut() ? "Du bist raus." : "Du bist gerade nicht dran."); return; }
    if (inflight) return;
    send({ t: "draw" });
  }
  function nope(rect) {
    if (!canNope()) { toast(count("nope") ? "Dafür ist es zu spät." : "Du hast kein „Nö!“."); return false; }
    return send({ t: "nope" }, rect);
  }
  function giveCard(c, rect) {
    if (!canGive()) return false;
    return send({ t: "give", c }, rect);
  }
  // play card c n times (n > 1: a cat pair or triple); target = a seat, or -1 to find one
  function start(c, n, target, rect) {
    if (!canAct()) { toast(isOut() ? "Du bist raus." : V.me < 0 ? "Du schaust zu." : "Du bist gerade nicht dran."); return false; }
    if (inflight) return false;
    return proceed({ c, n, name: "", target }, rect);
  }
  function proceed(p, rect) {
    if (p.n === 3 && !p.name) { naming = p; pick = null; $("#nameSheet").hidden = false; paintSel(); return false; }
    if (G.needsTarget(p.c, p.n) && p.target < 0) {
      const ts = validTargets();
      if (!ts.length) { toast("Alle anderen haben keine Karten."); sfx("bad"); return false; }
      if (ts.length === 1) p.target = ts[0];
      else { pick = p; paintSel(); renderDock(); toast("Tippe auf eine Person."); return false; }
    }
    const a = p.n > 1 ? { t: "combo", c: p.c, n: p.n, target: p.target, name: p.name } : { t: "play", c: p.c };
    if (p.n === 1 && G.needsTarget(p.c, 1)) a.target = p.target;
    return send(a, rect);
  }
  // card c was dropped or chosen: what does it do right now?
  function useCard(c, seat, rect) {
    if (V.phase === "stack") return c === "nope" ? nope(rect) : (toast("Gerade kannst du nur „Nö!“ sagen."), false);
    if (V.phase === "give") return giveCard(c, rect);
    if (c === "nope") { toast("„Nö!“ sagst du, wenn jemand anderes eine Karte spielt."); return false; }
    if (G.isCat(c)) {
      if (count(c) < 2) { toast("Katzenkarten gehen nur zu zweit oder zu dritt."); return false; }
      return start(c, 2, seat, rect);
    }
    if (c === "defuse") { toast("Entschärfen brauchst du automatisch, wenn du eine Katze ziehst."); return false; }
    return start(c, 1, seat, rect);
  }

  // ---------- selection, tap and drag ----------
  const seatOk = (c, seat) => {
    if (V.phase === "give") return seat === V.give.to;
    if (V.phase !== "play") return false;
    return (c === "favor" || (G.isCat(c) && count(c) >= 2)) && validTargets().includes(seat);
  };
  const tableOk = (c) => {
    if (V.phase === "give") return true;
    if (V.phase === "stack") return c === "nope";
    if (V.phase !== "play") return false;
    if (G.ACTIONS.includes(c)) return c !== "favor" || validTargets().length === 1;
    return G.isCat(c) && count(c) >= 2 && validTargets().length === 1;
  };
  const grabbable = (c) => {
    if (!V) return false;
    if (V.phase === "stack") return c === "nope" && canNope();
    if (V.phase === "give") return canGive();
    if (!canAct()) return false;
    return G.ACTIONS.includes(c) || (G.isCat(c) && count(c) >= 2);
  };

  function paintSel() {
    for (const e of $$("#hand .card.sel")) e.classList.remove("sel");
    if (!V) return;
    const c = dnd.src ? dnd.src.c : pick ? pick.c : sel;
    if (sel && !dnd.src) for (const e of $$("#hand .card")) if (e.dataset.c === sel) e.classList.add("sel");
    $("#table").classList.toggle("cd-drop", !!c && !pick && tableOk(c));
    const seats = pick ? validTargets() : null;
    for (const e of $$("#opps .obox")) { const i = +e.dataset.seat; e.classList.toggle("cd-drop", !!c && (pick ? seats.includes(i) : seatOk(c, i))); }
    paintActs();
  }

  const dnd = Cards.dnd({
    root: "#game",
    grab(e) {
      const el = e.target.closest("#hand .card");
      return el && grabbable(el.dataset.c) ? { el, c: el.dataset.c } : null;
    },
    onStart() { sel = null; pick = null; paintSel(); },
    target(el, s) {
      const box = el.closest("#opps .obox");
      if (box) { const seat = +box.dataset.seat; return { el: box, seat, ok: seatOk(s.c, seat) }; }
      const tb = el.closest("#table");
      return tb ? { el: tb, ok: tableOk(s.c) } : null;
    },
    drop(s, t, rect) {
      if (!t.ok) {
        if (V.phase === "play" && (s.c === "favor" || G.isCat(s.c)) && t.seat == null) toast("Zieh die Karte auf eine Person.");
        else if (t.seat != null) toast("Diese Person hat keine Karten.");
        return false;
      }
      return useCard(s.c, t.seat != null ? t.seat : -1, rect);
    },
    onEnd(dirty) { if (dirty) render(); else paintSel(); },
    tap: (e) => onTap(e)
  });

  function onTap(e) {
    if (!V) return;
    const cardEl = e.target.closest("#hand .card"), box = e.target.closest("#opps .obox"), deck = e.target.closest("#deck"), table = e.target.closest("#table");
    if (cardEl) {
      const c = cardEl.dataset.c;
      if (V.phase === "stack") { if (c === "nope") nope(); else toast("Gerade kannst du nur „Nö!“ sagen."); return; }
      if (V.phase === "give" && !canGive()) { toast(V.me < 0 ? "Du schaust zu." : `${pname(V.give.from)} muss erst eine Karte geben.`); return; }
      if (V.phase === "play" && !canAct()) { toast(V.me < 0 ? "Du schaust zu." : isOut() ? "Du bist raus." : `Warte, ${V.players[V.cur].name} ist dran.`); return; }
      if (V.phase === "roundEnd" || V.phase === "place") return;
      if (sel === c && !pick) { activate(); return; }
      pick = null; sel = c; paintSel(); sfx("pop"); buzz(8); renderDock();
      if (V.phase === "play") {
        if (G.isCat(c) && count(c) < 2) toast("Katzen gehen nur zu zweit (zwei gleiche) oder zu dritt.");
        else if (c === "nope") toast("„Nö!“ sagst du, wenn jemand anderes eine Karte spielt.");
        else if (c === "defuse") toast("Entschärfen brauchst du automatisch, wenn du eine Katze ziehst.");
      }
      return;
    }
    if (box) {
      const seat = +box.dataset.seat;
      if (pick) {
        if (!validTargets().includes(seat)) { toast("Diese Person hat keine Karten."); return; }
        pick.target = seat; proceed(pick); return;
      }
      if (sel && V.phase === "give" && canGive()) { if (seat === V.give.to) giveCard(sel); return; }
      if (sel && V.phase === "play" && canAct() && seatOk(sel, seat)) { useCard(sel, seat); return; }
      if (sel && V.phase === "play") toast("Auf diese Person kannst du die Karte nicht spielen.");
      return;
    }
    if (deck) { if (V.phase === "play") draw(); return; }
    if (table && sel && !pick) {
      if (V.phase === "play" && canAct()) activate();
      else if (V.phase === "give" && canGive()) giveCard(sel);
    }
  }
  // second tap or the button: play the chosen card
  function activate(n) {
    const c = sel; if (!c || !V) return;
    if (V.phase === "give") { giveCard(c); return; }
    if (V.phase === "stack") { if (c === "nope") nope(); return; }
    if (G.isCat(c) && n) { start(c, n, -1); return; }
    useCard(c, -1);
  }

  $("#drawBtn").addEventListener("click", draw);
  $("#playBtn").addEventListener("click", () => activate());
  $("#pairBtn").addEventListener("click", () => activate(2));
  $("#tripBtn").addEventListener("click", () => activate(3));
  $("#giveBtn").addEventListener("click", () => activate());
  $("#nopeBtn").addEventListener("click", () => nope());
  $("#cancelBtn").addEventListener("click", () => { sel = null; pick = null; naming = null; $("#nameSheet").hidden = true; paintSel(); renderDock(); });
  $("#resultBtn").addEventListener("click", () => { peek = false; render(); });

  // name sheet for the triple
  $("#nameGrid").innerHTML = Object.keys(G.CARDS).filter((c) => c !== "kitten").map((c) => `<button type="button" data-c="${c}"><span>${G.CARDS[c].icon}</span>${SHORT[c]}</button>`).join("");
  $("#nameGrid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-c]"); if (!b || !naming) return;
    const p = naming; p.name = b.dataset.c; naming = null; $("#nameSheet").hidden = true;
    proceed(p);
  });
  $("#nameCancel").addEventListener("click", () => { naming = null; $("#nameSheet").hidden = true; });

  // place sheet: where the defused kitten goes back into the deck
  const posLabel = (p, n) => (p === 0 ? "Ganz oben: die nächste Karte!" : p >= n ? "Ganz unten" : `Als ${p + 1}. Karte von oben`);
  const posRange = $("#posRange");
  posRange.addEventListener("input", () => { $("#posLab").textContent = posLabel(+posRange.value, +posRange.max); });
  $("#placeSheet .presets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]"); if (!b) return;
    const n = +posRange.max, p = b.dataset.p;
    posRange.value = p === "top" ? 0 : p === "bot" ? n : p === "mid" ? Math.floor(n / 2) : Math.floor(Math.random() * (n + 1));
    posRange.dispatchEvent(new Event("input"));
  });
  $("#placeBtn").addEventListener("click", () => {
    if (!V || V.phase !== "place" || V.place.pi !== V.me) return;
    placeSent = `${V.round}:${V.mv}`;
    $("#placeSheet").hidden = true;
    if (!send({ t: "place", pos: +posRange.value })) { placeSent = ""; renderPlace(); }
  });
  function renderPlace() {
    const show = !!V && V.phase === "place" && V.place.pi === V.me && placeSent !== `${V.round}:${V.mv}` && Date.now() >= placeAt;
    if (V && V.phase === "place" && V.place.pi === V.me && Date.now() < placeAt) setTimeout(() => { if (V && V.phase === "place") renderPlace(); }, placeAt - Date.now() + 20);
    $("#placeSheet").hidden = !show;
    if (show) {
      const key = `${V.round}:${V.mv}`;
      if (placeInit !== key) {
        placeInit = key;
        posRange.max = V.deckN; posRange.value = Math.floor(V.deckN / 2);
        $("#posLab").textContent = posLabel(+posRange.value, V.deckN);
      }
    }
  }

  // keys: space draws, N says "Nö!", Esc closes
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, button") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") {
      const open = ["#nameSheet", "#menu", "#reactBar"].find((s) => !$(s).hidden);
      if (open) { $(open).hidden = true; if (open === "#nameSheet") naming = null; }
      else if (sel || pick) { sel = null; pick = null; paintSel(); renderDock(); }
      return;
    }
    if (!V || $("#game").hidden || !$("#roundEnd").hidden || ["#menu", "#placeSheet", "#nameSheet"].some((s) => !$(s).hidden)) return;
    const k = e.key.toLowerCase();
    if ((k === " " || k === "d") && V.phase === "play" && canAct()) { e.preventDefault(); draw(); }
    else if (k === "n" && V.phase === "stack" && canNope()) { e.preventDefault(); nope(); }
  });

  // ---------- the computer in single player (online the server moves it) ----------
  let botT = null, tickT = null;
  function scheduleBot() {
    clearTimeout(botT);
    const plan = mode === "local" && L ? G.botPlan(L) : null;
    if (!plan) return;
    botT = setTimeout(() => {
      if (mode !== "local" || !L) return;
      if (!$("#menu").hidden || dnd.busy) { scheduleBot(); return; } // paused while the menu is open
      const again = G.botPlan(L);
      if (!again || again.key !== plan.key) { scheduleBot(); return; }
      const a = G.botMove(L, plan.pi);
      if (a) localRun(() => G.act(L, plan.pi, a)); else scheduleBot();
    }, plan.delay);
  }
  // the window for "Nö!" closes by itself
  function scheduleTick() {
    clearTimeout(tickT);
    const d = mode === "local" && L ? G.nextDeadline(L) : -1;
    if (d < 0) return;
    tickT = setTimeout(() => {
      if (mode !== "local" || !L) return;
      if (!$("#menu").hidden || dnd.busy) { scheduleTick(); return; }
      localRun(() => ({ ok: false }));
    }, d + 15);
  }
  function schedule() { scheduleBot(); scheduleTick(); }
  function stopLocal() { clearTimeout(botT); clearTimeout(tickT); }

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
      if (!R.view || (waiting && !watching)) { V = null; showScreen("lobby"); UI.renderLobby(); $("#roundEnd").hidden = true; $("#placeSheet").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else {
      V = null;
      $("#roundEnd").hidden = true; $("#placeSheet").hidden = true;
      showScreen("home"); renderHome();
    }
    UI.update();
  }

  function oppHTML(i) {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = !!(members && members[i] && !members[i].online && !p.bot);
    const act = actor() === i;
    const cls = ["obox", act ? "active" : "", away ? "away" : "", p.out ? "out" : ""].join(" ");
    const fan = p.out ? "" : Array.from({ length: Math.min(p.handN, 7) }, () => '<div class="card back"></div>').join("");
    const tag = p.out ? "raus" : act && V.phase === "play" && V.owed > 1 ? `${V.owed} Züge` : away ? "offline" : "";
    return `<div class="${cls}" data-seat="${i}"><div class="ohead"><span class="pav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="pname">${esc(p.name)}${p.bot ? " 🤖" : ""}</span><span class="owins" title="Siege">${p.wins}</span></div>` +
      `<div class="orow"><span class="ofan">${fan}</span><span class="ocnt">${p.out ? "" : p.handN}</span><span class="otag">${tag}</span></div>${p.out ? '<span class="boom">💥</span>' : ""}</div>`;
  }

  // the cards that were just played: they stay in the middle until the "Nö!" window is over
  function stackHTML() {
    const st = V.stack;
    let cards = [];
    if (st) cards = Array.from({ length: st.n }, () => st.c);
    else if (V.phase === "place") cards = ["kitten"];
    if (!cards.length) return '<div class="slot-empty">Hier landen<br>gespielte Karten</div>';
    const nopes = st && st.nopes ? `<div class="nopepile" id="nopePile">${cardHTML("nope")}<span class="cnt">×${st.nopes}</span></div>` : "";
    return `<div class="stackcards" id="stackCards">${cards.map((c) => cardHTML(c)).join("")}</div>${nopes}`;
  }

  function stackLine() {
    const st = V.stack;
    if (!st) return "";
    const name = st.n > 1 ? `${st.n}× ${G.cardName(st.c)}` : G.cardName(st.c);
    let t = `${pname(st.pi)} ${verb(st.pi, "spielst", "spielt")} ${name}`;
    if (st.target >= 0) t += ` gegen ${acc(st.target)}`;
    if (st.n === 3 && st.name) t += ` und ${verb(st.pi, "willst", "will")} „${G.cardName(st.name)}“`;
    const cancelled = st.nopes % 2 === 1;
    return `${esc(t)}<small>${cancelled ? '<span class="warn">Abgewehrt!</span> Außer jemand sagt noch ein „Nö!“.' : "Jemand kann „Nö!“ sagen …"}</small>`;
  }

  function renderStackBar() {
    const bar = $("#stackBar"), st = V.stack;
    if (V.phase !== "stack" || !st) { bar.hidden = true; stackKey = ""; return; }
    bar.hidden = false;
    const key = `${V.round}:${V.mv}:${st.nopes}`;
    if (key === stackKey) return;
    stackKey = key; stackEnds = Date.now() + st.left;
    const total = st.nopes ? G.NOPE_MS : G.WINDOW_MS, i = bar.firstElementChild;
    i.getAnimations().forEach((a) => a.cancel());
    i.animate([{ transform: `scaleX(${Math.min(1, st.left / total)})` }, { transform: "scaleX(0)" }], { duration: Math.max(1, st.left), easing: "linear", fill: "forwards" });
    setTimeout(() => { if (stackKey === key) paintActs(); }, st.left + 30);
  }

  function renderClock() {
    const bar = $("#turnBar"), left = mode === "online" && R ? R.turnLeft : 0;
    if (!left || !V || V.phase === "stack" || V.phase === "roundEnd") { bar.hidden = true; renderClock.key = null; return; }
    const key = `${V.round}:${V.mv}`;
    if (renderClock.key === key) return;
    renderClock.key = key; bar.hidden = false;
    const i = bar.firstElementChild;
    bar.classList.remove("low");
    i.getAnimations().forEach((a) => a.cancel());
    i.animate([{ transform: `scaleX(${left / G.TURN_MS})` }, { transform: "scaleX(0)" }], { duration: left, easing: "linear", fill: "forwards" });
    clearTimeout(renderClock.t);
    renderClock.t = setTimeout(() => { if (renderClock.key === key) { bar.classList.add("low"); if (actor() === V.me) { toast("Noch 10 Sekunden!"); buzz(80); } } }, Math.max(0, left - 10000));
  }

  function fitHand() {
    const hand = $("#hand"), cards = hand.children, n = cards.length;
    if (!n || !hand.clientWidth) return;
    const w = cards[0].getBoundingClientRect().width, avail = hand.clientWidth - 8;
    const ov = n > 1 ? Math.max(-w * 0.72, Math.min(6, (avail - n * w) / (n - 1))) : 0;
    hand.style.setProperty("--ov", ov.toFixed(1) + "px");
  }
  window.addEventListener("resize", () => { if (V) fitHand(); });

  function renderGame() {
    if (V.phase !== "roundEnd") peek = false;
    if (sel && !V.hand.includes(sel)) sel = null;
    if (pick && (V.phase !== "play" || !V.hand.includes(pick.c))) pick = null;
    if (naming && V.phase !== "play") { naming = null; $("#nameSheet").hidden = true; }
    const m = mine(), play = canAct();
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> · ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}`;

    // the cards that were in the middle go to the discard pile
    if (prevStack && prevStack.round === V.round && !V.stack) {
      const els = [...$$("#stackCards .card"), ...$$("#nopePile .card")];
      els.forEach((e, i) => fl.add({ html: cardHTML(e.dataset.c), src: rectOf(e), dst: { k: "disc" }, delay: 120 + i * 60, dur: 420 }));
      if (els.length) setTimeout(() => sfx("place"), 300);
    }
    prevStack = V.stack ? { round: V.round } : null;

    // opponents
    const opps = V.players.map((_, i) => i).filter((i) => i !== V.me);
    $("#opps").innerHTML = opps.map(oppHTML).join("");

    // table
    const dn = V.deckN, pct = dn ? Math.round((V.kn / dn) * 100) : 0;
    setHTML($("#deck"), dn ? pileCard(backHTML().replace('class="card back"', 'class="card back" style="--i:0;--f:0"'), { count: dn }) : pileCard("", { empty: true }));
    $("#deck").className = "deck";
    if (deckShake) { deckShake = false; $("#deck").animate([{ transform: "rotate(-6deg)" }, { transform: "rotate(6deg)" }, { transform: "rotate(-4deg)" }, { transform: "none" }], { duration: 420 }); }
    setHTML($("#stackZone"), stackHTML());
    const discFace = V.discN ? (V.phase === "stack" ? '<div class="card pile" style="--i:0;--f:0"><b>🗑️</b></div>' : cardHTML(V.discTop, { style: "--i:0;--f:0" })) : "";
    setHTML($("#disc"), pileCard(discFace, { count: V.discN || "", empty: !V.discN }));
    $("#danger").innerHTML = V.phase === "roundEnd" ? "" : `💣 <b>${V.kn}</b> im Stapel · Gefahr <b>${pct} %</b>`;
    $("#danger").classList.toggle("hot", pct >= 34);
    $("#stackInfo").innerHTML = V.phase === "stack" ? stackLine() : V.phase === "place" && V.place.pi !== V.me ? "" : "";
    renderStackBar();

    // cards seen with "Zukunft"
    const pk = $("#peek"), pkKey = V.peek && V.phase !== "roundEnd" ? `${V.round}:${V.peek.join(",")}` : "";
    pk.hidden = !pkKey;
    if (pk.dataset.k !== pkKey) {
      pk.dataset.k = pkKey;
      pk.innerHTML = pkKey ? `<span>Oben</span><div class="cards">${V.peek.map((c) => cardHTML(c)).join("")}</div>` : "";
    }

    // my hand
    const hand = $("#hand");
    hand.classList.toggle("empty", !V.hand || !V.hand.length);
    hand.hidden = !V.hand;
    if (V.hand) { setHTML(hand, V.hand.map((c) => cardHTML(c)).join("")); fitHand(); }
    if (dealPending && V.phase !== "roundEnd") queueDeal();
    trackHand = V.hand ? V.hand.slice() : [];

    // log
    const lmEl = $("#lastMove"), lines = V.log.slice(-2), lmKey = lines.join("\n");
    if (lmEl.dataset.k !== lmKey) {
      lmEl.dataset.k = lmKey;
      lmEl.innerHTML = lines.map((l, i) => `<div${i < lines.length - 1 ? ' class="old"' : ""}>${esc(l)}</div>`).join("");
      lmEl.classList.remove("fresh"); void lmEl.offsetWidth; lmEl.classList.add("fresh");
    }

    renderDock();
    renderClock();
    $("#reactBtn").hidden = mode !== "online";
    renderPlace();

    // turn change feedback
    const key = `${V.round}:${V.turn}:${V.owed}`;
    if (play && lastTurn !== key && lastTurn !== null && (mode === "online" || V.players.some((p) => p.bot))) { buzz([40, 60, 40]); sfx("turn"); }
    lastTurn = play ? key : (lastTurn === null ? "" : lastTurn);
    if (!play && V.phase === "play") lastTurn = lastTurn === null ? "" : lastTurn;

    // the result card waits until the last cards have landed
    let showEnd = V.phase === "roundEnd" && !peek;
    if (showEnd) {
      const rk = `${V.round}:${V.last.winners}:${V.mv}`;
      if (reSeen !== rk) { reSeen = rk; reAt = Date.now() + (reduce.matches ? 0 : 1600); }
      const wait = reAt - Date.now();
      if (wait > 0) { showEnd = false; clearTimeout(reT); reT = setTimeout(render, wait + 20); }
    }
    $("#roundEnd").hidden = !showEnd;
    if (V.phase === "roundEnd") {
      if (showEnd) renderRoundEnd();
      const k = `${V.round}:${V.last.winners.join(",")}:${V.players.map((p) => p.wins).join(",")}`;
      if (confettiFor !== k) {
        confettiFor = k; record(k);
        setTimeout(() => confetti(), 900);
      }
    }
    paintSel();
    fl.hide();
    fl.run();
  }

  function queueDeal() {
    dealPending = false;
    const src = deckRect(); if (!src) return;
    const cards = $$("#hand .card"), others = V.players.map((_, i) => i).filter((i) => i !== V.me && !V.players[i].out);
    sfx("shuffle");
    let t = 250, n = 0;
    cards.forEach((el, i) => {
      const c = el.dataset.c, nth = cards.slice(i + 1).filter((x) => x.dataset.c === c).length;
      fl.add({ html: backHTML(), flipTo: cardHTML(c), src, dst: { k: "hand", c, nth }, delay: t + i * 85, dur: 420 });
      if (i % 2 === 0) setTimeout(() => sfx("deal"), t + i * 85);
      n = i;
    });
    others.forEach((pi, k) => { for (let j = 0; j < 4; j++) fl.add({ html: backHTML(), src, dst: { k: "seat", pi }, delay: t + (k * 4 + j) * 70, dur: 380 }); });
  }

  // dock: who is up, what can be done
  function renderDock() {
    const play = canAct(), give = canGive(), m = mine();
    let who = "", hint = "", av = "";
    if (V.phase === "roundEnd") {
      const w = V.last.winners[0];
      who = `${pname(w)} ${verb(w, "gewinnst", "gewinnt")}`;
      av = V.players[w].avatar;
      hint = "Letzte Überlebende, Runde vorbei.";
    } else if (!V.hand) {
      const a = actor();
      av = V.players[a] ? V.players[a].avatar : "";
      who = V.players[a] ? `${V.players[a].name} ist dran` : "";
      hint = "Du schaust zu.";
    } else if (m && m.out) {
      const a = actor();
      av = "💥"; who = "Du bist raus";
      hint = V.players[a] ? `Schau zu: ${V.players[a].name} ist dran.` : "Schau zu.";
    } else if (V.phase === "stack") {
      const st = V.stack;
      av = V.players[st.pi].avatar; who = `${pname(st.pi)} ${verb(st.pi, "spielst", "spielt")} ${G.cardName(st.c)}`;
      hint = canNope() ? "Tippe auf „Nö!“, um es abzuwehren." : st.last === V.me ? "Du hast schon „Nö!“ gesagt." : count("nope") ? "Zu spät für ein „Nö!“." : "Du hast kein „Nö!“.";
    } else if (V.phase === "give") {
      const f = V.give.from;
      av = V.players[f].avatar;
      if (give) { who = "Gib eine Karte"; hint = `${V.players[V.give.to].name} hat einen Gefallen verlangt. Wähle eine Karte aus.`; }
      else { who = `${pname(f)} ${verb(f, "gibst", "gibt")} eine Karte`; hint = V.give.to === V.me ? "Du bekommst gleich eine Karte." : "Warte kurz."; }
    } else if (V.phase === "place") {
      const p = V.place.pi;
      av = V.players[p].avatar;
      who = p === V.me ? "Versteck die Katze" : `${V.players[p].name} versteckt die Katze`;
      hint = p === V.me ? "Wähle im Fenster, wohin sie kommt." : "Niemand weiß, wo.";
    } else {
      const P = V.players[V.cur];
      av = P.avatar;
      if (play) {
        who = V.owed > 1 ? `Du bist dran (${V.owed} Züge)` : "Du bist dran";
        hint = pick ? "Tippe auf eine Person." : sel ? "Nochmal tippen oder auf den Tisch ziehen." : "Spiele Karten oder ziehe vom Stapel.";
      } else {
        who = `${P.name} ist dran${V.owed > 1 ? ` (${V.owed} Züge)` : ""}`;
        hint = P.bot ? "Der Computer überlegt …" : "Warte auf den nächsten Zug.";
      }
    }
    $("#whoAv").textContent = av;
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    $("#dock").classList.toggle("myturn", !!V.hand && actor() === V.me && !isOut() && V.phase !== "stack");
    $("#keys").innerHTML = play ? "<kbd>Leertaste</kbd> ziehen · Karte antippen oder auf den Tisch ziehen" : canNope() ? "<kbd>N</kbd> sagt „Nö!“" : "";
    paintActs();
  }

  function paintActs() {
    if (!V) return;
    const play = canAct(), give = canGive(), nope_ = canNope(), watch = !V.hand || isOut();
    const c = sel;
    $("#drawBtn").hidden = !(V.phase === "play" && !watch);
    $("#drawBtn").disabled = !play;
    $("#nopeBtn").hidden = !(V.phase === "stack" && !watch && count("nope") > 0);
    $("#nopeBtn").disabled = !nope_;
    $("#playBtn").hidden = !(play && c && !G.isCat(c) && c !== "nope" && c !== "defuse" && !pick);
    if (c) $("#playBtn").textContent = `${G.cardName(c)} spielen`;
    $("#pairBtn").hidden = !(play && c && G.isCat(c) && count(c) >= 2 && !pick);
    $("#tripBtn").hidden = !(play && c && G.isCat(c) && count(c) >= 3 && !pick);
    $("#giveBtn").hidden = !(give && c);
    if (c) $("#giveBtn").textContent = `${SHORT[c]} geben`;
    $("#cancelBtn").hidden = !(pick || (c && (play || give)));
    $("#resultBtn").hidden = !(V.phase === "roundEnd" && peek);
  }

  // ---------- reactions (online) ----------
  const hasEmoji = (s) => /\p{Extended_Pictographic}/u.test(s);
  function bubble(pi, e, who) {
    const host = pi >= 0 && V && pi !== V.me ? seatEl(pi) : $("#dock");
    if (!host) return;
    const b = document.createElement("span");
    b.className = "bubble" + (hasEmoji(e) ? "" : " say"); b.textContent = pi < 0 && who ? `${who}: ${e}` : e;
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
      const info = p.out ? "💥 raus" : V.phase === "roundEnd" ? "übrig" : `${p.handN} Karten`;
      return `<li class="${winners.includes(i) ? "win" : ""}"><span>${avi(p.avatar)}${esc(p.name)}${you}<small>${info}</small></span>` +
        `<b>${p.wins} ${p.wins === 1 ? "Sieg" : "Siege"}</b></li>`;
    }).join("");
  }

  function renderRoundEnd() {
    const last = V.last, w = last.winners[0];
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round} vorbei`;
    $("#reTitle").textContent = `${w === V.me ? "Du gewinnst" : `${V.players[w].name} gewinnt`} ${last.over ? "das Spiel" : "die Runde"}!`;
    $("#reText").textContent = `${w === V.me ? "Du bist" : `${V.players[w].name} ist`} als Letzte(r) übrig geblieben. Im Stapel waren noch ${last.left} Karten.` +
      (last.over ? "" : ` Gespielt wird bis ${V.goal} Siege, als Nächstes beginnt ${V.players[V.nextStarter].name}.`);
    scoreList($("#reScores"), last.winners);
    UI.roundEndFooter({ over: last.over, next: "Nächste Runde" });
  }

  // Statistik lebt im Profil (shared/profile.js, gilt für alle Spiele)
  const profile = Spieleabend.profile;
  function record(key) {
    const i = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
    if (i < 0) return;
    profile.result("explodingkittens", key, { won: V.last.winners.includes(i), draw: !V.last.winners.length, online: mode === "online" });
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
      error(m) { inflight = false; if (V) render(); },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text, name) => bubble(pi, text, name),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    // the settings the host picks in the waiting room; everyone sees them
    renderSettings(host) {
      for (const [id, list, cur] of [["#goalOnline", GOALS, R.goal], ["#levelOnline", LEVELS, R.level || 2]]) {
        const el = $(id), k = cur + ":" + host;
        if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = segHTML(list, cur); for (const b of el.children) b.disabled = !host; }
      }
    },
    menu: {
      open() {
        LOOK.render();
        if (V) scoreList($("#menuScores"), []);
        $("#menuRules").textContent = V ? `Gespielt wird ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}.` : "";
      },
      local(box) {
        box.append(
          UI.armed("Runde neu starten", () => { L.round--; L.starter = (L.starter + L.players.length - 1) % L.players.length; G.startRound(L); peek = false; sel = null; pick = null; dealPending = true; store.set(K.local, L); render(); schedule(); }),
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; stopLocal(); render(); })
        );
      },
      player() {},
      skip: (v) => ["play", "give", "place"].includes(v.phase) && actor() !== v.me && !!v.players[actor()] && !v.players[actor()].bot
    }
  });
  function wsSend(m) { return UI.send(m); }

  // avatar picker on the start screen
  Spieleabend.avatarPicker({ avatars: G.AVATARS, get: () => myAvatar, set: (a) => { myAvatar = a; store.set(K.avatar, a); } });

  // ---------- start screen ----------
  for (const [id, key] of [["goal", "goal"], ["level", "level"]]) {
    $(`#${id}Online`).addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", [key]: +b.dataset.v }); });
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

  function startLocal(state, fresh) {
    L = state; mode = "local"; peek = false; sel = null; pick = null; naming = null; trackHand = []; prevStack = null; stackKey = ""; placeAt = 0; fl.clear();
    dealPending = !!fresh;
    store.set(K.local, L); render(); wake(); schedule();
    if (!fresh) localRun(() => ({ ok: false })); // a window that ran out while the page was closed
  }
  $("#startLocal").addEventListener("click", () => {
    const { names, bots } = HOME.roster($("#myName").value);
    const list = names.map((name, i) => ({ name, bot: bots[i], avatar: bots[i] ? G.BOT_AVATAR : myAvatar }));
    startLocal(G.newGame(list, goalLocal, levelLocal), true);
  });
  $("#resumeBtn").addEventListener("click", () => {
    const s = store.get(K.local); if (!s) return render();
    startLocal(s, false);
  });

  // ---------- round end ----------
  $("#reBtn").addEventListener("click", () => { peek = false; doAct({ t: "next" }); });
  $("#reLook").addEventListener("click", () => { peek = true; render(); });
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; stopLocal(); render(); }
    else if (R && R.members[R.you] && R.members[R.you].lobby) { watching = false; render(); }
    else if (V && V.phase === "roundEnd" && V.last && V.last.over) wsSend({ t: "lobby" });
    else wsSend({ t: "end" });
  });

  // keep the screen on while playing (needs HTTPS; silently skipped otherwise)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (mode) wake();
    if (mode === "local" && L) schedule();
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- boot ----------
  const code = UI.roomCode();
  render();
  if (webHost && (store.get(K.online) && !code)) UI.resume();
  UI.detectServer("/explodingkittens-server", "explodingkittens").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
