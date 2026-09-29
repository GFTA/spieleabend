# @@TITLE@@

@@DESC@@ Ein Spieleabend-Spiel: Warteraum, Raum-Code mit QR, Zuschauer, Chat,
Computer-Gegner, Avatare und Tisch-Designs kommen aus `../shared/`, siehe
[`ARCHITECTURE.md`](../ARCHITECTURE.md).

Erzeugt mit `scripts/new-game`. Das Beispielspiel ist „Pig“ (würfeln oder halten, eine 1
löscht die Punkte dieser Runde); die Regeln stehen in `public/game.js`, die Oberfläche in
`public/app.js` und `public/index.html`.

## Was du ersetzt, um daraus dein Spiel zu machen

- `public/game.js`: Regeln, `newGame`, `act`, `botMove`, `view` (reines JS, läuft im Browser und im Server)
- `server.js`: welche Einstellungen ein Raum hat (`newRoom`, `roomFields`, `settings`, `newGame`)
- `public/index.html`: Startbildschirm, Einstellungen im Warteraum, Spielregeln (`data-slot="rules"`), Tisch
- `public/app.js`: Tisch zeichnen (`renderGame`), Aktionen senden (`doAct`), Sounds und Animationen
- `public/icon.svg` plus `icon-180/192/512.png` (Platzhalter, ein Würfel) und `../start/public/@@ID@@.svg`
- `test/`: Regeln und einen Durchlauf über WebSockets

## Starten

    cd @@ID@@
    npm ci && npm start          # http://localhost:8080 (PORT ändert das)
    npm test

Auf dem Server, vom Repo-Ordner aus (der Build braucht `../shared`):

    cd @@ID@@
    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build

Läuft dann auf Port @@PORT@@ (`@@ENVPORT@@` in `.env` ändert das) und im Tunnel als
`http://@@ID@@:8080`. Die `.env` mit `TUNNEL_NETWORK` und `PARTY_SECRET` liegt nicht im Repo.
