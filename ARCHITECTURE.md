# Architektur-Manifest: ein einheitliches System für alle Spiele

Dieses Dokument beschreibt, was alle Spiele in diesem Repo gemeinsam haben —
designtechnisch und servertechnisch. Es ist der Bauplan für jedes neue Spiel:
wer sich daran hält, fühlt sich sofort wie die anderen an und lässt sich mit
demselben Handgriff deployen. Stand heute (uno, schiffe, wuerfelpoker,
viergewinnt, maedn, hangman, phase10, kniffel, poker) sind alle sieben Punkte für Punkt danach gebaut — das hier ist die
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

**Gemeinsamer Teil im Browser (`shared/`, von jedem Spiel-Server mit ausgeliefert):**

| Datei | Inhalt |
|---|---|
| `kit.css` | Basis-Palette, die sieben Tisch-Designs (nur Basisfarben) und alle Bausteine, die überall gleich aussehen (Knöpfe-Grundlagen, Felder, Panels, Segmente, Toggles, Toast, Avatar-Raster, Reaktionsblasen, Konfetti, Startseiten-Link …) |
| `kit.js` | `window.Spieleabend`: `store`, `look()` (Design + Größe inkl. `?table=`-Übernahme, `LOOK.render()`/`.apply()`/`.get()`), `identity()` (Profil + `?name=`/`?av=`), `avatarPicker()`/`pickerHTML()`, `profile`, `toast`, `confetti`, `showBubble`, Startseiten-Link im WLAN |
| `avatars.js` / `profile.js` | Avatar-Liste, Farben; Profil mit Statistik (s. „Profil, Avatar & Statistik“) |
| `room-ui.css` / `room-ui.js` | Warteraum und Spielmenü (s. u.) |

Reihenfolge in `index.html`: `kit.css`, `room-ui.css`, dann der eigene `<style>` (Spielfarben
und alles Spielspezifische, darf gemeinsame Regeln überschreiben); Scripts `kit.js`,
`room-ui.js`, `game.js`, `app.js`. Eine CSS-Regel gehört nur dann nach `kit.css`, wenn
sie in allen Spielen gleich ist **und** keine Spielregel sie durch die neue Reihenfolge
überschreiben würde (Beispiel: `.btn-primary` bleibt im Spiel, weil das Basis-`.btn` pro
Spiel verschieden ist). Die Abschnitte unten beschreiben die Konventionen; die Code-Beispiele
stehen so in `shared/kit.*`.

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

### Tisch-Designs (immer exakt diese sieben, gleiche Reihenfolge, gleiche Farben)

```js
const TABLES = [["night", "Nacht", "#1a1426"], ["felt", "Filz", "#15372a"], ["ocean", "Ozean", "#15243a"], ["light", "Hell", "#eceff5"], ["blossom", "Blüte", "#f7c6d9"], ["vulkan", "Vulkan", "#301c17"], ["mint", "Minze", "#dff3ea"]];
```

„Nacht“ ist der Default (kein `data-table`-Attribut nötig). Für die anderen
sechs überschreibt `:root[data-table="X"]{...}` dieselben Variablennamen wie
oben, plus die spiel-eigenen:

```css
:root[data-table="felt"]{--bg:#0f2a1f;--bg2:#15372a;--surface:#1c4636;--line:#2b5c48;--text:#eef7f1;--muted:#9cc3b1; /* + spieleigene Vars */}
:root[data-table="ocean"]{--bg:#0e1a2b;--bg2:#15243a;--surface:#1c3050;--line:#2b4468;--text:#eef3fb;--muted:#9fb4d3; /* + spieleigene Vars */}
:root[data-table="light"]{color-scheme:light;--bg:#eceff5;--bg2:#ffffff;--surface:#e2e7f0;--line:#cbd3e1;--text:#1b2030;--muted:#5b6479; /* + spieleigene Vars */}
:root[data-table="blossom"]{color-scheme:light;--bg:#fbe3ec;--bg2:#fff6f9;--surface:#f7d4e1;--line:#eebfd0;--text:#3a1a2b;--muted:#8b5a70;--scrim:rgba(251,227,236,.92); /* + spieleigene Vars, pastellig */}
:root[data-table="vulkan"]{--bg:#241512;--bg2:#301c17;--surface:#3d241d;--line:#583229;--text:#fbeee8;--muted:#cfa89a;--scrim:rgba(24,10,7,.86); /* + spieleigene Vars, dunkel-warm */}
:root[data-table="mint"]{color-scheme:light; /* helle Minz-Palette, s. kit.css; + spieleigene Vars, pastellig */}
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
damit sieben (oder später mehr) Optionen auf schmalen Handys umbrechen statt
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
`<div class="look" id="lookHome">` auf dem Startbildschirm und das
Einstellungen-Sheet (`id="lookSettings"`, s. u.); `renderLook()` befüllt
alle Ziele (`#lookHome`, `#lookSettings`) mit denselben Buttons.

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

