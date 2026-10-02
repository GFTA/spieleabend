// Shared card table mechanics for all card games: drag and drop (mouse + touch), flights, pile cascade.
// What a card looks like and which moves are legal stays in each game; this file only moves cards around.
// Load after kit.js, with cards.css:  <link rel="stylesheet" href="cards.css">  <script src="cards.js"></script>
//
//   Cards.dnd({ root, grab, target, drop, onStart, onEnd, tap })   drag a card, drop it on a target, snap back otherwise
//   Cards.flights({ resolve, off, onLand })                         animated moves; the target card stays hidden until it lands
//   Cards.cascade(n, { fmax, room })                                --f/--H for a pile whose cards overlap downwards
//   Cards.rectOf(el)                                                plain {left, top, width, height}
(function (root) {
  "use strict";
  const reduce = () => !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
  const place = (g, r) => { g.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;--w:${r.width}px`; };

  // n cards overlapping downwards: each card is shifted by f card heights, the whole pile is H card heights tall
  function cascade(n, o = {}) {
    const f = n > 1 ? Math.min(o.fmax || 0.27, (o.room || 1.25) / (n - 1)) : 0;
    return { f, H: n > 1 ? 1 + (n - 1) * f : 1 };
  }

  // ---------- drag and drop ----------
  // grab(e)           pointerdown on the table: return null (not draggable) or the thing picked up: { el, ...whatever you need }
  // target(under, s)  `under` is the element below the finger: return null or { el, ok, ... } (ok: it would accept the card)
  // drop(s, t, rect)  let go on target t (only called when there is one): do the move and return true, or return false to snap back.
  //                   rect is where the card was let go, so the flight into its place can start there
  // onStart(s)        the drag began (clear selections here)
  // onEnd(dirty)      the drag is over; dirty = a redraw was held back by defer()
  // tap(e)            a click that was not the end of a drag
  function dnd(o) {
    const box = typeof o.root === "string" ? document.querySelector(o.root) : o.root;
    const slop = o.slop || 8;
    let drag = null, dirty = false, lastDrag = 0, over = null;
    const setOver = (el) => {
      if (over && over !== el) over.classList.remove("cd-over");
      over = el || null;
      if (el) el.classList.add("cd-over");
    };

    box.addEventListener("pointerdown", (e) => {
      if (drag || e.button > 0) return;
      const s = o.grab(e);
      if (!s || !s.el) return;
      drag = { s, el: s.el, x0: e.clientX, y0: e.clientY, id: e.pointerId, started: false, ghost: null };
    });
    document.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.started) {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < slop) return;
        start();
      }
      e.preventDefault();
      drag.ghost.style.left = e.clientX - drag.dx + "px";
      drag.ghost.style.top = e.clientY - drag.dy + "px";
      const t = targetAt(e);
      setOver(t && t.ok ? t.el : null);
    }, { passive: false });
    document.addEventListener("pointerup", (e) => end(e, false));
    document.addEventListener("pointercancel", (e) => end(e, true));
    if (o.tap) box.addEventListener("click", (e) => { if (Date.now() - lastDrag >= 400) o.tap(e); });

    function start() {
      const r = rectOf(drag.el), g = document.createElement("div");
      drag.started = true; drag.rect = r;
      g.className = "cd-ghost";
      place(g, r);
      const clone = drag.el.cloneNode(true);
      clone.classList.remove("sel", "cd-dragging", "cd-sent", "cd-lift");
      clone.style.cssText = "";
      g.appendChild(clone);
      document.body.appendChild(g);
      drag.ghost = g; drag.dx = drag.x0 - r.left; drag.dy = drag.y0 - r.top;
      drag.el.classList.add("cd-dragging");
      if (o.onStart) o.onStart(drag.s);
    }
    function targetAt(e) {
      drag.ghost.style.display = "none";
      const under = document.elementFromPoint(e.clientX, e.clientY);
      drag.ghost.style.display = "";
      return under ? o.target(under, drag.s) || null : null;
    }
    function end(e, cancelled) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      const d = drag;
      if (!d.started) { drag = null; return; }
      const t = !cancelled && e ? targetAt(e) : null;
      const r = rectOf(d.ghost);
      drag = null;
      lastDrag = Date.now();
      setOver(null);
      const done = t ? !!o.drop(d.s, t, r) : false;
      if (done) d.ghost.remove();
      else {
        d.el.classList.remove("cd-dragging");
        const a = reduce() ? null : d.ghost.animate([{ transform: "none" }, { transform: `translate(${d.rect.left - r.left}px,${d.rect.top - r.top}px)` }], { duration: 200, easing: "ease-out" });
        if (a) a.onfinish = () => d.ghost.remove(); else d.ghost.remove();
      }
      const was = dirty; dirty = false;
      if (o.onEnd) o.onEnd(was);
    }

    return {
      get busy() { return !!drag; },                       // a finger is down on a card (maybe not yet dragging)
      get active() { return !!(drag && drag.started); },   // a card is being dragged
      get src() { return drag && drag.started ? drag.s : null; },
      // call at the top of render(): while a card is in the air the redraw waits (onEnd(true) tells you to do it)
      defer() { if (drag && drag.started) { dirty = true; return true; } return false; }
    };
  }

  // ---------- flights ----------
  // resolve(dst)  where a flight lands, looked up in the freshly drawn table: { rect, hide } or null.
  //               hide is the element that stays invisible until the card has landed
  // off()         optional: true while nothing is on screen (no flights then)
  // onLand(f)     optional: after a flight ended
  // add({ src, dst, html, delay, dur, flipTo, sweep })
  //   src      rect where the card starts          dst   anything resolve() understands
  //   html     what the flying card looks like     flipTo  html it turns into on the way (a card drawn face down)
  //   delay    ms until it takes off, dur ms in the air
  //   sweep    () => rect: after landing the card flies on to this rect and fades (a completed pile is cleared)
  // Call add() while handling the events, run() after the table is redrawn, hide() after every redraw.
  function flights(o) {
    const queue = [], active = [];
    function hide() {
      const now = performance.now();
      for (let i = active.length - 1; i >= 0; i--) {
        const f = active[i];
        if (f.done || now > f.until) { active.splice(i, 1); continue; }
        const r = o.resolve(f.dst);
        if (r && r.hide) r.hide.style.visibility = "hidden";
      }
    }
    function run() {
      const list = queue.splice(0);
      if (reduce() || (o.off && o.off())) return;
      for (const f of list) {
        if (!f.src || !o.resolve(f.dst)) continue;
        f.until = performance.now() + f.delay + f.dur + 400;
        active.push(f);
        setTimeout(() => fly(f), f.delay);
      }
      hide();
    }
    function fly(f) {
      const to = o.resolve(f.dst);
      if (!to) { f.done = true; return; }
      const s = f.src, d = to.rect, g = document.createElement("div");
      g.className = "cd-ghost";
      place(g, s);
      g.innerHTML = f.html;
      document.body.appendChild(g);
      const sc = d.width / s.width, dx = d.left - s.left, dy = d.top - s.top;
      let kf = [{ transform: "translate(0,0) scale(1)" }, { transform: `translate(${dx}px,${dy}px) scale(${sc})` }];
      const sw = f.sweep && f.sweep();
      if (sw) {
        const ex = sw.left - s.left, ey = sw.top - s.top;
        kf = [
          { transform: "translate(0,0) scale(1)", offset: 0 },
          { transform: `translate(${dx}px,${dy}px) scale(${sc})`, offset: 0.34, easing: "cubic-bezier(.2,.7,.3,1)" },
          { transform: `translate(${dx}px,${dy}px) scale(${sc * 1.12})`, offset: 0.52 },
          { transform: `translate(${ex}px,${ey}px) scale(${sw.width / s.width * 0.8})`, opacity: 0.1, offset: 1 }
        ];
      }
      if (f.flipTo) setTimeout(() => { g.innerHTML = f.flipTo; }, f.dur * 0.45);
      const a = g.animate(kf, { duration: f.dur, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" });
      const end = () => {
        g.remove(); f.done = true;
        const r = o.resolve(f.dst);
        if (r && r.hide) r.hide.style.visibility = "";
        if (o.onLand) o.onLand(f);
      };
      a.onfinish = end; a.oncancel = end;
    }
    return { add(f) { queue.push(f); }, run, hide, clear() { queue.length = 0; } };
  }

  root.Cards = { dnd, flights, cascade, rectOf };
})(typeof window !== "undefined" ? window : globalThis);
