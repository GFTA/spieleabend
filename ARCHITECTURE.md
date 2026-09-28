# Architektur-Manifest: ein einheitliches System für alle Spiele

Dieses Dokument beschreibt, was alle Spiele in diesem Repo gemeinsam haben —
designtechnisch und servertechnisch. Es ist der Bauplan für jedes neue Spiel:
wer sich daran hält, fühlt sich sofort wie die anderen an und lässt sich mit
demselben Handgriff deployen. Stand heute (uno, schiffe, wuerfelpoker,
viergewinnt, maedn) sind alle fünf Punkte für Punkt danach gebaut — das hier ist die
Doku dieser bereits gelebten Konvention, nicht ein Wunschzettel.

Wird eine neue gemeinsame Konvention eingeführt (z. B. der `?table=`-Handoff
von der Startseite, oder die 5-Minuten-Leerlauf-Regel für Räume), gehört sie
**in allen Spielen gleichzeitig** nachgezogen und **hier ergänzt** — sonst
driftet das System wieder auseinander.

## Grundprinzip

Jedes Spiel läuft auf zwei Arten, ohne Kontowechsel dazwischen:

- **„Jeder sein Handy“**: einer erstellt online einen Raum (4-Buchstaben-Code
  + QR), die anderen treten bei. Braucht den Node-Server.
- **„Ein Handy für alle“**: lokales Pass-and-play mit Sichtschutz zwischen
  den Zügen, läuft komplett im Browser, sogar offline (Service Worker).

Beide Modi teilen sich dieselbe Spiellogik (`public/game.js`, reines JS ohne
DOM-Zugriff, läuft identisch im Browser wie im Server) und denselben
Renderer (`public/app.js`).

## Design-System

### Farben & Schrift (`public/index.html`, `<style>`-Block oben)

Jedes Spiel definiert dieselbe Basis-Palette in `:root{}` und ergänzt nur
spiel-eigene Variablen (Schiffe: `--sea`/`--hull`/`--wreck`, Würfelpoker:
`--felt`/`--ivory`/`--pip`, Vier gewinnt: `--frame`/`--hole`, Mensch ärgere dich nicht: `--board`/`--spot`/`--c0`…`--c3`, …):

```css
:root{
  color-scheme: dark;
  --bg:#1a1426; --bg2:#231a33; --surface:#2b2140; --line:#3d3057;
  --text:#f4effb; --muted:#a99cc2;
  --red:#e0393e; --yellow:#f2c230; --green:#2fa35b; --blue:#2d6fd6;
  --accent:#f2c230; --scrim:rgba(15,10,22,.86); --cs:1;
  --display:"Bowlby One", "Arial Black", Impact, system-ui, sans-serif;
  --ui:"Figtree", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
```

`--cs` ist die Kartengröße/Würfelgröße/Feldgröße-Skalierung (aus dem
Aussehen-Menü, s.u.) — jedes Spiel multipliziert seine Spielelement-Größe
damit.

### Tisch-Designs (immer exakt diese fünf, gleiche Reihenfolge, gleiche Farben)

```js
const TABLES = [["night", "Nacht", "#1a1426"], ["felt", "Filz", "#15372a"], ["ocean", "Ozean", "#15243a"], ["light", "Hell", "#eceff5"], ["blossom", "Blüte", "#f7c6d9"]];
```

„Nacht“ ist der Default (kein `data-table`-Attribut nötig). Für die anderen
vier überschreibt `:root[data-table="X"]{...}` dieselben Variablennamen wie
oben, plus die spiel-eigenen:

```css
:root[data-table="felt"]{--bg:#0f2a1f;--bg2:#15372a;--surface:#1c4636;--line:#2b5c48;--text:#eef7f1;--muted:#9cc3b1; /* + spieleigene Vars */}
:root[data-table="ocean"]{--bg:#0e1a2b;--bg2:#15243a;--surface:#1c3050;--line:#2b4468;--text:#eef3fb;--muted:#9fb4d3; /* + spieleigene Vars */}
:root[data-table="light"]{color-scheme:light;--bg:#eceff5;--bg2:#ffffff;--surface:#e2e7f0;--line:#cbd3e1;--text:#1b2030;--muted:#5b6479; /* + spieleigene Vars */}
:root[data-table="blossom"]{color-scheme:light;--bg:#fbe3ec;--bg2:#fff6f9;--surface:#f7d4e1;--line:#eebfd0;--text:#3a1a2b;--muted:#8b5a70;--scrim:rgba(251,227,236,.92); /* + spieleigene Vars, pastellig */}
```

