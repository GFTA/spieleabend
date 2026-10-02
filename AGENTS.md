# AGENTS.md: ein Spiel für Spieleabend bauen oder ändern

Kurzfassung für Menschen und KI-Agenten. Die Details stehen in [`ARCHITECTURE.md`](ARCHITECTURE.md), die
Vorlage in `scripts/game-template/`. Dieses Repo ist öffentlich: keine Heimnetz-Angaben, IPs oder Secrets
(`.env` bleibt lokal und ist ignoriert).

## Start hier (Projekt in 60 Sekunden)

**Was das ist:** Eine Sammlung von Browser-Spielen für den privaten Spieleabend (Handy und Desktop, Deutsch).
Jedes Spiel läuft online (jeder sein Handy, Raum per QR-Code/Link, Host startet) und als Einzelspieler gegen
Computer-Gegner. Ein Spiel ist ein Ordner im Repo-Root (`uno/`, `kniffel/`, `sudoku/` …), die Startseite liegt in `start/`,
Gemeinsames in `shared/`, Werkzeuge in `scripts/`. Neue Spiele heißen klein geschrieben ohne Umlaute (`machikoro`).

**Was du zuerst tust, egal was die Aufgabe ist:**

1. Dieses Dokument komplett lesen, danach bei Bedarf [`ARCHITECTURE.md`](ARCHITECTURE.md) (Details zu Design-System, Server, Deployment).
2. `git status` und `git branch --show-current`. Neue Arbeit auf einem eigenen Branch (`add-<id>` für ein neues Spiel, `fix-<thema>`
   sonst), nie direkt auf `main`, außer es wird ausdrücklich gesagt.
3. Bei einem neuen Spiel: `scripts/new-game <id> "<Titel>"`. Bei einem bestehenden Spiel: zuerst dessen `README.md`, `public/game.js`
   und `test/` lesen, dann ändern.
4. Nach jeder Änderung: `cd <id> && npm test` und `scripts/check-games <id>`. Vor dem Melden die Checkliste am Ende durchgehen.

**Befehle (Node 22, kein `npm install` im Repo-Root):**

| Zweck | Befehl |
| --- | --- |
| Neues Spiel anlegen | `scripts/new-game <id> "<Titel>" --max N --desc "…"` |
| Tests eines Spiels | `cd <id> && npm ci && npm test` |
| Konventionen prüfen | `scripts/check-games <id>` (neue Spiele: `--strict`, dann zählen Warnungen als Fehler) |
| Spiel lokal starten | `cd <id> && node server.js` (Port 8080 im Container, sonst `PORT=…`) |

**Zusammenarbeit:**

- Aufgaben kommen oft diktiert und mit Tippfehlern. Deute sie großzügig und frage nur nach, wenn eine Entscheidung wirklich offen ist.
- Commits: kurze Nachricht im Imperativ, ein Commit pro Spielordner, `shared/` nur in einem eigenen Commit. Push auf den eigenen Branch.
- **Nie ohne ausdrückliche Anweisung:** auf `main` mergen oder pushen, deployen, `shared/` oder fremde Spielordner ändern, Dockerfiles ändern.
- Melde am Ende kurz: was geändert wurde, welche Tests und Checks grün sind, was im Browser gesehen wurde, was offen bleibt.
  Behaupte nie „getestet“, wenn du es nicht getestet hast, und sage ehrlich, was du nicht prüfen konntest.
- Bei einem Review-Ergebnis oder Fehlerbericht: jeden Punkt einzeln abarbeiten und am Ende pro Punkt sagen, wie er behoben wurde.

## Die wichtigsten Regeln (Rest unten zum Nachschlagen)

