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

### Tisch-Designs (immer exakt diese vier, gleiche Reihenfolge, gleiche Farben)

```js
const TABLES = [["night", "Nacht", "#1a1426"], ["felt", "Filz", "#15372a"], ["ocean", "Ozean", "#15243a"], ["light", "Hell", "#eceff5"]];
```

„Nacht“ ist der Default (kein `data-table`-Attribut nötig). Für die anderen
drei überschreibt `:root[data-table="X"]{...}` dieselben Variablennamen wie
oben, plus die spiel-eigenen:

```css
:root[data-table="felt"]{--bg:#0f2a1f;--bg2:#15372a;--surface:#1c4636;--line:#2b5c48;--text:#eef7f1;--muted:#9cc3b1; /* + spieleigene Vars */}
:root[data-table="ocean"]{--bg:#0e1a2b;--bg2:#15243a;--surface:#1c3050;--line:#2b4468;--text:#eef3fb;--muted:#9fb4d3; /* + spieleigene Vars */}
:root[data-table="light"]{color-scheme:light;--bg:#eceff5;--bg2:#ffffff;--surface:#e2e7f0;--line:#cbd3e1;--text:#1b2030;--muted:#5b6479; /* + spieleigene Vars */}
```

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
    if (Date.now() - r.touched > IDLE_TTL) {
      for (const ws of sockets.get(code) || []) send(ws, { t: "gone", reason: "idle" });
      /* jeweilige Bot-/Zug-Timer für den Code aufräumen */
      sockets.delete(code);
      rooms.delete(code); saveRooms();
    }
  }
}, 25000).unref();
```

Das schließt Räume **unabhängig davon, ob noch jemand verbunden ist** —
„keiner tut was“ reicht, nicht erst „alle sind weg“. Während eines
laufenden Spiels mit Zug-Timer (30s, s.u.) killt das niemanden mitten im
Zug: jeder erzwungene Timeout aktualisiert `touched` mit.

Client-seitig (`app.js`, WS-Message-Handler):

```js
} else if (m.t === "gone" || m.t === "left") {
  store.del(K.online); R = null; mode = null;
  if (m.t === "gone") toast(m.reason === "idle" ? "Raum wegen Inaktivität geschlossen." : "Diesen Raum gibt es nicht mehr.");
  render();
}
```

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
2. Design-System aus diesem Dokument übernehmen: Basis-`:root`-Palette, vier `TABLES`, `data-table`-Overrides, `applyLook()`, `?table=`-Übernahme-Block, geteilte `AVATARS`-Liste, `.avbtn`/`.look`-Markup
3. Server: `IDLE_TTL`/`ROOM_TTL`, Idle-Cleanup-Loop mit `{t:"gone",reason:"idle"}`, `/info`-Endpunkt im Standard-Shape
4. `start/games.json` + `start/public/<id>.svg` + Root-`README.md` ergänzen
5. Freien Port wählen, `docker-compose.yml`/`.tunnel.yml` nach obigem Muster
6. Auf dem Mini-PC: `.env` mit `TUNNEL_NETWORK`, Tunnel-Ingress +
  DNS-Eintrag für `<spielid>.cool-kidz.net` beim Nutzer erfragen (das ist
  remote verwaltet, nicht Teil dieses Repos)
