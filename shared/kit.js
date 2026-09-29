// Shared browser base of every Spieleabend game, loaded first (before room-ui.js, game.js
// and app.js): local storage, the table design and size (with the ?table= hand-off from the
// start page), name and avatar (?name=&av= hand-off, avatar picker), toast, confetti,
// reaction bubbles, sound/haptics/wake lock and the link back to the start page. app.js uses it as window.Spieleabend.
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
  const TABLES = [["night", "Nacht", "#1a1426"], ["felt", "Filz", "#15372a"], ["ocean", "Ozean", "#15243a"], ["light", "Hell", "#eceff5"], ["blossom", "Blüte", "#f7c6d9"]];
  const SIZES = [["0.85", "Klein"], ["1", "Normal"], ["1.15", "Groß"]];
  // key: where the choice is stored; sizeLabel: "Größe", "Kartengröße", ...; onChange: redraw after a change
  function look({ key, sizeLabel = "Größe", onChange }) {
    const cur = Object.assign({ table: "night", size: "1" }, store.get(key) || {});
    // came here from the games.cool-kidz.net start page with a design already picked there
    const qTable = new URLSearchParams(location.search).get("table");
    if (qTable && TABLES.some((x) => x[0] === qTable)) { cur.table = qTable; store.set(key, cur); }
    dropParams("table");
    function apply() {
      const root = document.documentElement, t = TABLES.find((x) => x[0] === cur.table) || TABLES[0];
      if (t[0] === "night") delete root.dataset.table; else root.dataset.table = t[0];
      root.style.setProperty("--cs", (SIZES.find((x) => x[0] === cur.size) || SIZES[1])[0]);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", getComputedStyle(root).getPropertyValue("--bg").trim() || t[2]);
    }
    // the same buttons on the start screen (#lookHome) and in the menu (#lookMenu)
    function render() {
      const html = `<div class="label">Tisch</div><div class="seg tables">${TABLES.map(([k, n, c]) =>
        `<button type="button" data-table="${k}" aria-pressed="${cur.table === k}"><span class="swatch" style="background:${c}"></span>${n}</button>`).join("")}</div>` +
        `<div class="label">${sizeLabel}</div><div class="seg three">${SIZES.map(([k, n]) =>
        `<button type="button" data-size="${k}" aria-pressed="${cur.size === k}">${n}</button>`).join("")}</div>`;
      for (const id of ["#lookHome", "#lookMenu"]) { const el = $(id); if (el && el.innerHTML !== html) el.innerHTML = html; }
      const sum = $("#lookSum");
      if (sum) sum.textContent = `${(TABLES.find((x) => x[0] === cur.table) || TABLES[0])[1]} · ${(SIZES.find((x) => x[0] === cur.size) || SIZES[1])[1]}`;
    }
    for (const id of ["#lookHome", "#lookMenu"]) { const el = $(id); if (el) el.addEventListener("click", (e) => {
      const t = e.target.closest("[data-table]"), z = e.target.closest("[data-size]");
      if (!t && !z) return;
      if (t) cur.table = t.dataset.table;
      if (z) cur.size = z.dataset.size;
      store.set(key, cur); apply(); render();
      if (onChange) onChange();
    }); }
    apply();
    return { render, apply, get: () => cur };
  }

  // ---------- name and avatar ----------
  // The avatar to start with: a valid stored one, one picked on the start page (?av=), or a
  // random one; a name from the start page (?name=) is stored for the name field.
  function identity({ me, avatar, avatars }) {
    let a = avatars.includes(store.get(avatar)) ? store.get(avatar) : avatars[Math.floor(Math.random() * avatars.length)];
    const q = new URLSearchParams(location.search), qn = (q.get("name") || "").trim().slice(0, 18), qa = q.get("av");
    if (qa && avatars.includes(qa)) a = qa;
    if (qn) store.set(me, qn);
    dropParams("name", "av");
    store.set(avatar, a);
    return a;
  }
  // the avatar button next to the name field (#myAvatar) opens a grid (#avatarGrid) to pick from
  function avatarPicker({ avatars, get, set }) {
    $("#myAvatar").addEventListener("click", () => {
      const g = $("#avatarGrid");
      g.innerHTML = avatars.map((a) => `<button type="button" data-pick="${a}" aria-pressed="${a === get()}">${a}</button>`).join("");
      g.hidden = !g.hidden;
    });
    $("#avatarGrid").addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]"); if (!b) return;
      set(b.dataset.pick);
      $("#avatarGrid").hidden = true; $("#myAvatar").textContent = b.dataset.pick;
    });
  }

  // ---------- feedback ----------
  let toastT = null;
  function toast(msg) {
    if (!msg) return;
    const t = $("#toast"); t.textContent = msg; t.classList.remove("off");
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
      for (const a of document.querySelectorAll("[data-start-link]")) a.href = startUrl();
  });

  // ---------- sound and haptics: synthesized effects (no files), the on/off switch, screen wake lock ----------
  // key: where on/off is stored; vol: default loudness of tone(); noiseFilter: "lowpass" | "bandpass";
  // effects: ({tone, noise}) => ({name: (...args) => ...}). Returns { sfx, buzz, isOn, wake }.
  function sound({ key, vol: defVol = 0.18, noiseFilter = "lowpass", effects }) {
    let on = store.get(key) !== false, actx = null, noiseBuf = null, lock = null;
    function audio() {
      if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
      if (actx.state === "suspended") actx.resume().catch(() => {});
      return actx;
    }
    // iOS only unlocks audio inside a touch
    document.addEventListener("pointerdown", () => { if (on) audio(); }, { once: true, capture: true });
    function tone(freq, start, dur, type = "sine", vol = defVol, to) {
      const a = audio(); if (!a) return;
      const t = a.currentTime + start, o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.01, dur / 4));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(start, dur, vol, freq) {
      const a = audio(); if (!a) return;
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
    const sfx = (k, ...args) => { if (on && document.visibilityState === "visible") try { table[k](...args); } catch (e) {} };
    const buzz = (ms) => { if (!on) return; try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
    // the checkbox is drawn by room-ui.js later in the same script run
    const sync = () => { const box = $("#soundOn"); if (box) box.checked = on; };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sync); else sync();
    document.addEventListener("change", (e) => {
      if (!e.target || e.target.id !== "soundOn") return;
      on = e.target.checked; store.set(key, on); if (on) { audio(); sfx("pop"); }
    });
    async function wake() {
      try { if ("wakeLock" in navigator && !lock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } } catch (e) {}
    }
    return { sfx, buzz, isOn: () => on, wake };
  }

  window.Spieleabend = { $, esc, store, startUrl, TABLES, look, identity, avatarPicker, toast, confetti, showBubble, sound, dropParams };
})();
