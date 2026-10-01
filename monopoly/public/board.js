// Monopoly board: 40 fields on an 11x11 grid, tokens that hop from field to field and the little effects
// (coin bursts, flying coins, floating numbers, the jail cage). Pure drawing, the rules live in game.js.
(() => {
  "use strict";
  const G = window.MonopolyGame, BOARD = G.BOARD;
  const SEATS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#14b8a6"];
  const ICON = { station: "🚂", chance: "❓", chest: "🎁", tax: "💸", park: "🅿️", jail: "⛓️", gojail: "👮" };
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  // field index -> [column, row] (1-based): Los bottom right, then left along the bottom, up the left side, ...
  const gridPos = (i) => (i <= 10 ? [11 - i, 11] : i < 20 ? [1, 21 - i] : i <= 30 ? [i - 19, 1] : [11, i - 29]);
  const sideOf = (i) => (i % 10 === 0 ? "c" : i < 10 ? "b" : i < 20 ? "l" : i < 30 ? "t" : "r");
  // the corners are 1.5 tracks wide, so the middle of column c sits at c (2..10), 0.75 or 11.25
  const mid = (c) => (c === 1 ? 0.75 : c === 11 ? 11.25 : c);
  const centerPct = (i) => { const [c, r] = gridPos(i); return [(mid(c) / 12) * 100, (mid(r) / 12) * 100]; };
  // soft hyphens before common endings so long German names break at sensible places
  const soft = (n) => esc(n).split(" ").map((w) => (w.length > 8 ? w.replace(/(gasse|allee|straße|strasse|schaft|steuer|promenade|bahnhof|hof|platz|werke|wiese|steig|ring|weg)$/i, "\u00ad$1") : w)).join(" ");
  const iconOf = (f, i) => (f.k === "util" ? (i === 12 ? "💡" : "🚰") : ICON[f.k] || "");

  let root, cells = [], toks = [], tokLayer, fxLayer, sig = [], seen = [];
  const where = []; // field each token stands on right now (what is drawn, which can lag behind the state)

  function build(el) {
    root = el; cells = []; toks = []; sig = []; seen = []; where.length = 0;
    let h = "";
    BOARD.forEach((f, i) => {
      const [c, r] = gridPos(i), side = sideOf(i), kind = f.k;
      const band = kind === "prop" ? `<i class="band" style="--bc:${G.GROUPS[f.g].color}"><u></u></i>` : "";
      let tx;
      if (kind === "prop") tx = `<span class="nm">${soft(f.n)}</span><b class="pr">${f.p}</b>`;
      else if (kind === "go") tx = `<span class="go">LOS</span><span class="ar">➜</span>`;
      else if (kind === "park") tx = `<span class="ic">${ICON.park}</span><span class="nm">Frei Parken</span><b class="pot"></b>`;
      else if (kind === "jail") tx = `<span class="ic">${ICON.jail}</span><span class="nm">Gefängnis</span>`;
      else if (kind === "gojail") tx = `<span class="ic">${ICON.gojail}</span><span class="nm">Ab ins Gefängnis</span>`;
      else if (kind === "tax") tx = `<span class="ic">${ICON.tax}</span><span class="nm">${soft(f.n)}</span><b class="pr">${f.t}</b>`;
      else if (kind === "chance" || kind === "chest") tx = `<span class="ic">${ICON[kind]}</span><span class="nm">${soft(f.n)}</span>`;
      else tx = `<span class="ic">${iconOf(f, i)}</span><span class="nm">${soft(f.n)}</span><b class="pr">${f.p}</b>`;
      const inner = band + `<span class="tx">${tx}</span>`;
      h += `<button type="button" class="cell s-${side} k-${kind}" data-i="${i}" style="grid-column:${c};grid-row:${r}" aria-label="${esc(f.n)}">${inner}</button>`;
    });
    el.innerHTML = h + `<div class="mid" id="mid"></div><div class="toks" id="toks"></div>`;
    cells = BOARD.map((_, i) => el.querySelector(`.cell[data-i="${i}"]`));
    tokLayer = el.querySelector("#toks");
    if (!fxLayer) { fxLayer = document.createElement("div"); fxLayer.id = "fxlayer"; document.body.append(fxLayer); }
  }

  // ownership, houses and mortgages (drawn from the state; changes pop in)
  function update(V) {
    V.props.forEach((p, i) => {
      const s = p ? `${p.owner}|${p.mort}|${p.houses}` : "";
      if (sig[i] === s) return;
      const old = seen[i] || null, el = cells[i];
      sig[i] = s; seen[i] = p ? { ...p } : null;
      el.style.setProperty("--oc", p ? SEATS[p.owner % SEATS.length] : "transparent");
      el.classList.toggle("owned", !!p);
      el.classList.toggle("mort", !!(p && p.mort));
      const u = el.querySelector(".band u");
      if (u) u.innerHTML = p && p.houses === 5 ? `<em class="hotel"></em>` : p ? "<em></em>".repeat(p.houses) : "";
      if (old !== null || p) {
        if (p && (!old || old.owner !== p.owner)) restart(el, "stamp");
        else if (p && old && p.houses > old.houses) restart(el, "built");
        else if (p && old && p.houses < old.houses) restart(el, "shake");
      }
    });
    const pot = cells[20].querySelector(".pot");
    pot.textContent = V.rules.parking && V.pot ? `${V.pot} €` : "";
  }

  function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 900); }

  // ---------- tokens ----------
  function offset(pi) { return [((pi % 3) - 1) * 1.15, (Math.floor(pi / 3) - 0.5) * 2.1]; }
  function put(pi, cell) {
    const t = toks[pi]; if (!t) return;
    const [x, y] = centerPct(cell), [dx, dy] = offset(pi);
    t.style.left = x + dx + "%"; t.style.top = y + dy + "%";
    where[pi] = cell;
  }
  // all=false: only create missing tokens and refresh their look (an animation may still be moving the others)
  function syncTokens(V, all) {
    V.players.forEach((p, i) => {
      const fresh = !toks[i];
      if (fresh) {
        const t = document.createElement("div");
        t.className = "tok"; t.dataset.p = i;
        t.innerHTML = `<span></span>`;
        t.style.setProperty("--tc", SEATS[i % SEATS.length]);
        tokLayer.append(t); toks[i] = t; where[i] = -1;
      }
      const t = toks[i];
      t.firstChild.textContent = p.avatar;
      t.classList.toggle("out", !!p.out);
      t.classList.toggle("injail", p.jail > 0);
      t.classList.toggle("turn", V.phase === "play" && V.cur === i);
      if (fresh || (all && where[i] !== p.pos)) { t.classList.add("snap"); put(i, p.pos); void t.offsetWidth; t.classList.remove("snap"); }
    });
  }
  function hop(pi, cell) {
    const t = toks[pi]; if (!t) return;
    put(pi, cell);
    const s = t.firstChild; s.classList.remove("hop"); void s.offsetWidth; s.classList.add("hop");
  }
  function land(pi) { const s = toks[pi] && toks[pi].firstChild; if (s) { s.classList.remove("hop", "land"); void s.offsetWidth; s.classList.add("land"); } }
  function fly(pi, cell) { const t = toks[pi]; if (!t) return; t.classList.add("flying"); put(pi, cell); setTimeout(() => t.classList.remove("flying"), 700); }
  const posOf = (pi) => where[pi];

  // ---------- effects, all drawn on one fixed layer so they can fly from the board to the player plates ----------
  const rectOf = (x) => (typeof x === "number" ? cells[x] : x).getBoundingClientRect();
  const pointOf = (x) => { const r = rectOf(x); return [r.left + r.width / 2, r.top + r.height / 2]; };
  function spawn(html, cls, x, y) {
    const e = document.createElement("div");
    e.className = "fx " + (cls || ""); e.innerHTML = html; e.style.left = x + "px"; e.style.top = y + "px";
    fxLayer.append(e);
    return e;
  }
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function floatText(target, text, cls) {
    const [x, y] = pointOf(target), e = spawn(esc(text), "float " + (cls || ""), x, y);
    if (reduced()) return setTimeout(() => e.remove(), 1200);
    e.animate([{ transform: "translate(-50%,0) scale(.6)", opacity: 0 }, { transform: "translate(-50%,-14px) scale(1.15)", opacity: 1, offset: 0.2 },
      { transform: "translate(-50%,-46px) scale(1)", opacity: 1, offset: 0.75 }, { transform: "translate(-50%,-64px) scale(.95)", opacity: 0 }], { duration: 1300, easing: "ease-out" }).onfinish = () => e.remove();
  }
  function coins(from, to, n = 3, glyph = "🪙") {
    const [x0, y0] = pointOf(from), [x1, y1] = pointOf(to);
    for (let k = 0; k < n; k++) {
      const e = spawn(glyph, "coin", x0, y0), lift = -50 - Math.random() * 40;
      if (reduced()) { setTimeout(() => e.remove(), 500); continue; }
      e.animate([{ transform: "translate(-50%,-50%) scale(.5)", opacity: 0 },
        { transform: `translate(calc(-50% + ${(x1 - x0) * 0.4}px),calc(-50% + ${(y1 - y0) * 0.4 + lift}px)) scale(1.1)`, opacity: 1, offset: 0.4 },
        { transform: `translate(calc(-50% + ${x1 - x0}px),calc(-50% + ${y1 - y0}px)) scale(.8)`, opacity: 1, offset: 0.92 },
        { transform: `translate(calc(-50% + ${x1 - x0}px),calc(-50% + ${y1 - y0}px)) scale(.3)`, opacity: 0 }],
      { duration: 700 + k * 90, delay: k * 110, easing: "ease-in-out", fill: "backwards" }).onfinish = () => e.remove();
    }
  }
  function burst(target, glyphs = ["🪙", "⭐", "✨"], n = 16) {
    const [x, y] = pointOf(target);
    for (let k = 0; k < n; k++) {
      const e = spawn(glyphs[k % glyphs.length], "coin big", x, y), a = (k / n) * Math.PI * 2 + Math.random() * 0.4, d = 50 + Math.random() * 70;
      if (reduced()) { setTimeout(() => e.remove(), 400); continue; }
      e.animate([{ transform: "translate(-50%,-50%) scale(.4)", opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px),calc(-50% + ${Math.sin(a) * d - 20}px)) scale(1.2) rotate(${(Math.random() - 0.5) * 360}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d * 1.1}px),calc(-50% + ${Math.sin(a) * d + 40}px)) scale(.7)`, opacity: 0 }], { duration: 1000 + Math.random() * 300, easing: "cubic-bezier(.2,.7,.4,1)" }).onfinish = () => e.remove();
    }
  }
  // the cage that falls over the jail field and lifts again
  function cage(on) {
    const el = cells[10];
    let c = el.querySelector(".cage");
    if (on) {
      if (!c) { c = document.createElement("span"); c.className = "cage"; c.innerHTML = "<i></i><i></i><i></i><i></i><i></i>"; el.append(c); }
      c.classList.remove("up"); c.classList.add("down");
      setTimeout(() => restart(el, "clang"), 450);
    } else if (c) { c.classList.remove("down"); c.classList.add("up"); setTimeout(() => c.remove(), 700); }
  }
  function siren(ms = 1400) { root.classList.add("siren"); setTimeout(() => root.classList.remove("siren"), ms); }
  const shake = (el) => restart(el, "shake");

  window.MonopolyBoard = { SEATS, build, update, syncTokens, hop, land, fly, posOf, gridPos, floatText, coins, burst, cage, siren, shake, restart, pointOf, cells: () => cells };
})();