### Profil, Avatar & Statistik (`shared/avatars.js`, `shared/profile.js`)

**Ein Profil pro Browser, in allen Spielen gleich:** Name, Avatar, Farbe und Statistik.

- `shared/avatars.js` (UMD): `AVATARS` (74 Emoji, die ersten 16 sind die alte Liste), `COLORS`
  (12 Hex-Farben, nur diese werden akzeptiert), `isColor()`. Jedes `game.js` liest `AVATARS` von dort
  (`require("../../shared/avatars.js")` bzw. `self.SAAvatars`); der Server liefert die Datei neben `kit.js` aus.
- `shared/profile.js`: `window.SAProfile` mit `get()`, `set(patch)`, `onChange()`, `result(spiel, schlüssel, {won, draw, online})`,
  `importLegacy()`, `reset(spiel?)`, `resetAll()`. Form: `{v:1, name, av, col, u, stats:{spiel:{g,w,d,cs,bs,og,ow,k,i}}}`.
- **Speicherort:** Cookie `sa_profile` mit `Domain=.cool-kidz.net` (gilt für alle Spiel-Subdomains und die Startseite)
  plus Spiegel in localStorage `spieleabend.profile`; der neuere Zeitstempel `u` gewinnt. Auf anderen Hosts (IP im WLAN) ist es host-bezogen.
- `kit.js`: `identity()` nimmt `?name=`/`?av=` (Vorrang), sonst das Profil; das `#myName`-Feld schreibt ins Profil.
  `avatarPicker()`/`pickerHTML()` zeigen Farbwahl (`.avcols`) und Avatar-Raster (`.avgrid`, scrollt, feste Spaltenzahl gibt es nicht).
- **Farbe** geht als validierter Hex-Wert mit `create`/`join`/`avatar` zum Server (`colorOf()` in `room-server.js`) und
  steht in `members`, Chat, Zuschauer- und Party-Daten. Sie erscheint in Warteraum, Chat, Party-Liste und Profil, nicht auf den Spielplaketten.
- **Krönchen** 👑 (`.avc.crown::after`) trägt der Host in Warteraum und Party-Liste.
- **Statistik:** jedes Spiel meldet beendete Partien über `Spieleabend.profile.result()` (Spiele mit Runden nur bei `last.over`);
  die alte Bilanz eines Browsers wird einmal per `importLegacy()` (nach Name) übernommen. Die Spielstartseite verlinkt
  nur noch auf `profile.html` der Startseite (`data-start-link="profile.html"`).
- **Startseite:** `start/public/profile.html` (Bearbeiten, Summen, Statistik je Spiel, Zurücksetzen mit Doppel-Tipp).
  Der `start`-Container hat kein `shared/`: `start/public/avatars.js` und `profile.js` sind **Kopien** — nach jeder Änderung
  `cp shared/avatars.js shared/profile.js start/public/` (ein Test in `start/test/profile.test.js` prüft die Gleichheit).
- App-Vertrag für `RoomUI`: `avatars: G.AVATARS` und `setAvatar(a)` (statt früher `cycleAvatar`).

`#myName` hat überall `maxlength="18"`.

### Einstellungen-Sheet & Zugleiste (`shared/room-ui.js`, `shared/kit.js`)

