// Monopoly UI: single player (against the computer) and online rooms share one table renderer.
// The state is drawn at once; fx.js paces the animations from the engine's events, and the dock waits until they are done.
(() => {
  "use strict";
  const G = window.MonopolyGame, B = window.MonopolyBoard, FX = window.MonopolyFX, SH = window.MonopolySheets;
  const M = (n) => (G && G.money ? G.money(n) : String(n));
  // An old cached game.js next to a new app.js: reload once without cache instead of breaking.
  if (!G || !G.botMove || !G.RULE_DEFAULTS || !G.money || !B || !FX || !SH) {
    let tried = false;
    try { tried = sessionStorage.getItem("monopoly.reloaded") === "1"; sessionStorage.setItem("monopoly.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("monopoly.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const K = { local: "monopoly.v1", online: "monopoly.online", me: "monopoly.me", cfg: "monopoly.cfg", sound: "monopoly.sound", avatar: "monopoly.avatar", look: "monopoly.look" };
  const store = Spieleabend.store;
  const BOARD = G.BOARD, GROUPS = G.GROUPS;

  const LOOK = Spieleabend.look({ key: K.look, sizeLabel: "Größe" });
  let myAvatar = Spieleabend.identity({ me: K.me, avatar: K.avatar, avatars: G.AVATARS });
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");
  const GOALS = [[1, "Eine Runde"], [2, "Bis 2 Siege"], [3, "Bis 3 Siege"]];
  const entries = (o) => Object.entries(o).map(([v, name]) => [+v, name]);

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let R = null;           // last online room message
  let watching = false;
  let V = null;           // view on screen
  let peek = false;       // round over, looking at the table
  let inflight = false;
  let server = null, serverState = "checking";
  let shown = [];         // cash on the plates (follows the pay events, not the state)
  let boardOn = false, boardN = 0, confettiFor = null, lastRound = null;
  const webHost = /^https?:$/.test(location.protocol);
  const HOME = window.HomeUI({ key: "monopoly.opp", max: G.MAX_PLAYERS, botNames: G.BOT_NAMES, onChange: () => renderHome() });
  let tab = HOME.single() || !webHost ? "local" : "online", tabTouched = HOME.single();
  const saved = store.get(K.cfg) || {};
  let cfg = { goal: G.normGoal(saved.goal), level: G.normLevel(saved.level), rules: G.normRules(saved.rules) };

  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const { toast, confetti, showBubble } = Spieleabend;
  const name = (i) => (i === V.me ? "Du" : V.players[i].name);

  const { sfx, buzz, wake } = Spieleabend.sound({
    key: K.sound,
    effects: ({ tone, noise }) => ({
      roll: () => { for (let i = 0; i < 6; i++) noise(i * 0.075, 0.05, 0.22, 1500 + i * 150); tone(240, 0, 0.12, "triangle", 0.07, 170); },
      step: () => tone(520 + Math.random() * 90, 0, 0.05, "sine", 0.07),
      coin: () => { tone(988, 0, 0.07, "square", 0.05); tone(1319, 0.07, 0.22, "square", 0.05); },
      pay: () => tone(420, 0, 0.14, "triangle", 0.1, 260),
      buy: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.07, 0.16, "triangle", 0.12)),
      card: () => { noise(0, 0.16, 0.2, 3000); tone(660, 0.14, 0.14, "triangle", 0.1); tone(880, 0.26, 0.2, "triangle", 0.1); },
      siren: () => { for (let i = 0; i < 5; i++) tone(i % 2 ? 760 : 540, i * 0.17, 0.17, "sawtooth", 0.06); },
      clang: () => { tone(190, 0, 0.4, "square", 0.1, 90); noise(0, 0.22, 0.3, 900); },
      free: () => [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.16, "triangle", 0.12)),
      build: () => { tone(260, 0, 0.08, "square", 0.09); tone(330, 0.1, 0.08, "square", 0.09); tone(440, 0.2, 0.18, "square", 0.09); },
      jackpot: () => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.06, 0.22, "triangle", 0.14)),
      pop: () => tone(740, 0, 0.06, "sine", 0.12),
      turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
      bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16))
    })
  });

  // ---------- animations ----------
  const plateEl = (i) => document.querySelector(`#plates [data-seat="${i}"]`);
  function shiftCash(pi, d) {
    shown[pi] = (shown[pi] == null ? V.players[pi].cash : shown[pi]) + d;
    const el = plateEl(pi), c = el && el.querySelector(".pcash");
    if (!c) return;
    c.textContent = shown[pi];
    c.classList.remove("up", "down"); void c.offsetWidth; c.classList.add(d > 0 ? "up" : "down");
  }
  FX.init({
    view: () => V, sfx, buzz, toast, plate: plateEl, cash: shiftCash,
    board: (v) => B.update(v), tokens: (v) => B.syncTokens(v, false)
  });
  FX.onIdle(() => render());

  // ---------- actions ----------
  function doAct(a) {
    if (mode === "local") {
      const res = G.act(L, 0, a);
      if (!res.ok) { toast(res.error); sfx("bad"); return false; }
      FX.push(res.events, G.view(L, 0));
      store.set(K.local, L);
      render(); scheduleBot();
      return true;
    }
    if (mode === "online") {
      if (inflight) return false;
      if (!UI.send({ t: "act", a })) { toast("Keine Verbindung zum Server."); return false; }
      inflight = true; setTimeout(() => { inflight = false; }, 1500);
      return true;
    }
    return false;
  }
  const act = (a) => { buzz(10); return doAct(a); };

  let botT = null;
  function scheduleBot(ms) {
    clearTimeout(botT);
    if (mode !== "local" || !L || L.phase !== "play") return;
    const plan = G.botPlan(L);
    if (!plan) return;
    botT = setTimeout(() => {
      if (mode !== "local" || !L || L.phase !== "play") return;
      if (!$("#menu").hidden || FX.busy() || SH.isOpen()) { scheduleBot(300); return; } // paused while the menu or a sheet is open
      const now = G.botPlan(L);
      if (!now || now.key !== plan.key) { scheduleBot(); return; }
      const a = G.botMove(L, now.pi), res = a ? G.act(L, now.pi, a) : null;
      if (res && res.ok) { FX.push(res.events, G.view(L, 0)); store.set(K.local, L); render(); }
      scheduleBot();
    }, ms || plan.delay);
  }

  // ---------- settings (start screen and waiting room share the markup) ----------
  const seg = (k, list, cur, on) => `<div class="label">${on}</div><div class="seg" data-k="${k}">` + list.map(([v, a]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${a}</button>`).join("") + `</div>`;
  const RULE_TEXT = [
    ["goDouble", "Doppelt auf Los", "Wer genau auf Los landet, bekommt 400 statt 200."],
    ["parking", "Jackpot auf Frei Parken", "Steuern und Strafen wandern in den Topf. Wer auf Frei Parken landet, kassiert ihn."],
    ["auction", "Versteigerung", "Kauft niemand ein Grundstück, wird es versteigert."]
  ];
  function settingsHTML(c, host) {
    const ro = host ? "" : " disabled";
    return seg("goal", GOALS, c.goal, "Spielziel") + seg("level", entries(G.LEVELS), c.level, "Computer-Stärke") +
      seg("cash", entries(G.CASHES).map(([v, n]) => [v, n]), c.rules.cash, "Startgeld") + seg("limit", entries(G.LIMITS), c.rules.limit, "Zeitlimit (Züge pro Spieler, danach gewinnt der Reichste)") +
      `<div class="label">Hausregeln</div>` +
      RULE_TEXT.map(([k, t, d]) => `<label class="toggle"><input type="checkbox" data-r="${k}"${c.rules[k] ? " checked" : ""}${ro}><span>${t}<small>${d}</small></span></label>`).join("");
  }
  function fillSettings(el, c, host) {
    const key = JSON.stringify([c, host]);
    if (el.dataset.k === key) return;
    el.dataset.k = key; el.innerHTML = settingsHTML(c, host);
    for (const b of el.querySelectorAll("button")) b.disabled = !host;
  }
  // a click inside a settings block -> { goal | level | rules:{...} }
  function settingOf(e) {
    const b = e.target.closest("[data-v]"), box = b && b.closest("[data-k]");
    if (b && box) { const k = box.dataset.k, v = +b.dataset.v; return k === "goal" || k === "level" ? { [k]: v } : { rules: { [k]: v } }; }
    const t = e.target.closest("[data-r]");
    return t ? { rules: { [t.dataset.r]: t.checked } } : null;
  }
  $("#setLocal").addEventListener("change", (e) => { if (e.target.matches("[data-r]")) localSet(settingOf(e)); });
  $("#setLocal").addEventListener("click", (e) => { if (e.target.closest("[data-v]")) localSet(settingOf(e)); });
  function localSet(s) {
    if (!s) return;
    if (s.goal) cfg.goal = G.normGoal(s.goal);
    if (s.level) cfg.level = G.normLevel(s.level);
    if (s.rules) cfg.rules = G.normRules(s.rules, cfg.rules);
    store.set(K.cfg, cfg); renderHome();
  }
  function onlineSet(e) {
    if (!R || R.you !== R.host) return;
    const s = settingOf(e); if (s) UI.send({ t: "settings", ...s });
  }
  document.addEventListener("click", (e) => { if (e.target.closest("#setOnline [data-v]")) onlineSet(e); });
  document.addEventListener("change", (e) => { if (e.target.matches("#setOnline [data-r]")) onlineSet(e); });

  // ---------- rendering ----------
  function showScreen(id) {
    for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id;
    if (id !== "game") { boardOn = false; FX.skip(); SH.close(); }
  }

  function render() {
    if (mode === "local" && L) {
      V = G.view(L, 0);
      showScreen("game"); renderGame();
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

  const plateHTML = (i) => {
    const p = V.players[i], members = mode === "online" && R ? R.members : null;
    const away = members && members[i] && !members[i].online;
    const mine = V.props.filter((x) => x && x.owner === i).length;
    const cls = ["plate", V.phase === "play" && V.actor === i ? "active" : "", away ? "away" : "", p.out ? "out" : ""].join(" ");
    const tag = p.out ? "pleite" : p.bot ? "Computer" : away ? "offline" : i === V.me ? "du" : "";
    const meta = [tag, p.jail > 0 ? "⛓️" : "", mine ? `🏠${mine}` : "", p.cards.length ? "🔓" : ""].filter(Boolean).join(" ");
    return `<div class="${cls}" data-seat="${i}" style="--sc:${B.SEATS[i % B.SEATS.length]}"><span class="pav" aria-hidden="true">${p.avatar}</span>` +
      `<span class="pinfo"><span class="pname">${esc(p.name)}</span><span class="pcash">${M(shown[i])}</span><span class="pmeta">${meta || "&nbsp;"}</span></span>` +
      (V.goal > 1 ? `<span class="pwins" title="Siege">${p.wins}</span>` : "") + `</div>`;
  };

  function renderGame() {
    const busy = FX.busy();
    if (V.phase !== "roundEnd") peek = false;
    if (!boardOn || boardN !== V.players.length || lastRound !== V.round) {
      if (!boardOn || boardN !== V.players.length) { B.build($("#board")); FX.mountMid(); }
      boardOn = true; boardN = V.players.length; lastRound = V.round; shown = [];
    }
    if (!busy || shown.length !== V.players.length) shown = V.players.map((p, i) => (busy && shown[i] != null ? shown[i] : p.cash));
    $("#plates").innerHTML = V.players.map((_, i) => plateHTML(i)).join("");
    const left = V.rules.limit ? ` · noch ${Math.max(0, V.rules.limit - Math.min(...V.players.filter((p) => !p.out).map((p) => p.turns)))} Züge` : "";
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> · Zug ${V.turn}${left}`;

    if (!busy) {
      B.update(V); B.syncTokens(V, true);
      FX.drawDice(V.dice, false, true); FX.piles(V);
      const lm = $("#lastMove"), lines = V.log.slice(-2), k = lines.join("\n");
      if (lm.dataset.k !== k) { lm.dataset.k = k; lm.innerHTML = lines.map((l, i) => `<div${i < lines.length - 1 ? ' class="old"' : ""}>${esc(l)}</div>`).join(""); }
    } else B.syncTokens(V, false);
    $("#reactBtn").hidden = mode !== "online";
    renderDock(busy);
    SH.refresh();

    $("#roundEnd").hidden = busy || V.phase !== "roundEnd" || peek;
    if (!busy && V.phase === "roundEnd") {
      if (!peek) renderRoundEnd();
      const k = `${V.round}:${V.last.winners.join(",")}:${V.players.map((p) => p.wins).join(",")}`;
      if (confettiFor !== k) {
        confettiFor = k; record(k);
        if (V.last.winners.includes(V.me)) setTimeout(() => confetti(), 400);
      }
    }
  }

  // ---------- the dock: who is up, what is on the table, what you can do ----------
  let dockFns = [];
  const cardHTML = (idx, extra) => {
    const f = BOARD[idx], color = f.k === "prop" ? GROUPS[f.g].color : "#94a3b8";
    const sub = f.k === "prop" ? `${GROUPS[f.g].name} · Miete ${M(f.r[0])}` : f.k === "station" ? "Bahnhof · Miete €25 bis €200" : "Versorgungswerk · 4× oder 10× Augenzahl";
    return `<div class="card" data-info="${idx}" style="--bc:${color}"><i class="sw"></i><div class="ct"><b>${esc(f.n)}</b><br>${sub}${extra ? `<br>${extra}` : ""}</div><div class="big">${M(f.p)}</div></div>`;
  };
  const sideText = (s) => [s.cash ? `${M(s.cash)}` : "", ...s.props.map((i) => BOARD[i].n), s.card ? "Freikarte" : ""].filter(Boolean).join(", ") || "nichts";

  let wasMine = false;
  function renderDock(busy) {
    dockFns = [];
    const acts = [], sub = [];
    const btn = (label, cls, fn, off) => { dockFns.push(fn); return `<button type="button" class="btn ${cls || ""}${off ? " off" : ""}" data-b="${dockFns.length - 1}">${label}</button>`; };
    let av = "", who = "", hint = "", now = "", mine = false;
    if (V.phase === "roundEnd") {
      const w = V.last.winners[0];
      Spieleabend.mine(false); wasMine = false;
      av = V.players[w].avatar; who = `${name(w)} ${w === V.me ? "gewinnst" : "gewinnt"}`; hint = "Runde vorbei.";
      if (!busy && peek) acts.push(btn("Ergebnis", "btn-primary", () => { peek = false; render(); }));
    } else {
      const a = V.actor, P = V.players[a];
      mine = a === V.me;
      const cue = mine && (mode === "online" || V.players.some((p) => p.bot));
      Spieleabend.mine(cue);
      if (cue && !wasMine && !busy) { sfx("turn"); buzz([40, 60, 40]); }
      wasMine = cue;
      av = P.avatar;
      who = mine ? "Du bist dran" : `${P.name} ist dran`;
      hint = mine ? "" : P.bot ? "Der Computer überlegt …" : V.me < 0 ? "Du schaust zu." : "Warte auf den Zug.";
      if (busy) hint = "";
      else if (V.trade) {
        const T = V.trade, f = V.players[T.from], t = V.players[T.to];
        now = `<div class="card"><div class="ct"><b>${esc(f.name)}</b> bietet <b>${esc(t.name)}</b> einen Tausch an:<br>gibt: ${esc(sideText(T.give))}<br>will: ${esc(sideText(T.take))}</div></div>`;
        if (T.to === V.me) { who = "Tauschangebot für dich"; acts.push(btn("Annehmen", "btn-primary", () => act({ t: "accept" })), btn("Ablehnen", "", () => act({ t: "reject" }))); }
        else if (T.from === V.me) { who = "Du wartest auf eine Antwort"; acts.push(btn("Zurückziehen", "", () => act({ t: "cancel" }))); }
      } else if (V.auction) {
        const A = V.auction, bid = A.bid ? `${M(A.bid)} von ${esc(V.players[A.who].name)}` : "noch keins";
        now = cardHTML(A.idx, `<b>Versteigerung</b> · Höchstgebot: ${bid}`);
        who = mine ? "Du bist beim Bieten dran" : `${P.name} bietet`;
        if (mine) {
          const cash = V.players[V.me].cash;
          for (const d of [10, 50, 100]) if (A.bid + d <= cash) acts.push(btn(`Bieten ${M(A.bid + d)}`, d === 10 ? "btn-primary" : "", () => act({ t: "bid", amount: A.bid + d })));
          acts.push(btn("Passen", "btn-ghost", () => act({ t: "pass" })));
        }
      } else if (V.step === "buy") {
        const f = BOARD[V.buy];
        now = cardHTML(V.buy);
        if (mine) { who = `${f.n} kaufen?`; acts.push(btn(`Kaufen für ${M(f.p)}`, "btn-primary", () => act({ t: "buy" })), btn(V.rules.auction ? "Versteigern" : "Nein", "", () => act({ t: "decline" }))); }
      } else if (V.step === "debt") {
        const D = V.debt, to = D.to < 0 ? "die Bank" : V.players[D.to].name;
        now = `<div class="card"><div class="ct"><b>${esc(V.players[D.pi].name)}</b> schuldet ${esc(to)} <b>${M(D.amount)}</b>.</div></div>`;
        if (mine) {
          who = `Du musst ${M(D.amount)} zahlen`; hint = `Dir fehlen ${M(Math.max(0, D.amount - V.players[V.me].cash))}. Verkaufe Häuser oder beleihe Grundstücke.`;
          acts.push(btn("Grundstücke verwalten", "btn-primary", () => SH.open("manage")), btn("Pleite gehen", "btn-danger", () => act({ t: "bankrupt" })));
        }
      } else if (mine && V.step === "roll") {
        const jail = P.jail > 0;
        who = jail ? "Du sitzt im Gefängnis" : V.doubles > 0 ? "Pasch! Nochmal würfeln" : "Du bist dran";
        hint = jail ? `Pasch würfeln, ${M(G.JAIL_FEE)} zahlen oder eine Freikarte nutzen.` : "";
        acts.push(btn(jail ? "Würfeln (Pasch?)" : "Würfeln", "btn-primary", () => act({ t: "roll" })));
        if (jail) {
          acts.push(btn(`${M(G.JAIL_FEE)} zahlen`, "", () => act({ t: "payJail" }), P.cash < G.JAIL_FEE));
          if (P.cards.length) acts.push(btn("Freikarte", "", () => act({ t: "useCard" })));
        }
      } else if (mine && V.step === "after") {
        who = "Zug beenden?"; hint = "Du kannst noch bauen oder tauschen.";
        acts.push(btn("Zug beenden", "btn-primary", () => act({ t: "end" })));
      }
      if (!busy && V.me >= 0 && !V.players[V.me].out) {
        sub.push(btn("Meine Grundstücke", "", () => SH.open("manage")));
        const can = V.cur === V.me && (V.step === "roll" || V.step === "after") && !V.trade && !V.auction && V.players.filter((p, i) => i !== V.me && !p.out).length;
        if (can) sub.push(btn("Tauschen", "", () => SH.open("trade")));
      }
    }
    $("#whoAv").textContent = av; $("#whoName").textContent = who; $("#whoHint").textContent = hint;
    $("#dock").classList.toggle("myturn", mine && !busy);
    $("#now").innerHTML = busy ? "" : now;
    $("#acts").innerHTML = busy ? "" : acts.join("");
    $("#subActs").innerHTML = busy ? "" : sub.join("");
  }
  $("#dock").addEventListener("click", (e) => {
    const b = e.target.closest("[data-b]");
    if (b) { const f = dockFns[+b.dataset.b]; if (f) f(); return; }
    const c = e.target.closest("[data-info]");
    if (c) SH.open("info", +c.dataset.info);
  });
  $("#board").addEventListener("click", (e) => { const c = e.target.closest(".cell"); if (c) SH.open("info", +c.dataset.i); });
  SH.init({ view: () => V, act, toast, sfx });

  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, button") || e.ctrlKey || e.metaKey || e.altKey) return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") { if (open) $(open).hidden = true; else SH.close(); return; }
    if (open || SH.isOpen() || $("#game").hidden || !$("#roundEnd").hidden || FX.busy() || !V || V.actor !== V.me) return;
    if ((e.key === " " || e.key.toLowerCase() === "r") && V.step === "roll" && !V.trade && !V.auction) { e.preventDefault(); act({ t: "roll" }); }
  });

  // ---------- reactions (online) ----------
  function bubble(pi, e, who) {
    const host = pi >= 0 ? plateEl(pi) : $("#dock");
    if (!host) return;
    const b = document.createElement("span");
    b.className = "bubble" + (e.length > 3 ? " say" : ""); b.textContent = pi < 0 && who ? `${who}: ${e}` : e;
    showBubble(host, b);
    setTimeout(() => b.remove(), 2800);
    sfx("pop");
  }
  $("#reactBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#reactBar").hidden = !$("#reactBar").hidden; });
  $("#reactBar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-e]"); if (!b) return;
    $("#reactBar").hidden = true;
    UI.send({ t: "react", e: b.dataset.e });
  });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#reactBar, #reactBtn")) $("#reactBar").hidden = true; });

  // ---------- round end ----------
  const worths = () => (V.last ? V.last.worths : V.players.map((p, i) => (p.out ? 0 : G.worth(V, i))));
  function scoreList(el, winners) {
    const w = worths(), order = V.players.map((p, i) => i).sort((a, b) => w[b] - w[a]);
    el.innerHTML = order.map((i) => {
      const p = V.players[i], you = i === V.me ? " (du)" : "";
      return `<li class="${winners.includes(i) ? "win" : ""}"><span>${avi(p.avatar)}${esc(p.name)}${you}<small>${p.out ? "pleite" : `${M(p.cash)} Bargeld`}</small></span><b>${p.out ? "–" : M(w[i])}</b></li>`;
    }).join("");
  }
  function renderRoundEnd() {
    const last = V.last, w = last.winners[0];
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round} vorbei`;
    $("#reTitle").textContent = `${w === V.me ? "Du gewinnst" : `${V.players[w].name} gewinnt`} ${last.over ? "das Spiel" : "die Runde"}!`;
    $("#reText").textContent = (last.reason === "limit" ? "Das Zeitlimit ist erreicht, der Reichste gewinnt." : "Alle anderen sind pleite.") +
      (last.over ? "" : ` Gespielt wird bis ${V.goal} Siege, als Nächstes beginnt ${V.players[V.nextStarter].name}.`) + " Rangliste nach Gesamtwert (Bargeld, Grundstücke, Häuser):";
    scoreList($("#reScores"), last.winners);
    UI.roundEndFooter({ over: last.over, next: "Nächste Runde" });
  }
  const profile = Spieleabend.profile;
  function record(key) {
    const i = mode === "online" ? V.me : V.players.findIndex((p) => !p.bot);
    if (i < 0) return;
    profile.result("monopoly", key, { won: V.last.winners.includes(i), draw: !V.last.winners.length, online: mode === "online" });
  }

  function renderHome() {
    LOOK.render();
    $("#myAvatar").textContent = myAvatar;
    for (const b of document.querySelectorAll("#modeTabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
    $("#onlinePanel").hidden = tab !== "online" || !webHost;
    $("#onlineOff").hidden = tab !== "online" || webHost;
    const sh = $("#serverHint");
    sh.hidden = serverState === "ok";
    sh.textContent = serverState === "checking" ? "Suche den Spiel-Server …" : "Unter dieser Adresse antwortet kein Spiel-Server. Du kannst es trotzdem versuchen, „Einzelspieler“ geht immer.";
    $("#localPanel").hidden = tab !== "local";
    fillSettings($("#setLocal"), cfg, true);
    const sv = store.get(K.local);
    $("#resumePanel").hidden = !(sv && sv.players);
    if (sv && sv.players) $("#resumeHint").textContent = `${sv.players.map((p) => p.name).join(" gegen ")} · Runde ${sv.round}`;
    HOME.render();
  }

  // ---------- waiting room and menu: shared (room-ui.js), plus this game's own parts ----------
  const UI = window.RoomUI({
    room: () => R, view: () => V, mode: () => mode, server: () => server,
    watching: (v) => (v === undefined ? watching : (watching = v)),
    onlineKey: K.online,
    on: {
      opened() { if (serverState !== "ok") { serverState = "ok"; server = server || {}; } },
      joined() { mode = "online"; wake(); },
      room(m) { R = m; mode = "online"; inflight = false; if (m.view && m.events && m.events.length) FX.push(m.events, m.view); render(); },
      react(m) { bubble(m.pi, m.e, m.name); },
      error() { inflight = false; },
      left() { R = null; mode = null; }
    },
    bubble: (pi, text, who) => bubble(pi, text, who),
    toast, render: () => render(), maxPlayers: G.MAX_PLAYERS, watchers: true,
    avatars: G.AVATARS, setAvatar: (a) => { myAvatar = a; store.set(K.avatar, a); },
    renderSettings(host) { fillSettings($("#setOnline"), { goal: R.goal, level: R.level || 2, rules: R.rules }, host); },
    menu: {
      open() {
        LOOK.render();
        if (V) scoreList($("#menuScores"), []);
        const mr = $("#menuRules");
        if (mr && V) mr.textContent = `Startgeld ${M(V.rules.cash)} · ${V.rules.limit ? `Zeitlimit ${V.rules.limit} Züge` : "ohne Zeitlimit"}${V.rules.goDouble ? " · doppelt auf Los" : ""}${V.rules.parking ? " · Jackpot" : ""}${V.rules.auction ? " · Versteigerung" : ""}.`;
      },
      local(box) {
        box.append(
          UI.armed("Runde neu starten", () => { L.round--; L.starter = (L.starter + L.players.length - 1) % L.players.length; G.startRound(L); FX.skip(); peek = false; store.set(K.local, L); render(); scheduleBot(); }),
          UI.armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; clearTimeout(botT); render(); })
        );
      },
      player() {},
      skip: (v) => v.phase === "play" && !v.players[v.cur].bot && v.cur !== v.me
    }
  });
  Spieleabend.avatarPicker({ avatars: G.AVATARS, get: () => myAvatar, set: (a) => { myAvatar = a; store.set(K.avatar, a); } });
  Spieleabend.followTurn("#plates", ".plate.active");

  // ---------- start screen ----------
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; tabTouched = true; renderHome(); } });
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
    UI.send({ t: "join", code, name: n, avatar: myAvatar });
  }
  $("#joinBtn").addEventListener("click", join);
  $("#joinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  $("#createBtn").addEventListener("click", () => {
    const n = myName(); if (!n) return;
    store.del(K.online);
    UI.send({ t: "create", name: n, goal: cfg.goal, level: cfg.level, rules: cfg.rules, avatar: myAvatar });
  });

  function startLocal(state) {
    L = state; mode = "local"; peek = false; boardOn = false; FX.skip();
    store.set(K.local, L); render(); wake(); scheduleBot();
  }
  $("#startLocal").addEventListener("click", () => {
    const { names, bots } = HOME.roster($("#myName").value);
    const list = names.map((n, i) => ({ name: n, bot: bots[i], avatar: bots[i] ? G.BOT_AVATAR : myAvatar }));
    startLocal(G.newGame(list, cfg.goal, cfg.rules, cfg.level));
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
    else if (V && V.phase === "roundEnd" && V.last && V.last.over) UI.send({ t: "lobby" });
    else UI.send({ t: "end" });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (mode) wake();
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- boot ----------
  const code = UI.roomCode();
  render();
  if (webHost && (store.get(K.online) && !code)) UI.resume();
  UI.detectServer("/monopoly-server", "monopoly").then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