„Blüte“ ist ein helles Pastell-Pink-Theme und folgt „Hell“ Regel für Regel:
jede `[data-table="light"]`-Regel (auch Zusatzregeln wie Unos
`.card-back::after`) bekommt eine `[data-table="blossom"]`-Schwester. Die
spiel-eigenen Farben werden dabei pastellig umgefärbt statt übernommen
(z. B. Meer lavendel `--sea:#e6d9f4`, Vier-gewinnt-Rahmen rosa
`--frame:#e27fa4`, Brett `--board:#fff1f5`, Filz `--felt:#f5d5e2`). `--accent`
bleibt Gelb, weil die Primär-Buttons einen fest gelben Schatten haben.

Die Design-Buttons im Spiel liegen in `<div class="seg tables">` mit
`.look .seg.tables{grid-template-columns:repeat(auto-fit,minmax(84px,1fr))}`,
damit fünf (oder später mehr) Optionen auf schmalen Handys umbrechen statt
rauszulaufen.

Im JS (`app.js`, Abschnitt „look“):

```js
let look = Object.assign({ table: "night", size: "1" }, store.get(K.look) || {});
function applyLook() {
  const root = document.documentElement, t = TABLES.find((x) => x[0] === look.table) || TABLES[0];
  if (t[0] === "night") delete root.dataset.table; else root.dataset.table = t[0];
  root.style.setProperty("--cs", look.size);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", getComputedStyle(root).getPropertyValue("--bg").trim() || t[2]);
}
```

Ausgewählt wird das über zwei identische UI-Stellen in `index.html`, ein
`<div class="look" id="lookHome">` auf dem Startbildschirm und ein
`id="lookMenu"` im Einstellungen/Regeln-Bereich; `renderLook()` befüllt
beide mit denselben Buttons.

**Design-Übernahme von der Startseite:** `games.cool-kidz.net` hat oben
rechts denselben Tisch-Picker und hängt die Wahl als `?table=<id>` an jeden
„Spielen“/„Beitreten“-Link. Jedes Spiel liest das beim Laden aus, bevor
`applyLook()` läuft, übernimmt es dauerhaft in sein eigenes `localStorage`
und räumt den Parameter aus der URL, ohne einen gleichzeitigen `?r=CODE`
(Raum-Beitritt) zu zerstören:

```js
let look = Object.assign({ table: "night", size: "1" }, store.get(K.look) || {});
{
  // came here from the games.cool-kidz.net start page with a design already picked there
  const params = new URLSearchParams(location.search), qTable = params.get("table");
  if (qTable && TABLES.some((x) => x[0] === qTable)) {
    look.table = qTable; store.set(K.look, look);
    params.delete("table");
    history.replaceState(null, "", location.pathname + (params.toString() ? `?${params}` : ""));
  }
}
function applyLook() { /* … */ }
```

Dieser Block steht **direkt nach** der `let look = …`-Zeile und **vor** dem
ersten `applyLook()`-Aufruf, damit kein falsches Design kurz aufblitzt.

### Avatare (identische Liste in jedem `game.js`)

```js
const AVATARS = ["🦊", "🐼", "🐸", "🐯", "🦁", "🐨", "🐙", "🦄", "🐵", "🐧", "🦉", "🐢", "🐳", "🦖", "👻", "🤠"];
```

In `app.js`:

```js
const randomAvatar = () => G.AVATARS[Math.floor(Math.random() * G.AVATARS.length)];
let myAvatar = G.AVATARS.includes(store.get(K.avatar)) ? store.get(K.avatar) : randomAvatar();
store.set(K.avatar, myAvatar);
let localAvatars = Array.isArray(store.get(K.avatars)) ? store.get(K.avatars) : [];
const avatarFor = (i) => (G.AVATARS.includes(localAvatars[i]) ? localAvatars[i] : G.AVATARS[i % G.AVATARS.length]);
const nextAvatar = (a) => G.AVATARS[(G.AVATARS.indexOf(a) + 1) % G.AVATARS.length];
```

UI: ein `<button class="avbtn" id="myAvatar">` (eigener Avatar, online) bzw.
`data-av="i"` pro lokalem Sitzplatz — Klick zyklet mit `nextAvatar` durch die
Liste. Bots zeigen immer 🤖 statt Avatar. Dieselbe `.avbtn`-CSS-Klasse
(50×50px, 14px radius, 28px Emoji, in Karten-Reihen 42×42px) in jedem Spiel.

