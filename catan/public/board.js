// Catan board: an SVG island (1 unit = one hex radius) that follows the game view.
// Pieces that appear in the view pop in, the robber hops, and legal spots can be lit up, tapped or dropped on.
(() => {
  "use strict";
  const G = window.CatanGame, GEO = G.GEO;
  const NS = "http://www.w3.org/2000/svg";
  const TERR = {
    wood: { c: "#2f7d3a", e: "🌲" }, brick: { c: "#c0562c", e: "🧱" }, sheep: { c: "#8fcf55", e: "🐑" },
    wheat: { c: "#e7bf3a", e: "🌾" }, ore: { c: "#7b8798", e: "⛰️" }, desert: { c: "#e0cd93", e: "🏜️" }
  };
  const PC = ["#e0393e", "#3b82f6", "#f4f4ee", "#f59e0b"];
  const PD = ["#7a1216", "#173f8a", "#6b6b60", "#8a5200"];
  let svg = null, gHex, gPort, gEdge, gVert, gHi, gRob, key = "", first = true, robEl = null, robAt = -1;
  const vEls = new Map(), eEls = new Map(), hexEls = [], tokEls = [];
  let spotMode = null;

  function mk(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.append(e);
    return e;
  }
  const pts = (h) => GEO.hexes[h].v.map((v) => `${GEO.verts[v].x.toFixed(3)},${GEO.verts[v].y.toFixed(3)}`).join(" ");

  function build(box, v) {
    box.innerHTML = "";
    svg = mk("svg", { viewBox: "-5.88 -5.3 10.82 10.6", role: "img", "aria-label": "Spielbrett", class: "cboard" });
    gHex = mk("g", {}, svg); gPort = mk("g", {}, svg); gEdge = mk("g", {}, svg); gVert = mk("g", {}, svg); gRob = mk("g", {}, svg); gHi = mk("g", { class: "hi" }, svg);
    box.append(svg);
    vEls.clear(); eEls.clear(); hexEls.length = 0; tokEls.length = 0; robEl = null; robAt = -1; first = true; spotMode = null;
    v.hexes.forEach((h, i) => {
      const t = TERR[h.res], g = mk("g", { class: "hex", "data-h": i }, gHex), c = GEO.hexes[i];
      mk("polygon", { points: pts(i), fill: t.c, stroke: "#1b1330", "stroke-width": ".05", "stroke-linejoin": "round" }, g);
      const em = mk("text", { x: c.x, y: c.y - (h.num ? .42 : 0), class: "emo", "text-anchor": "middle", "dominant-baseline": "central" }, g);
      em.textContent = t.e;
      if (h.num) {
        const tk = mk("g", { class: "tok", transform: `translate(${c.x} ${c.y + .2})` }, g);
        mk("circle", { r: ".31", fill: "#f6ecd0", stroke: "#a58a52", "stroke-width": ".03" }, tk);
        const tx = mk("text", { y: "-.03", "text-anchor": "middle", "dominant-baseline": "central", class: "num" + (h.num === 6 || h.num === 8 ? " red" : "") }, tk);
        tx.textContent = h.num;
        const n = G.pips(h.num);
        for (let k = 0; k < n; k++) mk("circle", { cx: ((k - (n - 1) / 2) * .075).toFixed(3), cy: ".17", r: ".027", fill: h.num === 6 || h.num === 8 ? "#c8202a" : "#5a4a2a" }, tk);
        tokEls[i] = tk;
      }
      hexEls[i] = g;
    });
    v.ports.forEach((type, i) => {
      const p = GEO.ports[i], bx = p.x + p.ox * .85, by = p.y + p.oy * .85;
      for (const vi of p.v) mk("line", { x1: GEO.verts[vi].x, y1: GEO.verts[vi].y, x2: bx, y2: by, class: "pline" }, gPort);
      const g = mk("g", { class: "port", transform: `translate(${bx} ${by})` }, gPort);
      mk("circle", { r: ".36", class: "pdisc" }, g);
      const a = mk("text", { y: type === "any" ? "0" : "-.1", "text-anchor": "middle", "dominant-baseline": "central", class: "plab" }, g);
      a.textContent = type === "any" ? "3:1" : "2:1";
      if (type !== "any") { const b = mk("text", { y: ".13", "text-anchor": "middle", "dominant-baseline": "central", class: "pemo" }, g); b.textContent = TERR[type].e; }
    });
    key = layoutKey(v);
  }
  const layoutKey = (v) => v.hexes.map((h) => h.res + h.num).join() + v.ports.join();

  function roadEl(e, o) {
    const E = GEO.edges[e], a = GEO.verts[E.a], b = GEO.verts[E.b];
    const dx = b.x - a.x, dy = b.y - a.y, k = .17;
    const x1 = a.x + dx * k, y1 = a.y + dy * k, x2 = b.x - dx * k, y2 = b.y - dy * k;
    const g = mk("g", { class: "road", "data-e": e }, gEdge), p = mk("g", { class: "pc" }, g);
    mk("line", { x1, y1, x2, y2, stroke: PD[o], "stroke-width": ".27", "stroke-linecap": "round" }, p);
    mk("line", { x1, y1, x2, y2, stroke: PC[o], "stroke-width": ".16", "stroke-linecap": "round" }, p);
    return g;
  }
  const HOUSE = "M-.18 .15V-.04L0 -.21L.18 -.04V.15Z";
  const CITY = "M-.28 .17V-.03H-.05V-.15L.07 -.29L.19 -.15V-.01H.28V.17Z";
  function vertEl(vi, b) {
    const P = GEO.verts[vi], g = mk("g", { class: "bld", "data-v": vi, transform: `translate(${P.x} ${P.y})` }, gVert), p = mk("g", { class: "pc" }, g);
    mk("path", { d: b.c ? CITY : HOUSE, fill: PC[b.o], stroke: PD[b.o], "stroke-width": ".06", "stroke-linejoin": "round" }, p);
    return g;
  }
  function robberEl() {
    const g = mk("g", { class: "robber", id: "robberEl" }, gRob), p = mk("g", { class: "rb" }, g);
    mk("ellipse", { cx: 0, cy: ".33", rx: ".23", ry: ".07", fill: "rgba(0,0,0,.35)" }, p);
    mk("path", { d: "M-.2 .32C-.2 .05 -.1 -.02 -.1 -.1H.1C.1 -.02 .2 .05 .2 .32Z", fill: "#262633", stroke: "#fff", "stroke-opacity": ".55", "stroke-width": ".035" }, p);
    mk("circle", { cx: 0, cy: "-.2", r: ".14", fill: "#262633", stroke: "#fff", "stroke-opacity": ".55", "stroke-width": ".035" }, p);
    return g;
  }
  const hexPos = (h) => ({ x: GEO.hexes[h].x, y: GEO.hexes[h].y - .08 });

  function sync(v) {
    if (!svg || key !== layoutKey(v)) return false;
    for (let e = 0; e < v.edge.length; e++) {
      const o = v.edge[e], have = eEls.get(e);
      if (o >= 0 && !have) { const g = roadEl(e, o); eEls.set(e, g); if (!first) g.classList.add("fresh"); }
      else if (o < 0 && have) { have.remove(); eEls.delete(e); }
    }
    for (let i = 0; i < v.vert.length; i++) {
      const b = v.vert[i], have = vEls.get(i), k = b ? `${b.o}${b.c ? "c" : "s"}` : "";
      if (have && have.dataset.k !== k) { have.remove(); vEls.delete(i); }
      if (b && !vEls.has(i)) { const g = vertEl(i, b); g.dataset.k = k; vEls.set(i, g); if (!first) g.classList.add("fresh"); }
    }
    if (!robEl) robEl = robberEl();
    const p = hexPos(v.robber);
    if (robAt !== v.robber) {
      const from = robAt >= 0 ? hexPos(robAt) : null;
      robEl.style.transform = `translate(${p.x}px,${p.y}px)`;
      if (from && robEl.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        robEl.animate([
          { transform: `translate(${from.x}px,${from.y}px)` },
          { transform: `translate(${(from.x + p.x) / 2}px,${(from.y + p.y) / 2 - 1.1}px)`, offset: .5 },
          { transform: `translate(${p.x}px,${p.y}px)` }
        ], { duration: 650, easing: "ease-in-out" });
      }
      robAt = v.robber;
    }
    tokEls.forEach((t, i) => { if (t) t.classList.toggle("blocked", i === v.robber); });
    first = false;
    return true;
  }

  // ---- spots: tappable circles / roads / hexes ----
  // kind "vertex" | "edge" | "hex"; ids: what is allowed; onPick(id); cls: colour hint
  function spots(kind, ids, onPick, cls, marks) {
    if (gHi) gHi.innerHTML = ""; spotMode = null;
    if (!svg) return;
    for (const id of marks || []) {
      if (kind !== "edge") break;
      const E = GEO.edges[id], a = GEO.verts[E.a], b = GEO.verts[E.b];
      mk("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "ringl mark", "stroke-linecap": "round" }, gHi);
    }
    if (!ids || !ids.length) return;
    spotMode = { kind, ids, onPick };
    for (const id of ids) {
      let g;
      if (kind === "vertex") { const P = GEO.verts[id]; g = mk("g", { class: "spot " + (cls || ""), "data-id": id }, gHi); mk("circle", { cx: P.x, cy: P.y, r: ".2", class: "ring" }, g); mk("circle", { cx: P.x, cy: P.y, r: ".36", fill: "rgba(0,0,0,.01)" }, g); }
      else if (kind === "edge") { const E = GEO.edges[id], a = GEO.verts[E.a], b = GEO.verts[E.b]; g = mk("g", { class: "spot " + (cls || ""), "data-id": id }, gHi); mk("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "ringl", "stroke-linecap": "round" }, g); mk("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "rgba(0,0,0,.01)", "pointer-events": "stroke", "stroke-width": ".5", "stroke-linecap": "round" }, g); }
      else { g = mk("g", { class: "spot hexspot " + (cls || ""), "data-id": id }, gHi); mk("polygon", { points: pts(id), class: "ringh" }, g); }
      g.addEventListener("click", (e) => { e.stopPropagation(); if (spotMode && spotMode.onPick) spotMode.onPick(id); });
    }
  }
  const clearSpots = () => { if (gHi) gHi.innerHTML = ""; spotMode = null; };
  const spotKey = () => (spotMode ? spotMode.kind + spotMode.ids.join() : "");

  function toSvg(cx, cy) {
    if (!svg) return null;
    const m = svg.getScreenCTM(); if (!m) return null;
    const p = svg.createSVGPoint(); p.x = cx; p.y = cy;
    return p.matrixTransform(m.inverse());
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // the allowed spot closest to a screen point (within reach), for dropping a dragged piece
  function nearest(kind, ids, cx, cy) {
    const p = toSvg(cx, cy); if (!p) return null;
    let best = null, bd = kind === "hex" ? 1 : .62;
    for (const id of ids) {
      const q = kind === "vertex" ? GEO.verts[id] : kind === "edge" ? { x: (GEO.verts[GEO.edges[id].a].x + GEO.verts[GEO.edges[id].b].x) / 2, y: (GEO.verts[GEO.edges[id].a].y + GEO.verts[GEO.edges[id].b].y) / 2 } : GEO.hexes[id];
      const d = dist(p, q);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }
  function hot(id) {
    if (!gHi) return;
    for (const g of gHi.children) g.classList.toggle("hot", id != null && +g.dataset.id === id);
  }
  const svgEl = () => svg;
  const hexCenter = (h) => { const r = hexEls[h] && hexEls[h].getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; };
  const vertCenter = (vi) => { const g = vEls.get(vi); const r = g && g.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; };
  const robberCenter = () => { const r = robEl && robEl.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; };
  function flashNum(sum) {
    hexEls.forEach((g, i) => {
      const t = tokEls[i], n = t && +t.querySelector("text").textContent;
      if (n === sum) { g.classList.remove("hit"); void g.getBoundingClientRect(); g.classList.add("hit"); setTimeout(() => g.classList.remove("hit"), 1600); }
    });
  }

  window.CatanBoard = { build, sync, spots, clearSpots, spotKey, nearest, hot, toSvg, svgEl, hexCenter, vertCenter, robberCenter, flashNum, robberEl: () => robEl, PC, PD, TERR, HOUSE, CITY, built: () => !!svg, same: (v) => !!svg && key === layoutKey(v) };
})();