1. Starte **immer** mit `scripts/new-game <id> "<Titel>"`. Nie einen Ordner von Hand anlegen oder ein Spiel kopieren.
2. Lies ein ähnliches bestehendes Spiel, bevor du Regeln schreibst. Kopiere dessen Muster, erfinde keine eigenen.
3. Regeln, Bots und Bot-Tempo stehen **nur** in `public/game.js` (kein DOM). Server und Browser rufen sie bloß auf.
4. `server.js` ist ein dünner Adapter um `../shared/room-server.js`. `app.js` nutzt `RoomUI`, `HomeUI` und `Spieleabend.*`. Nichts davon selbst nachbauen.
5. Das Rundenende läuft **immer** über `UI.roundEndFooter`, danach genau einmal `profile.result(...)` und bei Sieg `confetti()`.
6. Kein Hot-Seat. Einzelspieler ist Mensch plus Computer-Gegner (`HomeUI({ min: 0 })`, wenn das Spiel auch allein Spaß macht).
7. Alles, was sich bewegt, ist sichtbar animiert, auch Bot-Züge und Züge der anderen. Karten ziehen, ablegen und fliegen lassen **immer** über `shared/cards.js` (`Cards.dnd`, `Cards.flights`, `Cards.cascade`), nie mit eigenem Ghost-/Pointer-Code.
8. Die Engine muss schnell sein (keine Sekunden-Generatoren) und Computer-Gegner spielen in Menschen-Tempo. Beides braucht einen Test.
9. Eingaben zeigen sofort Wirkung (optimistisch), Uhren laufen vom Server-Wert aus.
10. **Jede Aktion vom Client ist feindlich**: Die Engine prüft in `act` alles. Nachschlagen in Tabellen nur mit `Object.prototype.hasOwnProperty.call(TABELLE, key)` oder über `Map`/`Object.create(null)`, nie mit `TABELLE[a.id]`: `"constructor"`, `"__proto__"` oder `"toString"` sind sonst gültige Schlüssel. Zahlen mit `Number.isInteger` und Bereich prüfen, Strings auf Typ. Dazu gehört ein Test mit solchen Nachrichten.
11. **Jedes Engine-Event hat eine sichtbare Reaktion im Client** (Zahlung: Zahler *und* Empfänger, Tausch, Zug, Wurf, Kauf). Liste vor dem Commit alle `events.push({ t: … })` der Engine und prüfe, dass `handleEvents` jeden davon anzeigt.
12. `view()` schickt nur, was sich ändert. Statische Daten (Kartentexte, Namen, Regeln) stehen einmal im Client (`game.js` ist dort ohnehin geladen), nicht in jedem Update. Bewusste Abweichungen von den Originalregeln stehen in der `README.md` des Spiels.
13. Fertig ist ein Spiel erst, wenn `npm test` und `scripts/check-games <id>` grün sind **und** du es im Browser bis zum Rundenende gespielt hast (Einzel- und Mehrspieler, Handy- und Desktop-Breite). Jede Warnung des Checkers beheben, auch wenn sie nicht abbricht.

Privat bleibt privat: keine IPs, Hostnamen des eigenen Servers oder Secrets im Repo. Ein Commit pro Spielordner.

## Arbeitsablauf (in dieser Reihenfolge)

1. **Generator zuerst, nie bei null anfangen.**
   `scripts/new-game <id> "<Titel>" --max N --desc "…"` legt einen lauffähigen Ordner an (Engine, Server-Adapter,
   Oberfläche, Tests, Docker, Icons, Eintrag in `start/games.json` und README). Er läuft sofort als kleines Würfelspiel.
2. **Ein gutes Vorbild lesen**, bevor du Regeln schreibst: ein ähnliches Spiel (gleichzeitig spielen: `sudoku/`,
   reihum: `kniffel/` oder `uno/`, Brett: `viergewinnt/`, `maedn/`).
3. **Erst die Engine** (`public/game.js`) mit Tests, dann Server-Adapter, dann Oberfläche.
4. **Prüfen:** `cd <id> && npm ci && npm test`, dann `scripts/check-games <id>` (Konventionen).
   Beides muss grün sein, die CI prüft dasselbe.
5. **Im Browser ausprobieren** (Einzelspieler mit 0 und mehreren Gegnern, Mehrspieler mit zwei Tabs, Handy- und
   Desktop-Breite, bis zum Rundenende). Typecheck und Tests reichen bei UI nicht. Achte auf Fehler in der Konsole.
6. Pro Spielordner committen und pushen. Deployen nur auf Anweisung, dann immer mit
   `docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build`.

## Feste Regeln

- **Engine (`public/game.js`)**: reines JS ohne `document`/`window`/`localStorage`, UMD (`module.exports` und Global).
  Sie läuft im Browser und im Server und enthält *alle* Regeln, auch das Bot-Timing (`botPlan`).
- **Server (`server.js`)**: nur ein dünner Adapter um `../shared/room-server.js` (Hooks `newRoom`, `roomFields`,
  `settings`, `newGame`, optional `botPlan`, `botMove`, `turnClock`, `handlers`). Kein eigener `ws`/`express`-Code,
  keine eigene Raumverwaltung.
- **Oberfläche (`public/app.js`)**: nutzt `RoomUI` (Verbindung, Lobby, Bereit, Revanche), `HomeUI` (Gegner-Auswahl),
  `Spieleabend.look/identity/profile/sound/followTurn` aus `shared/kit.js`. Keine eigenen WebSockets, keine eigenen
  Lobby-, Avatar- oder Profil-Bausteine.
- **Rundenende immer mit `UI.roundEndFooter({ over, next })`**, darin stecken Revanche, „Zurück zum Start“ und die
  Abstimmung. Danach `Spieleabend.profile.result(...)` und bei Sieg `confetti()`, genau einmal pro Runde.