- `room-ui.js` baut in **jedem** Spiel oben rechts ein Einstellungen-Sheet
  (`#settings`): Tisch-Design, Größe, Avatar und Farbe (wie im Profil,
  online wird `{t:"avatar", avatar, color}` an den Raum geschickt) und der
  Ton-Schalter. Geöffnet wird es über `#setBtn` in der Topbar im Spiel bzw.
  `#setFab` (fest oben rechts) auf Startbildschirm/Warteraum; im Spiel ist
  der Fab per `:has(#game:not([hidden]))` ausgeblendet. Pro Spiel ist dafür
  kein HTML nötig; spielspezifische Optionen gehören in ein
  `data-slot="settings"`-Template im Menü („Spiel-Einstellungen“).
- `Spieleabend.followTurn(box, selektor|[selektoren])` scrollt eine
  horizontal scrollende Spielerleiste automatisch zum Spieler, der dran ist
  (weich, nur wenn er nicht komplett sichtbar ist, zentriert; hält die
  Position bei Neuzeichnen). Jedes Spiel mit so einer Leiste ruft es einmal
  beim Start auf (`#plates`/`.plate.active`, `#players`/`.pcard.active` …);
  eigenes `scrollLeft`/`scrollIntoView` gehört nicht mehr in die Spiele.
- Neue Themes brauchen in jedem Spiel eine `:root[data-table="X"]`-Regel mit
  den spieleigenen Variablen (Brett, Meer, Filz …) — die Basis kommt aus `kit.css`.

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

## Server-Architektur (`shared/room-server.js` + `server.js` pro Spiel)

Alle Spiele laufen auf **einem** gemeinsamen Server-Kern: `shared/room-server.js`
(reiner `http` + `ws`-Server ohne Framework). Er enthält alles, was unten
beschrieben ist: Räume, Warteraum/Bereit, Revanche, Wiederverbinden,
Zuschauer, Computer-Gegner und Zug-Uhren, Raum schließen, Idle-Cleanup,
Persistenz und die HTTP-Oberfläche. Das `server.js` eines Spiels ist nur noch
ein kurzer Adapter, der die Engine (`public/game.js`) und ein paar
spielspezifische Haken übergibt:

```js
const Game = require("./public/game.js");
module.exports = require("../shared/room-server.js")({
  dir: __dirname, Game, id: "maedn", title: "Mensch ärgere dich nicht",
  maxPlayers: Game.MAX_PLAYERS, watchers: 20, reactions: [/* acht Reaktionen */],
  newRoom: (msg) => ({ goal, rules, level }),       // Einstellungen beim Erstellen
  roomFields: (room) => ({ goal, rules, level }),   // … in jeder Raum-Nachricht
  settings(room, msg) { /* {t:"settings"} im Warteraum */ },
  newGame: (room, players) => Game.newGame(/* … */),
  leaveGame(room, pid, ctx) { /* optional: Aufgeben / Computer übernimmt */ }
});
```

Optionale Haken: `botPlan`/`botMove` (eigenes Bot-Timing, Standard ist
`Game.botMove` nach `BOT_MS`), `turnClock` (30-s-Zug-Uhr des Servers),
`handlers` (zusätzliche Nachrichten wie Unos `{t:"rules"}`), `hostHandover`
(Host-Rolle wandert weiter, wenn der Host offline geht — Uno, Würfelpoker).
Neue gemeinsame Server-Funktionen gehören **nur** in `shared/room-server.js`.
Die Code-Beispiele unten zeigen die Bausteine, wie sie dort stehen.

Gemeinsame Bausteine:

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
Host — im Warteraum (`#closeLobby`) und im Spielmenü (`armed(…)`-Aktion).
Beide wollen zweimal getippt werden, wie alle zerstörerischen Menü-Aktionen;
im Warteraum färbt sich der Knopf beim ersten Tipp rot und ein Toast sagt
„Nochmal tippen“.

Die Knöpfe des Warteraums (`.lobby-actions`) stehen in **einer Zeile**:
„Bereit“ und „Starten“ als Text, „Raum verlassen“ (`#leaveLobby`) und „Raum
für alle schließen“ als Icon-Knöpfe (`.iconact`, Name in `aria-label` und
`title`). Die Spielerzahl im Start-Knopf (`.cnt`) fällt unter 360px Breite
weg, damit nichts abgeschnitten wird.

