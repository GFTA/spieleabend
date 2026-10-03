// Catan: the pop-up sheets (trade with the bank and players, development cards, discard, victim, plenty, monopoly).
(() => {
  "use strict";
  const G = window.CatanGame;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const EMO = { wood: "🌲", brick: "🧱", sheep: "🐑", wheat: "🌾", ore: "⛰️" };
  const DEV_TEXT = {
    knight: "Versetze den Räuber und stiehl eine Karte. Drei Ritter bringen die Größte Rittermacht.",
    road: "Baue zwei Straßen kostenlos.",
    yop: "Nimm dir zwei beliebige Rohstoffe aus der Bank.",
    mono: "Alle Mitspieler geben dir ihre Karten eines Rohstoffs.",
    vp: "Ein verdeckter Siegpunkt. Er zählt, sobald du damit gewinnst."
  };
  let ctx = null, cur = null, arg = null;
  const F = { tab: "bank", bg: null, bw: null, give: G.emptyHand(), want: G.emptyHand(), to: null, pick: [], dis: G.emptyHand() };
  const V = () => ctx.view();
  const sum = (h) => G.total(h);

  const resBtn = (r, attrs, inner, cls) => `<button type="button" class="rbtn ${cls || ""}" ${attrs}><span class="re">${EMO[r]}</span>${inner || ""}</button>`;

  function stepper(r, kind, n, max) {
    return `<div class="step"><span class="re">${EMO[r]}</span>` +
      `<button type="button" data-st="${kind}:${r}:-1" aria-label="weniger ${G.RES_NAMES[r]}" ${n <= 0 ? "disabled" : ""}>−</button><b>${n}</b>` +
      `<button type="button" data-st="${kind}:${r}:1" aria-label="mehr ${G.RES_NAMES[r]}" ${n >= max ? "disabled" : ""}>+</button></div>`;
  }

  // ---------- one renderer per sheet ----------
  const R = {
    trade(v) {
      const me = v.me, hand = v.hand, ok = canTrade(v);
      let html = `<h2>Handeln</h2><div class="seg two" data-tabs><button type="button" data-tab="bank" aria-pressed="${F.tab === "bank"}">Mit der Bank</button><button type="button" data-tab="players" aria-pressed="${F.tab === "players"}">Mit Spielern</button></div>`;
      if (!ok) return html + `<p class="hint">Handeln geht nur in deinem Zug nach dem Würfeln.</p><button class="btn btn-block" data-close type="button">Schließen</button>`;
      if (F.tab === "bank") {
        html += `<div class="label">Du gibst</div><div class="rrow">` + G.RES.map((r) => {
          const rate = G.portRate(v, me, r), can = hand[r] >= rate;
          return resBtn(r, `data-bg="${r}" ${can ? "" : "disabled"} aria-pressed="${F.bg === r}"`, `<small>${rate}:1 · ${hand[r]}</small>`);
        }).join("") + `</div><div class="label">Du bekommst</div><div class="rrow">` + G.RES.map((r) =>
          resBtn(r, `data-bw="${r}" ${v.bank[r] > 0 && r !== F.bg ? "" : "disabled"} aria-pressed="${F.bw === r}"`, `<small>Bank ${v.bank[r]}</small>`)).join("") + `</div>`;
        const rate = F.bg ? G.portRate(v, me, F.bg) : 0, good = F.bg && F.bw && hand[F.bg] >= rate && v.bank[F.bw] > 0;
        html += `<button class="btn btn-primary btn-block" data-bank type="button" ${good ? "" : "disabled"}>${good ? `${rate}× ${EMO[F.bg]} gegen 1× ${EMO[F.bw]} tauschen` : "Wähle, was du gibst und bekommst"}</button>`;
        const ports = [...new Set(G.RES.map((r) => G.portRate(v, me, r)))].sort();
        html += `<p class="hint">${ports[0] === 4 ? "Ohne Hafen: vier gleiche Karten gegen eine beliebige." : "Dein Hafen macht den Tausch günstiger, siehe die Zahlen oben."}</p>`;
      } else {
        html += `<div class="label">Du gibst</div><div class="steps">` + G.RES.map((r) => stepper(r, "give", F.give[r], hand[r])).join("") +
          `</div><div class="label">Du möchtest</div><div class="steps">` + G.RES.map((r) => stepper(r, "want", F.want[r], 9)).join("") + `</div>` +
          `<div class="label">An wen?</div><div class="seg" data-to>` +
          `<button type="button" data-to="all" aria-pressed="${F.to == null}">Alle</button>` +
          v.players.map((p, i) => (i === me ? "" : `<button type="button" data-to="${i}" aria-pressed="${F.to === i}">${p.avatar} ${esc(p.name)}</button>`)).join("") + `</div>`;
        const same = G.RES.some((r) => F.give[r] && F.want[r]), good = sum(F.give) && sum(F.want) && !same;
        html += `<button class="btn btn-primary btn-block" data-offer type="button" ${good ? "" : "disabled"}>${same ? "Gleiche Rohstoffe tauschen geht nicht" : good ? "Angebot machen" : "Wähle Karten für beide Seiten"}</button>`;
        html += `<p class="hint">Wer annimmt, kann am Ende von dir ausgewählt werden. Das Angebot gilt 25 Sekunden.</p>`;
      }
      return html + `<button class="btn btn-ghost btn-block" data-close type="button">Schließen</button>`;
    },
    devs(v) {
      const mine = v.devs, mineTurn = v.cur === v.me && v.phase === "play";
      const order = ["knight", "road", "yop", "mono", "vp"], rows = [];
      for (const k of order) {
        const have = mine.filter((d) => d.k === k);
        if (!have.length) continue;
        const ready = have.filter((d) => d.ok).length;
        const can = k !== "vp" && ready && mineTurn && !v.devPlayed && !v.trade && (v.step === "main" || (v.step === "roll" && k === "knight"));
        const why = k === "vp" ? "" : !ready ? "Neu gekauft: ab deinem nächsten Zug." : v.devPlayed && mineTurn ? "Pro Zug nur eine Karte." : !mineTurn ? "Nur in deinem Zug." : v.step === "roll" && k !== "knight" ? "Erst würfeln." : v.trade ? "Erst den Handel beenden." : "";
        rows.push(`<div class="dcard ${k}"><div><b>${G.DEV_NAMES[k]}</b>${have.length > 1 ? ` ×${have.length}` : ""}<small>${DEV_TEXT[k]}</small>${why ? `<small class="why">${why}</small>` : ""}</div>` +
          (k === "vp" ? `<span class="vpt">+${have.length}</span>` : `<button type="button" class="btn ${can ? "btn-primary" : ""}" data-play="${k}" ${can ? "" : "disabled"}>Spielen</button>`) + `</div>`);
      }
      return `<h2>Entwicklungskarten</h2>` + (rows.length ? rows.join("") : `<p class="hint">Du hast keine Karten. Für ${G.RES.filter((r) => G.COST.dev[r]).map((r) => EMO[r]).join("")} gibt es eine aus dem Stapel (${v.deck} übrig).</p>`) + `<button class="btn btn-ghost btn-block" data-close type="button">Schließen</button>`;
    },
    yop(v) {
      const n = F.pick.length;
      return `<h2>Erfindung</h2><p class="hint">Nimm zwei Rohstoffe aus der Bank (${n}/2).</p><div class="rrow">` +
        G.RES.map((r) => resBtn(r, `data-pick="${r}" ${v.bank[r] - F.pick.filter((x) => x === r).length > 0 || F.pick.includes(r) ? "" : "disabled"}`, `<small>${F.pick.filter((x) => x === r).length || ""}</small>`, F.pick.includes(r) ? "sel" : "")).join("") +
        `</div><button class="btn btn-primary btn-block" data-yop type="button" ${n === 2 ? "" : "disabled"}>Nehmen</button><button class="btn btn-ghost btn-block" data-close type="button">Abbrechen</button>`;
    },
    mono(v) {
      return `<h2>Monopol</h2><p class="hint">Welchen Rohstoff sollen dir alle geben?</p><div class="rrow">` +
        G.RES.map((r) => resBtn(r, `data-mono="${r}"`, `<small>${G.RES_NAMES[r]}</small>`)).join("") +
        `</div><button class="btn btn-ghost btn-block" data-close type="button">Abbrechen</button>`;
    },
    victim(v) {
      return `<h2>Von wem stehlen?</h2><div class="victims">` +
        arg.victims.map((i) => `<button type="button" class="btn" data-victim="${i}"><span class="pav">${v.players[i].avatar}</span> ${esc(v.players[i].name)}<small>${v.players[i].n} Karten</small></button>`).join("") +
        `</div><button class="btn btn-ghost btn-block" data-close type="button">Abbrechen</button>`;
    },
    discard(v) {
      const need = v.disc[v.me] || 0, got = sum(F.dis);
      return `<h2>Zu viele Karten</h2><p class="hint">Bei einer 7 musst du die Hälfte abgeben: <b>${need}</b> Karten (${got}/${need}).</p><div class="steps">` +
        G.RES.map((r) => stepper(r, "dis", F.dis[r], v.hand[r])).join("") +
        `</div><button class="btn btn-primary btn-block" data-discard type="button" ${got === need ? "" : "disabled"}>Abgeben</button>`;
    }
  };

  const canTrade = (v) => v.phase === "play" && v.cur === v.me && v.step === "main" && !v.trade;

  function render() {
    const box = $("#sheet");
    if (!cur) { box.hidden = true; return; }
    const v = V();
    if (!v || v.me < 0) { close(); return; }
    if (cur === "discard" && !(v.disc[v.me] > 0)) { close(); return; }
    if (cur !== "discard" && v.disc[v.me] > 0) { open("discard"); return; }
    if (cur === "trade" && v.phase !== "play") { close(); return; }
    box.hidden = false;
    const body = box.querySelector(".sheet");
    const y = body.scrollTop;
    body.innerHTML = R[cur](v);
    body.scrollTop = y;
  }
  function open(name, a) {
    if (name === "discard") F.dis = G.emptyHand();
    if (name === "yop") F.pick = [];
    if (name === "trade" && cur !== "trade") { F.give = G.emptyHand(); F.want = G.emptyHand(); F.bg = F.bw = null; F.to = null; }
    cur = name; arg = a || null; render();
  }
  function close() { cur = null; arg = null; const b = $("#sheet"); b.hidden = true; }

  function init(c) {
    ctx = c;
    const box = $("#sheet");
    box.addEventListener("click", (e) => {
      const t = e.target, v = V();
      if (t === box && cur !== "discard") { close(); return; }
      const b = t.closest("button"); if (!b || b.disabled) return;
      const d = b.dataset;
      if (b.hasAttribute("data-close")) return close();
      if (d.tab) { F.tab = d.tab; return render(); }
      if (d.bg) { F.bg = F.bg === d.bg ? null : d.bg; if (F.bw === F.bg) F.bw = null; return render(); }
      if (d.bw) { F.bw = F.bw === d.bw ? null : d.bw; return render(); }
      if (b.hasAttribute("data-bank")) { if (ctx.act({ t: "bank", give: F.bg, get: F.bw })) { F.bg = F.bw = null; } return render(); }
      if (d.st) {
        const [kind, r, step] = d.st.split(":"), h = kind === "give" ? F.give : kind === "want" ? F.want : F.dis;
        const max = kind === "give" || kind === "dis" ? v.hand[r] : 9, lim = kind === "dis" ? Math.max(0, (v.disc[v.me] || 0) - sum(h) + h[r]) : max;
        h[r] = Math.max(0, Math.min(Math.min(max, lim), h[r] + +step));
        return render();
      }
      if (d.to != null) { F.to = d.to === "all" ? null : +d.to; return render(); }
      if (b.hasAttribute("data-offer")) { if (ctx.act({ t: "offer", give: { ...F.give }, want: { ...F.want }, to: F.to })) close(); return; }
      if (d.play) {
        const k = d.play;
        if (k === "road") { close(); ctx.freeRoads(); return; }
        if (k === "yop" || k === "mono") { open(k); return; }
        if (ctx.act({ t: "play", card: k })) close();
        return;
      }
      if (d.pick) { const i = F.pick.indexOf(d.pick); if (F.pick.length < 2) F.pick.push(d.pick); else if (i >= 0) F.pick.splice(i, 1); return render(); }
      if (b.hasAttribute("data-yop")) { if (ctx.act({ t: "play", card: "yop", res: F.pick.slice() })) close(); return; }
      if (d.mono) { if (ctx.act({ t: "play", card: "mono", res: d.mono })) close(); return; }
      if (d.victim) { const hex = arg.hex; close(); ctx.act({ t: "robber", hex, victim: +d.victim }); return; }
      if (b.hasAttribute("data-discard")) { ctx.act({ t: "discard", res: { ...F.dis } }); F.dis = G.emptyHand(); return; }
    });
  }

  window.CatanSheets = { init, open, close, refresh: render, isOpen: () => !!cur, name: () => cur, canTrade };
})();
