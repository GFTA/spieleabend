# Activity

Zeichnen, Erklären, Pantomime: errate die Begriffe der anderen. Ein Spieleabend-Spiel: Warteraum, Raum-Code mit QR, Zuschauer, Chat,
Computer-Gegner, Avatare und Tisch-Designs kommen aus `../shared/`, siehe
[`ARCHITECTURE.md`](../ARCHITECTURE.md).

Reihum bekommt jemand einen Begriff und stellt ihn **zeichnend**, **erklärend** oder **pantomimisch** dar (die Spielart
wird ausgelost, im Warteraum lassen sich Spielarten, Zeit pro Begriff, Länge und Computer-Stärke einstellen). Alle anderen
tippen ihre Ideen; Umlaute, Groß-/Kleinschreibung, Artikel und kleine Tippfehler sind egal. Punkte gibt es nach Schwierigkeit
und Tempo, wer darstellt, bekommt Punkte für jeden Rater. Nach 50 % und 75 % der Zeit wird je ein Buchstabe verraten.

- `public/game.js`: Regeln, Wortlisten (drei Schwierigkeiten je Spielart), Raten (`match`), Computer-Tipps (`botPlan`/`botMove`), Zeichen-Ops (`draw`), `view`
- `server.js`: Raum-Einstellungen und die Zeichen-Nachrichten: Striche gehen nicht durch den normalen Zustand, die Person am Zug schickt kleine Pakete (`draw`), der Server prüft sie und gibt sie an alle anderen weiter (`drawsync` holt die ganze Zeichnung nach)
- `public/app.js`: Tisch, Zeichenfläche (Pointer Events, logische Koordinaten 1000×750), Uhr und Computer im Einzelspielermodus
- Computer-Gegner raten nur mit und stellen nie etwas dar; allein ist man dreimal pro Durchgang dran
- `test/`: Regeln, Wortgeheimnis, Zeichen-Weitergabe, feindliche Eingaben, ein Durchlauf über WebSockets

## Starten

    cd activity
    npm ci && npm start          # http://localhost:8080 (PORT ändert das)
    npm test

Auf dem Server, vom Repo-Ordner aus (der Build braucht `../shared`):

    cd activity
    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build

Läuft dann auf Port 8100 (`ACTIVITY_PORT` in `.env` ändert das) und im Tunnel als
`http://activity:8080`. Die `.env` mit `TUNNEL_NETWORK` und `PARTY_SECRET` liegt nicht im Repo.
