// Machi Koro UI: single player (against the computer) and online rooms share one table renderer.
(() => {
  "use strict";
  const G = window.MachikoroGame;
  if (!G || !G.botMove || !G.AVATARS) {
    let tried = false;
    try { tried = sessionStorage.getItem("machikoro.reloaded") === "1"; sessionStorage.setItem("machikoro.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("machikoro.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const K = { local: "machikoro.v1", online: "machikoro.online", me: "machikoro.me", goal: "machikoro.goal", level: "machikoro.level",
    sound: "machikoro.sound", stats: "machikoro.stats", avatar: "machikoro.avatar", look: "machikoro.look" };
  const store = Spieleabend.store;

  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Größe" });
  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");

  const LEVELS = Object.entries(G.LEVELS).map(([v, name]) => [+v, name]);
  const GOALS = [[1, "Eine Runde"], [2, "Bis 2 Siege"], [3, "Bis 3 Siege"]];

  let mode = null;
  let L = null;
  let R = null;
  let watching = false;
  let V = null;
  let animDice = false;
  let pulse = null;
  let coinFlash = null;
  let peek = false;
  let inflight = false;
  let server = null;
  let serverState = "checking";
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "machikoro.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, min: 0, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  let goalLocal = G.normGoal(store.get(K.goal) || 1);
  let levelLocal = G.normLevel(store.get(K.level) || 2);
  let lastTurn = null, confettiFor = null, botKey = null;

  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const canPlay = () => !!V && V.phase === "play" && V.cur >= 0 && V.cur === V.me;
  const pname = (i) => (i === V.me ? "Du" : V.players[i].name);
  const { toast, confetti, showBubble } = Spieleabend;

  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound,
    effects: ({ tone, noise }) => ({
      roll: () => { noise(0.35, 0.1, 0.3, 1800); tone(300, 0.2, 0.08, "triangle", 0.1, 180); },
      coin: () => { tone(880, 0, 0.08, "triangle", 0.1); tone(1175, 0.08, 0.1, "triangle", 0.1); },
      buy: () => { tone(523, 0, 0.1, "triangle", 0.12); tone(659, 0.1, 0.14, "triangle", 0.12); },
      landmark: () => { tone(523, 0, 0.12); tone(659, 0.12, 0.12); tone(784, 0.24, 0.18); },
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16))
    })
  });

  function handleEvents(events, v) {
    if (!v) return;
    for (const ev of events || []) {
      if (ev.t === "roll") { animDice = true; sfx("roll"); }
      if (ev.t === "income" && ev.lines && ev.lines.length) { coinFlash = { all: true }; sfx("coin"); }
      if (ev.t === "pay" || ev.t === "bank") { coinFlash = { pi: ev.pi != null ? ev.pi : ev.to }; }
      if (ev.t === "buy") { pulse = { pi: ev.pi, id: ev.id }; sfx("buy"); }
      if (ev.t === "landmark") { pulse = { pi: ev.pi, id: ev.id }; sfx("landmark"); }
      if (ev.t === "giveup") toast(ev.pi === v.me ? "Du hast aufgegeben." : `${v.players[ev.pi].name} gibt auf.`);
      if (ev.t === "end") setTimeout(() => sfx("win"), 500);
    }
  }

  function doAct(a) {
    if (mode === "local") {
      const res = G.act(L, L.cur, a);
      if (!res.ok) { toast(res.error); sfx("bad"); return false; }
      handleEvents(res.events, G.view(L, 0));
      store.set(K.local, L);
      render();
      scheduleBot();
      return true;
    }
    if (mode === "online") {
      if (!wsSend({ t: "act", a })) { toast("Keine Verbindung zum Server."); return false; }
      return true;
    }
    return false;
  }

  function play(a) {
    if (!V || V.phase !== "play") return;
    if (!canPlay()) { toast(V.me < 0 ? "Du schaust zu." : `Warte, ${V.players[V.cur].name} ist dran.`); return; }
    if (inflight) return;
    if (mode === "online") { inflight = true; setTimeout(() => { inflight = false; }, 3000); }
    buzz(10);
    doAct(a);
  }

  let botT = null;
  function scheduleBot() {
    clearTimeout(botT);
    botKey = null;
    if (mode !== "local" || !L) return;
    const plan = G.botPlan(L);
    if (!plan) return;
    botKey = plan.key;
    botT = setTimeout(() => {
      if (mode !== "local" || !L) return;
      if ($("#menu") && !$("#menu").hidden) { scheduleBot(); return; }
      const again = G.botPlan(L);
      if (!again || again.key !== botKey) { scheduleBot(); return; }
      const pi = again.pi, a = G.botMove(L, pi);
      const res = a ? G.act(L, pi, a) : null;
      if (res && res.ok) { handleEvents(res.events, G.view(L, 0)); store.set(K.local, L); render(); }
      scheduleBot();
    }, plan.delay);
  }

  function showScreen(id) {
    for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id;
  }

  function render() {
    if (mode === "local" && L) {
      V = G.view(L, 0);
      showScreen("game");
      renderGame();
    } else if (mode === "online" && R) {
      const meM = R.members[R.you], waiting = !!(R.view && meM && meM.lobby);
      if (!waiting) watching = false;
      if (!R.view || (waiting && !watching)) { V = null; showScreen("lobby"); UI.renderLobby(); $("#roundEnd").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else {
      V = null;
      $("#roundEnd").hidden = true;
      showScreen("home"); renderHome();
    }
    UI.update();
  }

  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function dieHTML(value, cls) {
    let pips = "";
    for (let i = 0; i < 9; i++) pips += `<i${(PIPS[value] || []).includes(i) ? ' class="on"' : ""}></i>`;
    return `<div class="die ${cls || ""}" aria-label="${value ? "Würfel zeigt " + value : "Würfel"}">${pips}</div>`;
  }

  function plateHTML(i) {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = members && members[i] && !members[i].online;
    const flash = coinFlash && (coinFlash.all || coinFlash.pi === i);
    const cls = ["plate", V.phase === "play" && V.cur === i ? "active" : "", away ? "away" : "", pulse && pulse.pi === i ? "pulse" : "", flash ? "coinflash" : ""].join(" ");
    const tag = p.bot ? "Computer" : away ? "offline" : i === V.me ? "du" : "";
    const lm = `${p.landmarks}/4`;
    return `<div class="${cls}" data-seat="${i}"><span class="pav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="pinfo"><span class="pname">${esc(p.name)}</span><span class="pmeta">${tag || "&nbsp;"}</span></span>` +
      `<span class="pscore">${p.coins}💰<small>${lm} Wahrz.</small></span>` +
      `<span class="pwins" title="Siege">${p.wins}</span></div>`;
  }

  function cardHTML(c, opts) {
    const o = opts || {};
    const rolls = (c.rolls || []).join("·");
    const cls = ["card", c.color || "landmark", o.buyable ? "buyable" : "", o.off ? "off" : "", o.pop ? "pop" : ""].join(" ");
    const qty = o.qty != null ? `<span class="qty">${o.qty}</span>` : "";
    const data = o.action ? ` data-act='${JSON.stringify(o.action).replace(/'/g, "&#39;")}'` : "";
    const tag = o.tag || (c.cost != null ? `<span class="cost">${c.cost}💰</span>` : "");
    return `<button type="button" class="${cls}"${data}${o.buyable ? "" : " disabled"} title="${esc(c.desc || c.name)}">${qty}` +
      (rolls ? `<span class="roll">${rolls}</span>` : "") +
      `<span class="em">${c.emoji}</span><span class="nm">${esc(c.name)}</span>${tag}</button>`;
  }

  function renderGame() {
    if (V.phase !== "roundEnd") peek = false;
    $("#plates").innerHTML = V.players.map((_, i) => plateHTML(i)).join("");
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> · ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}`;

    const tumble = animDice ? "tumble" : "";
    $("#dice").innerHTML = V.dice.length
      ? V.dice.map((d) => dieHTML(d, tumble)).join("")
      : `<div class="die" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>`;
    animDice = false;

    const inc = V.income;
    $("#income").innerHTML = inc && inc.lines && inc.lines.length
      ? `Wurf <b>${inc.total}</b>: ${esc(inc.lines.slice(0, 4).join(" · "))}${inc.lines.length > 4 ? " …" : ""}`
      : (V.dice.length ? `Wurf <b>${V.dice.reduce((a, b) => a + b, 0)}</b>` : "");

    // Market
    const canBuild = canPlay() && V.step === "build";
    const affC = new Set((V.affordable && V.affordable.cards) || []);
    $("#market").innerHTML = V.cardOrder.map((id) => {
      const c = V.cards[id], qty = V.market[id] || 0;
      if (!qty) return "";
      return cardHTML(c, {
        qty, buyable: canBuild && affC.has(id),
        action: canBuild && affC.has(id) ? { t: "buy", id } : null,
        pop: pulse && pulse.id === id
      });
    }).join("") || "<p class=\"hint\">Markt leer.</p>";

    // Cities
    const LM = V.landmarks, LO = V.landmarkOrder;
    const affL = new Set((V.affordable && V.affordable.landmarks) || []);
    $("#cities").innerHTML = V.players.map((p, i) => {
      const mine = i === V.me;
      const head = `<div class="city-head">${p.avatar} ${esc(mine ? "Deine Stadt" : p.name)} · ${p.coins}💰 · ${p.landmarks}/4</div>`;
      const est = Object.keys(p.cards).map((id) => {
        const c = V.cards[id];
        return cardHTML(c, { qty: p.cards[id] > 1 ? p.cards[id] : null, tag: "", pop: pulse && pulse.pi === i && pulse.id === id });
      }).join("");
      const lms = LO.map((id) => {
        const Lmk = LM[id], on = !!p.lm[id];
        const canBuy = canBuild && mine && affL.has(id);
        return cardHTML(Lmk, {
          off: !on, buyable: canBuy,
          action: canBuy ? { t: "landmark", id } : null,
          tag: on ? "<span class=\"cost\">✓</span>" : `<span class="cost">${Lmk.cost}💰</span>`,
          pop: pulse && pulse.pi === i && pulse.id === id
        });
      }).join("");
      return `<div class="city">${head}<div class="cards">${est}${lms}</div></div>`;
    }).join("");

    pulse = null; coinFlash = null;

    const lmEl = $("#lastMove"), lines = V.log.slice(-2), lmKey = lines.join("\n");
    if (lmEl.dataset.k !== lmKey) {
      lmEl.dataset.k = lmKey;
      lmEl.innerHTML = lines.map((l, i) => `<div${i < lines.length - 1 ? ' class="old"' : ""}>${esc(l)}</div>`).join("");
      lmEl.classList.remove("fresh"); void lmEl.offsetWidth; lmEl.classList.add("fresh");
    }

    // Dock
    let who = "", hint = "", av = "";
    const acts = $("#acts");
    acts.innerHTML = "";
    if (V.phase === "roundEnd") {
      const w = V.last.winners[0];
      who = `${pname(w)} ${w === V.me ? "gewinnst" : "gewinnt"}`;
      av = V.players[w].avatar;
      hint = "Runde vorbei.";
    } else {
      const P = V.players[V.cur];
      av = P.avatar;
      if (canPlay()) {
        who = "Du bist dran";
        if (V.step === "roll") {
          hint = V.players[V.me].lm.station ? "Mit 1 oder 2 Würfeln würfeln." : "Würfle!";
          acts.innerHTML = `<button class="btn btn-primary" data-a='{"t":"roll","dice":1}' type="button">1 Würfel</button>` +
            (V.players[V.me].lm.station ? `<button class="btn btn-primary" data-a='{"t":"roll","dice":2}' type="button">2 Würfel</button>` : "");
        } else if (V.step === "reroll") {
          hint = "Nochmal würfeln (Funkturm) oder behalten?";
          acts.innerHTML = `<button class="btn btn-primary" data-a='{"t":"reroll"}' type="button">Neu würfeln</button>` +
            `<button class="btn" data-a='{"t":"keep"}' type="button">Behalten</button>`;
        } else if (V.step === "tv") {
          hint = "Wen zapfst du mit dem Fernsehsender ab?";
          acts.innerHTML = V.players.map((op, i) => i === V.me ? "" :
            `<button class="btn" data-a='{"t":"tv","target":${i}}' type="button">${esc(op.name)} (${op.coins}💰)</button>`).join("");
        } else if (V.step === "trade") {
          hint = "Unternehmen: Tausch überspringen oder Karte tippen (vereinfacht: überspringen).";
          acts.innerHTML = `<button class="btn" data-a='{"t":"trade","skip":true}' type="button">Nicht tauschen</button>`;
        } else if (V.step === "build") {
          hint = "Gebäude/Wahrzeichen tippen oder passen.";
          acts.innerHTML = `<button class="btn" data-a='{"t":"pass"}' type="button">Passen</button>`;
        }
      } else {
        who = `${P.name} ist dran`;
        hint = P.bot ? "Der Computer überlegt …" : V.me < 0 ? "Du schaust zu." : "Warte auf den nächsten Zug.";
      }
    }
    $("#whoAv").textContent = av;
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    $("#dock").classList.toggle("myturn", canPlay());
    $("#resultBtn").hidden = !(V.phase === "roundEnd" && peek);
    $("#reactBtn").hidden = mode !== "online";
    $("#keys").innerHTML = canPlay() && V.step === "roll" ? "<kbd>Leertaste</kbd> würfeln" : "";

    const key = `${V.round}:${V.turn}:${V.cur}:${V.step}`;
    if (canPlay() && lastTurn !== key && lastTurn !== null && (mode === "online" || V.players.some((p) => p.bot))) { buzz([40, 60, 40]); sfx("turn"); }
    lastTurn = key;

    $("#roundEnd").hidden = V.phase !== "roundEnd" || peek;
    if (V.phase === "roundEnd") {
      if (!peek) renderRoundEnd();
      const k = `${V.round}:${V.last.winners.join(",")}:${V.players.map((p) => p.wins).join(",")}`;
      if (confettiFor !== k) {
        confettiFor = k; record(k);
        setTimeout(() => confetti(), 700);
      }
    }
  }

  $("#acts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]");
    if (!b) return;
    try { play(JSON.parse(b.getAttribute("data-a"))); } catch (err) {}
  });
  $("#market").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    try { play(JSON.parse(b.getAttribute("data-act"))); } catch (err) {}
  });
  $("#cities").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    try { play(JSON.parse(b.getAttribute("data-act"))); } catch (err) {}
  });
  $("#resultBtn").addEventListener("click", () => { peek = false; render(); });

  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, button") || e.ctrlKey || e.metaKey || e.altKey) return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") { if (open) $(open).hidden = true; return; }
    if (open || $("#game").hidden || !$("#roundEnd").hidden || !canPlay()) return;
    if ((e.key === " " || e.key.toLowerCase() === "r") && V.step === "roll") {
      e.preventDefault();
      play({ t: "roll", dice: 1 });
    }
  });

  function bubble(pi, e, who) {
    const host = pi >= 0 ? document.querySelector(`#plates [data-seat="${pi}"]`) : $("#dock");
    if (!host) return;
    const b = document.createElement("span");
    const text = e.length > 3;
    b.className = "bubble" + (text ? " say" : ""); b.textContent = pi < 0 && who ? `${who}: ${e}` : e;
    showBubble(host, b);
    setTimeout(() => b.remove(), 2800);
    sfx("pop");
  }
  $("#reactBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#reactBar").hidden = !$("#reactBar").hidden; });
  $("#reactBar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-e]"); if (!b) return;
    $("#reactBar").hidden = true;
    wsSend({ t: "react", e: b.dataset.e });
  });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#reactBar, #reactBtn")) $("#reactBar").hidden = true; });

  function scoreList(el, winners) {
    el.innerHTML = V.players.map((p, i) => {
      const you = i === V.me ? " (du)" : "";
      return `<li class="${winners.includes(i) ? "win" : ""}"><span>${avi(p.avatar)}${esc(p.name)}${you}<small>${p.landmarks}/4 · ${p.coins}💰</small></span>` +
        `<b>${p.wins} ${p.wins === 1 ? "Sieg" : "Siege"}</b></li>`;
    }).join("");
  }

  function renderRoundEnd() {
    const last = V.last, w = last.winners[0];
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round} vorbei`;
    $("#reTitle").textContent = `${w === V.me ? "Du gewinnst" : `${V.players[w].name} gewinnt`} ${last.over ? "das Spiel" : "die Runde"}!`;
    $("#reText").textContent = `Alle Wahrzeichen nach ${last.moves} Würfen.` +
      (last.over ? "" : ` Gespielt wird bis ${V.goal} Siege, als Nächstes beginnt ${V.players[V.nextStarter].name}.`);
    scoreList($("#reScores"), last.winners);
    UI.roundEndFooter({ over: last.over, next: "Nächste Runde" });
  }

  const profile = Spieleabend.profile;
  { const old = (store.get(K.stats) || {})[profile.get().name]; if (old) profile.importLegacy("machikoro", { rounds: old.rounds || old.games, wins: old.wins }); }
  function record(key) {
    const i = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
    if (i < 0) return;
    profile.result("machikoro", key, { won: V.last.winners.includes(i), draw: !V.last.winners.length, online: mode === "online" });
  }

  function segHTML(list, cur) {
    return list.map(([v, a, b]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${a}${b ? `<small>${b}</small>` : ""}</button>`).join("");
  }

  function renderHome() {
    LOOK.render();
    $("#myAvatar").textContent = myAvatar;
    for (const b of document.querySelectorAll("#modeTabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
    $("#onlinePanel").hidden = tab !== "online" || !webHost;
    $("#onlineOff").hidden = tab !== "online" || webHost;
    const sh = $("#serverHint");
    sh.hidden = serverState === "ok";
    sh.textContent = serverState === "checking" ? "Suche den Spiel-Server …"
      : "Unter dieser Adresse antwortet kein Spiel-Server. Du kannst es trotzdem versuchen, „Einzelspieler“ geht immer.";
    $("#localPanel").hidden = tab !== "local";
    $("#goalLocal").innerHTML = segHTML(GOALS, goalLocal);
    $("#levelLocal").innerHTML = segHTML(LEVELS, levelLocal);

    const saved = store.get(K.local);
    $("#resumePanel").hidden = !(saved && saved.players);
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => p.name).join(" gegen ")} · Runde ${saved.round}`;
    HOME.render();
  }

  const UI = window.RoomUI({
    room: () => R, view: () => V, mode: () => mode, server: () => server,
    watching: (v) => (v === undefined ? watching : (watching = v)),
    onlineKey: K.online,
    on: {
      opened() { if (serverState !== "ok") { serverState = "ok"; server = server || {}; } },
      joined(m) { mode = "online"; wake(); },
      room(m) { R = m; mode = "online"; inflight = false; if (m.view) handleEvents(m.events, m.view); render(); },
      react(m) { bubble(m.pi, m.e, m.name); },
      error(m) { inflight = false; },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text, name) => bubble(pi, text, name),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    renderSettings(host) {
      for (const [id, list, cur] of [["#goalOnline", GOALS, R.goal], ["#levelOnline", LEVELS, R.level || 2]]) {
        const el = $(id), k = cur + ":" + host;
        if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = segHTML(list, cur); for (const b of el.children) b.disabled = !host; }
      }
    },
    menu: {
      open() {
        LOOK.render();
        if (V) scoreList($("#menuScores"), []);
        $("#menuRules").textContent = V ? `${V.goal === 1 ? "Eine Runde" : `Bis ${V.goal} Siege`}. Wer zuerst alle Wahrzeichen hat, gewinnt.` : "";
      },
      local(box) {
        box.append(
          UI.armed("Runde neu starten", () => { L.round--; L.starter = (L.starter + L.players.length - 1) % L.players.length; G.startRound(L); peek = false; store.set(K.local, L); render(); scheduleBot(); }),
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; clearTimeout(botT); render(); })
        );
      },
      player(box) {
        if (V && V.phase === "play" && V.me >= 0) box.append(UI.armed("Aufgeben", () => wsSend({ t: "act", a: { t: "giveup" } })));
      },
      skip: (v) => v.phase === "play" && v.cur !== v.me && !v.players[v.cur].bot
    }
  });
  function wsSend(m) { return UI.send(m); }

  Spieleabend.avatarPicker({ avatars: G.AVATARS, get: () => myAvatar, set: (a) => { myAvatar = a; store.set(K.avatar, a); } });

  for (const [id, key] of [["goal", "goal"], ["level", "level"]]) {
    $(`#${id}Online`).addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", [key]: +b.dataset.v }); });
  }
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; tabTouched = true; renderHome(); } });
  $("#goalLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { goalLocal = +b.dataset.v; store.set(K.goal, goalLocal); renderHome(); } });
  $("#levelLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { levelLocal = +b.dataset.v; store.set(K.level, levelLocal); renderHome(); } });

  $("#myName").value = store.get(K.me) || "";
  $("#myName").addEventListener("input", (e) => store.set(K.me, e.target.value));
  $("#joinCode").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ""); });
  const myName = () => {
    const n = $("#myName").value.trim();
    if (!n) { toast("Bitte gib zuerst deinen Namen ein."); $("#myName").focus(); }
    return n;
  };
  function join() {
    const n = myName(); if (!n) return;
    const code = $("#joinCode").value.trim();
    if (code.length !== 4) { toast("Der Raum-Code hat 4 Buchstaben."); $("#joinCode").focus(); return; }
    store.del(K.online);
    wsSend({ t: "join", code, name: n, avatar: myAvatar });
  }
  $("#joinBtn").addEventListener("click", join);
  $("#joinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  $("#createBtn").addEventListener("click", () => {
    const n = myName(); if (!n) return;
    store.del(K.online);
    wsSend({ t: "create", name: n, goal: goalLocal, level: levelLocal, avatar: myAvatar });
  });

  function startLocal(state) {
    L = state; mode = "local"; peek = false;
    store.set(K.local, L); render(); wake(); scheduleBot();
  }
  $("#startLocal").addEventListener("click", () => {
    const { names, bots } = HOME.roster($("#myName").value);
    const list = names.map((name, i) => ({ name, bot: bots[i], avatar: bots[i] ? G.BOT_AVATAR : myAvatar }));
    startLocal(G.newGame(list, goalLocal, levelLocal));
  });
  $("#resumeBtn").addEventListener("click", () => {
    const s = store.get(K.local); if (!s) return render();
    startLocal(s);
  });

  $("#reBtn").addEventListener("click", () => { peek = false; doAct({ t: "next" }); });
  $("#reLook").addEventListener("click", () => { peek = true; render(); });
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; clearTimeout(botT); render(); }
    else if (R && R.members[R.you] && R.members[R.you].lobby) { watching = false; render(); }
    else if (V && V.phase === "roundEnd" && V.last && V.last.over) wsSend({ t: "lobby" });
    else wsSend({ t: "end" });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (mode) wake();
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  const code = UI.roomCode();
  render();
  if (webHost && (store.get(K.online) && !code)) UI.resume();
  UI.detectServer("/machikoro-server", "machikoro").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