Der Warteraum ist in allen Spielen gleich aufgebaut: Raum-Code, dann
Spieler, dann Einstellungen, Hausregeln und Spielregeln. Auf breiten
Bildschirmen stehen Code und Spieler links und der Rest rechts
(`.cols` > `.col`; in Vier gewinnt heißen die Brett-Spalten auch `.col`,
daher dort `#lobby .col`).

Das **Spielmenü** ist ebenfalls überall gleich: Punktestand mit einer Zeile zu
Spielziel und Hausregeln, dann die aufklappbaren Bereiche Spielregeln,
Spielverlauf und Einstellungen (Aussehen, Töne, bei Schiffe die Zielhilfe).
Danach kommen Aktionen für die eigene Person (`#menuActions`, z. B.
Aufgeben) und der eingeklappte Bereich „Als Host“ (`#hostActions`:
Überspringen, Computer übernimmt, Spiel für alle beenden, Raum schließen).
Dieser Bereich geht von selbst auf, wenn jemand offline ist. Ganz unten steht
eine Zeile mit „Weiterspielen“ sowie Icons für „Raum verlassen“
(`#menuLeave`, zweimal tippen) und die Startseite.

**Beides steht nur einmal im Repo: `shared/room-ui.js` + `shared/room-ui.css`.**
Der Server liefert sie neben den Spieldateien aus (`room-ui.js?v=…`, im
Versions-Hash enthalten), `sw.js` cached sie, `scripts/build-single.js` baut
sie mit ein. `room-ui.js` wird vor `game.js`/`app.js` geladen und baut beim
Laden das Markup von `#lobby` und `#menu`. Das Spiel liefert in `index.html` nur
Platzhalter:

```html
<section id="lobby" class="screen" hidden aria-label="Warteraum">
  <template data-slot="settings"><div class="panel">…Spielziel, Stärke, …</div></template>
</section>
<div class="overlay" id="menu" hidden [data-title="Siege" data-scores="ranking" data-rules-title="…"]>
  <template data-slot="rules"><ul>…Spielregeln…</ul></template>        <!-- auch im Warteraum -->
  <template data-slot="history">…optional über dem Spielverlauf…</template>
  <template data-slot="settings">…optionale Schalter, z. B. Zielhilfe…</template>
</div>
```

In `app.js` ruft das Spiel `const UI = RoomUI({...})` mit seinen Zuständen
(`room`, `view`, `mode`, `server`, `watching`), `send`, `toast`, `render`,
`maxPlayers`, `watchers` sowie den Haken `renderSettings(host)`,
`memberExtra(m, i)` (Farbpunkt, Team), `cycleAvatar()` und `menu: { open,
local, player, skip, standIn }` auf. Zurück kommen `UI.renderLobby()` (inkl.
Bereit-Logik), `UI.rematchStatus()` und `UI.armed()` für eigene
Zweimal-tippen-Aktionen. Neue Warteraum- oder Menü-Funktionen gehören **nur**
dorthin.

**Verbindung und Chat** stecken ebenfalls in `room-ui.js`: ein WebSocket, der sich
selbst neu verbindet, nach einem Neuladen per gespeichertem `secret` (bzw. als
Zuschauer per Name) wieder in den Raum kommt und `create`/`join` bis zum Öffnen
puffert, plus die Verbindungs-Pille `#net`. Das Spiel gibt dafür `onlineKey` und
`on: { opened, joined, room, react, error, left }` mit, sendet über `UI.send()`
(in den Apps als `wsSend()`), ruft beim Start `UI.resume()` und in jedem
`render()` `UI.update()`.

