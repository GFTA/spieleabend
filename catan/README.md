# Catan

Siedeln, handeln, bauen: Wer zuerst 10 Siegpunkte hat, gewinnt. Ein Spieleabend-Spiel: Warteraum, Raum-Code mit QR, Zuschauer, Chat,
Computer-Gegner, Avatare und Tisch-Designs kommen aus `../shared/`, siehe
[`ARCHITECTURE.md`](../ARCHITECTURE.md).

Das Grundspiel für 2–4 Personen: Sechseckbrett mit Häfen, Straßen, Siedlungen und Städte, Räuber, Entwicklungskarten, Längste
Handelsstraße und Größte Rittermacht. Wer in seinem Zug die Siegpunkte (8, 10 oder 12) erreicht, gewinnt. Teile setzt man per
Antippen eines leuchtenden Platzes oder zieht sie aufs Brett (Maus und Touch); der Räuber lässt sich ebenfalls ziehen.

- `public/game.js`: Regeln, Brettaufbau (seedbar), Aufbauphase, Würfeln, 7er-Ablauf, Bank- und Spielerhandel, Entwicklungskarten, Wertung, Computer-Gegner (`botPlan`/`botMove`, drei Stärken) und `view`
- `public/board.js`: SVG-Brett (Felder, Zahlen, Häfen, Teile, Räuber, Zielpunkte für Drag & Drop)
- `public/fx.js`: Warteschlange für Würfel, Kartenflüge und Banner; der Zustand ist schon final, die Warteschlange taktet nur die Animation
- `public/sheets.js`: Handeln, Karten, Abgeben, Wahl des Räuber-Opfers
- `public/app.js`: Tisch, Dock mit Handkarten und Teilen, Ziehen/Antippen, Einzelspieler-Bots
- `server.js`: Raum-Einstellungen; Angebote laufen mit Frist (`turnClock`)
- `test/`: Regeln, Bots, feindliche Eingaben, Zeitabläufe, ein Durchlauf über WebSockets

Abweichungen vom Brettspiel: keine 5–6-Spieler-Erweiterung; ein offenes Angebot gleichzeitig ohne Gegenangebote, wer anbietet, wählt
unter den Zusagen aus (25 s Frist); alle geben bei einer 7 gleichzeitig ab; den Sieg prüft das Spiel nur im eigenen Zug.

## Starten

    cd catan
    npm ci && npm start          # http://localhost:8080 (PORT ändert das)
    npm test

Auf dem Server, vom Repo-Ordner aus (der Build braucht `../shared`):

    cd catan
    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build

Läuft dann auf Port 8101 (`CATAN_PORT` in `.env` ändert das) und im Tunnel als
`http://catan:8080`. Die `.env` mit `TUNNEL_NETWORK` und `PARTY_SECRET` liegt nicht im Repo.
