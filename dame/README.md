# Dame

Dame nach deutschen Regeln für den Spieleabend: allein gegen den Computer, zu zweit an einem Gerät oder
online mit Raum-Code. Warteraum, Zuschauer, Reaktionen, Avatare und Tisch-Designs kommen aus `../shared/`,
siehe [`ARCHITECTURE.md`](../ARCHITECTURE.md).

- **Brett und Steine**: 8×8, jeder Spieler 12 Steine auf den dunklen Feldern, Weiß beginnt. Männer ziehen schräg vorwärts und schlagen auch rückwärts. Damen ziehen und schlagen über beliebig viele Felder („fliegende Dame“).
- **Schlagzwang** mit Pflicht zum Weiterspringen im selben Zug. Gesprungene Steine bleiben bis zum Zugende liegen, keiner wird zweimal übersprungen. Ein Mann, der die letzte Reihe erreicht, wird Dame und beendet damit den Zug.
- **Ende**: Wer keinen Stein oder keinen Zug mehr hat, verliert. Unentschieden bei dreimal derselben Stellung oder 50 Zügen ohne Schlag und ohne Männerzug. Aufgeben geht jederzeit.
- **Hausregeln**: „Ohne Schlagzwang“ und „Zugzeit“ (30 Sekunden, danach zieht das Spiel zufällig).
- **Bedienung**: Steine mit Maus oder Finger aufs Zielfeld ziehen (Auswahl rastet ein oder springt zurück), oder Stein und Feld antippen. Mehrfachsprünge geht Feld für Feld oder direkt aufs Endfeld. Leuchtende Steine zeigen, welche schlagen müssen.
- **Einzelspieler**: Stufen Leicht, Normal, Profi und Zufällig. „Tipp“ zeigt den Zug, den der Computer spielen würde (auch online), „Zug zurück“ nimmt den eigenen Zug gegen den Computer zurück.
- **Computer**: Alpha-Beta-Suche mit Schlagsuche, Materialbewertung und Zufall unter fast gleich guten Zügen. Profi rechnet unter einer halben Sekunde pro Zug.

## Entwicklung

    cd dame
    npm ci && npm start          # http://localhost:8080 (PORT ändert das)
    npm test

| Datei | Inhalt |
| --- | --- |
| `public/game.js` | Regeln, Zuggenerator, Bots, Tipp, Ansicht (`view`) |
| `public/app.js` | Brett mit Ziehen und Tippen, Zug-Animationen, Online |
| `public/index.html` | Layout und Spielregeln |
| `server.js` | Adapter um `shared/room-server.js` |
| `test/` | Regeln und ein Durchlauf über WebSockets |

## Auf dem Server

Vom Repo-Ordner aus (der Build braucht `../shared`):

    cd dame
    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build

Läuft dann auf Port 8094 (`DAME_PORT` in `.env` ändert das) und im Tunnel als
`http://dame:8080`. Die `.env` mit `TUNNEL_NETWORK` und `PARTY_SECRET` liegt nicht im Repo.