- **Skriptreihenfolge in `index.html`**: `kit.css`, `room-ui.css`, `avatars.js`, `profile.js`, `kit.js`, `room-ui.js`,
  `home-ui.js`, `game.js`, `app.js` (Kartenspiele laden zusätzlich `cards.css` nach `room-ui.css` und `cards.js` nach `home-ui.js`). Gemeinsames liegt in `shared/`. Wird dort etwas geändert, betrifft es alle Spiele gleichzeitig:
  Änderungen sind additiv (neue optionale Parameter mit altem Standardwert).
- **Kein Hot-Seat / „Ein Handy für alle“.** Einzelspieler heißt: Mensch plus Computer-Gegner. Darf ein Spiel auch allein
  Spaß machen, erlaubt `HomeUI({ min: 0 })` null Gegner.
- **Jede Bewegung ist sichtbar animiert**, auch Bot-Züge und Züge der anderen. `prefers-reduced-motion` schaltet global ab.
- **Nicht ändern**: `Dockerfile` (in allen Spielen identisch), `shared/*` ohne Not, andere Spielordner.
- Design: die sieben Tisch-Designs, Schriften und Farben aus `kit.css`, keine eigenen Themes oder Buttons erfinden.
  Die Hauptaktion sitzt fest unten in der Dock-Leiste.

## Typische Fehler (alle schon passiert)

| Fehler | Stattdessen |
| --- | --- |
| Eigene „Nochmal“-Buttons und `UI.rematchStatus()` im Rundenende. Das wirft im Einzelspielermodus einen JS-Fehler, Konfetti und Statistik fehlen. | `UI.roundEndFooter` |
| Generator oder Löser brauchen Sekunden und blockieren den Server für alle Räume. | Bitmasken/Backtracking mit Kandidaten-Auswahl, dazu ein Zeit-Test in `game.test.js` |
| „Eindeutig lösbar“ nur behauptet, nie geprüft. | Test: `countSolutions(puzzle, 2) === 1` |
| Bots lösen in Sekunden oder werden mit mehr Bots schneller. | Menschen-Tempo in `botPlan`, Gesamtzeit pro Stufe geteilt durch Bots |
| Bot-Logik doppelt (Server und Browser) und dann verschieden. | Eine Funktion in der Engine, beide rufen sie |
| Schnelles Tippen wird von einer „inflight“-Sperre verschluckt. | Optimistisch anzeigen, Server korrigiert |
| Uhr läuft mit lokaler Ankunftszeit und geht gegenüber dem Server falsch. | Server-`elapsed` als Basis |
| Fortgesetztes lokales Spiel läuft im Hintergrund weiter. | `savedAt` speichern, Startzeit beim Fortsetzen verschieben |
| Solo ohne Gegner geht nicht, obwohl das Spiel allein Spaß macht. | `HomeUI({ min: 0 })` |
| Schrift für Notizen oder Hinweise winzig. | Mindestens `clamp(9px, 2.6vw, 12px)` für Notizen, sonst 14px aufwärts |
| `CARDS[a.id]` / `market[a.id]` mit Client-Wert. `"constructor"` wird akzeptiert, die Münzen werden `NaN`, Funktionen landen im Spielstand. | `own(tabelle, key)` (hasOwnProperty) vor jedem Nachschlagen, Test mit `constructor`/`__proto__`/`toString`/`null`/Zahlen |
| Engine erzeugt Events (`pay`, `trade`), der Client zeigt nur einen Teil. Ein Tausch ist nur im Log zu sehen, der Zahler blitzt nicht. | Jedes Event in `handleEvents` behandeln: bewegen, blitzen oder einblenden |
| `view()` schickt bei jedem Zug alle Kartentexte (mehrere KB) mit. | Statisches einmal im Client, im View nur Zustand |
| Nur die Form der Daten getestet. | Tests für Regeln, Bots, Rundenende, Server-Runde über echten WebSocket |

## Testen

- `cd <id> && npm ci && npm test` (Node 22). Kein `npm install` im Repo-Root.
- Die Vorlage bringt `test/game.test.js` (Engine) und `test/server.test.js` (echte Runde durch den geteilten Server).
  Kürze Bot-Pausen im Servertest mit `BOT_MS=20` und hebe das Rate-Limit mit `RATE_PER_S=5000` an, wenn du Nachrichten spammst.
- Browser-Test: Playwright gegen `node server.js`, Selektoren: `#modeTabs [data-tab=local]`, `#oppBox [data-opp=N]`, `#startLocal`.

## Checkliste vor dem Commit

- [ ] `scripts/check-games` ist grün
- [ ] `npm test` im Spielordner ist grün, Engine-Tests decken Regeln, Bots und Rundenende ab
- [ ] Einzelspieler bis zum Rundenende gespielt, keine Fehler in der Konsole
- [ ] Mehrspieler mit zwei Tabs gespielt (Lobby, Start, Zug, Rundenende, Revanche)
- [ ] Handy (390 px) und Desktop angesehen
- [ ] Nichts Privates im Diff (IPs, Hostnamen des eigenen Servers, `.env`, Secrets)
