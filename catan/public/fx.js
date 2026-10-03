// Catan: turns the engine's events into things you see and hear, one after the other.
// The state is already final when events arrive; this queue only paces dice, card flights and banners.
(() => {
  "use strict";
  const G = window.CatanGame, B = window.CatanBoard;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const EMO = { wood: "🌲", brick: "🧱", sheep: "🐑", wheat: "🌾", ore: "⛰️" };
  const CARD = "🂠";
  let ctx = null, queue = [], running = false, timer = null;
  const idleCbs = [];
  const wait = (ms, fn) => setTimeout(fn, ms);
  const who = (v, i) => (i === v.me ? "Du" : v.players[i].name);
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function dieHTML(value, cls) {
    let pips = "";
    for (let i = 0; i < 9; i++) pips += `<i${(PIPS[value] || []).includes(i) ? ' class="on"' : ""}></i>`;
    return `<div class="die ${cls || ""}" aria-label="${value ? "Würfel zeigt " + value : "Würfel"}">${pips}</div>`;
  }
  function drawDice(d, tumble) {
    const el = $("#dice"); if (!el) return;
    const k = d ? d.join() + (tumble ? "t" : "") : "";
    if (!tumble && el.dataset.k === k) return;
    el.dataset.k = k;
    el.innerHTML = d ? dieHTML(d[0], tumble ? "tumble" : "") + dieHTML(d[1], tumble ? "tumble" : "") : "";
  }

  // a little thing flies from one screen point to another (resource cards, stolen card, ...)
  function fly(from, to, html, delay = 0, ms = 750) {
    if (!from || !to || reduced()) return;
    const el = document.createElement("div");
    el.className = "flyer"; el.innerHTML = html;
    el.style.left = from.x + "px"; el.style.top = from.y + "px"; el.style.opacity = "0";
    document.body.append(el);
    const dx = to.x - from.x, dy = to.y - from.y;
    const a = el.animate([
      { transform: "translate(-50%,-50%) scale(.4)", opacity: 0 },
      { transform: "translate(-50%,-50%) scale(1.15)", opacity: 1, offset: .18 },
      { transform: `translate(calc(-50% + ${dx * .5}px),calc(-50% + ${dy * .5 - 30}px)) scale(1)`, opacity: 1, offset: .6 },
      { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.7)`, opacity: .1 }
    ], { duration: ms, delay, easing: "cubic-bezier(.4,.1,.3,1)", fill: "both" });
    const done = () => el.remove();
    a.onfinish = a.oncancel = done; wait(ms + delay + 400, done);
  }
  const mid = (el) => { const r = el && el.getBoundingClientRect(); return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; };
  const toPlate = (i) => mid(ctx.plate(i));
  const toHand = (r) => mid(ctx.hand(r)) || mid($("#dock"));
  const boardMid = () => mid($("#board"));
  const resChip = (r, n) => `<span class="chip">${EMO[r]}${n > 1 ? `<b>${n}</b>` : ""}</span>`;

  function banner(html, cls, ms) {
    const st = $("#stage"); if (!st) return;
    const b = document.createElement("div");
    b.className = "banner " + (cls || ""); b.innerHTML = html;
    st.append(b);
    wait(ms, () => { b.classList.add("out"); wait(300, () => b.remove()); });
  }
  const info = (t) => { const el = $("#info"); if (el) el.textContent = t || ""; };
  const float = (el, text, cls) => {
    const p = mid(el); if (!p) return;
    const f = document.createElement("div");
    f.className = "ftext " + (cls || ""); f.textContent = text; f.style.left = p.x + "px"; f.style.top = p.y + "px";
    document.body.append(f); wait(1300, () => f.remove());
  };
  const fromHex = (hex) => B.hexCenter(hex);
  function gains(list, v, delay0 = 0) {
    list.forEach((g, k) => {
      const to = g.pi === v.me ? toHand(g.res) : toPlate(g.pi);
      for (let j = 0; j < Math.min(g.n, 3); j++) fly(fromHex(g.hex), to, resChip(g.res, 1), delay0 + k * 90 + j * 120);
    });
  }

  const H = {
    roll(e, v) {
      ctx.sfx("roll"); drawDice(e.d, true);
      info(`${who(v, e.pi)} ${e.pi === v.me ? "würfelst" : "würfelt"} ${e.sum}`);
      wait(650, () => {
        B.flashNum(e.sum);
        if (e.sum === 7) { banner("7! Der Räuber kommt", "dark", 1100); ctx.sfx("bad"); }
        else if (!e.gains.length) info(`${e.sum}: Niemand bekommt etwas.`);
        gains(e.gains, v);
        if (e.gains.length) ctx.sfx("coin");
        if (e.short && e.short.length) ctx.toast(`Die Bank hat nicht genug ${e.short.map((r) => G.RES_NAMES[r]).join(", ")}.`);
      });
      return e.sum === 7 ? 1500 : e.gains.length ? 1700 : 1100;
    },
    gain(e, v) { gains(e.gains, v); ctx.sfx("coin"); return 900; },
    build(e, v) { ctx.sfx(e.k === "road" ? "road" : "build"); return 450; },
    discard(e, v) {
      float(ctx.plate(e.pi), `−${e.n}`, "bad"); ctx.sfx("pop");
      for (let j = 0; j < Math.min(e.n, 4); j++) fly(toPlate(e.pi), boardMid(), `<span class="chip">${CARD}</span>`, j * 80, 600);
      return 700;
    },
    robber(e, v) { ctx.sfx("robber"); info(`${who(v, e.pi)} ${e.pi === v.me ? "versetzt" : "versetzt"} den Räuber`); return 750; },
    steal(e, v) {
      fly(toPlate(e.from), toPlate(e.to), `<span class="chip">${CARD}</span>`, 0, 800);
      float(ctx.plate(e.from), "−1", "bad"); float(ctx.plate(e.to), "+1", "good");
      banner(`${esc(who(v, e.to))} ${e.to === v.me ? "stiehlst" : "stiehlt"} von ${esc(who(v, e.from))}`, "dark", 1100); ctx.sfx("steal");
      return 1000;
    },
    bank(e, v) {
      const a = e.pi === v.me ? toHand(e.give) : toPlate(e.pi), b = boardMid();
      for (let j = 0; j < Math.min(e.n, 4); j++) fly(a, b, resChip(e.give, 1), j * 90, 600);
      fly(b, e.pi === v.me ? toHand(e.get) : toPlate(e.pi), resChip(e.get, 1), 450, 650);
      banner(`${e.n}× ${EMO[e.give]} → 1× ${EMO[e.get]}`, "", 1000); ctx.sfx("coin");
      return 1000;
    },
    buyDev(e, v) { fly(boardMid(), e.pi === v.me ? toHand("wood") : toPlate(e.pi), `<span class="chip dev">📜</span>`, 0, 700); float(ctx.plate(e.pi), "📜", "good"); ctx.sfx("pop"); return 650; },
    play(e, v) {
      const name = G.DEV_NAMES[e.card];
      banner(`${esc(who(v, e.pi))} ${e.pi === v.me ? "spielst" : "spielt"}<br><b>${name}</b>`, "gold", 1300); ctx.sfx("card");
      if (e.card === "mono") for (const f of e.from) fly(toPlate(f.pi), e.pi === v.me ? toHand(e.res) : toPlate(e.pi), resChip(e.res, f.n), 300, 700);
      if (e.card === "yop") e.res.forEach((r, k) => fly(boardMid(), e.pi === v.me ? toHand(r) : toPlate(e.pi), resChip(r, 1), 300 + k * 150, 700));
      return 1300;
    },
    offer(e, v) {
      ctx.sfx("pop");
      if (e.to === v.me || (e.to == null && e.pi !== v.me)) { ctx.toast(`${v.players[e.pi].name} bietet dir einen Tausch an.`); ctx.buzz(30); }
      return 350;
    },
    answer(e, v) { float(ctx.plate(e.pi), e.yes ? "ja" : "nein", e.yes ? "good" : "bad"); ctx.sfx(e.yes ? "yes" : "pop"); return 450; },
    trade(e, v) {
      const a = e.a === v.me ? null : toPlate(e.a), b = e.b === v.me ? null : toPlate(e.b);
      for (const r of G.RES) {
        if (e.give[r]) fly(e.a === v.me ? toHand(r) : a, e.b === v.me ? toHand(r) : b, resChip(r, e.give[r]), 0, 800);
        if (e.want[r]) fly(e.b === v.me ? toHand(r) : b, e.a === v.me ? toHand(r) : a, resChip(r, e.want[r]), 200, 800);
      }
      banner("Handel perfekt!", "", 1000); ctx.sfx("buy");
      return 1000;
    },
    offerEnd(e, v) {
      ctx.toast(e.none ? "Niemand will tauschen." : e.pi === v.me ? "Angebot zurückgezogen." : `${v.players[e.pi].name} zieht das Angebot zurück.`);
      return 350;
    },
    award(e, v) {
      banner(`${e.kind === "road" ? "🛣️ Längste Handelsstraße" : "⚔️ Größte Rittermacht"}<small>${esc(who(v, e.pi))}  +2 Punkte</small>`, "gold", 1600);
      ctx.sfx("award"); return 1300;
    },
    turn(e, v) { info(""); return 200; },
    end(e, v) { ctx.sfx("win"); return 700; }
  };

  function pump() {
    timer = null;
    if (!queue.length) { running = false; idleCbs.forEach((f) => f()); return; }
    running = true;
    const { ev, v } = queue.shift();
    let ms = 0;
    try { ms = (H[ev.t] ? H[ev.t](ev, v) : 0) || 0; } catch (err) { console.error(err); }
    timer = setTimeout(pump, ms);
  }
  function push(events, v) {
    if (!events || !events.length) return;
    if (document.hidden) { skip(); return; }
    for (const ev of events) queue.push({ ev, v });
    if (queue.length > 40) queue.splice(0, queue.length - 15);
    if (!running) pump();
  }
  function skip() {
    queue = []; clearTimeout(timer); timer = null;
    if (running) { running = false; idleCbs.forEach((f) => f()); }
  }

  window.CatanFX = { init(c) { ctx = c; }, push, skip, drawDice, info, dieHTML, busy: () => running, onIdle: (f) => idleCbs.push(f), EMO };
})();
