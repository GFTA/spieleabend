// Shared card table mechanics for all card games: drag and drop (mouse + touch), flights, pile cascade.
// What a card looks like and which moves are legal stays in each game; this file only moves cards around.
// Load after kit.js, with cards.css:  <link rel="stylesheet" href="cards.css">  <script src="cards.js"></script>
//
//   Cards.dnd({ root, grab, target, drop, ... })   drag a card, drop it on a target, snap back otherwise
//   Cards.fly({ rect, html, ... })                 one card in the air (optionally turning over); the primitive under flights
//   Cards.flights({ resolve, off, onLand })        animated moves; the target card stays hidden until it lands
//   Cards.cascade(n, { fmax, room })               --f/--H for a pile whose cards overlap downwards
//   Cards.autoFlip(box, sel)                       a hand that slides smoothly whenever cards come and go (FLIP)
//   Cards.shuffle(rect, { html, n })               a riffle shuffle played on a pile
//   Cards.rectOf(el), Cards.reduced()              plain {left, top, width, height, right, bottom}; prefers-reduced-motion
(function (root) {
  "use strict";
  const reduce = () => !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const box4 = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return box4(r.left, r.top, r.width, r.height); };
  // --w is the card width for cards that size themselves with --w, --cw for the ones that use --cw
  const place = (g, r) => { g.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;--w:${r.width}px;--cw:${r.width}px`; };
  const faceOf = (html, cls) => {
    const t = document.createElement("template");
    t.innerHTML = String(html).trim();
    const el = t.content.firstElementChild;
    el.classList.add(cls);
    return el;
  };

  // n cards overlapping downwards: each card is shifted by f card heights, the whole pile is H card heights tall
  function cascade(n, o = {}) {
    const f = n > 1 ? Math.min(o.fmax || 0.27, (o.room || 1.25) / (n - 1)) : 0;
    return { f, H: n > 1 ? 1 + (n - 1) * f : 1 };
  }

  // ---------- drag and drop ----------
  // grab(e)            pointerdown inside root: return null (not draggable) or the thing picked up: { el, hold?, ...whatever you need }
  //                    el is what gets cloned into the ghost; hold (default el) is what the finger went down on
  // target(under, s, e) `under` is the element below the finger (maybe null): return null or { el, ok, ... } (ok: it would accept the card)
  // drop(s, t, rect)   let go on target t (only called when there is one): do the move and return true, or return false to snap back.
  //                    rect is where the card was let go, so the flight into its place can start there
  // zones(s)           optional: [{ el, ok }] every place a card could go; while dragging those that fit light up (.cd-drop), the rest dim
  // onStart(s)         the drag began (clear selections here)
  // onEnd(dirty, s, { started, dropped })   every press is over (also taps and aborts); dirty = a redraw was held back by defer()
  // tap(e)             a click that was not the end of a drag
  // slop               pixels before a press turns into a drag (8)
  // canStart(s,dx,dy,e) at the moment the slop is passed: return false to give up on this press (a swipe that should scroll)
  // release(s,e,info)  at pointerup, before the drop; info = { started, ms, dist, t }. Return true when it was a tap (you did the
  //                    tap yourself): the card then goes back without a drop
  // tilt               the ghost leans into the direction of the drag
  // strip              extra classes to take off the cloned card
  function dnd(o) {
    const box = typeof o.root === "string" ? document.querySelector(o.root) : (o.root || document);
    const slop = o.slop || 8;
    const strip = ["sel", "cd-dragging", "cd-sent", "cd-lift"].concat(o.strip || []);
    let drag = null, dirty = false, lastDrag = 0, over = null, zones = [];
    // iOS Safari sends pointermove/up to the element the finger went down on, even when a redraw removed it from
    // the page; then nothing reaches the document. So we listen on that element too and count each event once.
    const seen = new WeakSet();
    const once = (e) => { if (seen.has(e)) return false; seen.add(e); return true; };
    const onMove = (e) => { if (once(e)) move(e); };
    const onUp = (e) => { if (once(e)) conclude(e, "up"); };
    const onCancel = (e) => { if (once(e)) conclude(e, "cancel"); };
    const setOver = (el) => {
      if (over && over !== el) over.classList.remove("cd-over");
      over = el || null;
      if (el) el.classList.add("cd-over");
    };

    box.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      if (drag) { if (e.isPrimary === false) return; conclude(null, "abort"); } // a second finger leaves it alone; a fresh touch drops a stale drag
      const s = o.grab(e);
      if (!s || !s.el) return;
      const hold = s.hold || s.el;
      drag = { s, el: s.el, hold, x0: e.clientX, y0: e.clientY, id: e.pointerId, t0: Date.now(), started: false, ghost: null };
      hold.addEventListener("pointermove", onMove, { passive: false });
      hold.addEventListener("pointerup", onUp);
      hold.addEventListener("pointercancel", onCancel);
    });
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    root.addEventListener("blur", () => { if (drag) conclude(null, "abort"); });
    if (o.tap) box.addEventListener("click", (e) => { if (Date.now() - lastDrag >= 400) o.tap(e); });

    function move(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.started) {
        if (Math.hypot(dx, dy) < slop) return;
        if (o.canStart && o.canStart(drag.s, dx, dy, e) === false) { conclude(null, "abort"); return; }
        if (!drag) return;
        start();
      }
      e.preventDefault();
      drag.gx = e.clientX - drag.ox; drag.gy = e.clientY - drag.oy;
      drag.ghost.style.left = drag.gx + "px";
      drag.ghost.style.top = drag.gy + "px";
      if (o.tilt) drag.ghost.style.transform = `rotate(${Math.max(-12, Math.min(12, dx / 12))}deg) scale(1.06)`;
      const t = targetAt(e, drag);
      setOver(t && t.ok ? t.el : null);
    }
    function start() {
      const r = rectOf(drag.el), g = document.createElement("div");
      drag.started = true; drag.rect = r;
      g.className = "cd-ghost cd-held";
      place(g, r);
      if (o.tilt) g.style.transformOrigin = "50% 50%";
      const clone = drag.el.cloneNode(true);
      clone.classList.remove(...strip);
      clone.style.cssText = "";
      g.appendChild(clone);
      document.body.appendChild(g);
      document.body.classList.add("cd-grabbing");
      drag.ghost = g; drag.ox = drag.x0 - r.left; drag.oy = drag.y0 - r.top; drag.gx = r.left; drag.gy = r.top;
      drag.el.classList.add("cd-dragging");
      if (o.onStart) o.onStart(drag.s);
      if (o.zones) {
        zones = o.zones(drag.s) || [];
        for (const z of zones) { z.el.classList.add("cd-zone"); z.el.classList.toggle("cd-drop", !!z.ok); }
        document.body.classList.add("cd-dragging-on");
      }
    }
    function targetAt(e, d) {
      d.ghost.style.display = "none";
      const under = document.elementFromPoint(e.clientX, e.clientY);
      d.ghost.style.display = "";
      return o.target(under, d.s, e) || null;
    }
    // mode: "up" (finger lifted), "cancel" (the system took the touch), "abort" (given up: swipe, stale, window lost focus)
    function conclude(e, mode) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      const d = drag;
      drag = null;
      d.hold.removeEventListener("pointermove", onMove, { passive: false });
      d.hold.removeEventListener("pointerup", onUp);
      d.hold.removeEventListener("pointercancel", onCancel);
      setOver(null);
      if (zones.length) { for (const z of zones) z.el.classList.remove("cd-zone", "cd-drop"); zones = []; document.body.classList.remove("cd-dragging-on"); }
      document.body.classList.remove("cd-grabbing");
      let t = null, tapped = false, dropped = false;
      if (mode === "up") {
        if (d.started) t = targetAt(e, d);
        if (o.release) tapped = !!o.release(d.s, e, { started: d.started, ms: Date.now() - d.t0, dist: Math.hypot(e.clientX - d.x0, e.clientY - d.y0), t });
      }
      if (d.started) {
        if (!tapped && mode !== "abort") lastDrag = Date.now();
        if (mode === "up" && !tapped && t) dropped = !!o.drop(d.s, t, box4(d.gx, d.gy, d.rect.width, d.rect.height));
        if (dropped) d.ghost.remove();
        else {
          d.el.classList.remove("cd-dragging");
          if (tapped || mode === "abort" || reduce()) d.ghost.remove();
          else {
            const from = d.ghost.style.transform || "none";
            const a = d.ghost.animate([{ transform: from }, { transform: `translate(${d.rect.left - d.gx}px,${d.rect.top - d.gy}px)` }], { duration: 200, easing: "ease-out" });
            a.onfinish = () => d.ghost.remove();
            setTimeout(() => d.ghost.remove(), 600);
          }
        }
      }
      const was = dirty; dirty = false;
      if (o.onEnd) o.onEnd(was, d.s, { started: d.started, dropped });
    }

    return {
      get busy() { return !!drag; },                       // a finger is down on a card (maybe not yet dragging)
      get active() { return !!(drag && drag.started); },   // a card is being dragged
      get src() { return drag && drag.started ? drag.s : null; },
      get since() { return Date.now() - lastDrag; },       // ms since the last drag ended (to ignore the click that follows)
      // call at the top of render(): while a card is in the air the redraw waits (onEnd(true) tells you to do it)
      defer() { if (drag && drag.started) { dirty = true; return true; } return false; }
    };
  }

  // ---------- one card in the air ----------
  // fly({ rect, html, flip, to, frames, dur, delay, easing, fill, hide, hideBy, onEnd }) -> { el, cancel } (null: reduced motion)
  //   rect     where it takes off ({left, top, width, height}); the card is drawn that size
  //   html     what it looks like           flip   html it turns into on the way (a card drawn face down)
  //   to       rect it lands on (a straight flight)      frames  or your own keyframes, relative to rect (flipFrames: the turn's own)
  //   hide     element that stays invisible until the card has landed (hideBy: "visibility" (default) or "opacity")
  function fly(o) {
    if (reduce()) return null;
    const s = o.rect, g = document.createElement("div");
    let inner = null;
    g.className = "cd-ghost" + (o.flip ? " cd-flip" : "");
    place(g, s);
    if (o.flip) {
      inner = document.createElement("div");
      inner.className = "cd-fly-inner";
      inner.append(faceOf(o.html, "cd-face"), faceOf(o.flip, "cd-rev"));
      g.append(inner);
    } else g.innerHTML = o.html;
    document.body.appendChild(g);
    const h = o.hide, by = o.hideBy || "visibility";
    if (h) h.style[by] = by === "opacity" ? "0" : "hidden";
    const kf = o.frames || [{ transform: "none" }, { transform: `translate(${o.to.left - s.left}px,${o.to.top - s.top}px) scale(${o.to.width / s.width})` }];
    const dur = o.dur || 420, delay = o.delay || 0;
    const timing = { duration: dur, delay, easing: o.easing || "cubic-bezier(.2,.7,.3,1)", fill: o.fill || "both" };
    const a = g.animate(kf, timing);
    if (inner) inner.animate(o.flipFrames || [{ transform: "rotateY(0deg)" }, { transform: "rotateY(180deg)" }], timing);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      g.remove();
      if (h) h.style[by] = "";
      if (o.onEnd) o.onEnd();
    };
    a.onfinish = end; a.oncancel = end;
    setTimeout(end, dur + delay + 400);
    return { el: g, cancel: () => a.cancel() };
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
  //   turn     true: the card lifts off, turns over slowly (needs flipTo) and only then flies on (a tense draw)
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
        setTimeout(() => go(f), f.delay);
      }
      hide();
    }
    function go(f) {
      const to = o.resolve(f.dst);
      if (!to) { f.done = true; return; }
      const s = f.src, d = to.rect;
      const sc = d.width / s.width, dx = d.left - s.left, dy = d.top - s.top;
      let frames = null;
      const sw = f.sweep && f.sweep();
      if (sw) {
        const ex = sw.left - s.left, ey = sw.top - s.top;
        frames = [
          { transform: "translate(0,0) scale(1)", offset: 0 },
          { transform: `translate(${dx}px,${dy}px) scale(${sc})`, offset: 0.34, easing: "cubic-bezier(.2,.7,.3,1)" },
          { transform: `translate(${dx}px,${dy}px) scale(${sc * 1.12})`, offset: 0.52 },
          { transform: `translate(${ex}px,${ey}px) scale(${sw.width / s.width * 0.8})`, opacity: 0.1, offset: 1 }
        ];
      }
      let flipFrames = null;
      if (f.turn && f.flipTo) {
        const cx = d.left + d.width / 2 - (s.left + s.width / 2), cy = d.top + d.height / 2 - (s.top + s.height / 2);
        const mid = `translate(${cx * 0.12}px,${cy * 0.12 - s.height * 0.55}px) scale(${sc * 1.45})`, fin = `translate(${cx}px,${cy}px) scale(${sc})`;
        frames = [
          { transform: "translate(0,0) scale(1)", offset: 0 },
          { transform: mid, offset: 0.3, easing: "ease-in-out" },
          { transform: mid, offset: 0.8, easing: "cubic-bezier(.2,.7,.3,1)" },
          { transform: fin, offset: 1 }
        ];
        flipFrames = [
          { transform: "rotateY(0deg)", offset: 0 },
          { transform: "rotateY(0deg)", offset: 0.3, easing: "ease-in-out" },
          { transform: "rotateY(180deg)", offset: 0.62 },
          { transform: "rotateY(180deg)", offset: 1 }
        ];
      }
      const ok = fly({
        rect: s, html: f.html, flip: f.flipTo, to: d, frames, flipFrames, dur: f.dur, fill: "forwards",
        onEnd() {
          f.done = true;
          const r = o.resolve(f.dst);
          if (r && r.hide) r.hide.style.visibility = "";
          if (o.onLand) o.onLand(f);
        }
      });
      if (!ok) f.done = true;
    }
    return { add(f) { queue.push(f); }, run, hide, clear() { queue.length = 0; } };
  }

  // ---------- a hand that slides ----------
  // Remembers where every card stood; when the hand is redrawn (innerHTML) cards that were there before glide from the old
  // spot to the new one. Cards are matched by data-id (or data-v, or their look); new cards are the flights' business.
  function autoFlip(box, sel = ":scope > *") {
    box = typeof box === "string" ? document.querySelector(box) : box;
    if (!box) return;
    let prev = new Map(), pw = 0;
    const snap = () => {
      const m = new Map(), seen = {}, b = box.getBoundingClientRect();
      for (const el of box.querySelectorAll(sel)) {
        const d = el.dataset;
        const base = d.id != null ? "i" + d.id : d.v != null ? "v" + d.v : d.c != null ? "c" + d.c : el.textContent + "|" + [...el.classList].filter((c) => !/^(sel|cd-|hot|new|can|ok|dim|bad|pick|fan)/.test(c)).join(".");
        const k = base + "#" + (seen[base] = (seen[base] || 0) + 1), r = el.getBoundingClientRect();
        m.set(k, { el, x: r.left - b.left + box.scrollLeft, y: r.top - b.top + box.scrollTop });
      }
      return { m, w: b.width };
    };
    new MutationObserver(() => {
      const now = snap();
      if (!reduce() && now.w && Math.abs(now.w - pw) < 2 && !document.hidden)
        for (const [k, c] of now.m) {
          const p = prev.get(k);
          if (!p || p.el === c.el || c.el.classList.contains("cd-dragging")) continue;
          const dx = p.x - c.x, dy = p.y - c.y;
          if (Math.abs(dx) + Math.abs(dy) < 2 || Math.abs(dx) + Math.abs(dy) > 900) continue;
          c.el.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: 280, easing: "cubic-bezier(.2,.7,.3,1)" });
        }
      prev = now.m; pw = now.w;
    }).observe(box, { childList: true });
    const first = snap(); prev = first.m; pw = first.w;
  }

  // ---------- a riffle shuffle on a pile ----------
  function shuffle(rect, o = {}) {
    if (reduce() || !rect || !rect.width) return;
    const n = o.n || 8, w = rect.width;
    for (let i = 0; i < n; i++) {
      const g = document.createElement("div");
      g.className = "cd-ghost";
      place(g, rect);
      g.innerHTML = o.html || "";
      document.body.appendChild(g);
      const side = i % 2 ? 1 : -1;
      const a = g.animate([
        { transform: "translate(0,0) rotate(0deg)", offset: 0 },
        { transform: `translate(${side * w * 0.85}px,${-rect.height * 0.12}px) rotate(${side * 16}deg)`, offset: 0.42 },
        { transform: `translate(${side * w * 0.12}px,${-rect.height * 0.04}px) rotate(${side * 3}deg)`, offset: 0.75 },
        { transform: "translate(0,0) rotate(0deg)", offset: 1 }
      ], { duration: 640, delay: i * 55, easing: "ease-in-out", fill: "both" });
      a.onfinish = a.oncancel = () => g.remove();
    }
  }

  root.Cards = { dnd, fly, flights, cascade, rectOf, reduced: reduce, autoFlip, shuffle };
})(typeof window !== "undefined" ? window : globalThis);
