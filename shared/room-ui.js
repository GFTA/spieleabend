// Shared browser part of every Spieleabend game: the waiting room and the in-game menu.
// Loaded right before the game's app.js. On load it builds the markup of both from one
// template (the game only fills a few <template data-slot> placeholders in index.html),
// then app.js calls RoomUI({...}) with its state accessors and gets the functions that
// render and run them:
//
//   <section id="lobby" class="screen" hidden aria-label="Warteraum">
//     <template data-slot="settings"> goal / computer strength / ... panel </template>
//   </section>
//   <div class="overlay" id="menu" hidden [data-title="Siege"] [data-scores="ranking"] [data-rules-title="…"]>
//     <template data-slot="rules"> the game rules (shown in the menu and in the waiting room) </template>
//     <template data-slot="history"> optional, above the move log </template>
//     <template data-slot="settings"> optional toggles above "Töne und Vibration" </template>
//   </div>
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SVG = (d, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"${extra || ""} aria-hidden="true">${d}</svg>`;
  const ICONS = {
    leave: SVG('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/>', ' stroke-linejoin="round"'),
    close: SVG('<path d="M12 3v8"/><path d="M6.4 7a8 8 0 1 0 11.2 0"/>'),
    home: SVG('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>', ' stroke-linejoin="round"'),
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6" /></svg>'
  };

  ICONS.chat = SVG('<path d="M4 5h16v11H9l-5 4z"/>', ' stroke-linejoin="round"');
  const CHAT_FORM = `<form class="chatform" data-chat><input class="field" type="text" maxlength="200" placeholder="Nachricht …" autocomplete="off" enterkeyhint="send" aria-label="Chat-Nachricht"><button class="btn" type="submit">Senden</button></form>`;

  // ---------- markup ----------
  const slot =(root, name) => { const t = root.querySelector(`template[data-slot="${name}"]`); return t ? t.innerHTML : ""; };
  const lobby = $("#lobby"), menu = $("#menu");
  const rulesHTML = slot(menu, "rules");
  lobby.innerHTML = `
    <div class="panel nowplaying" id="nowPlaying" hidden></div>
    <div class="cols"><div class="col">
    <div class="panel">
      <div class="label" style="text-align:center">Raum-Code</div>
      <div class="roomcode" id="roomCode"></div>
      <div class="qr" id="qr" hidden></div>
      <p class="hint" style="text-align:center" id="joinHint"></p>
      <div class="link"><code id="joinUrl"></code><button class="btn" id="copyBtn" type="button">Kopieren</button></div>
    </div>
    <div class="panel">
      <div class="label" id="membersLabel"></div>
      <ul class="members" id="members"></ul>
      <button class="btn btn-ghost" id="addBot" type="button">+ Computer-Gegner</button>
      <button class="btn btn-primary" id="sitBtn" type="button" hidden>Mitspielen</button>
      <p class="hint" id="lobbyHint"></p>
      <a class="btn btn-ghost btn-block" id="partyLobby" hidden>Zurück zur Party</a>
    </div>
    <div class="panel chatpanel">
      <div class="label">Chat</div>
      <ol class="chatlog" id="chatLobbyLog"></ol>
      ${CHAT_FORM}
    </div>
    </div><div class="col">
    ${slot(lobby, "settings")}
    <details class="houserules" id="rulesLobbyBox">
      <summary><span class="label">Hausregeln</span><span class="rules-sum" id="rulesLobbySum"></span></summary>
      <div class="panel">
        <p class="hint" id="rulesLobbyHint"></p>
        <div class="rules-list" id="rulesLobby"></div>
      </div>
    </details>
    <details class="houserules">
      <summary><span class="label">Spielregeln</span></summary>
      <div class="panel gamerules" id="rulesHelpLobby">${rulesHTML}</div>
    </details>
    </div></div>
    <div class="lobby-actions">
      <button class="btn btn-primary" id="readyBtn" type="button" hidden>Bereit</button>
      <button class="btn btn-primary" id="startOnline" type="button">Starten</button>
      <button class="btn iconact" id="leaveLobby" type="button" aria-label="Raum verlassen" title="Raum verlassen">${ICONS.leave}</button>
      <button class="btn iconact" id="closeLobby" type="button" hidden aria-label="Raum für alle schließen" title="Raum für alle schließen">${ICONS.close}</button>
    </div>`;
  menu.innerHTML = `
  <div class="sheet">
    <h2>${menu.dataset.title || "Punktestand"}</h2>
    <ol class="${menu.dataset.scores || "scores"}" id="menuScores"></ol>
    <div class="hint" id="menuRules"></div>
    <div class="rules"><details><summary>${menu.dataset.rulesTitle || "Spielregeln"}</summary>${rulesHTML}</details></div>
    <div class="rules"><details><summary>Spielverlauf</summary>${slot(menu, "history")}<ol class="history" id="menuLog"></ol></details></div>
    <div class="rules"><details><summary>Einstellungen</summary><div class="look" id="lookMenu"></div>${slot(menu, "settings")}<label class="toggle" for="soundOn"><input type="checkbox" id="soundOn" checked><span>Töne und Vibration</span></label></details></div>
    <div id="menuActions"></div>
    <div class="rules" id="hostBox" hidden><details><summary>Als Host</summary><div class="hostacts" id="hostActions"></div></details></div>
    <div class="menubar">
      <button class="btn btn-primary" id="menuClose" type="button">Weiterspielen</button>
      <button class="btn iconact" id="menuLeave" type="button" hidden aria-label="Raum verlassen" title="Raum verlassen">${ICONS.leave}</button>
      <a class="btn iconact" href="https://games.cool-kidz.net/" data-start-link aria-label="Zur Spieleabend-Startseite" title="Zur Spieleabend-Startseite">${ICONS.home}</a>
    </div>
  </div>`;
  // chat during a game: a button in the top bar next to the menu, and a sheet with the whole log
  $("#menuBtn").insertAdjacentHTML("beforebegin", `<button class="iconbtn" id="chatBtn" type="button" aria-label="Chat" title="Chat" hidden>${ICONS.chat}<span class="badge" id="chatBadge" hidden></span></button>`);
  document.body.insertAdjacentHTML("beforeend", `<div class="overlay" id="chat" hidden><div class="sheet"><h2>Chat</h2><ol class="chatlog" id="chatLog"></ol>${CHAT_FORM}
    <button class="btn btn-primary btn-block" id="chatClose" type="button">Weiterspielen</button></div></div>`);

  // ---------- behavior ----------
  // app: {
  //   room() -> R, view() -> V, mode() -> "online" | "local" | null, server() -> /info of this server
  //   watching(v?) get/set "watching the running game from the waiting room"
  //   toast(text), render(), maxPlayers, watchers (full rooms let people watch)
  //   onlineKey: where the room code + secret are stored to rejoin after a reload
  //   on: { opened(), joined(m), room(m), react(m), error(m), left() }  what the game does with server messages
  //   bubble(pi, text, name) -> show a short text over a player (reactions; chat lines during a game)
  //   memberExtra(m, i) -> html after the name (colour dot, ...)
  //   renderSettings(host) -> fill the settings slot and the house rules
  //   cycleAvatar() -> the next avatar for me (also stored by the app)
  //   menu: { open(), local(box), player(box), skip(V) -> may the host skip the current player, standIn }
  // }
  // returns { send, resume, update, renderLobby, rematchStatus, armed, detectServer(path, flag), roomCode(), ... }; update() runs on every render
  window.RoomUI = function (app) {
    const R = () => app.room(), V = () => app.view();
    const store = window.Spieleabend.store, startUrl = window.Spieleabend.startUrl;

    // ---------- party hand-off: the start page opens the game with ?pr=ROOM and ?ps=SEAT-SECRET (or ?pw=NAME to watch) ----------
    // it lands in the same place a reload would: the stored room, which the game's own start code resumes
    (function partyBoot() {
      const q = new URLSearchParams(location.search), code = (q.get("pr") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
      if (!code || !(q.get("ps") || q.get("pw"))) return;
      store.set(app.onlineKey, q.get("ps") ? { code, secret: q.get("ps") } : { code, watch: q.get("pw").slice(0, 18) });
      for (const n of ["pr", "ps", "pw", "r"]) q.delete(n);
      history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : ""));
    })();
    // "back to the party" links in the waiting room and the menu, only in rooms a party made
    const partyHref = () => startUrl(`?party=${R().party}`);

    // ---------- connection: one socket, reconnects on its own, rejoins with the stored secret ----------
    let ws = null, wantOnline = false, retry = 0, queue = [], giveUpT = null, netT = null;
    function connect() {
      if (ws && ws.readyState <= 1) return;
      // each socket only ever touches itself: a late close of an old socket must not wipe out the new one
      const sock = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
      ws = sock;
      sock.onopen = () => {
        if (ws !== sock) { sock.close(); return; }
        retry = 0; clearTimeout(giveUpT);
        if (app.on.opened) app.on.opened();
        const s = store.get(app.onlineKey);
        if (s && !queue.some((m) => m.t === "create" || m.t === "join"))
          sock.send(JSON.stringify(s.watch ? { t: "join", code: s.code, name: s.watch, watch: true } : { t: "resume", code: s.code, secret: s.secret }));
        for (const m of queue.splice(0)) sock.send(JSON.stringify(m));
        app.render();
      };
      sock.onmessage = (e) => { if (ws !== sock) return; try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
      sock.onclose = () => {
        if (ws !== sock) return;
        ws = null;
        if (wantOnline) setTimeout(connect, Math.min(8000, 400 * 2 ** retry++));
        app.render();
      };
    }
    // send now, or for create/join: connect first and send as soon as the socket is open
    function send(m) {
      if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; }
      if (m.t === "create" || m.t === "join") {
        queue.push(m); wantOnline = true; retry = 0; connect();
        clearTimeout(giveUpT);
        giveUpT = setTimeout(() => {
          if (ws && ws.readyState === 1) return;
          queue = []; wantOnline = false;
          if (ws) ws.close();
          app.toast("Der Spiel-Server antwortet nicht. Prüf die Adresse oder die Internetverbindung.");
          app.render();
        }, 8000);
        return true;
      }
      return false;
    }
    // after a reload: back into the room stored in onlineKey
    function resume() { wantOnline = true; connect(); }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && wantOnline && !(ws && ws.readyState <= 1)) { retry = 0; connect(); }
    });
    function onMsg(m) {
      if (m.t === "watching" || m.t === "joined") {
        store.set(app.onlineKey, m.t === "watching" ? { code: m.code, watch: m.name } : { code: m.code, secret: m.secret });
        wantOnline = true;
        if (location.search) history.replaceState(null, "", location.pathname);
        app.on.joined(m);
        if (m.t === "watching") app.toast("Das Spiel läuft schon oder der Raum ist voll: Du schaust zu.");
      } else if (m.t === "room") {
        app.on.room(m);
      } else if (m.t === "react") {
        app.on.react(m);
      } else if (m.t === "chatlog") {
        chat = m.list || []; unread = 0; renderChat();
      } else if (m.t === "chat") {
        addChat(m.line);
      } else if (m.t === "error") {
        if (app.on.error) app.on.error(m);
        app.toast(m.msg);
      } else if (m.t === "gone" || m.t === "left") {
        // keep the socket: a join or create sent a moment ago is answered on it
        store.del(app.onlineKey);
        chat = []; unread = 0; renderChat();
        app.on.left();
        if (m.t === "gone") app.toast(m.reason === "idle" ? "Raum wegen Inaktivität geschlossen." : m.reason === "closed" ? "Der Raum wurde geschlossen." : "Diesen Raum gibt es nicht mehr.");
        app.render();
      }
    }
    // runs on every render: the connection pill (only after a short grace period, phones drop
    // sockets all the time) and the chat button
    function update() {
      const online = app.mode() === "online", down = online && wantOnline && !(ws && ws.readyState === 1);
      if (!down) { clearTimeout(netT); netT = null; $("#net").hidden = true; }
      else if (!netT && $("#net").hidden) netT = setTimeout(() => { netT = null; if (app.mode() === "online" && !(ws && ws.readyState === 1)) $("#net").hidden = false; }, 2000);
      $("#chatBtn").hidden = !online || !R();
      if (!online) $("#chat").hidden = true;
      renderBadge();
    }

    // ---------- chat: one per room, in the waiting room and as a sheet during the game ----------
    let chat = [], unread = 0;
    const mine = (line) => { const r = R(), s = store.get(app.onlineKey); return !!r && line.pi === r.you && (r.you >= 0 || (s && s.watch === line.name)); };
    const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
    function renderChat() {
      const html = chat.length ? chat.map((l) => `<li class="${mine(l) ? "me" : ""}"><span class="av" aria-hidden="true">${esc(l.avatar || "")}</span><div><b>${esc(l.name || "?")}</b> <time>${hhmm(l.at)}</time><p>${esc(l.text)}</p></div></li>`).join("")
        : '<li class="empty">Noch keine Nachrichten.</li>';
      for (const id of ["#chatLobbyLog", "#chatLog"]) { const el = $(id); el.innerHTML = html; el.scrollTop = el.scrollHeight; }
      renderBadge();
    }
    function renderBadge() {
      const b = $("#chatBadge");
      b.hidden = !unread; b.textContent = unread > 9 ? "9+" : String(unread);
      $("#chatBtn").setAttribute("aria-label", unread ? `Chat, ${unread} neu` : "Chat");
    }
    function addChat(line) {
      if (chat.some((l) => l.id === line.id)) return;
      chat = chat.concat(line).slice(-100);
      const seen = !$("#chat").hidden || !$("#lobby").hidden;
      if (!mine(line) && !seen) {
        unread++;
        if (app.bubble) app.bubble(line.pi, line.text.length > 30 ? line.text.slice(0, 29) + "…" : line.text, line.name);
      }
      renderChat();
    }
    // the server takes one line per second: a quicker one waits here instead of being refused
    let chatAt = 0, chatWait = [];
    function sendChat(text) {
      chatWait.push(text);
      if (chatWait.length > 1) return;
      (function next() {
        const wait = chatAt + 1100 - Date.now();
        if (wait > 0) return setTimeout(next, wait);
        chatAt = Date.now();
        send({ t: "chat", text: chatWait.shift() });
        if (chatWait.length) setTimeout(next, 1100);
      })();
    }
    for (const f of document.querySelectorAll("form[data-chat]")) f.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = f.querySelector("input"), text = input.value.trim();
      if (!text) return;
      if (!(ws && ws.readyState === 1)) { app.toast("Keine Verbindung, die Nachricht wurde nicht gesendet."); return; }
      sendChat(text); input.value = "";
    });
    renderChat();
    $("#chatBtn").addEventListener("click", () => { $("#chat").hidden = false; unread = 0; renderChat(); });
    $("#chatClose").addEventListener("click", () => { $("#chat").hidden = true; });
    $("#chat").addEventListener("click", (e) => { if (e.target.id === "chat") $("#chat").hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#chat").hidden) { $("#chat").hidden = true; e.stopPropagation(); } }, true);

    function joinUrl() {
      const r = R(), server = app.server();
      const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
      // opened on the server box itself: link to its LAN address instead (not a Docker-internal one)
      const ip = local && server && server.ips && server.ips.find((x) => !/^172\.(1[6-9]|2\d|3[01])\./.test(x));
      const base = ip ? `${location.protocol}//${ip}:${location.port || server.port}/` : location.origin + location.pathname;
      return `${base}?r=${r.code}`;
    }
    function drawQr(url) {
      const box = $("#qr");
      const paint = () => {
        try {
          const q = window.qrcode(0, "M"); q.addData(url); q.make();
          box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
          box.hidden = false;
        } catch (e) { box.hidden = true; }
      };
      if (window.qrcode) return paint();
      const s = document.createElement("script");
      s.src = "vendor/qrcode.js"; s.onload = paint; s.onerror = () => { box.hidden = true; };
      document.head.appendChild(s);
    }

    let qrFor = null;
    function renderLobby() {
      const r = R(), max = app.maxPlayers;
      $("#roomCode").textContent = r.code;
      const url = joinUrl();
      $("#joinUrl").textContent = url;
      if (qrFor !== url) { qrFor = url; drawQr(url); }
      const lan = /^http:\/\/(\d+\.){3}\d+[:/]/.test(url);
      $("#joinHint").textContent = "Die anderen scannen den QR-Code oder öffnen den Link und geben den Code ein." +
        (app.watchers ? " Ist der Raum voll, schauen weitere Leute zu." : "") + (lan ? " Alle müssen im selben WLAN sein." : "");
      const host = r.you === r.host;
      $("#closeLobby").hidden = !host;
      $("#partyLobby").hidden = !r.party; if (r.party) $("#partyLobby").href = partyHref();
      const watcher = r.you < 0, seen = r.watchers || [];
      $("#membersLabel").textContent = `Spieler (${r.members.length}/${max})` + (seen.length ? ` · ${seen.length} ${seen.length === 1 ? "schaut" : "schauen"} zu` : "");
      $("#sitBtn").hidden = !watcher || r.members.length >= max;
      $("#members").innerHTML = r.members.map((m, i) =>
        `<li class="${i === r.you ? "me" : ""}">${m.bot ? `<span class="botico">${ICONS.bot}</span>` : `<span class="on${m.online ? "" : " off"}"></span>`}` +
        (i === r.you ? `<button class="av" type="button" data-myav aria-label="Avatar wechseln">${m.avatar}</button>` : `<span class="av" aria-hidden="true">${m.avatar || ""}</span>`) +
        `<span class="nm">${esc(m.name)}</span>${app.memberExtra ? app.memberExtra(m, i) : ""}` +
        `${i === r.host ? '<span class="tag">Host</span>' : ""}${i === r.you ? '<span class="tag">du</span>' : ""}${m.bot ? '<span class="tag">Computer</span>' : ""}` +
        `${m.bot && host ? `<button class="rm" type="button" data-unbot="${i}" aria-label="${esc(m.name)} entfernen">×</button>` : ""}</li>`).join("");
      $("#addBot").hidden = !host || r.members.length >= max;
      app.renderSettings(host);
      if (watcher) $("#lobbyHint").textContent = r.members.length >= max ? "Du schaust zu. Wird ein Platz frei, kannst du mitspielen." : "Du schaust zu. Tippe auf „Mitspielen“, um einen freien Platz zu nehmen.";
      renderReady();
    }

    // waiting room: ready up, or watch the game that runs
    function renderReady() {
      const r = R(), me = r.members[r.you], host = r.you === r.host, run = r.view;
      const over = !!(run && run.phase === "roundEnd" && run.last && run.last.over);
      const n = run ? run.players.length : 0, playing = (i) => !!run && i < n && !r.members[i].lobby;
      const btn = $("#readyBtn"), start = $("#startOnline"), box = $("#nowPlaying");
      btn.hidden = !me || me.bot;
      if (run && !over) { btn.dataset.act = "watch"; btn.textContent = "Zuschauen"; btn.classList.add("btn-primary"); }
      else {
        btn.dataset.act = "ready";
        btn.textContent = me && me.ready ? (over ? "Bei der Revanche dabei ✓" : "Bereit ✓") : (over ? "Bei der Revanche mitspielen" : "Bereit");
        btn.classList.toggle("btn-primary", !(me && me.ready) && !(host && !run)); // the host's main button is "Starten"
      }
      box.hidden = !run;
      if (run) {
        const names = r.members.filter((m, i) => playing(i)).map((m) => esc(m.name)).join(", ");
        box.innerHTML = over
          ? `<b>Das Spiel ist vorbei.</b> ${names} stimmen gerade über eine Revanche ab. Willst du mitspielen, tippe auf „Bei der Revanche mitspielen“.`
          : `<b>Gerade läuft ein Spiel:</b> ${names}. Du kannst zuschauen. Ist es vorbei, kannst du bei der Revanche einsteigen.`;
      }
      const go = r.members.filter((m, i) => m.bot || (m.online && (m.ready || i === r.host)));
      start.hidden = !host || !!run;
      start.disabled = go.length < 2;
      start.innerHTML = go.length < 2 ? "Starten" : `Starten<span class="cnt"> (${go.length})</span>`;
      start.title = go.length < 2 ? "Warte, bis jemand bereit ist" : `Spiel mit ${go.length} Spielern starten`;
      // who is ready, who plays, who waits
      [...document.querySelectorAll("#members > li")].forEach((li, i) => {
        const m = r.members[i];
        if (!m || m.bot) return;
        const t = run ? (playing(i) ? ["spielt", ""] : m.ready ? ["dabei", "ok"] : ["wartet", "wait"]) : m.ready ? ["bereit", "ok"] : null;
        if (t) li.insertAdjacentHTML("beforeend", `<span class="tag ${t[1]}">${t[0]}</span>`);
      });
      if (run) for (const el of document.querySelectorAll("#lobby .seg button, #lobby .rules-list input")) el.disabled = true;
      if (!me) return;
      const people = r.members.filter((m) => !m.bot && m.online), ready = people.filter((m) => m.ready).length;
      $("#lobbyHint").textContent = run
        ? (over ? "" : "Wer im Warteraum ist, spielt die nächste Runde mit, wenn er sich bereit meldet.")
        : (me.ready ? `Du bist bereit (${ready} von ${people.length}). Sind alle bereit, geht es los.` : `Tippe auf „Bereit“, wenn du mitspielen willst (${ready} von ${people.length} bereit).`) +
          (host ? " Mit „Spiel starten“ geht es sofort los, wer nicht bereit ist, wartet dann hier." : "");
    }
    // after a game: who is in for the rematch, who is still deciding, who went back, who left
    function rematchStatus(n, votes) {
      const groups = { in: [], extra: [], wait: [], lobby: [], gone: [] };
      R().members.forEach((m, i) => {
        if (m.bot) return;
        if (i < n && !m.lobby) groups[!m.online ? "gone" : votes.includes(i) ? "in" : "wait"].push(m);
        else if (m.ready && m.online) groups.extra.push(m);
        else if (i < n) groups[m.online ? "lobby" : "gone"].push(m);
      });
      return [["in", "Bereit"], ["extra", "Aus dem Warteraum dabei"], ["wait", "Überlegt noch"], ["lobby", "Zurück im Warteraum"], ["gone", "Gegangen"]]
        .filter(([k]) => groups[k].length).map(([k, t]) => `<span><b>${t}:</b> ${groups[k].map((m) => esc(m.name)).join(", ")}</span>`).join(" · ");
    }

    // buttons of the round-end sheet: next round or rematch (with votes online), back to start / waiting room
    function roundEndFooter({ over, next }) {
      const r = R(), v = V(), mode = app.mode(), online = mode === "online" && !!r;
      const btn = $("#reBtn"), votesEl = $("#reVotes"), back = $("#reBack");
      btn.textContent = over ? "Revanche" : next;
      if (online && over) { // a rematch needs everyone still at the table
        const n = v.players.length, votes = r.rematch || [];
        const table = r.members.map((m, i) => i).filter((i) => i < n && !r.members[i].lobby && !r.members[i].bot && r.members[i].online);
        const yes = table.filter((i) => votes.includes(i)).length;
        btn.textContent = votes.includes(r.you)
          ? (yes === table.length ? "Zu wenige für eine Revanche, warte auf Mitspieler" : `Warte auf die anderen (${yes}/${table.length})`)
          : `Revanche (${yes}/${table.length} bereit)`;
        votesEl.innerHTML = rematchStatus(n, votes);
      }
      votesEl.hidden = !(online && over);
      btn.hidden = mode === "online" && v.me < 0;
      if (mode === "local") { back.hidden = false; back.textContent = "Zurück zum Start"; }
      else { back.hidden = over ? !r.members[r.you] : r.host !== v.me; back.textContent = "Zurück in den Warteraum"; } // after a game everyone decides for themselves
    }

    // waiting room buttons
    $("#readyBtn").addEventListener("click", () => {
      if ($("#readyBtn").dataset.act === "watch") { app.watching(true); app.render(); return; }
      const r = R(), me = r && r.members[r.you];
      if (me) send({ t: "ready", on: !me.ready });
    });
    $("#startOnline").addEventListener("click", () => send({ t: "start" }));
    $("#leaveLobby").addEventListener("click", () => send({ t: "leave" }));
    // host closes the room for everyone; tap twice, like the menu actions
    let closeArm = null;
    $("#closeLobby").addEventListener("click", (e) => {
      const b = e.currentTarget, reset = () => { closeArm = null; b.classList.remove("btn-danger"); };
      if (closeArm) { clearTimeout(closeArm); reset(); send({ t: "close" }); return; }
      b.classList.add("btn-danger"); app.toast("Nochmal tippen, dann ist der Raum für alle geschlossen.");
      closeArm = setTimeout(reset, 3500);
    });
    $("#copyBtn").addEventListener("click", () => {
      const url = $("#joinUrl").textContent;
      const ok = () => app.toast("Link kopiert.");
      const fallback = () => { const r = document.createRange(); r.selectNodeContents($("#joinUrl")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); app.toast("Link markiert, jetzt kopieren."); };
      try { navigator.clipboard.writeText(url).then(ok, fallback); } catch (e) { fallback(); }
    });
    $("#addBot").addEventListener("click", () => send({ t: "bot" }));
    $("#sitBtn").addEventListener("click", () => send({ t: "sit" }));
    $("#members").addEventListener("click", (e) => {
      const b = e.target.closest("[data-unbot]");
      if (b) return send({ t: "unbot", i: +b.dataset.unbot });
      if (e.target.closest("[data-myav]")) send({ t: "avatar", avatar: app.cycleAvatar() });
    });

    // ---------- in-game menu ----------
    // a menu action with in-page two-step confirmation
    function armed(label, run) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn btn-ghost btn-block"; b.textContent = label;
      let t = null;
      b.addEventListener("click", () => {
        if (t) { clearTimeout(t); t = null; $("#menu").hidden = true; run(); return; }
        b.textContent = "Sicher? Nochmal tippen"; b.classList.add("btn-danger");
        t = setTimeout(() => { t = null; b.textContent = label; b.classList.remove("btn-danger"); }, 3500);
      });
      return b;
    }
    function openMenu() {
      const v = V(), r = R(), mode = app.mode();
      $("#menuLog").innerHTML = v ? v.log.slice().reverse().map((l) => `<li>${esc(l)}</li>`).join("") : "";
      app.menu.open(); // scores, the goal and house rules line, the look settings, ...
      const box = $("#menuActions"); box.innerHTML = "";
      const hb = $("#hostActions"); hb.innerHTML = ""; // host-only actions, folded away
      if (mode === "local") app.menu.local(box);
      else if (mode === "online" && r) {
        const host = r.you === r.host;
        if (r.members[r.you] && r.members[r.you].lobby) { // watching from the waiting room: no player actions
          const b = document.createElement("button");
          b.type = "button"; b.className = "btn btn-block"; b.textContent = "Zurück in den Warteraum";
          b.addEventListener("click", () => { app.watching(false); $("#menu").hidden = true; app.render(); });
          box.append(b);
        } else {
          if (host && v && app.menu.skip(v)) hb.append(armed(`${v.players[v.cur].name} überspringen`, () => send({ t: "act", a: { t: "skip" } })));
          app.menu.player(box);
          if (host && v && app.menu.standIn) r.members.forEach((m, i) => {
            if (!m.bot && !m.online) hb.append(armed(`🤖 Computer spielt für ${m.name}`, () => send({ t: "standIn", seat: i })));
          });
          if (host) hb.append(armed("Spiel für alle beenden", () => send({ t: "end" })));
        }
        if (host) hb.append(armed("Raum für alle schließen", () => send({ t: "close" })));
      }
      if (mode === "online" && r && r.party) {
        const a = document.createElement("a");
        a.className = "btn btn-block"; a.textContent = "Zurück zur Party"; a.href = partyHref();
        box.append(a);
      }
      $("#hostBox").hidden = !hb.children.length;
      $("#hostBox details").open = !!(r && r.members.some((m) => !m.bot && !m.online)); // someone dropped out: show what the host can do
      $("#menuLeave").hidden = mode !== "online";
      $("#menu").hidden = false;
    }
    $("#menuBtn").addEventListener("click", openMenu);
    // leave the room from the menu's bottom row: first tap turns it red, the second leaves
    let leaveArm = null;
    $("#menuLeave").addEventListener("click", () => {
      const b = $("#menuLeave");
      clearTimeout(leaveArm);
      if (b.classList.contains("btn-danger")) { b.classList.remove("btn-danger"); $("#menu").hidden = true; send({ t: "leave" }); return; }
      b.classList.add("btn-danger"); app.toast("Nochmal tippen, dann verlässt du den Raum.");
      leaveArm = setTimeout(() => b.classList.remove("btn-danger"), 3500);
    });
    $("#menuClose").addEventListener("click", () => { $("#menu").hidden = true; });

    // ---------- boot: is there a game server behind this address, and was I sent a room code (?r=) ----------
    // Ask twice over HTTP (some ad blockers eat such requests), then simply try the WebSocket.
    // path: the game's own /xxx-server answer, flag: the key that answer carries ({uno: true, ...})
    async function getJson(path, flag, ms) {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
      try {
        const r = await fetch(path, { cache: "no-store", signal: ctl.signal });
        const j = await r.json();
        return j && j[flag] ? j : null;
      } catch (e) { return null; } finally { clearTimeout(t); }
    }
    function probeSocket(ms) {
      return new Promise((res) => {
        let w;
        try { w = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws"); } catch (e) { return res(false); }
        const t = setTimeout(() => { w.close(); res(false); }, ms);
        w.onopen = () => { clearTimeout(t); w.close(); res(true); };
        w.onerror = () => { clearTimeout(t); res(false); };
      });
    }
    async function detectServer(path, flag) {
      if (!/^https?:$/.test(location.protocol)) return null;
      return (await getJson(path, flag, 6000)) || (await getJson("/info", flag, 4000)) || ((await probeSocket(6000)) ? {} : null);
    }
    function roomCode() {
      const code = new URLSearchParams(location.search).get("r");
      if (code) $("#joinCode").value = code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
      return code;
    }

    return { send, resume, update, renderLobby, renderReady, rematchStatus, roundEndFooter, armed, openMenu, joinUrl, detectServer, roomCode, ICONS };
  };
})();
