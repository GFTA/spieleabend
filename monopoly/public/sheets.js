// Monopoly: the overlays you open from the table: property info, "my properties" (build, mortgage) and trade offers.
(() => {
  "use strict";
  const G = window.MonopolyGame, B = window.MonopolyBoard, BOARD = G.BOARD, GROUPS = G.GROUPS;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  let ctx = null, kind = null, arg = null;
  let T = null; // trade being put together { to, give, take }

  const colorOf = (i) => (BOARD[i].k === "prop" ? GROUPS[BOARD[i].g].color : BOARD[i].k === "station" ? "#64748b" : "#a3a3a3");
  const rank = (i) => (BOARD[i].k === "prop" ? BOARD[i].g : BOARD[i].k === "station" ? 8 : 9);
  const order = (a, b) => rank(a) - rank(b) || a - b;
  const ownable = (i) => ["prop", "station", "util"].includes(BOARD[i].k);
  const v = () => ctx.view();

  function open(k, a) { kind = k; arg = a; if (k === "manage") selIdx = null; if (k === "trade") T = { to: a == null ? -1 : a, give: { cash: 0, props: [], card: 0 }, take: { cash: 0, props: [], card: 0 } }; draw(); $("#sheet").hidden = false; }
  function close() { kind = null; $("#sheet").hidden = true; }
  const isOpen = () => kind !== null && !$("#sheet").hidden;
  function refresh() { if (isOpen()) draw(); }

  // ---------- property info ----------
  function infoHTML(idx) {
    const V = v(), f = BOARD[idx], pr = V.props[idx];
    let h = `<h2>${esc(f.n)}</h2>`;
    if (f.k === "prop") {
      const here = pr ? pr.houses : -1, labels = ["Miete", "Mit Farbgruppe", "1 Haus", "2 Häuser", "3 Häuser", "4 Häuser", "Hotel"];
      const rows = [f.r[0], f.r[0] * 2, f.r[1], f.r[2], f.r[3], f.r[4], f.r[5]];
      h += `<div class="label" style="color:${colorOf(idx)}">${GROUPS[f.g].name} · Preis ${f.p}</div><table class="rent">` +
        rows.map((r, i) => `<tr class="${pr && (i === 0 ? here === 0 : i === 1 ? false : here === i - 1) ? "here" : ""}"><td>${labels[i]}</td><td>${r}</td></tr>`).join("") +
        `<tr><td>Haus / Hotel kostet</td><td>${f.h}</td></tr><tr><td>Hypothek</td><td>${G.mortgageValue(idx)}</td></tr></table>`;
    } else if (f.k === "station") {
      h += `<div class="label">Bahnhof · Preis ${f.p}</div><table class="rent"><tr><td>1 Bahnhof</td><td>25</td></tr><tr><td>2 Bahnhöfe</td><td>50</td></tr><tr><td>3 Bahnhöfe</td><td>100</td></tr><tr><td>4 Bahnhöfe</td><td>200</td></tr><tr><td>Hypothek</td><td>${G.mortgageValue(idx)}</td></tr></table>`;
    } else if (f.k === "util") {
      h += `<div class="label">Versorgungswerk · Preis ${f.p}</div><table class="rent"><tr><td>Eins gehört dir</td><td>4 × Augenzahl</td></tr><tr><td>Beide gehören dir</td><td>10 × Augenzahl</td></tr><tr><td>Hypothek</td><td>${G.mortgageValue(idx)}</td></tr></table>`;
    } else {
      const text = { go: `Wer über Los zieht, bekommt ${G.GO_PAY}.${V.rules.goDouble ? ` Wer genau darauf landet, bekommt ${G.GO_PAY * 2}.` : ""}`,
        jail: "Nur zu Besuch, solange du nicht verhaftet wurdest. Raus kommst du mit Pasch, 50 oder einer Freikarte.",
        gojail: "Wer hier landet, geht direkt ins Gefängnis.",
        park: V.rules.parking ? "Steuern und Strafen landen im Jackpot. Wer hier landet, kassiert ihn." : "Hier passiert nichts. Du ruhst dich aus.",
        tax: `Zahle ${f.t} an die Bank.`, chance: "Ziehe eine Ereigniskarte.", chest: "Ziehe eine Gemeinschaftskarte." }[f.k];
      h += `<p class="hint">${text}</p>`;
    }
    if (ownable(idx)) {
      h += pr ? `<p class="hint">Gehört <b>${esc(V.players[pr.owner].name)}</b>${pr.mort ? " (beliehen)" : ""}${pr.houses ? `, ${pr.houses === 5 ? "mit Hotel" : pr.houses + " Haus/Häuser"}` : ""}.</p>` : `<p class="hint">Noch frei.</p>`;
    }
    return h + `<button class="btn btn-primary btn-block" data-close>Schließen</button>`;
  }

  // ---------- my properties: title deeds, one stack per colour group ----------
  let selIdx = null;
  const ink = (c) => { const n = parseInt(c.slice(1), 16), l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); return l > 150 ? "#1a1426" : "#fff"; };
  function canManage(V) { return V.me >= 0 && V.phase === "play" && V.cur === V.me && !V.auction && !V.trade; }
  const groupName = (f) => (f.k === "prop" ? GROUPS[f.g].name : f.k === "station" ? "Bahnhöfe" : "Werke");
  function deedHTML(i, V, mine) {
    const f = BOARD[i], pr = V.props[i], c = colorOf(i), me = V.me;
    let rows = [], hi = -1, foot = "";
    if (f.k === "prop") {
      const labels = ["Miete", "Komplett", "1 Haus", "2 Häuser", "3 Häuser", "4 Häuser", "Hotel"];
      rows = [f.r[0], f.r[0] * 2, f.r[1], f.r[2], f.r[3], f.r[4], f.r[5]].map((r, k) => [labels[k], r]);
      hi = pr.houses > 0 ? pr.houses + 1 : G.ownsSet(V, me, f.g) ? 1 : 0;
      foot = `<span>Haus / Hotel ${f.h}</span>`;
    } else if (f.k === "station") {
      rows = [["1 Bahnhof", 25], ["2 Bahnhöfe", 50], ["3 Bahnhöfe", 100], ["4 Bahnhöfe", 200]];
      hi = mine.filter((j) => BOARD[j].k === "station").length - 1;
    } else rows = [["Eins gehört dir", "4 × Zahl"], ["Beide gehören dir", "10 × Zahl"]], hi = mine.filter((j) => BOARD[j].k === "util").length - 1;
    const marks = f.k === "prop" && pr.houses ? (pr.houses === 5 ? `<em class="hotel"></em>` : "<em></em>".repeat(pr.houses)) : "";
    const icon = f.k === "station" ? "🚂 " : f.k === "util" ? (i === 12 ? "💡 " : "🚰 ") : "";
    return `<button type="button" class="deed${i === selIdx ? " sel" : ""}${pr.mort ? " mort" : ""}" data-sel="${i}" style="--bc:${c};--ink:${ink(c)}" aria-pressed="${i === selIdx}">` +
      `<span class="dh"><b>${icon}${esc(f.n)}</b><i class="dm">${marks}</i></span>` +
      `<span class="dr">${rows.map((r, k) => `<span class="${k === hi ? "now" : ""}"><span>${r[0]}</span><b>${r[1]}</b></span>`).join("")}</span>` +
      `<span class="df">${foot}<span>Hypothek ${G.mortgageValue(i)}</span></span>${pr.mort ? `<span class="stamp">Beliehen</span>` : ""}</button>`;
  }
  function manageHTML() {
    const V = v(), me = V.me, mine = G.ownedBy(V, me).sort(order), ok = canManage(V);
    const buildOk = ok && (V.step === "roll" || V.step === "after"), sellOk = ok && ["roll", "after", "debt"].includes(V.step);
    if (!mine.includes(selIdx)) selIdx = mine.length ? mine[0] : null;
    let h = `<h2>Meine Grundstücke</h2><div class="label">Kasse ${V.players[me].cash} · Bank: ${V.houses} Häuser, ${V.hotels} Hotels</div>`;
    if (!ok) h += `<p class="hint">Bauen und beleihen geht nur in deinem Zug.</p>`;
    if (V.step === "debt" && ok) h += `<p class="hint"><b>Du schuldest ${V.debt.amount}.</b> Verkaufe Häuser oder beleihe Grundstücke, dann wird automatisch bezahlt.</p>`;
    if (!mine.length) return h + `<p class="hint">Dir gehört noch nichts.</p><button class="btn btn-primary btn-block" data-close>Fertig</button>`;
    const groups = [];
    for (const i of mine) { const r = rank(i); (groups[groups.length - 1] && groups[groups.length - 1].r === r ? groups[groups.length - 1] : groups[groups.push({ r, l: [] }) - 1]).l.push(i); }
    h += `<div class="deck">` + groups.map((g) => `<div class="grp"><div class="gh" style="color:${colorOf(g.l[0])}">${groupName(BOARD[g.l[0]])} · ${g.l.length}/${g.r < 8 ? GROUPS[g.r].m.length : g.r === 8 ? 4 : 2}</div><div class="stack">${g.l.map((i) => deedHTML(i, V, mine)).join("")}</div></div>`).join("") + `</div>`;
    if (groups.length > 1) h += `<div class="dots">` + groups.map((g, k) => `<button type="button" data-g="${k}" aria-label="${groupName(BOARD[g.l[0]])}" style="--bc:${colorOf(g.l[0])}"></button>`).join("") + `</div>`;
    const i = selIdx, f = BOARD[i], pr = V.props[i];
    const st = pr.mort ? `beliehen, auslösen ${G.unmortgageCost(i)}` : pr.houses === 5 ? "Hotel" : pr.houses ? `${pr.houses} ${pr.houses === 1 ? "Haus" : "Häuser"}` : "";
    const btn = (a, label, bad) => `<button class="btn ${bad ? "off" : ""}" data-a="${a}" data-i="${i}">${label}</button>`;
    let bs = "";
    if (f.k === "prop" && !pr.mort) {
      bs += btn("build", `+ Haus ${f.h}`, buildOk ? G.buildError(V, me, i) : "x");
      if (pr.houses) bs += btn("sell", `− Haus ${f.h / 2}`, sellOk ? G.sellError(V, me, i) : "x");
    }
    bs += pr.mort ? btn("unmortgage", `Auslösen ${G.unmortgageCost(i)}`, buildOk ? G.unmortError(V, me, i) : "x") : btn("mortgage", `Hypothek ${G.mortgageValue(i)}`, sellOk ? G.mortError(V, me, i) : "x");
    h += `<div class="trow" style="--bc:${colorOf(i)}"><div class="nmx">${esc(f.n)}${st ? `<small>${st}</small>` : ""}</div>${bs}</div>`;
    return h + `<button class="btn btn-primary btn-block" data-close>Fertig</button>`;
  }
  function wireDeck(el, page) {
    const d = el.querySelector(".deck"); if (!d) return;
    const dots = [...el.querySelectorAll(".dots button")];
    const mark = () => { const k = Math.round(d.scrollLeft / Math.max(1, d.clientWidth)); dots.forEach((b, j) => b.setAttribute("aria-current", j === k)); };
    d.style.scrollBehavior = "auto"; d.scrollLeft = page * d.clientWidth; d.style.scrollBehavior = "";
    d.addEventListener("scroll", mark, { passive: true }); mark();
  }

  // ---------- trade ----------
  const sideOf = (s) => G.cleanSide(s);
  function chips(side, pi, list) {
    const V = v();
    return `<div class="chips">` + list.map((i) => `<button type="button" class="chip${V.props[i].mort ? " mort" : ""}" style="--bc:${colorOf(i)}" data-s="${side}" data-i="${i}" aria-pressed="${T[side].props.includes(i)}">${esc(BOARD[i].n)}</button>`).join("") +
      (V.players[pi].cards.length ? `<button type="button" class="chip" data-s="${side}" data-card aria-pressed="${!!T[side].card}">🔓 Freikarte</button>` : "") + `</div>`;
  }
  function cashStep(side, max) {
    return `<div class="step"><button data-s="${side}" data-d="-50">−50</button><button data-s="${side}" data-d="-10">−10</button><b>${T[side].cash}</b><button data-s="${side}" data-d="10">+10</button><button data-s="${side}" data-d="50">+50</button></div><div class="hint">höchstens ${max}</div>`;
  }
  function tradeHTML() {
    const V = v(), me = V.me, others = V.players.map((p, i) => i).filter((i) => i !== me && !V.players[i].out);
    let h = `<h2>Tauschen</h2><div class="partner">` + others.map((i) => `<button type="button" data-p="${i}" aria-pressed="${T.to === i}">${V.players[i].avatar} ${esc(V.players[i].name)}</button>`).join("") + `</div>`;
    if (T.to < 0 || !V.players[T.to] || V.players[T.to].out) return h + `<p class="hint">Mit wem möchtest du tauschen?</p><button class="btn btn-block" data-close>Abbrechen</button>`;
    const mineP = G.ownedBy(V, me).sort(order), theirP = G.ownedBy(V, T.to).sort(order);
    T.give.cash = Math.min(T.give.cash, V.players[me].cash); T.take.cash = Math.min(T.take.cash, V.players[T.to].cash);
    const give = sideOf(T.give), take = sideOf(T.take), err = give && take ? G.tradeError(V, me, T.to, give, take) : "Ungültiges Angebot.";
    h += `<div class="twocol"><div><div class="gh">Du gibst</div>${cashStep("give", V.players[me].cash)}${chips("give", me, mineP)}</div>` +
      `<div><div class="gh">Du bekommst</div>${cashStep("take", V.players[T.to].cash)}${chips("take", T.to, theirP)}</div></div>`;
    h += err ? `<p class="hint" style="color:var(--red)">${esc(err)}</p>` : "";
    return h + `<div class="row"><button class="btn" data-close>Abbrechen</button><button class="btn btn-primary ${err ? "off" : ""}" data-send>Anbieten</button></div>`;
  }

  function draw() {
    const el = $("#sheetBody"), scroll = el.scrollTop, d0 = el.querySelector(".deck"), page = d0 ? Math.round(d0.scrollLeft / Math.max(1, d0.clientWidth)) : 0;
    el.classList.toggle("deckmode", kind === "manage");
    el.innerHTML = kind === "info" ? infoHTML(arg) : kind === "manage" ? manageHTML() : kind === "trade" ? tradeHTML() : "";
    el.scrollTop = scroll; wireDeck(el, page);
  }

  function click(e) {
    if (e.target.id === "sheet") return close();
    const t = e.target.closest("button"); if (!t || !kind) return;
    if (t.hasAttribute("data-close")) return close();
    const V = v();
    if (kind === "manage" && t.dataset.sel != null) { selIdx = +t.dataset.sel; ctx.sfx("pop"); return draw(); }
    if (kind === "manage" && t.dataset.g != null) { const d = $("#sheetBody .deck"); if (d) d.scrollTo({ left: +t.dataset.g * d.clientWidth, behavior: "smooth" }); return; }
    if (kind === "manage" && t.dataset.a) {
      const a = { t: t.dataset.a, idx: +t.dataset.i }, fn = { build: G.buildError, sell: G.sellError, mortgage: G.mortError, unmortgage: G.unmortError }[a.t];
      const err = canManage(V) ? fn(V, V.me, a.idx) : "Das geht nur in deinem Zug.";
      if (err) { ctx.toast(err); ctx.sfx("bad"); return; }
      ctx.act(a);
    } else if (kind === "trade") {
      if (t.dataset.p != null) { T = { to: +t.dataset.p, give: { cash: 0, props: [], card: 0 }, take: { cash: 0, props: [], card: 0 } }; }
      else if (t.dataset.d && t.dataset.s) T[t.dataset.s].cash = Math.max(0, T[t.dataset.s].cash + +t.dataset.d);
      else if (t.dataset.i && t.dataset.s) { const l = T[t.dataset.s].props, i = +t.dataset.i, k = l.indexOf(i); if (k >= 0) l.splice(k, 1); else l.push(i); }
      else if (t.hasAttribute("data-card")) T[t.dataset.s].card = T[t.dataset.s].card ? 0 : 1;
      else if (t.hasAttribute("data-send")) {
        const give = sideOf(T.give), take = sideOf(T.take), err = give && take ? G.tradeError(V, V.me, T.to, give, take) : "Ungültiges Angebot.";
        if (err) { ctx.toast(err); return; }
        if (ctx.act({ t: "trade", to: T.to, give, take })) close();
        return;
      }
      draw();
    }
  }

  window.MonopolySheets = { init(c) { ctx = c; $("#sheet").addEventListener("click", click); }, open, close, refresh, isOpen };
})();