Das aufklappbare Avatar-Raster hat **keine feste Spaltenzahl**, sonst ragt es
auf 320px-Handys rechts raus:

```css
.avgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(42px,1fr));gap:4px;/* … */}
.avgrid button{/* … */;padding:0;min-width:0}
```

### Name & Avatar von der Startseite

`games.cool-kidz.net` hat einen „Du“-Bereich (Avatar-Button, Name, Raster mit
derselben `AVATARS`-Liste), gespeichert unter `spieleabend.me`. Wie das Design
wird beides an jeden „Spielen“/„Beitreten“-Link gehängt: `?name=…&av=…`
(Name nur, wenn nicht leer; Avatar immer). Die Startseite aktualisiert beim
Tippen nur die `href`s (`updateLinks()`), rendert die Karten nicht neu — sonst
wären halb eingetippte Raum-Codes weg.

Jedes Spiel übernimmt das direkt nach `let myAvatar = …`, bevor irgendwas
gerendert wird, dauerhaft in seine eigenen Schlüssel (`K.me`, `K.avatar`) und
räumt die URL auf:

```js
{
  // name and avatar picked on the games.cool-kidz.net start page (same hand-off as ?table=)
  const q = new URLSearchParams(location.search), qn = (q.get("name") || "").trim().slice(0, 18), qa = q.get("av");
  if (qa && G.AVATARS.includes(qa)) { myAvatar = qa; store.set(K.avatar, myAvatar); }
  if (qn) store.set(K.me, qn);
  if (q.has("name") || q.has("av")) {
    q.delete("name"); q.delete("av");
    history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : ""));
  }
}
```

`#myName` hat überall `maxlength="18"` — die Übernahme kürzt genauso.

### Sonstige geteilte UI-Konventionen

- Schriften: Google Fonts „Bowlby One“ (Überschriften/Logos) + „Figtree“ (UI)
- `#confetti`-Canvas + `confetti()`-Funktion für Sieg-Feiern
- `prefers-reduced-motion: reduce` schaltet global alle Animationen ab
  (`*{animation:none!important;transition:none!important}`) — das ist
  Absicht (Barrierefreiheit), kein Bug, siehe Windows 11 „Animationseffekte“
  bzw. iOS/Android „Bewegung reduzieren“.
- `manifest.webmanifest` + `sw.js` (Service Worker, **network-first**, s.
  Vorlage in einem der bestehenden Spiele) für Installierbarkeit/Offline
- Reaktions-Emojis im Online-Spiel: dieselben acht (`👍😂😱😡🎉🙈` + „Gut
  gespielt!“/„Uff …“/„Beeil dich!“/„Na warte!“)
- Reaktions-Blasen hängen **nicht** im Spieler-Element (das liegt meist oben
  in einer scrollenden Leiste und schneidet sie ab), sondern als
  `position:fixed`-Overlay am `body`. `showBubble(host, b)` misst den Spieler,
  setzt die Blase darüber — oder, wenn der Spieler im oberen Bildschirmrand
  sitzt (`top < 110px`), darunter (`.bubble.down`, Animation `floatdown`) —
  und klemmt sie horizontal in den Bildschirm. Nur kleine Bewegung (16px),
  2,8s sichtbar.
- Zurück zur Startseite: oben auf dem Startbildschirm
  `<div class="homebar"><a class="homelink" data-start-link>‹ Spieleabend</a></div>`
  und im Spielmenü unter „Weiterspielen“ ein Link „Zur Spieleabend-Startseite“.
  `href` ist `https://games.cool-kidz.net/`; wird das Spiel im WLAN über
  IP:Port geöffnet, biegt `app.js` alle `[data-start-link]` auf Port 8090
  desselben Rechners um.
- Spielregeln stehen im Spielmenü (`<details>` mit „Spielregeln“ im
  `summary`) und zusätzlich aufklappbar im Warteraum unter den Hausregeln
  (`#rulesHelpLobby`). Der Warteraum-Block wird beim Laden aus dem Menü
  kopiert, der Regeltext wird also nur an einer Stelle gepflegt.
- Die Hauptaktion (Würfel, Karte ziehen, …) sitzt an **einem festen Ort** in
  der Dock-Leiste unten: auf dem Handy immer mit dem Daumen erreichbar, am
  Desktop immer an derselben Stelle. Ein Tipp darauf wird nie still
  verschluckt — gibt es genau einen möglichen Zug, führt er ihn aus
  (Mensch ärgere dich nicht: 6 würfeln, nochmal tippen → Figur kommt raus),
  sonst sagt er, was zu tun ist.