Der **Chat** gehört zum Raum: `{t:"chat", text}` an den Server (max. 200 Zeichen,
eine Zeile pro Sekunde, der Browser puffert schnellere), der schickt
`{t:"chat", line:{id, at, pi, name, avatar, text}}` an alle im Raum inklusive
Zuschauer und hält die letzten 100 Zeilen in `room.chat`, solange der Raum lebt;
nach `joined`/`watching` kommt der Verlauf als `{t:"chatlog", list}`. Im
Warteraum steht der Chat unter den Spielern, im Spiel hinter dem Sprechblasen-Knopf
`#chatBtn` neben dem Menü, mit Zähler für Ungelesenes; neue Zeilen erscheinen dort
kurz als Blase über dem Spieler (`bubble`-Haken des Spiels). Getestet in
`maedn/test/chat.test.js`.

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
`toLobby`, `checkRematch` in `shared/room-server.js`), clientseitig `renderReady()` und
`rematchStatus()` in `shared/room-ui.js`. Beides ist in allen Spielen gleich und nur an den Stellen
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
- `POST /party-room` → legt einen Raum an, in dem alle Party-Mitglieder schon sitzen (Header
  `x-party-secret` = Env `PARTY_SECRET`, sonst 403; ohne gesetztes Secret 503). Body
  `{party, members:[{name, avatar, ready}]}`, Antwort `{code, max, seats:[{name, secret}], watch:[name], out:[name]}`.
  Passen alle rein, sitzen alle. Sonst sitzen der Host (erster) und alle mit `ready`, der Rest wird
  Zuschauer (`watch`, nur Spiele mit `watchers`) oder bleibt draußen (`out`). Der Bereit-Status aus
  der Party wird übernommen. Das Raum-Objekt trägt `party` (Code), die `room`-Nachricht ebenfalls.

### Party-System (Startseite)

`start/party.js` + `start/server.js`: Gruppen im Speicher des Start-Servers (weg bei Neustart, nach
3 h ohne Besuch aufgeräumt). Aktionen per `POST /party/{create,join,act}`, Updates per Server-Sent
Events (`GET /party/events`, ohne Abhängigkeiten). Nur der Host startet ein Spiel (`act {t:"launch"}`):
der Start-Server ruft `<status-origin>/party-room` des Spiels auf und schickt jedem Mitglied nur seine
eigene Einlass-URL (`?pr=RAUM&ps=SITZ-SECRET`, Zuschauer `?pr=RAUM&pw=NAME`). Die Startseite folgt
einmal pro Raum automatisch (`spieleabend.went` in localStorage). `shared/room-ui.js` legt diese
Parameter beim Laden wie ein gespeichertes Raum-Secret ab, das normale `UI.resume()` des Spiels
übernimmt den Rest (keine Änderung an den `app.js` nötig). Ist der Raum von einer Party, gibt es
„Zurück zur Party“ im Warteraum und im Menü (`Spieleabend.startUrl("?party=CODE")`).
`games.json`: `max` (Plätze), `watch` (Spiel hat Zuschauer), `hint:false` (kein Hinweis bei zu
großer Party, bisher Mensch ärgere dich nicht wegen der geplanten 5–6/7–8-Bretter).
`PARTY_SECRET` steht in der `.env` jedes Spiels und der Startseite (gleicher Wert, nicht im Repo).

**Wiederverbinden nach Standby/Netzwechsel:** Ein Handy behält oft einen Socket, der offen aussieht,
aber tot ist. Deshalb schickt `room-ui.js` bei `visibilitychange` (sichtbar), `online`, `pageshow`
(bfcache) und alle 10 s, wenn 25 s nichts kam, ein `{t:"ping"}`; der Server antwortet `{t:"pong"}`
(`room-server.js`, fasst den Raum nicht an, hält ihn also nicht künstlich am Leben). Kommt binnen 3 s
nichts, wird der Socket verworfen und neu verbunden (`resume` mit dem Secret), danach „Wieder
verbunden.“. Die Startseite öffnet nach ≥ 8 s im Hintergrund (oder bei `online`/`pageshow`) den
Party-Stream neu, nach einem `act {t:"ping"}`, der bei 404 die Party vergisst.

**Einladungs-Link (Discord & Co):** Der Start-Server ersetzt in `public/index.html` den Platzhalter
`<!--embed-->` durch Open-Graph-Tags (`embed()` in `start/server.js`). `/?party=CODE` nennt den
Host und wie viele schon dabei sind (`parties.peek()`: nur öffentliche Fakten, kein Secret, alles
HTML-escaped); jeder andere Link bekommt den allgemeinen Text. Das Bild `public/og.png`
(1200×630, statisch) muss ein PNG sein, Discord zeigt kein SVG. Basis-URL aus `X-Forwarded-Host/-Proto`
oder `PUBLIC_URL`. Der Button „Einladung teilen“ nutzt `navigator.share` (auf dem Handy mit Discord
in der Auswahl), sonst kopiert er Text + Link (nur unter https möglich).

