// Shared start screen bits of every game (loaded after room-ui.js, before app.js):
//  - single-player switch: ?sp=1 (sent by the start page) opens the game in the "Einzelspieler" tab
//  - the single-player line-up: me plus 1..max-1 computer opponents
// HomeUI({ key, max, botNames }) -> { single(), opp(), roster(name), render() }
(function () {
  "use strict";
  const K = window.Spieleabend;
  window.HomeUI = function ({ key, max, botNames, onChange }) {
    const single = new URLSearchParams(location.search).get("sp") === "1";
    K.dropParams("sp");
    const top = Math.max(1, max - 1);
    let opp = Math.min(top, Math.max(1, +K.store.get(key) || 1));
    const box = () => K.$("#oppBox");
    function render() {
      const el = box(); if (!el) return;
      const names = botNames.slice(0, opp).join(", ");
      if (top < 2) { el.innerHTML = `<p class="hint">Du spielst gegen den Computer: ${K.esc(names)}.</p>`; return; }
      el.innerHTML = `<div class="label">Anzahl der Gegner</div>` +
        `<div class="seg" style="grid-template-columns:repeat(auto-fit,minmax(44px,1fr))">${Array.from({ length: top }, (_, i) =>
          `<button type="button" data-opp="${i + 1}" aria-pressed="${i + 1 === opp}">${i + 1}</button>`).join("")}</div>` +
        `<p class="hint">Gegen den Computer: ${K.esc(names)}.</p>`;
    }
    document.addEventListener("click", (e) => {
      const b = e.target.closest("#oppBox [data-opp]"); if (!b) return;
      opp = +b.dataset.opp; K.store.set(key, opp); render();
      if (onChange) onChange();
    });
    // names and bot flags for G.newGame: index 0 is the human
    function roster(me) {
      const n = String(me || "").trim() || "Du";
      const bots = botNames.slice(0, opp);
      return { names: [n, ...bots], bots: [false, ...bots.map(() => true)] };
    }
    return { single: () => single, opp: () => opp, roster, render };
  };
})();