## Server-Architektur (`server.js`)

Reiner `http` + `ws`-Server ohne Framework, ein File. Gemeinsame Bausteine:

### Konstanten & Env

```js
const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SAVE_FILE = path.join(DATA_DIR, "rooms.json");
const MAX_ROOMS = 200;
const ROOM_TTL = 12 * 3600 * 1000;   // beim Laden von Disk: ältere Räume nicht wiederherstellen
const IDLE_TTL = 5 * 60 * 1000;      // Laufzeit-Cleanup: 5 Min ohne jede Aktion → Raum schließen
```

### Raum-Lebenszyklus

- 4-Buchstaben-Codes über `newCode()`, `rooms: Map<code, room>`,
  `sockets: Map<code, Set<ws>>`
- Jede echte Aktion (Zug, Beitritt, …) setzt `room.touched = Date.now()`
- Persistenz debounced nach `data/rooms.json` (`saveRooms()`), beim Start
  `loadRooms()` gefiltert nach `ROOM_TTL`
- **Idle-Cleanup**, alle 25s zusammen mit dem WS-Ping/Pong-Keepalive:

```js
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
  for (const [code, r] of rooms) {
    if (Date.now() - r.touched > IDLE_TTL) closeRoom(code, "idle");
  }
}, 25000).unref();

// close a room for good and tell everyone still in it why ("idle" or "closed" by the host)
function closeRoom(code, reason) {
  for (const ws of sockets.get(code) || []) { send(ws, { t: "gone", reason }); ws.code = null; ws.pid = null; }
  /* jeweilige Bot-/Zug-/Spezial-Timer für den Code aufräumen */
  sockets.delete(code);
  rooms.delete(code); saveRooms();
}
```

Das schließt Räume **unabhängig davon, ob noch jemand verbunden ist** —
„keiner tut was“ reicht, nicht erst „alle sind weg“. Während eines
laufenden Spiels mit Zug-Timer (30s, s.u.) killt das niemanden mitten im
Zug: jeder erzwungene Timeout aktualisiert `touched` mit.

**Raum schließen durch den Host** läuft über dieselbe Funktion:

```js
case "close": { // host closes the room for everyone
  if (!room || ws.pid !== room.host) return;
  closeRoom(room.code, "closed");
  return;
}
```

Im Client gibt es dafür einen Knopf „Raum für alle schließen“ nur für den
Host — im Warteraum (`#closeLobby` unter „Raum verlassen“) und im Spielmenü
(`armed(…)`-Aktion). Beide wollen zweimal getippt werden („Sicher? Nochmal
tippen“), wie alle zerstörerischen Menü-Aktionen.

Client-seitig (`app.js`, WS-Message-Handler):

```js
} else if (m.t === "gone" || m.t === "left") {
  store.del(K.online); R = null; mode = null;
  if (m.t === "gone") toast(m.reason === "idle" ? "Raum wegen Inaktivität geschlossen." : m.reason === "closed" ? "Der Raum wurde geschlossen." : "Diesen Raum gibt es nicht mehr.");
  render();
}
```

### Warteraum, Bereit-System und Revanche

Ein Raum kann gleichzeitig Leute **im Spiel** und Leute **im Warteraum** haben.
Die Invariante, auf der alles aufbaut: Während ein Spiel läuft, sind
`room.members[0..n)` seine Spieler (`n = state.players.length`,
Mitgliedsnummer = Platz im Spiel). Wer dahinter steht oder `.lobby` gesetzt
hat, ist im Warteraum. `seatPlayers(room, play)` sortiert die Mitglieder bei
jedem Spielstart so um (Spieler nach vorn, Rest dahinter) und zieht Sockets
und Host mit. Deshalb funktioniert Wiederverbinden per `secret` weiter: Man
landet auf dem neuen Index.

- **Bereit:** Im Warteraum meldet man sich mit `{t:"ready", on}` bereit
  (`member.ready`). Sind alle anwesenden Menschen bereit, startet das Spiel von
  selbst (`autoStart`). Der Host kann mit „Spiel starten“ sofort starten, dann
  spielen die Bereiten, der Host und die Computer mit, der Rest wartet.
  Mindestens zwei Spieler, nicht nur Computer.