## Deployment

### Dockerfile (wortidentisch in allen Spielen)

Gebaut wird vom Repo-Root aus (Compose: `context: ..`, Build-Arg `GAME` =
Spielordner), damit `shared/` mit ins Image kommt. Das Root-`.dockerignore`
hält den Kontext klein.

```dockerfile
FROM node:22-alpine
ARG GAME
WORKDIR /app/game
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY ${GAME}/package.json ${GAME}/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY shared /app/shared
COPY ${GAME}/server.js ./
COPY ${GAME}/public ./public
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
schiffe 8081, viergewinnt 8082, wuerfelpoker 8083, maedn 8084, hangman 8085, phase10 8086, kniffel 8087, poker 8088, start 8090 — neues Spiel
nimmt sich den nächsten freien):

```yaml
services:
  <spielid>:
    build:
      context: ..
      dockerfile: <ordner>/Dockerfile
      args:
        GAME: <ordner>
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

**Kurzweg:** `scripts/new-game <id> "<Titel>" [--port N] [--sub name] [--max N] [--desc "…"] [--dry-run]`
legt aus `scripts/game-template/` einen lauffähigen Ordner an (kleines Würfelspiel „Pig“ mit
Engine, Server-Adapter, Oberfläche, Tests, Dockerfile, Compose, systemd, Icons), kopiert die `.env` eines
anderen Spiels, wählt den nächsten freien Port und trägt `start/games.json`, `start/public/<id>.svg` und
die README-Tabelle ein (Punkte 1, 2, 4 und 5 unten sind damit erledigt). Danach nur noch die Regeln in
`game.js`/`app.js`/`index.html` ersetzen. Die Vorlage hat eigene Tests (`test/`), die im Generat mitlaufen.
Übrig bleiben Punkt 6 (Tunnel-Ingress, DNS, Start) und Committen.

Die einzelnen Schritte, falls man ohne Generator arbeitet:

1. Ordner mit `server.js` (Adapter für `shared/room-server.js`, s. o.), `public/{index.html,app.js,game.js,sw.js,manifest.webmanifest}`, `Dockerfile`, `docker-compose(.tunnel).yml`, `test/` — bestehendes Spiel als Vorlage kopieren, nicht bei null anfangen
2. `kit.css`/`room-ui.css` und `kit.js`/`room-ui.js` einbinden (Reihenfolge s. o.), `Spieleabend.look()`/`identity()`/`avatarPicker()` aufrufen; aus dem Design-System dazu: sieben `TABLES` (inkl. „Blüte“, „Vulkan“, „Minze“ mit passenden Spielfarben), `data-table`-Overrides, `applyLook()`, `?table=`- und `?name=`/`?av=`-Übernahme, `shared/avatars.js` + `shared/profile.js` einbinden (Profil, Statistik-Hook `profile.result`, „Profil & Statistik“-Link), responsives `.avgrid`, `.avbtn`/`.look`/`.seg.tables`-Markup, `showBubble()`-Overlay für Reaktionen, Hauptaktion fest in der Dock-Leiste
3. Server: kommt aus `shared/room-server.js` (`IDLE_TTL`/`ROOM_TTL`, `closeRoom()` für Idle-Cleanup (`reason:"idle"`) und den Host-Befehl `{t:"close"}` (`reason:"closed"`), alle Erstell-Einstellungen im Warteraum änderbar, `/info`-Endpunkt im Standard-Shape) — das Spiel liefert nur Engine + Haken
   Client: „Raum für alle schließen“ (Host, Warteraum + Spielmenü), `gone`-Meldung je nach `reason`
4. `start/games.json` + `start/public/<id>.svg` + Root-`README.md` ergänzen
5. Freien Port wählen, `docker-compose.yml`/`.tunnel.yml` nach obigem Muster
6. Auf dem Mini-PC: `.env` mit `TUNNEL_NETWORK`, Tunnel-Ingress +
  DNS-Eintrag für `<spielid>.cool-kidz.net` beim Nutzer erfragen (das ist
  remote verwaltet, nicht Teil dieses Repos)
