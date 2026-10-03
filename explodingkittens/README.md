# Exploding Kittens

Kartenspiel für 2–5 Personen: Wer eine explodierende Katze zieht und keine Entschärfen-Karte hat, ist raus,
wer als Letzte(r) übrig bleibt, gewinnt. Ein Spieleabend-Spiel: Warteraum, Raum-Code mit QR, Zuschauer, Chat,
Computer-Gegner, Avatare und Tisch-Designs kommen aus `../shared/`, siehe [`ARCHITECTURE.md`](../ARCHITECTURE.md).
Einzelspieler gegen den Computer und Online-Räume benutzen dieselbe Regel-Engine (`public/game.js`).

## Regeln, wie sie hier gelten

- Jede Person startet mit einer Entschärfen-Karte plus 7 Karten. Im Stapel liegen (Personen − 1) Katzen und
  bis zu 2 weitere Entschärfen-Karten.
- Wer dran ist, spielt beliebig viele Karten und beendet den Zug mit **Ziehen**.
- Zieht jemand die Katze: Entschärfen-Karte ablegen und die Katze **heimlich an einer Stelle seiner Wahl**
  zurück in den Stapel stecken (Schieberegler, Oben / Mitte / Unten / Zufall). Ohne Entschärfen: raus, die Karten
  wandern in den Ablagestapel.
- Aktionen: **Aussetzen** (Zug beenden ohne Ziehen), **Angriff** (Zug beenden, die nächste Person muss zwei Züge machen;
  Angriffe addieren sich, jeder weitere gibt einen zusätzlichen Zug), **Mischen**, **Blick in die Zukunft**
  (die obersten 3 Karten ansehen), **Gefallen** (eine Person gibt dir eine Karte ihrer Wahl).
- **Nö!** stoppt jede Aktion, auch ein anderes Nö!. Die Aktion gilt, wenn eine gerade Zahl Nös gespielt wurde.
  Nach einer gespielten Karte läuft ein kurzes Zeitfenster (ca. 3 Sekunden, nach jedem Nö! 2,6 Sekunden),
  in dem alle mit Nö! reagieren können.
  Kann niemand mehr Nö! sagen (keine Karte auf der Hand oder „Kein Nö“ getippt), wird die Karte nach etwa 0,6 Sekunden ausgeführt.
- **Katzenkarten** (Taco, Melone, Kartoffel, Regenbogen, Bart) gehen nur als **Paar** (zufällige Karte der gewählten
  Person) oder **Drilling** (genannte Karte; hat sie die Person, bekommst du sie, sonst gehst du leer aus).
- Ein leerer Stapel wird aus dem Ablagestapel neu gemischt.
- Spielziel: eine Runde, bis 2 oder bis 3 Siege (Einstellung im Warteraum). Online läuft eine Zugzeit von 45 Sekunden,
  danach zieht das Spiel für die Person.

### Abweichungen vom Original

- Eigene Kartennamen und Symbole (Emoji statt Zeichnungen), keine Erweiterungen.
- Kein Kombi-Zug mit fünf verschiedenen Karten.
- Das „Nö!“-Fenster läuft automatisch ab, statt dass alle ausdrücklich passen müssen.

## Bedienung

Karten antippen (zweimal tippen oder Knopf = spielen) oder auf den Tisch beziehungsweise auf eine Person ziehen
(Maus und Touch). Leertaste = ziehen, <kbd>N</kbd> = Nö!.

## Aufbau

- `public/game.js`: Regeln, `newGame`, `act`, `botMove`, `botPlan`, `tick`, `view` (reines JS, läuft im Browser und im Server)
- `server.js`: Einstellungen eines Raums (Ziel, Computer-Stufe) und Anschluss an `../shared/room-server.js`
- `public/index.html`, `public/app.js`: Startbildschirm, Tisch, Animationen (jede Karte fliegt sichtbar, auch die der anderen)
- `test/`: Regeln, Bots und ein Durchlauf über WebSockets

## Starten

    cd explodingkittens
    npm ci && npm start          # http://localhost:8080 (PORT ändert das)
    npm test

Auf dem Server, vom Repo-Ordner aus (der Build braucht `../shared`):

    cd explodingkittens
    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build

Läuft dann auf Port 8099 (`EXPLODINGKITTENS_PORT` in `.env` ändert das) und im Tunnel als
`http://explodingkittens:8080`. Die `.env` mit `TUNNEL_NETWORK` und `PARTY_SECRET` liegt nicht im Repo.