- **Während ein Spiel läuft**, steht im Warteraum statt „Bereit“ der Knopf
  **„Zuschauen“** (rein clientseitig, `watching = true`). Zusätzlich gibt es
  einen Hinweis „Gerade läuft ein Spiel: …“. Warteraum-Mitglieder bekommen die
  Zuschauer-Ansicht (`view(state, -1)`), dürfen nicht `act`en („Du bist
  gerade nicht im Spiel.“) und haben im Menü nur „Zurück in den Warteraum“,
  „Raum verlassen“ und, als Host, „Raum für alle schließen“. Wer während
  eines Spiels beitritt, landet ebenfalls im Warteraum statt abgewiesen zu
  werden; nur bei vollem Raum wird man reiner Zuschauer (Spiele mit
  Zuschauer-Modus).
- **Nach dem Spiel** (`phase === "roundEnd" && last.over`) wählt jeder selbst:
  „Revanche“ (`{t:"act", a:{t:"next"}}` zählt als Stimme, `room.rematch`) oder
  „Zurück in den Warteraum“ (`{t:"lobby"}`). Wer den Tab schließt, gilt als
  gegangen. `checkRematch(room)` läuft nach jeder Stimme, jedem Wechsel in den
  Warteraum, jedem Bereit-Melden und jedem Verbindungsabbruch:
  - noch jemand am Tisch, der online ist und nicht abgestimmt hat → warten
  - alle abgestimmt → Revanche mit ihnen, den Computern am Tisch und allen,
    die sich im Warteraum bereit gemeldet haben („Bei der Revanche
    mitspielen“). Gleiche Besetzung wie vorher → die Spiel-Engine macht ihr
    eigenes `next`, sonst startet ein neues Spiel in neuer Besetzung.
  - zu wenige (nur eine Person) → der Knopf sagt „Zu wenige für eine
    Revanche, warte auf Mitspieler“
  - niemand mehr am Tisch → alle zurück in den Warteraum (`toLobby`)
- Der Ergebnis-Bildschirm zeigt eine Statuszeile (`#reVotes`): „Bereit · Aus
  dem Warteraum dabei · Überlegt noch · Zurück im Warteraum · Gegangen“. „Nächste
  Runde“ mitten in einem Spiel bleibt ohne Abstimmung, und der Host kann über
  das Menü weiterhin für alle beenden (`{t:"end"}` → `toLobby`).

Die Raum-Nachricht trägt pro Mitglied `lobby` und `ready` sowie
`rematch: room.rematch || []`. Serverseitig ist das ein gemeinsamer Baustein
(`inGame`, `seatPlayers`, `readyPlayers`, `startWith`, `autoStart`,
`toLobby`, `checkRematch`), clientseitig `renderReady()` und
`rematchStatus()`. Beides ist in allen Spielen gleich und nur an den Stellen
angepasst, an denen die Spiele ihren Zustand anlegen. Durchgetestet in
`maedn/test/lobby.test.js`.

### Einstellungen im Warteraum

Alles, was beim Erstellen gewählt wird (Spielziel/Runden, Hausregeln,
Computer-Stärke, Feldgröße …), muss der Host **im Warteraum noch ändern
können**, solange das Spiel nicht läuft (`room.state` ist leer) — die anderen
sehen die Auswahl live, aber ausgegraut. Nach „Spiel beenden, zurück in den
Warteraum“ geht das wieder. Neuere Spiele bündeln das in einer
`{t:"settings", goal, rules, level, …}`-Nachricht; Uno und Würfelpoker haben
dafür `{t:"rules"}`, `{t:"botLevel"}` und `{t:"goal"}`. Der Hinweis auf dem
Startbildschirm lautet entsprechend „… kannst du danach im Warteraum noch
ändern“.

### Bots & Zug-Timer

- `botTimers: Map<code, …>` für den nächsten Bot-Zug (Verzögerung, damit es
  nicht wie ein Cheat aussieht)
- Wo ein Zug-Timer existiert (nicht jedes Spiel braucht einen): `turnTimers`
  + `clearTimer(map, code)`-Helper, `TURN_MS` aus `game.js`, erzwingt nach
  Ablauf eine `{t:"timeout"}`-Aktion — nur der Server darf die auslösen
  (`if (a.t === "timeout") return;` im Client-Handler)

### HTTP-Oberfläche

- `GET /info` → `{"<spielid>": true, "version": "<git-kurz-hash o.ä.>", "ips": [...], "port": 8080, "rooms": <anzahl>}`
  — das ist der Healthcheck- **und** der Cross-Container-Endpunkt, den
  sowohl `docker healthcheck` als auch die Startseite (`spiele-start`)
  abfragen. Muss exakt dieses Shape haben.
