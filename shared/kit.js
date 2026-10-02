// Shared browser base of every Spieleabend game, loaded first (before room-ui.js, game.js
// and app.js): local storage, the table design and size (with the ?table= hand-off from the
// start page), name and avatar (?name=&av= hand-off, avatar picker), toast, confetti,
// reaction bubbles, sound/haptics/wake lock, the settings that follow the player into every game
// (profile prefs: table, sound, volume, less motion, high contrast, notifications), dialog focus
// handling and the link back to the start page. app.js uses it as window.Spieleabend.
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  // drop hand-off parameters from the address bar without touching the others (?r=CODE)
  function dropParams(...names) {
    const q = new URLSearchParams(location.search);
    if (!names.some((n) => q.has(n))) return;
    for (const n of names) q.delete(n);
    history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : ""));
  }

  // ---------- look: table design and size, applied before anything is drawn ----------
  const TABLES = [["night", "Nacht", "#1a1426"], ["felt", "Filz", "#15372a"], ["ocean", "Ozean", "#15243a"], ["light", "Hell", "#eceff5"], ["blossom", "Blüte", "#f7c6d9"], ["vulkan", "Vulkan", "#301c17"], ["mint", "Minze", "#dff3ea"]];
  const SIZES = [["0.85", "Klein"], ["1", "Normal"], ["1.15", "Groß"]];
  // key: where the choice is stored; sizeLabel: "Größe", "Kartengröße", ...; onChange: redraw after a change
  function look({ key, sizeLabel = "Größe", onChange }) {
    const saved = store.get(key) || {}, cur = Object.assign({ table: "night", size: "1" }, saved);
    const known = (t) => TABLES.some((x) => x[0] === t);
    // order: hand-off from the start page (?table=), the table chosen in any game or the start page
    // (profile), what this game stored before, the system's light/dark setting
    const qTable = new URLSearchParams(location.search).get("table"), pTable = P.prefs().table;
    if (qTable && known(qTable)) { cur.table = qTable; store.set(key, cur); P.setPrefs({ table: qTable }); }
    else if (pTable && known(pTable)) cur.table = pTable;
    else if (!saved.table && matchMedia("(prefers-color-scheme: light)").matches) cur.table = "light";
    dropParams("table");
    function apply() {
      const root = document.documentElement, t = TABLES.find((x) => x[0] === cur.table) || TABLES[0];
      if (t[0] === "night") delete root.dataset.table; else root.dataset.table = t[0];
      root.style.setProperty("--cs", (SIZES.find((x) => x[0] === cur.size) || SIZES[1])[0]);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", getComputedStyle(root).getPropertyValue("--bg").trim() || t[2]);
    }
    // the design buttons live in the settings menu (#lookSettings)
    function render() {
      const html = `<div class="label">Tisch</div><div class="seg tables">${TABLES.map(([k, n, c]) =>
        `<button type="button" data-table="${k}" aria-pressed="${cur.table === k}"><span class="swatch" style="background:${c}"></span>${n}</button>`).join("")}</div>` +
        `<div class="label">${sizeLabel}</div><div class="seg three">${SIZES.map(([k, n]) =>
        `<button type="button" data-size="${k}" aria-pressed="${cur.size === k}">${n}</button>`).join("")}</div>`;
      const el = $("#lookSettings"); if (el && el.innerHTML !== html) el.innerHTML = html;
    }
    { const el = $("#lookSettings"); if (el) el.addEventListener("click", (e) => {
      const t = e.target.closest("[data-table]"), z = e.target.closest("[data-size]");
      if (!t && !z) return;
      if (t) cur.table = t.dataset.table;
      if (z) cur.size = z.dataset.size;
      store.set(key, cur); if (t) P.setPrefs({ table: cur.table }); apply(); render();
      if (onChange) onChange();
    }); }
    apply();
    return { render, apply, get: () => cur };
  }

  // ---------- name and avatar (the profile: shared/profile.js) ----------
  const P = window.SAProfile, COLORS = window.SAAvatars.COLORS;

  // ---------- settings that follow the player (profile prefs) ----------
  const pref = (k, d) => { const v = P.prefs()[k]; return v === undefined ? d : v; };
  const calm = () => pref("motion", true) === false; // "less motion" chosen by hand, on top of the system setting
  const REDUCE = /prefers-reduced-motion:\s*reduce/;
  const nativeMatchMedia = window.matchMedia.bind(window);
  // every game asks matchMedia("(prefers-reduced-motion: reduce)") before it animates: say yes when the player chose less motion
  window.matchMedia = (q) => calm() && REDUCE.test(q)
    ? { matches: true, media: String(q), onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
    : nativeMatchMedia(q);
  if (Element.prototype.animate) {
    const nativeAnimate = Element.prototype.animate;
    Element.prototype.animate = function (kf, opts) {
      if (calm()) opts = typeof opts === "number" ? 1 : Object.assign({}, opts, { duration: 1, delay: 0, endDelay: 0, iterations: 1 });
      return nativeAnimate.call(this, kf, opts);
    };
  }
  function applyPrefs() {
    const root = document.documentElement;
    if (calm()) root.dataset.motion = "off"; else delete root.dataset.motion;
    if (pref("contrast", false)) root.dataset.contrast = "high"; else delete root.dataset.contrast;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) { const bg = getComputedStyle(root).getPropertyValue("--bg").trim(); if (bg) meta.setAttribute("content", bg); }
  }
  applyPrefs();
  P.onChange(applyPrefs);

  // screen reader announcements: a polite live region (toasts are one themselves)
  let liveEl = null;
  function say(text) {
    if (!text) return;
    if (!liveEl) {
      liveEl = document.createElement("div");
      liveEl.setAttribute("role", "status"); liveEl.setAttribute("aria-live", "polite");
      liveEl.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap";
      document.body.appendChild(liveEl);
    }
    liveEl.textContent = "";
    setTimeout(() => { liveEl.textContent = text; }, 40);
  }
  // The name and avatar to start with: a hand-off from the start page (?name=&av=), else the
  // profile, else what this game stored before (which the profile then adopts).
  function identity({ me, avatar, avatars }) {
    const q = new URLSearchParams(location.search), qn = (q.get("name") || "").trim().slice(0, 18), qa = q.get("av");
    const p = P.get();
    const name = qn || p.name || String(store.get(me) || "").trim().slice(0, 18);
    let a = qa && avatars.includes(qa) ? qa : avatars.includes(p.av) ? p.av : avatars.includes(store.get(avatar)) ? store.get(avatar) : avatars[Math.floor(Math.random() * avatars.length)];
    if (name) store.set(me, name);
    dropParams("name", "av");
    store.set(avatar, a);
    if (name !== p.name || a !== p.av) P.set({ name, av: a });
    const nameField = $("#myName");
    if (nameField) nameField.addEventListener("input", () => P.set({ name: nameField.value.trim() }));
    return a;
  }
  // colour swatches + avatar grid; data-col / data-pick buttons
  function pickerHTML(avatars, cur, col) {
    return `<div class="avcols" role="group" aria-label="Farbe">` +
      `<button type="button" data-col="" class="avnone" aria-pressed="${!col}" aria-label="Keine Farbe">∅</button>` +
      COLORS.map((c) => `<button type="button" data-col="${c}" aria-pressed="${c === col}" style="background:${c}" aria-label="Farbe ${c}"></button>`).join("") + `</div>` +
      avatars.map((a) => `<button type="button" data-pick="${a}" aria-pressed="${a === cur}">${a}</button>`).join("");
  }
  // the avatar button next to the name field (#myAvatar) opens a grid (#avatarGrid) to pick from
  function avatarPicker({ avatars, get, set }) {
    const btn = $("#myAvatar"), grid = $("#avatarGrid");
    const paint = () => { btn.style.background = P.get().col || ""; };
    paint();
    btn.addEventListener("click", () => {
      grid.innerHTML = pickerHTML(avatars, get(), P.get().col);
      grid.hidden = !grid.hidden;
    });
    grid.addEventListener("click", (e) => {
      const c = e.target.closest("[data-col]");
      if (c) { P.set({ col: c.dataset.col }); paint(); grid.innerHTML = pickerHTML(avatars, get(), P.get().col); return; }
      const b = e.target.closest("[data-pick]"); if (!b) return;
      set(b.dataset.pick); P.set({ av: b.dataset.pick });
      grid.hidden = true; btn.textContent = b.dataset.pick;
    });
  }

  // A row of player plates that scrolls sideways: whenever another player gets the turn, bring them into view.
  // sels: selectors of the highlighted plate, the first one that exists wins
  function followTurn(box, sels) {
    box = typeof box === "string" ? $(box) : box;
    if (!box) return;
    sels = [].concat(sels);
    let last = null, left = 0, raf = 0;
    box.addEventListener("scroll", () => { left = box.scrollLeft; }, { passive: true });
    const find = () => { for (const s of sels) { const a = box.querySelector(s); if (a) return a; } return null; };
    const run = () => {
      raf = 0;
      const a = find();
      if (!a) { last = null; return; }
      if (!box.clientWidth) return;
      const key = [...a.parentNode.children].indexOf(a);
      if (key === last) { if (Math.abs(box.scrollLeft - left) > 1) box.scrollLeft = left; return; } // the row was redrawn: keep where it was
      last = key;
      const c = box.getBoundingClientRect(), r = a.getBoundingClientRect();
      if (r.left >= c.left + 4 && r.right <= c.right - 4) return;
      box.scrollTo({ left: box.scrollLeft + (r.left + r.width / 2) - (c.left + c.width / 2), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    };
    new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(run); }).observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    raf = requestAnimationFrame(run);
  }

  // ---------- feedback ----------
  let toastT = null;
  function toast(msg) {
    if (!msg) return;
    const t = $("#toast");
    if (!t.getAttribute("role")) { t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); }
    t.textContent = msg; t.classList.remove("off");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("off"), 2800);
  }
  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cv = $("#confetti"), ctx = cv.getContext("2d"), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; cv.hidden = false;
    const cols = ["#e0393e", "#f2c230", "#2fa35b", "#2d6fd6", "#ffffff"];
    const ps = Array.from({ length: 140 }, () => ({
      x: Math.random() * cv.width, y: -Math.random() * cv.height * 0.5, w: (6 + Math.random() * 6) * dpr, h: (10 + Math.random() * 8) * dpr,
      vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: cols[(Math.random() * 5) | 0]
    }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05 * dpr; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      }
      if (t - t0 < 3200) requestAnimationFrame(frame); else { ctx.clearRect(0, 0, cv.width, cv.height); cv.hidden = true; }
    })(t0);
  }
  // a reaction bubble as a fixed overlay above the player (below it near the top edge), kept on screen
  function showBubble(host, b) {
    const r = host.getBoundingClientRect(), down = r.top < 110;
    b.style.top = (down ? r.bottom + 6 : r.top - 6) + "px";
    if (down) b.classList.add("down");
    document.body.appendChild(b);
    const w = b.offsetWidth / 2 + 8;
    b.style.left = Math.min(innerWidth - w, Math.max(w, r.left + r.width / 2)) + "px";
  }

  // back to the Spieleabend start page: games.cool-kidz.net behind the tunnel, port 8090 of the
  // same box in the LAN (after all scripts ran, so the menu's link exists too)
  const startUrl = (search = "") =>
    (/^https?:$/.test(location.protocol) && !/(^|\.)cool-kidz\.net$/.test(location.hostname)
      ? `${location.protocol}//${location.hostname}:8090/` : "https://games.cool-kidz.net/") + search;
  document.addEventListener("DOMContentLoaded", () => {
    if (/^https?:$/.test(location.protocol) && !/(^|\.)cool-kidz\.net$/.test(location.hostname))
      for (const a of document.querySelectorAll("[data-start-link]")) a.href = startUrl(a.dataset.startLink);
  });

  // ---------- your turn: breathing screen edge, blinking tab title ----------
  const desktop = () => matchMedia("(hover: hover) and (pointer: fine)").matches;
  function mine(on) { document.body.classList.toggle("myturn", !!on); }
  let titleT = 0;
  function attention() {
    if (titleT || (document.hasFocus() && document.visibilityState === "visible")) return;
    const base = document.title; let n = 0;
    const stop = () => { clearInterval(titleT); titleT = 0; document.title = base; removeEventListener("focus", stop); document.removeEventListener("visibilitychange", vis); };
    const vis = () => { if (document.visibilityState === "visible" && document.hasFocus()) stop(); };
    titleT = setInterval(() => { document.title = n++ % 2 ? base : "🔔 Du bist dran!"; }, 1000);
    document.title = "🔔 Du bist dran!";
    addEventListener("focus", stop); document.addEventListener("visibilitychange", vis);
  }
  // a desktop notification when it is my turn and the tab is in the background (only if the player allowed it in the settings)
  let note = null;
  function notify(title, body) {
    if (!pref("notify", false) || !("Notification" in window) || Notification.permission !== "granted" || document.visibilityState === "visible") return;
    try {
      if (note) note.close();
      note = new Notification(title, { body, tag: "spieleabend-turn" });
      note.onclick = () => { window.focus(); note.close(); };
    } catch (e) {}
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && note) { try { note.close(); } catch (e) {} note = null; } });
  // a red dot on the tab icon while it is my turn
  let iconBase = null, iconType = "", iconDot = null, dotWanted = false;
  function badge(on) {
    dotWanted = !!on;
    const link = document.querySelector('link[rel~="icon"]');
    if (!link) return;
    if (iconBase === null) { iconBase = link.href; iconType = link.type; }
    const show = () => { link.type = "image/png"; link.href = iconDot; };
    if (!on) { if (link.href !== iconBase) { link.href = iconBase; link.type = iconType; } return; }
    if (iconDot) return show();
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement("canvas"); cv.width = cv.height = 64;
        const c = cv.getContext("2d");
        c.drawImage(img, 0, 0, 64, 64);
        c.beginPath(); c.arc(48, 16, 14, 0, 6.3); c.fillStyle = "#e0393e"; c.fill(); c.lineWidth = 4; c.strokeStyle = "#fff"; c.stroke();
        iconDot = cv.toDataURL("image/png");
        if (dotWanted) show();
      } catch (e) {}
    };
    img.src = iconBase;
  }
  // restart a one-shot CSS animation class on el: "trace" (soft ring for the last move of others), "wobble" (no, not like that)
  function flash(el, cls = "trace", ms = 2600) {
    if (!el) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }
  // a captured piece is thrown off the board: it flies away from the piece that took it, spinning, and is removed
  function toss(el, by, ms = 620) {
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !el.animate) { el.remove(); return; }
    const v = el.getBoundingClientRect(), m = by ? by.getBoundingClientRect() : v;
    let dx = v.left - m.left, dy = v.top - m.top;
    const L = Math.hypot(dx, dy);
    if (L < 1) { dx = 1; dy = -1; } else { dx /= L; dy /= L; }
    const far = v.width * 2.6, spin = (dx >= 0 ? 1 : -1) * (200 + Math.random() * 160);
    el.style.zIndex = 8; el.style.pointerEvents = "none";
    const a = el.animate([
      { translate: "0 0", rotate: "0deg", scale: 1, opacity: 1 },
      { translate: `${dx * far * 0.5}px ${dy * far * 0.5 - v.width * 0.7}px`, rotate: `${spin * 0.5}deg`, scale: 1.3, opacity: 1, offset: 0.45 },
      { translate: `${dx * far}px ${dy * far + v.width * 0.5}px`, rotate: `${spin}deg`, scale: 0.55, opacity: 0 }
    ], { duration: ms, easing: "cubic-bezier(.3,.6,.4,1)", fill: "forwards" });
    a.onfinish = a.oncancel = () => el.remove();
    setTimeout(() => el.remove(), ms + 300);
  }

  // ---------- sound and haptics: synthesized effects (no files), the on/off switch, screen wake lock ----------
  // key: where on/off is stored; vol: default loudness of tone(); noiseFilter: "lowpass" | "bandpass";
  // effects: ({tone, noise}) => ({name: (...args) => ...}). Returns { sfx, buzz, isOn, wake }.
  function sound({ key, vol: defVol = 0.18, noiseFilter = "lowpass", effects }) {
    let on = pref("sound", store.get(key) !== false), actx = null, noiseBuf = null, lock = null, volMul = pref("vol", 100) / 100;
    function audio() {
      if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
      if (actx.state === "suspended") actx.resume().catch(() => {});
      return actx;
    }
    // iOS only unlocks audio inside a touch
    document.addEventListener("pointerdown", () => { if (on) audio(); }, { once: true, capture: true });
    function tone(freq, start, dur, type = "sine", vol = defVol, to) {
      if (volMul < 0.01) return;
      const a = audio(); if (!a) return;
      vol *= volMul;
      const t = a.currentTime + start, o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.01, dur / 4));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(start, dur, vol, freq) {
      if (volMul < 0.01) return;
      const a = audio(); if (!a) return;
      vol *= volMul;
      if (!noiseBuf) {
        noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const t = a.currentTime + start, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      s.buffer = noiseBuf; f.type = noiseFilter; f.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(g).connect(a.destination); s.start(t); s.stop(t + dur + 0.02);
    }
    const table = effects({ tone, noise });
    // "turn" = it is your move now. On a PC it is a clearer chime that also rings from a background tab, and the tab title blinks
    const sfx = (k, ...args) => {
      if (!on) return;
      if (k === "turn") {
        attention();
        if (document.visibilityState !== "visible" && !desktop()) return;
        try {
          if (!desktop()) return table.turn();
          const v = defVol * 1.25;
          tone(523, 0, 0.16, "sine", v); tone(659, 0.11, 0.16, "sine", v); tone(784, 0.22, 0.4, "triangle", v); tone(1568, 0.22, 0.3, "sine", v * 0.35);
        } catch (e) {}
        return;
      }
      if (document.visibilityState === "visible") try { table[k](...args); } catch (e) {}
    };
    const buzz = (ms) => { if (!on) return; try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
    // the checkbox and the volume slider are drawn by room-ui.js later in the same script run
    const sync = () => {
      const box = $("#soundOn"), vol = $("#soundVol");
      if (box) box.checked = on;
      if (vol) { vol.value = String(Math.round(volMul * 100)); vol.disabled = !on; }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sync); else sync();
    document.addEventListener("change", (e) => {
      if (!e.target) return;
      if (e.target.id === "soundOn") { on = e.target.checked; store.set(key, on); P.setPrefs({ sound: on }); sync(); if (on) { audio(); sfx("pop"); } }
      else if (e.target.id === "soundVol") sfx("pop");
    });
    document.addEventListener("input", (e) => {
      if (!e.target || e.target.id !== "soundVol") return;
      volMul = Math.min(100, Math.max(0, +e.target.value || 0)) / 100; P.setPrefs({ vol: Math.round(volMul * 100) });
    });
    async function wake() {
      try { if ("wakeLock" in navigator && !lock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } } catch (e) {}
    }
    const api = { sfx, buzz, isOn: () => on, wake };
    window.Spieleabend.sounds = api; // room-ui.js rings it for a nudge
    return api;
  }

  // ---------- dialogs: every .overlay is a modal dialog for screen readers and the keyboard ----------
  // focus moves into it when it opens, Tab stays inside, and focus goes back to where it came from when it closes.
  // The chat overlay is a side bar on wide screens and stays out of that.
  function dialogs() {
    const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const shown = (o) => !o.hidden && o.isConnected;
    const modal = (o) => o.id !== "chat" && !o.dataset.nomodal;
    const watch = (o) => {
      if (o.dataset.dlg) return;
      o.dataset.dlg = "1";
      const box = o.querySelector(".sheet") || o;
      if (!box.getAttribute("role") && !o.getAttribute("role")) {
        box.setAttribute("role", "dialog");
        if (modal(o)) box.setAttribute("aria-modal", "true");
        const h = box.querySelector("h2");
        if (h) { if (!h.id) h.id = (o.id || "dlg" + Math.random().toString(36).slice(2, 7)) + "Title"; box.setAttribute("aria-labelledby", h.id); }
      }
      let back = null, was = shown(o);
      const run = () => {
        const now = shown(o);
        if (now === was) return;
        was = now;
        if (now && modal(o)) {
          back = document.activeElement;
          if (!box.hasAttribute("tabindex")) box.setAttribute("tabindex", "-1");
          box.style.outline = "none";
          try { box.focus({ preventScroll: true }); } catch (e) {}
        } else if (!now && back) {
          const a = document.activeElement;
          if ((!a || a === document.body || o.contains(a)) && back.isConnected) try { back.focus({ preventScroll: true }); } catch (e) {}
          back = null;
        }
      };
      new MutationObserver(run).observe(o, { attributes: true, attributeFilter: ["hidden"] });
      if (was && modal(o)) { was = false; run(); }
    };
    const scan = () => { for (const o of document.querySelectorAll(".overlay")) watch(o); };
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const open = [...document.querySelectorAll(".overlay")].filter((o) => shown(o) && modal(o)).pop();
      if (!open) return;
      const box = open.querySelector(".sheet") || open;
      const items = [...box.querySelectorAll(FOCUSABLE)].filter((x) => x.getClientRects().length);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1], a = document.activeElement;
      if (!box.contains(a) || a === box) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", dialogs); else dialogs();

  // Hand sort switch: "123" on one side, a rainbow circle on the other; the lit side is the current order.
  // mode: "value" (by number) or "color". Games keep the click handling and the stored choice themselves.
  const SORT_INNER = '<span class="st st-n">123</span><span class="st st-c"><i></i></span>';
  const sortLabel = (mode) => (mode === "value" ? "Sortiert nach Zahl, tippen für Farbe" : "Sortiert nach Farbe, tippen für Zahl");
  const sortToggleHTML = (mode, attrs = "") => `<button type="button" class="sorttoggle" data-mode="${mode}" aria-label="${sortLabel(mode)}" title="${sortLabel(mode)} (S)"${attrs ? " " + attrs : ""}>${SORT_INNER}</button>`;
  function sortToggle(el, mode) {
    el.classList.add("sorttoggle");
    el.dataset.mode = mode;
    el.setAttribute("aria-label", sortLabel(mode));
    el.title = sortLabel(mode) + " (S)";
    if (!el.firstElementChild) el.innerHTML = SORT_INNER;
  }
  window.Spieleabend = { $, esc, store, sortToggle, sortToggleHTML, startUrl, TABLES, look, identity, avatarPicker, pickerHTML, followTurn, mine, flash, toss, profile: P, toast, confetti, showBubble, sound, dropParams, pref, calm, say, notify, badge, sounds: null };
})();
