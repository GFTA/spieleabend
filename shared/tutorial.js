// Interactive tutorial shared by every game. Loaded on demand by room-ui.js (button on the start screen and in the menu,
// or ?tutorial=1) together with the game's own public/tour.js, which only holds the steps:
//
//   Tutorial.define({
//     opponents: 1,                       // computer opponents for the practice game (default 1; 0 = none)
//     steps: [
//       { title: "Willkommen", text: "…" },                               // no target: centred, "Weiter"
//       { target: "#hand", text: "Das ist deine Hand." },                 // highlights the element, "Weiter"
//       { target: "#hand .card.ok", text: "Tippe …", wait: "tap" },       // goes on when the player presses the target
//       { target: "#board", text: "…", wait: { until: ($) => !!$("#roundEnd:not([hidden])") } },
//     ]
//   });
//
// Functions (target, wait.until, pre) get document.querySelector as their argument ($).
// A step may also have: place ("top" | "bottom"), pre() (runs when the step opens), idle (text while the target is
// missing, e.g. "Gleich bist du dran"), wait: { tap: "selector" } (press a different element than the highlighted one).
// target: selector (first visible match), array of selectors (the highlight covers all of them) or a function
// returning an element / array of elements / null.
(function () {
  "use strict";
  const K = window.Spieleabend || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DONE_KEY = (id) => "sa.tour.done." + id;

  let def = null, run = null;

  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[hidden]");
  };
  function resolve(target) {
    if (!target) return [];
    if (typeof target === "function") { const t = target($); return (Array.isArray(t) ? t : t ? [t] : []).filter(visible); }
    const list = Array.isArray(target) ? target : [target];
    const out = [];
    for (const s of list) {
      const el = typeof s === "string" ? [...document.querySelectorAll(s)].find(visible) : visible(s) ? s : null;
      if (el) out.push(el);
    }
    return out;
  }
  const union = (els) => {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const e of els) { const q = e.getBoundingClientRect(); l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
    return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
  };

  function build() {
    const layer = document.createElement("div");
    layer.className = "tour"; layer.id = "tour";
    layer.innerHTML = `<div class="tour-dim" hidden></div><div class="tour-hole" hidden></div>` +
      `<div class="tour-bubble" role="dialog" aria-live="polite" aria-label="Tutorial">` +
      `<button class="tour-x" type="button" aria-label="Tutorial beenden">×</button>` +
      `<div class="tour-count"></div><h3 class="tour-title"></h3><div class="tour-text"></div><div class="tour-idle" hidden></div>` +
      `<div class="tour-bar"><button class="btn btn-ghost tour-back" type="button">Zurück</button><button class="btn btn-primary tour-next" type="button">Weiter</button></div></div>`;
    document.body.append(layer);
    return layer;
  }

  // ---------- starting a practice game from the start screen ----------
  async function startPractice(opts) {
    if ($("#game") && !$("#game").hidden) return true; // already at the table: explain what is there
    if (!$("#home") || $("#home").hidden) return false;
    const tab = $('[data-tab="local"]'); if (tab) tab.click();
    const resume = $("#resumePanel");
    if (resume && !resume.hidden && !(await confirmBox("Für das Tutorial startet ein neues Einzelspiel. Dein gespeichertes Einzelspiel geht dabei verloren."))) return false;
    // one opponent keeps it clear; the player's own choice is put back afterwards
    const want = opts.opponents == null ? 1 : opts.opponents;
    const cur = $("#oppBox [data-opp][aria-pressed=\"true\"]"), pick = $(`#oppBox [data-opp="${want}"]`);
    if (pick && cur !== pick) pick.click();
    if (opts.setup) await opts.setup();
    const go = $("#startLocal"); if (!go) return false;
    go.click();
    for (let i = 0; i < 40; i++) { if ($("#game") && !$("#game").hidden) break; await sleep(100); }
    if (cur && pick && cur !== pick) cur.click();
    return !!($("#game") && !$("#game").hidden);
  }
  function confirmBox(text) {
    return new Promise((resolve) => {
      const o = document.createElement("div");
      o.className = "overlay tour-confirm";
      o.innerHTML = `<div class="sheet" style="max-width:380px"><h2>Tutorial starten?</h2><p class="hint">${esc(text)}</p>` +
        `<div class="menubar"><button class="btn btn-ghost" type="button" data-no>Abbrechen</button><button class="btn btn-primary" type="button" data-yes>Los geht’s</button></div></div>`;
      o.addEventListener("click", (e) => { const y = e.target.closest("[data-yes]"), n = e.target.closest("[data-no]"); if (y || n || e.target === o) { o.remove(); resolve(!!y); } });
      document.body.append(o);
    });
  }

  // ---------- the tour ----------
  async function begin() {
    if (run) end();
    if (!def) return;
    const ok = await startPractice(def);
    if (!ok) return;
    const layer = build();
    const R = run = { layer, i: -1, step: null, tick: null, armed: false, advancing: false, scrolled: null, rect: "" };
    const q = (s) => $(s, layer);
    const bubble = q(".tour-bubble"), hole = q(".tour-hole"), dim = q(".tour-dim");
    const steps = def.steps;

    const onDown = (e) => {
      const st = R.step; if (!st || !st.tapSel) return;
      if (e.target.closest && e.target.closest(".tour")) return;
      if (resolve(st.tapSel).some((el) => el.contains(e.target))) R.armed = true;
    };
    const advanceSoon = (st) => {
      if (R.advancing) return;
      R.advancing = true;
      setTimeout(() => { R.advancing = false; if (run === R && R.step === st) go(R.i + 1); }, 450);
    };
    const onUp = () => { if (R.armed && R.step) { R.armed = false; advanceSoon(R.step); } };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); end(); } };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("keydown", onKey, true);
    const relayout = () => layout(true);
    R.off = () => {
      document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("pointerup", onUp, true); document.removeEventListener("keydown", onKey, true);
      clearInterval(R.tick); window.removeEventListener("resize", relayout);
    };

    function go(n) {
      if (run !== R) return;
      if (n >= steps.length) { finish(); return; }
      n = Math.max(0, n);
      R.i = n; R.armed = false; R.advancing = false; R.scrolled = null; R.rect = "";
      const st = R.step = steps[n], w = st.wait;
      st.tapSel = w === "tap" ? st.target : w && w.tap ? w.tap : null;
      q(".tour-count").textContent = `${n + 1} / ${steps.length}`;
      q(".tour-title").textContent = st.title || ""; q(".tour-title").hidden = !st.title;
      q(".tour-text").innerHTML = st.text;
      q(".tour-idle").hidden = true;
      const last = n === steps.length - 1, nextBtn = q(".tour-next");
      nextBtn.textContent = last ? "Fertig" : w ? "Überspringen" : "Weiter";
      nextBtn.classList.toggle("btn-primary", !w || last); nextBtn.classList.toggle("btn-ghost", !!w && !last);
      q(".tour-back").hidden = n === 0;
      bubble.classList.remove("pop"); void bubble.offsetWidth; bubble.classList.add("pop");
      if (st.pre) { try { st.pre($); } catch (e) { /* a missing element never stops the tour */ } }
      layout(true);
      if (!w) nextBtn.focus({ preventScroll: true });
    }
    function layout(force) {
      if (run !== R || !R.step) return;
      const st = R.step, els = resolve(st.target), hasTarget = !!st.target, idle = hasTarget && !els.length;
      q(".tour-idle").hidden = !idle;
      if (idle) q(".tour-idle").textContent = st.idle || "Gleich bist du dran …";
      if (st.wait && st.wait.until && !R.advancing) {
        let ok = false; try { ok = !!st.wait.until($); } catch (e) { ok = false; }
        if (ok) advanceSoon(st);
      }
      const vw = window.innerWidth, vh = window.innerHeight;
      let box = null;
      if (els.length) {
        box = union(els);
        const out = box.top < 0 || box.bottom > vh || box.left < 0 || box.right > vw;
        if (out && R.scrolled !== els[0]) { R.scrolled = els[0]; els[0].scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" }); box = union(resolve(st.target)); }
      }
      const key = (box ? [box.left, box.top, box.width, box.height] : [0]).concat([vw, vh, idle ? 1 : 0, q(".tour-text").offsetHeight]).map(Math.round).join();
      if (!force && key === R.rect) return;
      R.rect = key;
      dim.hidden = hasTarget; // a step without a target is a modal card over a dimmed game
      hole.hidden = !box;
      if (box) {
        const pad = 6, x = box.left - pad, y = box.top - pad, w = box.width + pad * 2, h = box.height + pad * 2;
        hole.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(Math.min(22, 10 + Math.min(w, h) / 8))}px`;
      }
      const bw = Math.min(360, vw - 24);
      bubble.style.width = bw + "px";
      const bh = bubble.offsetHeight, gap = 14, m = 12;
      let left = (vw - bw) / 2, top = (vh - bh) / 2;
      if (box) { // where the bubble covers the least of the highlighted area
        const above = box.top - m, below = vh - box.bottom - m;
        let place = st.place || (below >= bh + gap ? "bottom" : above >= bh + gap ? "top" : above > below ? "top" : "bottom");
        if (place === "bottom" && below < bh + gap && above > below) place = "top";
        else if (place === "top" && above < bh + gap && below > above) place = "bottom";
        top = place === "bottom" ? Math.min(box.bottom + gap + 6, vh - bh - m) : Math.max(m, box.top - gap - 6 - bh);
        left = Math.min(Math.max(m, box.left + box.width / 2 - bw / 2), vw - bw - m);
        if (!st.place && below < bh + gap && above < bh + gap) { // a big target: beside it, if there is room, instead of on top of it
          const right = vw - box.right - m, side = box.left - m;
          if (right >= bw + gap || side >= bw + gap) {
            left = right >= bw + gap ? box.right + gap + 6 : box.left - gap - 6 - bw;
            top = Math.min(Math.max(m, box.top + box.height / 2 - bh / 2), vh - bh - m);
          }
        }
      }
      bubble.style.left = Math.round(left) + "px"; bubble.style.top = Math.round(top) + "px";
    }
    window.addEventListener("resize", relayout);
    R.tick = setInterval(() => layout(false), 160);

    function finish() {
      try { K.store && K.store.set(DONE_KEY(window.Tutorial.gameId), 1); } catch (e) { /* storage may be blocked */ }
      end();
      if (K.toast) K.toast("Tutorial geschafft. Viel Spaß beim Spielen!");
    }
    q(".tour-x").addEventListener("click", end);
    q(".tour-next").addEventListener("click", () => go(R.i + 1));
    q(".tour-back").addEventListener("click", () => go(R.i - 1));
    go(0);
  }
  function end() {
    if (!run) return;
    run.off(); run.layer.remove(); run = null;
  }

  window.Tutorial = {
    gameId: "",
    define(d) { def = d; },
    begin, end,
    get active() { return !!run; },
    _resolve: resolve
  };
})();