- Statische Dateien aus `public/`
- WebSocket-Upgrade für den Online-Modus

## Deployment

### Dockerfile (wortidentisch in allen Spielen)

```dockerfile
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/info >/dev/null || exit 1
CMD ["node", "server.js"]
```

### docker-compose.yml + docker-compose.tunnel.yml

Basis-Compose macht das Spiel lokal im LAN erreichbar (Host-Port
konfigurierbar über eine Env-Var, Default individuell pro Spiel: uno 8080,
schiffe 8081, viergewinnt 8082, wuerfelpoker 8083, maedn 8084, start 8090 — neues Spiel
nimmt sich den nächsten freien):

```yaml
services:
  <spielid>:
    build: .
    image: <spielid>:latest
    container_name: <spielid>
    restart: unless-stopped
    ports:
      - "${<SPIEL>_PORT:-<default-port>}:8080"
    volumes:
      - <spielid>-data:/data
volumes:
  <spielid>-data:
```

Tunnel-Overlay hängt den Container zusätzlich ins Docker-Netzwerk von
`cloudflared`, damit der Tunnel ihn unter seinem Container-Namen erreicht:

```yaml
services:
  <spielid>:
    networks: [default, tunnel]
networks:
  tunnel:
    external: true
    name: ${TUNNEL_NETWORK:?TUNNEL_NETWORK in .env setzen}
```

`.env` im Spielordner: `TUNNEL_NETWORK=proxy` (aktuelles Netzwerk auf dem
Mini-PC, siehe `uno/.env`), plus bei Portkollision `<SPIEL>_PORT=<frei>`.

Start: `docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build`

**`container_name` muss exakt dem Hostnamen entsprechen, den der
Cloudflare-Tunnel-Ingress-Eintrag erwartet** (`http://<container_name>:8080`)
— das ist auf dem Mini-PC bereits eingerichtet (Tunnel „debian-main“ +
DNS-Record `<spielid>.cool-kidz.net`), dort nichts ändern, nur den
passenden Container danebenstellen.

## Repo-Integration

- Eintrag in `start/games.json`: `id`, `name`, `title`, `desc`, `players`,
  `url` (`https://<spielid>.cool-kidz.net/`), `status`
  (`http://<container_name>:8080/info`) — daraus baut `spiele-start` sowohl
  die Startseiten-Kachel als auch den `?table=`-Link automatisch, ohne dass
  `start/public/index.html` angefasst werden muss
- Icon `start/public/<spielid>.svg`
- `spiele-start` liest `games.json` und `public/` per Volume live aus dem Repo: auf dem
  Mini-PC reicht `git pull`, damit die Kachel erscheint (kein Rebuild der Startseite)
- Zeile in der Tabelle in diesem Repo-Root-`README.md`

## Checkliste: neues Spiel hinzufügen

1. Ordner mit `server.js`, `public/{index.html,app.js,game.js,sw.js,manifest.webmanifest}`, `Dockerfile`, `docker-compose(.tunnel).yml`, `test/` — bestehendes Spiel als Vorlage kopieren, nicht bei null anfangen
2. Design-System aus diesem Dokument übernehmen: Basis-`:root`-Palette, fünf `TABLES` (inkl. „Blüte“ mit pastelligen Spielfarben), `data-table`-Overrides, `applyLook()`, `?table=`- und `?name=`/`?av=`-Übernahme, geteilte `AVATARS`-Liste, responsives `.avgrid`, `.avbtn`/`.look`/`.seg.tables`-Markup, `showBubble()`-Overlay für Reaktionen, Hauptaktion fest in der Dock-Leiste
3. Server: `IDLE_TTL`/`ROOM_TTL`, `closeRoom()` für Idle-Cleanup (`reason:"idle"`) und den Host-Befehl `{t:"close"}` (`reason:"closed"`), alle Erstell-Einstellungen im Warteraum änderbar, `/info`-Endpunkt im Standard-Shape
   Client: „Raum für alle schließen“ (Host, Warteraum + Spielmenü), `gone`-Meldung je nach `reason`
4. `start/games.json` + `start/public/<id>.svg` + Root-`README.md` ergänzen
5. Freien Port wählen, `docker-compose.yml`/`.tunnel.yml` nach obigem Muster
6. Auf dem Mini-PC: `.env` mit `TUNNEL_NETWORK`, Tunnel-Ingress +
  DNS-Eintrag für `<spielid>.cool-kidz.net` beim Nutzer erfragen (das ist
  remote verwaltet, nicht Teil dieses Repos)
