// Shared start screen bits of every game (loaded after room-ui.js, before app.js):
//  - single-player switch: ?sp=1 (sent by the start page) opens the game in the "Einzelspieler" tab
//  - the single-player line-up: me plus min..max-1 computer opponents (min defaults to 1, a game that is
//    fun alone passes 0)
// HomeUI({ key, max, botNames, min }) -> { single(), opp(), roster(name), render() }
(function () {
  "use strict";
  const K = window.Spieleabend;
  window.HomeUI = function ({ key, max, botNames, min = 1, onChange }) {
    const single = new URLSearchParams(location.search).get("sp") === "1";
    K.dropParams("sp");
    const top = Math.max(min, max - 1);
    let opp = Math.min(top, Math.max(min, +K.store.get(key) || min));
    const box = () => K.$("#oppBox");
    function render() {
      const el = box(); if (!el) return;
      const names = botNames.slice(0, opp).join(", ");
      const who = opp ? `Gegen den Computer: ${K.esc(names)}.` : "Du spielst allein.";
      if (top < 2 && min) { el.innerHTML = `<p class="hint">Du spielst gegen den Computer: ${K.esc(names)}.</p>`; return; }
      el.innerHTML = `<div class="label">Anzahl der Gegner</div>` +
        `<div class="seg" style="grid-template-columns:repeat(auto-fit,minmax(44px,1fr))">${Array.from({ length: top - min + 1 }, (_, i) =>
          `<button type="button" data-opp="${min + i}" aria-pressed="${min + i === opp}">${min + i}</button>`).join("")}</div>` +
        `<p class="hint">${who}</p>`;
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
