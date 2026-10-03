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

  ICONS.sliders = SVG('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>');
  ICONS.chat = SVG('<path d="M4 5h16v11H9l-5 4z"/>', ' stroke-linejoin="round"');
  ICONS.share = SVG('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 15V3"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/>', ' stroke-linejoin="round"');
  ICONS.bell = SVG('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>', ' stroke-linejoin="round"');
  ICONS.vol = SVG('<path d="M4 9.5v5h4l5 4v-13l-5 4z"/><path d="M16.5 9a4 4 0 0 1 0 6"/>', ' stroke-linejoin="round"');
  const QUICK = ["👍 Gut gespielt!", "🎉 Glückwunsch!", "⏳ Bin gleich da", "😴 Beeil dich", "🔁 Nochmal?"];
  const QUICK_ROW = `<div class="quickchat" role="group" aria-label="Schnellnachrichten">${QUICK.map((q) => `<button type="button" data-quick="${q}">${q}</button>`).join("")}</div>`;
  const CHAT_FORM = QUICK_ROW + `<form class="chatform" data-chat><input class="field" type="text" maxlength="200" placeholder="Nachricht …" autocomplete="off" enterkeyhint="send" aria-label="Chat-Nachricht"><button class="btn" type="submit">Senden</button></form>`;

  // ---------- markup ----------
  const slot =(root, name) => { const t = root.querySelector(`template[data-slot="${name}"]`); return t ? t.innerHTML : ""; };
  const lobby = $("#lobby"), menu = $("#menu");
  const rulesHTML = slot(menu, "rules");
  lobby.innerHTML = `
    <div class="panel nowplaying" id="nowPlaying" hidden></div>
    <div class="cols"><div class="col">
    <div class="panel invite" id="partyBar" hidden>
      <div class="label invite-lab">Party</div><div class="partycode" id="partyCode"></div>
      <button class="btn" id="inviteBtn" type="button">${ICONS.share}<span>Einladen</span></button>
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
    <div class="roominfo" id="roomInfo" hidden></div>
    <ol class="${menu.dataset.scores || "scores"}" id="menuScores"></ol>
    <div class="hint" id="menuRules"></div>
    <div class="rules"><details><summary>${menu.dataset.rulesTitle || "Spielregeln"}</summary>${rulesHTML}</details></div>
    <button class="btn btn-ghost btn-block tourbtn" id="menuTour" type="button">📖 Interaktives Tutorial</button>
    <div class="rules"><details><summary>Spielverlauf</summary>${slot(menu, "history")}<ol class="history" id="menuLog"></ol></details></div>
    ${slot(menu, "settings") ? `<div class="rules"><details><summary>Spiel-Einstellungen</summary>${slot(menu, "settings")}</details></div>` : ""}
    <div id="menuActions"></div>
    <div class="rules" id="hostBox" hidden><details><summary>Als Host</summary><div class="hostacts" id="hostActions"></div></details></div>
    <div class="menubar">
      <button class="btn btn-primary" id="menuClose" type="button">Weiterspielen</button>
      <button class="btn iconact" id="menuLeave" type="button" hidden aria-label="Raum verlassen" title="Raum verlassen">${ICONS.leave}</button>
      <a class="btn iconact" href="https://games.cool-kidz.net/" data-start-link aria-label="Zur Spieleabend-Startseite" title="Zur Spieleabend-Startseite">${ICONS.home}</a>
    </div>
  </div>`;
  // chat during a game: a button in the top bar next to the menu, and a sheet with the whole log
  $("#menuBtn").insertAdjacentHTML("beforebegin", `<button class="iconbtn" id="nudgeBtn" type="button" aria-label="Anstupsen: Du bist dran" title="Anstupsen: Du bist dran" hidden>${ICONS.bell}</button>`);
  $("#menuBtn").insertAdjacentHTML("beforebegin", `<button class="iconbtn" id="chatBtn" type="button" aria-label="Chat" title="Chat" hidden>${ICONS.chat}<span class="badge" id="chatBadge" hidden></span></button>`);
  // settings (design, sound, accessibility): a button in the game's top bar, a floating one on the start and waiting screens
  $("#menuBtn").insertAdjacentHTML("beforebegin", `<button class="iconbtn" id="setBtn" type="button" aria-label="Einstellungen" title="Einstellungen">${ICONS.sliders}</button>`);
  document.body.insertAdjacentHTML("beforeend", `<button class="iconbtn setfab" id="setFab" type="button" aria-label="Einstellungen" title="Einstellungen">${ICONS.sliders}</button>
  <div class="overlay" id="settings" hidden><div class="sheet"><h2>Einstellungen</h2>
    <div class="look" id="lookSettings"></div>
    <div class="setrow"><label class="toggle" for="soundOn"><input type="checkbox" id="soundOn" checked><span>Töne</span></label>
      <div class="volrow">${ICONS.vol}<input class="range" type="range" id="soundVol" min="0" max="100" step="5" value="100" aria-label="Lautstärke"></div></div>
    <label class="toggle" for="calmOn"><input type="checkbox" id="calmOn"><span>Weniger Bewegung<small>Keine Flug- und Wackel-Animationen</small></span></label>
    <label class="toggle" for="contrastOn"><input type="checkbox" id="contrastOn"><span>Hoher Kontrast<small>Kräftigere Schrift und Rahmen</small></span></label>
    <label class="toggle" id="hapticRow" for="hapticOn" hidden><input type="checkbox" id="hapticOn"><span>Vibration<small>Kurzes Brummen bei deinem Zug</small></span></label>
    <label class="toggle" id="notifyRow" for="notifyOn" hidden><input type="checkbox" id="notifyOn"><span>Benachrichtigungen<small>Dein Zug und neue Chat-Nachrichten, wenn dieser Tab im Hintergrund ist</small></span></label>
    <div class="setmore"><button class="btn btn-ghost" id="fsBtn" type="button" hidden>Vollbild</button><button class="btn btn-ghost" id="keysBtn" type="button" hidden>Tastenkürzel</button><button class="btn btn-ghost" id="prefsReset" type="button" data-label="Einstellungen zurücksetzen">Einstellungen zurücksetzen</button></div>
    <button class="btn btn-primary btn-block" id="settingsClose" type="button">Fertig</button></div></div>`);
  document.body.insertAdjacentHTML("beforeend", `<div class="overlay" id="chat" hidden><div class="sheet"><h2>Chat</h2><ol class="chatlog" id="chatLog"></ol>${CHAT_FORM}
    <button class="btn btn-primary btn-block" id="chatClose" type="button"><span class="onphone">Weiterspielen</span><span class="ondesk">Chat einklappen</span></button></div></div>`);
  document.body.insertAdjacentHTML("beforeend", `<div class="overlay" id="leaveVote" hidden><div class="sheet leavevotesheet" role="dialog" aria-modal="true" aria-labelledby="leaveVoteTitle">
    <h2 id="leaveVoteTitle"></h2>
    <p class="hint" id="leaveVoteHint">Bot übernehmen oder auf die Rückkehr warten?</p>
    <div class="leavevotetally" id="leaveVoteTally"></div>
    <div class="leavevoteacts">
      <button class="btn btn-primary btn-block" id="leaveVoteBot" type="button">Bot übernehmen</button>
      <button class="btn btn-block" id="leaveVoteWait" type="button">Warten</button>
    </div>
  </div></div>`);

  // ---------- behavior ----------
  // app: {
  //   room() -> R, view() -> V, mode() -> "online" | "local" | null, server() -> /info of this server
  //   watching(v?) get/set "watching the running game from the waiting room"
  //   toast(text), render(), maxPlayers, watchers (full rooms let people watch)
  //   onlineKey: where the room code + secret are stored to rejoin after a reload
  //   on: { opened(), joined(m), room(m), react(m), error(m), left(), msg(m) }  what the game does with server messages
  //   bubble(pi, text, name) -> show a short text over a player (reactions; chat lines during a game)
  //   memberExtra(m, i) -> html after the name (colour dot, ...)
  //   renderSettings(host) -> fill the settings slot and the house rules
  //   avatars -> the list to pick from; setAvatar(a) -> remember my new avatar
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

    // the start page offers "back to your game" for the room this browser sits in (cookie shared by all games)
    function trackRoom(code) { window.Spieleabend.gameId.then((id) => { if (id) window.SAProfile.setRoom(id, code || null); }); }

    // ---------- connection: one socket, reconnects on its own, rejoins with the stored secret ----------
    let pingAt = 0, rtt = 0;
    let ws = null, wantOnline = false, retry = 0, queue = [], giveUpT = null, netT = null, lastRx = 0, probeT = null, dropped = false;
    function connect() {
      if (ws && ws.readyState <= 1) return;
      // each socket only ever touches itself: a late close of an old socket must not wipe out the new one
      const sock = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
      ws = sock;
      sock.onopen = () => {
        if (ws !== sock) { sock.close(); return; }
        retry = 0; clearTimeout(giveUpT); lastRx = Date.now(); sock.wasOpen = true;
        if (dropped) { dropped = false; app.toast("Wieder verbunden."); }
        if (app.on.opened) app.on.opened();
        const s = store.get(app.onlineKey);
        if (s && !queue.some((m) => m.t === "create" || m.t === "join"))
          sock.send(JSON.stringify(s.watch ? { t: "join", code: s.code, name: s.watch, watch: true } : { t: "resume", code: s.code, secret: s.secret }));
        for (const m of queue.splice(0)) sock.send(JSON.stringify(m));
        app.render();
      };
      sock.onmessage = (e) => { if (ws !== sock) return; lastRx = Date.now(); try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
      sock.onclose = () => {
        if (ws !== sock) return;
        ws = null;
        if (wantOnline && sock.wasOpen) dropped = true;
        if (wantOnline) setTimeout(connect, Math.min(8000, 400 * 2 ** retry++));
        app.render();
      };
    }
    // send now, or for create/join: connect first and send as soon as the socket is open
    function send(m) {
      if ((m.t === "create" || m.t === "join") && m.color === undefined) m.color = window.Spieleabend.profile.get().col;
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
    // a phone that slept or switched networks often keeps a socket that looks open but is dead:
    // ask it, and replace it when nothing comes back
    function probe() {
      if (!wantOnline || probeT) return;
      if (!(ws && ws.readyState <= 1)) { retry = 0; connect(); return; }
      const sock = ws;
      if (sock.readyState !== 1) return;
      const sent = Date.now();
      sock.send('{"t":"ping"}');
      probeT = setTimeout(() => {
        probeT = null;
        if (ws !== sock || lastRx >= sent) return;
        ws = null; sock.onclose = sock.onmessage = sock.onopen = null;
        try { sock.close(); } catch (e) {}
        dropped = true; retry = 0; connect(); app.render();
      }, 3000);
    }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") probe(); });
    window.addEventListener("online", probe);
    window.addEventListener("pageshow", (e) => { if (e.persisted) probe(); });
    setInterval(() => { if (document.visibilityState === "visible" && Date.now() - lastRx > 25000) probe(); }, 10000);
    function onMsg(m) {
      if (m.t === "watching" || m.t === "joined") {
        store.set(app.onlineKey, m.t === "watching" ? { code: m.code, watch: m.name } : { code: m.code, secret: m.secret });
        wantOnline = true;
        if (location.search) history.replaceState(null, "", location.pathname);
        app.on.joined(m);
        if (m.t === "watching") app.toast("Das Spiel läuft schon oder der Raum ist voll: Du schaust zu.");
      } else if (m.t === "room") {
        app.on.room(m);
        presence(m); timerWarn(m);
        trackRoom(R() && R().code);
      } else if (m.t === "react") {
        app.on.react(m);
      } else if (m.t === "chatlog") {
        chat = m.list || []; unread = 0; renderChat();
      } else if (m.t === "chat") {
        addChat(m.line);
      } else if (m.t === "pong") {
        if (pingAt) { rtt = Date.now() - pingAt; pingAt = 0; paintRoomInfo(); }
      } else if (m.t === "nudge") {
        const K = window.Spieleabend;
        app.toast(`${m.name} stupst dich an: Du bist dran!`);
        K.say(`${m.name} stupst dich an. Du bist dran.`);
        if (K.sounds) { K.sounds.sfx("turn"); K.sounds.buzz(220); }
        K.notify(`${m.name} wartet auf dich`, baseTitle);
      } else if (m.t === "nudged") {
        app.toast(`${m.name} wurde angestupst.`);
      } else if (m.t === "error") {
        if (app.on.error) app.on.error(m);
        app.toast(m.msg);
      } else if (m.t === "gone" || m.t === "left") {
        // keep the socket: a join or create sent a moment ago is answered on it
        store.del(app.onlineKey);
        trackRoom(null);
        seenOn = null; clearTimeout(warnT);
        chat = []; unread = 0; renderChat();
        app.on.left();
        if (m.reason === "kicked") app.toast("Der Host hat dich aus dem Raum entfernt.");
        else if (m.t === "gone") app.toast(m.reason === "idle" ? "Raum wegen Inaktivität geschlossen." : m.reason === "closed" ? "Der Raum wurde geschlossen." : "Diesen Raum gibt es nicht mehr.");
        app.render();
      } else if (app.on.msg) {
        app.on.msg(m); // game-specific messages (Activity's drawing strokes)
      }
    }
    // someone else lost the connection or came back: say so (a phone that sleeps looks like a dropout to the others)
    let seenOn = null, warnT = 0;
    function presence(m) {
      const prev = seenOn;
      seenOn = { code: m.code, by: new Map(m.members.map((x) => [x.name, x.online])) };
      if (!prev || prev.code !== m.code) return;
      m.members.forEach((x, i) => {
        if (x.bot || i === m.you || !prev.by.has(x.name) || prev.by.get(x.name) === x.online) return;
        app.toast(x.online ? `${x.name} ist wieder da.` : `${x.name} hat die Verbindung verloren.`);
      });
    }
    // five seconds before my turn timer runs out: two beeps
    function timerWarn(m) {
      clearTimeout(warnT); warnT = 0;
      if (!(m.you >= 0 && m.turnPid === m.you && m.turnLeft > 5500)) return;
      warnT = setTimeout(() => {
        const K = window.Spieleabend;
        if (K.sounds) K.sounds.warn();
        K.say("Noch fünf Sekunden.");
      }, m.turnLeft - 5000);
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
      turnCue();
      renderLeaveVote();
      nudgeCheck();
    }

    // closing the tab in the middle of an online game starts a leave vote for the others: ask first (desktop browsers only show their own text)
    window.addEventListener("beforeunload", (e) => {
      const v = V(), r = R();
      if (app.mode() !== "online" || !v || !r || !(v.me >= 0) || v.phase === "roundEnd" || v.over || (r.members[r.you] && r.members[r.you].lobby)) return;
      if (!r.members.some((m, i) => i !== r.you && !m.bot && m.online)) return;
      e.preventDefault(); e.returnValue = "";
    });

    // ---------- nudge: after 20 s of waiting for a person, a bell in the top bar pokes them (the server checks again) ----------
    let nudgeKey = "", nudgeSince = 0, nudgeT = 0;
    function nudgeCheck() {
      const v = V(), r = R(), btn = $("#nudgeBtn");
      const ok = app.mode() === "online" && !!v && !!r && v.me >= 0 && Number.isInteger(v.cur) && v.cur !== v.me && v.phase !== "roundEnd" &&
        !!r.members[v.cur] && !r.members[v.cur].bot && !(r.members[r.you] && r.members[r.you].lobby);
      const key = ok ? `${v.cur}|${v.phase}|${v.log ? v.log.length : 0}` : "";
      if (key !== nudgeKey) { nudgeKey = key; nudgeSince = Date.now(); }
      clearTimeout(nudgeT);
      const wait = nudgeSince + 20000 - Date.now();
      if (!ok || wait > 0) { btn.hidden = true; if (ok) nudgeT = setTimeout(nudgeCheck, wait + 50); return; }
      if (btn.hidden) { btn.hidden = false; btn.classList.remove("ring"); void btn.offsetWidth; btn.classList.add("ring"); }
      btn.title = `${r.members[v.cur].name} anstupsen`; btn.setAttribute("aria-label", btn.title);
    }
    $("#nudgeBtn").addEventListener("click", () => {
      send({ t: "nudge" });
      $("#nudgeBtn").hidden = true; nudgeSince = Date.now(); clearTimeout(nudgeT); nudgeT = setTimeout(nudgeCheck, 20050);
    });

    // the tab title says when it is my turn while the tab is in the background (phones: the task switcher)
    const baseTitle = document.title;
    let wasMine = false;
    function turnCue() {
      const K = window.Spieleabend, hidden = document.visibilityState === "hidden";
      const v = V(), mine = app.mode() === "online" && !!v && v.me >= 0 && v.cur === v.me && (v.phase === "play" || v.phase === "drawn");
      const want = mine && hidden ? `● Du bist dran · ${baseTitle}` : baseTitle;
      if (document.title !== want) document.title = want;
      K.badge(mine && hidden);
      if (mine && !wasMine) { K.say("Du bist dran."); if (hidden) K.notify("Du bist dran", baseTitle); }
      wasMine = mine;
    }
    document.addEventListener("visibilitychange", turnCue);

    // ---------- chat: one per room, in the waiting room and as a sheet during the game ----------
    let chat = [], unread = 0;
    const mine = (line) => { const r = R(), s = store.get(app.onlineKey); return !!r && line.pi === r.you && (r.you >= 0 || (s && s.watch === line.name)); };
    const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
    function renderChat() {
      const html = chat.length ? chat.map((l) => `<li class="${mine(l) ? "me" : ""}"><span class="av avc" style="--avc:${esc(l.color || "transparent")}" aria-hidden="true">${esc(l.avatar || "")}</span><div><b>${esc(l.name || "?")}</b> <time>${hhmm(l.at)}</time><p>${esc(l.text)}</p></div></li>`).join("")
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
      if (!mine(line)) {
        const K = window.Spieleabend, who = line.name || "?";
        K.say(`${who}: ${line.text}`);
        K.notify(`${who} im Chat`, line.text.slice(0, 120));
      }
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
    document.addEventListener("click", (e) => {
      const q = e.target.closest("[data-quick]");
      if (!q) return;
      if (!(ws && ws.readyState === 1)) { app.toast("Keine Verbindung, die Nachricht wurde nicht gesendet."); return; }
      sendChat(q.dataset.quick);
    });
    renderChat();
    // on a wide screen the chat is a sidebar on the right that pushes the game aside, the button folds it in and out
    const wide = matchMedia("(min-width:1000px) and (min-height:560px)");
    const syncChat = () => { document.body.classList.toggle("chatopen", !$("#chat").hidden && wide.matches); window.dispatchEvent(new Event("resize")); };
    new MutationObserver(syncChat).observe($("#chat"), { attributes: true, attributeFilter: ["hidden"] });
    wide.addEventListener && wide.addEventListener("change", syncChat);
    $("#chatBtn").addEventListener("click", () => { $("#chat").hidden = wide.matches ? !$("#chat").hidden : false; unread = 0; renderChat(); });
    $("#chatClose").addEventListener("click", () => { $("#chat").hidden = true; });
    $("#chat").addEventListener("click", (e) => { if (e.target.id === "chat" && !wide.matches) $("#chat").hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#chat").hidden) { $("#chat").hidden = true; e.stopPropagation(); } }, true);

    function drawQr(box, url) {
      if (box.dataset.url === url && box.firstChild) { box.hidden = false; return; }
      const paint = () => {
        try {
          const q = window.qrcode(0, "M"); q.addData(url); q.make();
          box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
          box.dataset.url = url; box.hidden = false;
        } catch (e) { box.hidden = true; }
      };
      if (window.qrcode) return paint();
      const s = document.createElement("script");
      s.src = "vendor/qrcode.js"; s.onload = paint; s.onerror = () => { box.hidden = true; };
      document.head.appendChild(s);
    }

    function renderLobby() {
      const r = R(), max = app.maxPlayers;
      $("#partyBar").hidden = !r.party; $("#partyCode").textContent = r.party || "";
      const host = r.you === r.host;
      $("#closeLobby").hidden = !host;
      $("#partyLobby").hidden = !r.party; if (r.party) $("#partyLobby").href = partyHref();
      const watcher = r.you < 0, seen = r.watchers || [];
      $("#membersLabel").textContent = `Spieler (${r.members.length}/${max})` + (seen.length ? ` · ${seen.length} ${seen.length === 1 ? "schaut" : "schauen"} zu` : "");
      $("#sitBtn").hidden = !watcher || r.members.length >= max;
      const before = new Set([...document.querySelectorAll("#members > li .nm")].map((e) => e.textContent));
      $("#members").innerHTML = r.members.map((m, i) =>
        `<li class="${i === r.you ? "me" : ""}">${m.bot ? `<span class="botico">${ICONS.bot}</span>` : `<span class="on${m.online ? "" : " off"}"></span>`}` +
        `<span class="av avc${i === r.host ? " crown" : ""}" style="--avc:${esc(m.color || "transparent")}" aria-hidden="true">${m.avatar || ""}</span>` +
        `<span class="nm">${esc(m.name)}</span>${app.memberExtra ? app.memberExtra(m, i) : ""}` +
        `${i === r.host ? '<span class="tag">Host</span>' : ""}${i === r.you ? '<span class="tag">du</span>' : ""}${m.bot ? '<span class="tag">Computer</span>' : ""}` +
        `${m.bot && host ? `<button class="rm" type="button" data-unbot="${i}" aria-label="${esc(m.name)} entfernen">×</button>` : host && !m.bot && i !== r.you ? `<button class="rm" type="button" data-kick="${i}" data-name="${esc(m.name)}" aria-label="${esc(m.name)} aus dem Raum werfen">×</button>` : ""}</li>`).join("");
      if (before.size) [...document.querySelectorAll("#members > li")].forEach((li) => { const nm = li.querySelector(".nm"); if (nm && !before.has(nm.textContent)) li.classList.add("join"); });
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
      let share = $("#reShare");
      if (!share) {
        share = document.createElement("button");
        share.id = "reShare"; share.type = "button"; share.className = "btn btn-ghost btn-block";
        share.addEventListener("click", async () => {
          const vv = V(), l = (vv && vv.last) || {}, ids = Array.isArray(l.winners) ? l.winners : Number.isInteger(l.winner) ? [l.winner] : [];
          const names = ids.map((i) => vv.players && vv.players[i] && vv.players[i].name).filter(Boolean);
          const text = `${baseTitle}: ${names.length ? `${names.join(" & ")} ${names.length > 1 ? "gewinnen" : "gewinnt"}!` : "Spiel zu Ende."} Spiel mit auf Spieleabend.`;
          const url = location.origin + location.pathname;
          if (navigator.share) { navigator.share({ title: "Spieleabend", text, url }).catch(() => {}); return; }
          app.toast(await window.Spieleabend.copy(`${text} ${url}`) ? "Ergebnis kopiert." : "Kopieren geht hier nicht.");
        });
        $("#reBack").before(share);
      }
      share.textContent = navigator.share ? "Ergebnis teilen" : "Ergebnis kopieren";
      share.hidden = !over;
      if (mode === "local") { back.hidden = false; back.textContent = "Zurück zum Start"; }
      else { back.hidden = over ? !r.members[r.you] : r.host !== v.me; back.textContent = "Zurück in den Warteraum"; } // after a game everyone decides for themselves
    }

    // mid-game leave vote: remaining seated humans choose bot or wait
    function renderLeaveVote() {
      const r = R(), lv = r && r.leaveVote, el = $("#leaveVote");
      const me = r && r.you >= 0 ? r.members[r.you] : null;
      const canVote = !!(lv && app.mode() === "online" && me && !me.bot && !me.lobby && r.you !== lv.seat);
      if (!canVote) { el.hidden = true; return; }
      $("#leaveVoteTitle").textContent = `${lv.name} hat verlassen`;
      const votes = lv.votes || {};
      const lines = r.members.map((m, i) => {
        if (i === lv.seat || m.bot || m.lobby || i >= (V() && V().players ? V().players.length : r.members.length)) return "";
        if (!m.online && votes[i] == null) return "";
        const c = votes[i];
        const tag = c === "bot" ? "Bot" : c === "wait" ? "Warten" : "…";
        return `<span class="${c || "pending"}"><b>${esc(m.name)}</b> ${tag}</span>`;
      }).filter(Boolean);
      $("#leaveVoteTally").innerHTML = lines.length ? lines.join(" · ") : "Noch keine Stimmen.";
      const mine = votes[r.you];
      $("#leaveVoteBot").classList.toggle("btn-primary", mine !== "wait");
      $("#leaveVoteWait").classList.toggle("btn-primary", mine === "wait");
      el.hidden = false;
    }
    $("#leaveVoteBot").addEventListener("click", () => send({ t: "leaveVote", choice: "bot" }));
    $("#leaveVoteWait").addEventListener("click", () => send({ t: "leaveVote", choice: "wait" }));

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
    // invite sheet: QR code of the party link, below it the button for the system share menu
    const partyLink = () => startUrl(`?party=${R().party}`);
    function shareSheet() {
      const r = R(); if (!r || !r.party) return;
      let o = $("#shareSheet");
      if (!o) {
        o = document.createElement("div"); o.className = "overlay"; o.id = "shareSheet"; o.hidden = true;
        o.innerHTML = `<div class="sheet sharesheet" role="dialog" aria-modal="true" aria-labelledby="shareTitle"><h2 id="shareTitle">Zur Party einladen</h2>` +
          `<div class="qr big" id="shareQr" hidden></div><div class="sharecode" id="shareCode" aria-label="Party-Code"></div>` +
          `<p class="hint">Scannt den QR-Code oder öffnet den Link.</p>` +
          `<button class="btn btn-primary btn-block" id="shareGo" type="button"></button><button class="btn btn-ghost btn-block" id="shareClose" type="button">Schließen</button></div>`;
        document.body.appendChild(o);
        const close = () => { o.hidden = true; };
        o.addEventListener("click", (e) => { if (e.target === o) close(); });
        $("#shareClose").addEventListener("click", close);
        document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !o.hidden) { close(); e.stopPropagation(); } }, true);
        $("#shareGo").addEventListener("click", async () => {
          const url = partyLink(), code = R().party;
          if (navigator.share) { navigator.share({ title: "Spieleabend", text: `Komm in meine Spieleabend-Party! Code: ${code}`, url }).catch(() => {}); return; }
          app.toast(await window.Spieleabend.copy(url) ? "Link kopiert." : "Kopieren geht hier nicht.");
        });
      }
      const url = partyLink();
      $("#shareCode").textContent = r.party;
      $("#shareGo").innerHTML = navigator.share ? `${ICONS.share}<span>Teilen</span>` : "<span>Link kopieren</span>";
      drawQr($("#shareQr"), url);
      o.hidden = false;
    }
    $("#inviteBtn").addEventListener("click", shareSheet);
    $("#addBot").addEventListener("click", () => send({ t: "bot" }));
    $("#sitBtn").addEventListener("click", () => send({ t: "sit" }));
    $("#members").addEventListener("click", (e) => {
      const b = e.target.closest("[data-unbot]");
      if (b) return send({ t: "unbot", i: +b.dataset.unbot });
      const k = e.target.closest("[data-kick]");
      if (!k) return;
      if (k.classList.contains("sure")) return send({ t: "kick", i: +k.dataset.kick });
      for (const o of $("#members").querySelectorAll(".rm.sure")) { o.classList.remove("sure"); o.textContent = "×"; }
      k.classList.add("sure"); k.textContent = "Raus?";
      setTimeout(() => { k.classList.remove("sure"); k.textContent = "×"; }, 3000);
    });

    // ---------- settings sheet: design, sound, accessibility ----------
    (function settings() {
      const P = window.Spieleabend.profile;
      const K = window.Spieleabend;
      const syncPrefs = () => {
        $("#calmOn").checked = K.calm(); $("#contrastOn").checked = K.pref("contrast", false);
        $("#notifyOn").checked = K.pref("notify", false) && "Notification" in window && Notification.permission === "granted";
        $("#hapticOn").checked = K.pref("haptic", K.sounds ? K.sounds.isOn() : true);
        $("#fsBtn").textContent = document.fullscreenElement ? "Vollbild beenden" : "Vollbild";
      };
      const open = () => { syncPrefs(); $("#settings").hidden = false; };
      $("#calmOn").addEventListener("change", (e) => P.setPrefs({ motion: e.target.checked ? false : null }));
      $("#contrastOn").addEventListener("change", (e) => P.setPrefs({ contrast: e.target.checked }));
      if ("Notification" in window) $("#notifyRow").hidden = false;
      if (navigator.vibrate) { $("#hapticRow").hidden = false; $("#hapticOn").addEventListener("change", (e) => { P.setPrefs({ haptic: e.target.checked }); if (e.target.checked && K.sounds) K.sounds.buzz(60); }); }
      // two taps: all choices (design, sound, volume, motion, contrast, vibration, notifications) back to the start
      $("#prefsReset").addEventListener("click", (e) => {
        const b = e.currentTarget;
        if (!b.dataset.armed) {
          b.dataset.armed = "1"; b.textContent = "Sicher? Nochmal tippen";
          setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = b.dataset.label; } }, 3000);
          return;
        }
        P.setPrefs({ table: null, sound: true, vol: null, motion: null, contrast: null, notify: null, haptic: null });
        location.reload();
      });
      $("#notifyOn").addEventListener("change", async (e) => {
        const box = e.target;
        if (!box.checked) { P.setPrefs({ notify: false }); return; }
        let perm = Notification.permission;
        if (perm === "default") { try { perm = await Notification.requestPermission(); } catch (err) { perm = "denied"; } }
        box.checked = perm === "granted";
        P.setPrefs({ notify: box.checked });
        if (!box.checked) app.toast("Benachrichtigungen sind im Browser blockiert. Erlaube sie in den Seiteneinstellungen.");
      });
      const fullscreen = () => {
        if (!document.fullscreenEnabled) return;
        (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => app.toast("Vollbild geht hier nicht."));
      };
      if (document.fullscreenEnabled) { $("#fsBtn").hidden = false; $("#fsBtn").addEventListener("click", fullscreen); document.addEventListener("fullscreenchange", syncPrefs); }
      if (matchMedia("(hover: hover) and (pointer: fine)").matches) $("#keysBtn").hidden = false;
      $("#keysBtn").addEventListener("click", () => { $("#settings").hidden = true; keysSheet(); });

      // ---------- keyboard: Alt plus a letter (the games use the plain letters), "?" for the list ----------
      function keysSheet() {
        let o = $("#keysSheet");
        if (!o) {
          o = document.createElement("div"); o.className = "overlay"; o.id = "keysSheet"; o.hidden = true;
          o.innerHTML = `<div class="sheet"><h2>Tastenkürzel</h2><dl class="keyslist">` +
            `<dt><kbd>Alt</kbd> + <kbd>M</kbd></dt><dd>Menü</dd><dt><kbd>Alt</kbd> + <kbd>O</kbd></dt><dd>Einstellungen</dd>` +
            `<dt><kbd>Alt</kbd> + <kbd>C</kbd></dt><dd>Chat (online)</dd><dt><kbd>Alt</kbd> + <kbd>K</kbd></dt><dd>Ton an oder aus</dd>` +
            `<dt><kbd>Alt</kbd> + <kbd>V</kbd></dt><dd>Vollbild</dd><dt><kbd>Alt</kbd> + <kbd>H</kbd> oder <kbd>?</kbd></dt><dd>Diese Liste</dd>` +
            `<dt><kbd>Esc</kbd></dt><dd>Schließt das offene Fenster</dd></dl>` +
            `<p class="hint">Welche Tasten das Spiel selbst kennt, steht in seinen Regeln.</p>` +
            `<button class="btn btn-primary btn-block" id="keysClose" type="button">Schließen</button></div>`;
          document.body.appendChild(o);
          const close = () => { o.hidden = true; };
          o.addEventListener("click", (e) => { if (e.target === o) close(); });
          $("#keysClose").addEventListener("click", close);
          document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !o.hidden) { close(); e.stopPropagation(); } }, true);
        }
        o.hidden = !o.hidden;
      }
      const usable = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
      const blocker = (id) => [...document.querySelectorAll(".overlay")].some((o) => !o.hidden && o.id !== "chat" && o.id !== id);
      document.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.isComposing) return;
        const typing = !!(e.target.closest && e.target.closest("input, textarea, select, [contenteditable]"));
        let run = null;
        if (e.altKey && !e.shiftKey) {
          run = {
            KeyM: () => { if (!$("#menu").hidden) $("#menuClose").click(); else if (usable($("#menuBtn")) && !blocker("menu")) $("#menuBtn").click(); },
            KeyO: () => { if (!$("#settings").hidden) $("#settingsClose").click(); else if (!blocker("settings")) (usable($("#setBtn")) ? $("#setBtn") : $("#setFab")).click(); },
            KeyC: () => { if (usable($("#chatBtn")) && !blocker("chat")) $("#chatBtn").click(); },
            KeyK: () => { const b = $("#soundOn"); b.checked = !b.checked; b.dispatchEvent(new Event("change", { bubbles: true })); app.toast(b.checked ? "Ton an" : "Ton aus"); },
            KeyV: fullscreen,
            KeyH: () => { if (!blocker("keysSheet")) keysSheet(); }
          }[e.code];
        } else if (e.key === "?" && !typing && !e.altKey) run = () => { if (!blocker("keysSheet")) keysSheet(); };
        if (!run) return;
        e.preventDefault(); e.stopImmediatePropagation();
        run();
      }, true);
      $("#setBtn").addEventListener("click", open);
      $("#setFab").addEventListener("click", open);
      $("#settingsClose").addEventListener("click", () => { $("#settings").hidden = true; });
    })();

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
            if (!m.bot && !m.online && !(r.leaveVote && r.leaveVote.seat === i))
              hb.append(armed(`🤖 Computer spielt für ${m.name}`, () => send({ t: "standIn", seat: i })));
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
      paintRoomInfo();
      if (mode === "online" && ws && ws.readyState === 1) { pingAt = Date.now(); ws.send('{"t":"ping"}'); }
      $("#menu").hidden = false;
    }
    $("#menuBtn").addEventListener("click", openMenu);
    // ---------- interactive tutorial: tutorial.js and the game's tour.js are fetched only when someone asks for it ----------
    let tourReady = null;
    function startTutorial() {
      const meta = document.querySelector('meta[name$="-version"]'), v = meta ? "?v=" + meta.content : "";
      const css = (href) => new Promise((ok) => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href + v; l.onload = l.onerror = ok; document.head.append(l); });
      const js = (src) => new Promise((ok, no) => { const e = document.createElement("script"); e.src = src + v; e.onload = ok; e.onerror = no; document.head.append(e); });
      if (!tourReady) tourReady = Promise.all([css("tutorial.css"), js("tutorial.js")]).then(() => js("tour.js")).catch((e) => { tourReady = null; throw e; });
      tourReady.then(() => Spieleabend.gameId).then((id) => { window.Tutorial.gameId = id || ""; return window.Tutorial.begin(); })
        .catch(() => app.toast("Das Tutorial lässt sich gerade nicht laden."));
    }
    $("#menuTour").addEventListener("click", () => { $("#menu").hidden = true; startTutorial(); });
    if ($("#localPanel")) {
      const tb = document.createElement("button");
      tb.type = "button"; tb.className = "btn btn-ghost btn-block tourbtn"; tb.id = "tourBtn"; tb.textContent = "📖 Tutorial: Spiel kennenlernen";
      tb.addEventListener("click", startTutorial);
      $("#localPanel").after(tb);
      Spieleabend.gameId.then((id) => { if (id && store.get("sa.tour.done." + id)) tb.textContent = "📖 Tutorial wiederholen"; });
      const tq = new URLSearchParams(location.search);
      if (tq.get("tutorial")) {
        tq.delete("tutorial"); history.replaceState(null, "", location.pathname + (tq.toString() ? `?${tq}` : ""));
        setTimeout(startTutorial, 700);
      }
    }
    // ?rules=1 (a link from the start page) opens the rules in a sheet of their own: the menu only exists once a game runs
    (function rulesSheet() {
      const q = new URLSearchParams(location.search);
      if (!q.get("rules") || !rulesHTML) return;
      q.delete("rules"); history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : ""));
      const o = document.createElement("div");
      o.className = "overlay"; o.id = "rulesSheet";
      o.innerHTML = `<div class="sheet"><h2>${menu.dataset.rulesTitle || "Spielregeln"}</h2><div class="gamerules">${rulesHTML}</div>` +
        `<div class="menubar"><button class="btn btn-primary" type="button">Verstanden</button></div></div>`;
      o.addEventListener("click", (e) => { if (e.target === o || e.target.closest(".menubar button")) o.remove(); });
      document.body.append(o);
    })();
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

    // ---------- room info at the top of the menu: code, link, spectators, connection ----------
    function paintRoomInfo() {
      const r = R(), box = $("#roomInfo");
      if (!r || app.mode() !== "online" || !r.code) { box.hidden = true; return; }
      const seen = r.watchers || [];
      box.innerHTML = `<span>Raum</span><span class="rc">${esc(r.code)}</span><button type="button" data-copy>Link kopieren</button>` +
        `<span class="meta">${seen.length ? `Zuschauer: ${seen.map(esc).join(", ")} · ` : ""}Verbindung: <span class="ping">${rtt ? `${rtt} ms` : "…"}</span></span>`;
      box.hidden = false;
    }
    $("#roomInfo").addEventListener("click", async (e) => {
      if (!e.target.closest("[data-copy]")) return;
      const url = `${location.origin}${location.pathname}?r=${R().code}`;
      app.toast(await window.Spieleabend.copy(url) ? "Link kopiert." : "Kopieren geht hier nicht.");
    });

    // ---------- a new version of the game was deployed while this page was open ----------
    (function updateWatch() {
      const meta = document.querySelector('meta[name$="-version"]');
      if (!meta || !/^https?:$/.test(location.protocol)) return;
      let shown = false, dismissed = false, last = 0;
      async function check() {
        if (shown || dismissed || document.visibilityState !== "visible" || Date.now() - last < 60000) return;
        last = Date.now();
        try {
          const j = await (await fetch("/info", { cache: "no-store" })).json();
          if (!j || !j.version || j.version === meta.content) return;
          shown = true;
          document.body.insertAdjacentHTML("beforeend", `<div id="updateBar" role="status"><span>Neue Version verfügbar</span><button type="button" data-reload>Jetzt laden</button><button type="button" class="x" data-close aria-label="Später">✕</button></div>`);
          $("#updateBar").addEventListener("click", (e) => {
            if (e.target.closest("[data-reload]")) location.reload();
            else if (e.target.closest("[data-close]")) { dismissed = true; $("#updateBar").remove(); }
          });
        } catch (err) {}
      }
      document.addEventListener("visibilitychange", check);
      setInterval(check, 5 * 60000);
      setTimeout(check, 30000);
    })();

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
            return code;
    }

    return { send, resume, update, renderLobby, renderReady, rematchStatus, roundEndFooter, armed, openMenu, detectServer, roomCode, ICONS };
  };
})();
