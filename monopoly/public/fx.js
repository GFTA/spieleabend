// Monopoly: turns the engine's events into things you see and hear, one after the other.
// The state is already final when events arrive; this queue only paces what is drawn (token hops, coins, cards, banners).
(() => {
  "use strict";
  const G = window.MonopolyGame, B = window.MonopolyBoard;
  const $ = (s) => document.querySelector(s);
  const M = (n) => G.money(n);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  let ctx = null, queue = [], running = false, timer = null, quiet = false;
  const idleCbs = [];

  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function dieHTML(value, cls) {
    let pips = "";
    for (let i = 0; i < 9; i++) pips += `<i${(PIPS[value] || []).includes(i) ? ' class="on"' : ""}></i>`;
    return `<div class="die ${cls || ""}" aria-label="${value ? "Würfel zeigt " + value : "Würfel"}">${pips}</div>`;
  }
  // scattered little houses / hotels for the bank's piles (fixed positions, so it never jumps around)
  const SPOTS = [[8, 30, -12], [36, 6, 8], [62, 34, -4], [22, 52, 14], [50, 56, -16], [76, 8, 10], [88, 52, 6], [12, 8, 4]];
  const pileHTML = (cls, id) => `<div class="pile ${cls}"><div class="heap">${SPOTS.map(([x, y, r]) => `<i style="left:${x}%;top:${y}%;transform:rotate(${r}deg)"></i>`).join("")}</div><b id="${id}"></b></div>`;
  function mountMid() {
    $("#mid").innerHTML = `<div class="dk chest"><span>Gemeinschafts&shy;karte</span></div><div class="dk chance"><span>Ereignis&shy;karte</span></div>` +
      pileHTML("hotels", "pileT") + pileHTML("houses", "pileH") +
      `<div class="dice" id="dice"></div><div class="info" id="info"></div><div class="stage" id="stage"></div>`;
    drawDice(ctx && ctx.view() ? ctx.view().dice : [0, 0], false);
    if (ctx && ctx.view()) piles(ctx.view());
  }
  function piles(v) {
    const h = $("#pileH"), t = $("#pileT");
    if (h) h.textContent = v.houses; if (t) t.textContent = v.hotels;
  }
  function drawDice(d, tumble, unlessSame) {
    const el = $("#dice"); if (!el) return;
    if (unlessSame && el.dataset.k === d.join()) return;
    el.dataset.k = d.join();
    el.innerHTML = d[0] ? dieHTML(d[0], tumble ? "tumble" : "") + dieHTML(d[1], tumble ? "tumble" : "") : "";
  }
  const info = (t) => { const el = $("#info"); if (el) el.textContent = t || ""; };

  const who = (v, i) => (i === v.me ? "Du" : v.players[i].name);
  const plate = (i) => (i >= 0 && ctx.plate(i)) || $("#mid");
  const cell = (i) => B.cells()[i];
  const wait = (ms, fn) => setTimeout(fn, ms);

  function banner(html, cls, ms) {
    const st = $("#stage"); if (!st) return;
    const b = document.createElement("div");
    b.className = "banner " + (cls || ""); b.innerHTML = html;
    st.append(b);
    wait(ms, () => { b.classList.add("out"); wait(300, () => b.remove()); });
  }
  function showCard(deck, id, ms) {
    const st = $("#stage"); if (!st) return;
    const c = G.CARDS[deck][id], el = document.createElement("div");
    el.className = "pcard " + deck;
    el.innerHTML = `<h4>${deck === "chance" ? "Ereignis" : "Gemeinschaft"}</h4><p>${esc(c ? c.text : "")}</p>`;
    st.append(el);
    wait(ms, () => { el.classList.add("out"); wait(300, () => el.remove()); });
  }

  // ---------- one handler per engine event, each returns how long it takes ----------
  const H = {
    roll(e, v) {
      ctx.sfx("roll"); drawDice(e.d, true);
      info(`${who(v, e.pi)} ${e.pi === v.me ? "würfelst" : "würfelt"} ${e.d[0] + e.d[1]}`);
      if (e.doubles > 0 && B.posOf(e.pi) >= 0) wait(700, () => { B.floatText(B.posOf(e.pi), "Pasch!", "gold"); ctx.sfx("pop"); });
      return 1100;
    },
    move(e) {
      const per = e.steps > 14 ? 110 : e.steps > 8 ? 170 : 240;
      for (let k = 1; k <= e.steps; k++) wait((k - 1) * per, () => { B.hop(e.pi, (e.from + e.dir * k + 400) % 40); ctx.sfx("step"); });
      wait(e.steps * per, () => B.land(e.pi));
      return e.steps * per + 250;
    },
    pay(e, v) {
      const bank = e.from < 0 && e.to < 0;
      if (bank) return 0;
      const amount = Math.round(e.amount);
      if (e.why === "go") {
        ctx.cash(e.to, amount);
        B.restart(cell(0), "glow");
        if (e.exact) {
          B.burst(0, ["🪙", "⭐", "✨", "💰"], e.bonus ? 24 : 14);
          B.floatText(0, `+${M(amount)}`, "gold");
          banner(`LOS!<small>${e.bonus ? `Doppelt: +${M(amount)}` : `+${M(amount)}`}</small>`, "", 1300);
          ctx.sfx(e.bonus ? "jackpot" : "coin"); ctx.buzz([20, 40, 20]);
        } else {
          B.coins(0, plate(e.to), 4); B.floatText(0, `+${M(amount)}`, "plus"); ctx.sfx("coin");
        }
        return 1500;
      }
      if (e.why === "parking") {
        ctx.cash(e.to, amount);
        B.restart(cell(20), "glow"); B.burst(20, ["🪙", "💰", "✨"], 18); B.coins(20, plate(e.to), 5);
        banner(`Jackpot!<small>+${M(amount)}</small>`, "", 1200); ctx.sfx("jackpot");
        return 1300;
      }
      const from = e.from < 0 ? (e.idx != null ? cell(e.idx) : $("#mid")) : plate(e.from);
      const to = e.to < 0 ? (e.idx != null ? cell(e.idx) : $("#mid")) : plate(e.to);
      if (e.from >= 0) ctx.cash(e.from, -amount);
      if (e.to >= 0) ctx.cash(e.to, amount);
      B.coins(from, to, amount >= 300 ? 6 : amount >= 100 ? 4 : 2);
      if (e.from >= 0) B.floatText(plate(e.from), `−${M(amount)}`, "minus");
      if (e.to >= 0) B.floatText(plate(e.to), `+${M(amount)}`, "plus");
      if (e.why === "rent" && e.idx != null) B.restart(cell(e.idx), "glow");
      if (e.to === v.me) ctx.sfx("coin"); else if (e.from === v.me) ctx.sfx("pay"); else ctx.sfx("coin");
      return 500;
    },
    offer(e) { if (e.idx != null) B.restart(cell(e.idx), "glow"); ctx.sfx("pop"); return 350; },
    buy(e, v) {
      ctx.board(v); B.coins(plate(e.pi), cell(e.idx), 3);
      B.floatText(cell(e.idx), "Gekauft!", "gold"); ctx.sfx("buy");
      return 650;
    },
    decline(e, v) { info(`${who(v, e.pi)} kauft nicht.`); return 350; },
    card(e, v) {
      showCard(e.deck, e.id, 2100); ctx.sfx("card");
      info(`${who(v, e.pi)} ${e.pi === v.me ? "ziehst" : "zieht"} eine Karte`);
      return 2200;
    },
    jail(e, v) {
      B.siren(1500); ctx.sfx("siren"); ctx.buzz([60, 40, 60]);
      banner(`Ab ins Gefängnis!${e.why === "speed" ? "<small>Dreimal Pasch</small>" : ""}`, "red", 1400);
      wait(450, () => B.fly(e.pi, 10));
      wait(1050, () => { B.cage(true); ctx.sfx("clang"); ctx.tokens(v); });
      wait(1900, () => B.cage(false));
      return 2100;
    },
    jailOut(e, v) {
      ctx.tokens(v); ctx.sfx("free"); B.cage(false);
      const how = { doubles: "Pasch!", fee: "50 bezahlt", pay: "50 bezahlt", card: "Freikarte" }[e.how] || "";
      banner(`Frei!${how ? `<small>${how}</small>` : ""}`, "blue", 1000);
      B.land(e.pi);
      return 1100;
    },
    auction(e) { B.restart(cell(e.idx), "glow"); ctx.sfx("pop"); banner("Versteigerung!", "dark", 900); return 1000; },
    bid(e, v) { B.floatText(plate(e.pi), M(e.amount), "gold"); ctx.sfx("coin"); return 400; },
    pass(e, v) { B.floatText(plate(e.pi), "passt", ""); return 300; },
    auctionEnd() { return 300; },
    build(e, v) { ctx.board(v); B.floatText(cell(e.idx), e.level === 5 ? "🏨" : "🏠", "gold"); ctx.sfx("build"); return 550; },
    sell(e, v) { ctx.board(v); B.floatText(cell(e.idx), "verkauft", ""); ctx.sfx("pay"); return 450; },
    mortgage(e, v) { ctx.board(v); B.floatText(cell(e.idx), e.on ? "Hypothek" : "ausgelöst", ""); ctx.sfx("pay"); return 450; },
    debt(e, v) { B.restart(plate(e.pi), "bad"); ctx.sfx("bad"); info(`${who(v, e.pi)} ${e.pi === v.me ? "hast" : "hat"} Schulden (${M(e.amount)})`); return 500; },
    bankrupt(e, v) {
      ctx.board(v); ctx.tokens(v); ctx.sfx("bad"); ctx.buzz([80, 40, 80]);
      banner(`${esc(v.players[e.pi].name)} ist pleite!`, "red", 1500);
      B.restart(plate(e.pi), "bad");
      return 1600;
    },
    tradeOffer(e, v) { if (e.to === v.me) { ctx.toast(`${v.players[e.from].name} bietet dir einen Tausch an.`); ctx.buzz(30); } ctx.sfx("pop"); return 350; },
    tradeDone(e, v) {
      ctx.board(v);
      if (e.from != null && e.to != null) { B.coins(plate(e.from), plate(e.to), 3, "🤝"); B.coins(plate(e.to), plate(e.from), 3, "🤝"); }
      banner("Tausch perfekt!", "", 900); ctx.sfx("buy");
      return 950;
    },
    tradeNo(e, v) { ctx.toast(e.cancelled ? "Angebot zurückgezogen." : `${who(v, e.to)} ${e.to === v.me ? "lehnst" : "lehnt"} ab.`); return 350; },
    turn(e, v) { ctx.tokens(v); if (e.pi === v.me) { ctx.sfx("turn"); ctx.buzz([40, 60, 40]); } info(""); return 250; },
    end(e, v) { ctx.sfx("win"); return 700; }
  };

  function pump() {
    timer = null;
    if (!queue.length) { running = false; idleCbs.forEach((f) => f()); return; }
    running = true;
    const { ev, v } = queue.shift();
    let ms = 0;
    if (!quiet) { try { ms = (H[ev.t] ? H[ev.t](ev, v) : 0) || 0; } catch (err) { console.error(err); } }
    timer = setTimeout(pump, ms);
  }
  function push(events, v) {
    if (!events || !events.length) return;
    if (document.hidden) { skip(); return; }
    for (const ev of events) queue.push({ ev, v });
    if (queue.length > 60) queue.splice(0, queue.length - 20);
    if (!running) pump();
  }
  // forget what is still waiting (leaving the table, tab in the background)
  function skip() {
    queue = []; clearTimeout(timer); timer = null;
    if (running) { running = false; idleCbs.forEach((f) => f()); }
  }

  window.MonopolyFX = {
    init(c) { ctx = c; },
    mountMid, piles, drawDice, info, push, skip, dieHTML,
    busy: () => running,
    onIdle: (f) => idleCbs.push(f)
  };
})();
