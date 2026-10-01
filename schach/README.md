# Schach

Schach mit allen Regeln für den Spieleabend: allein gegen den Computer, zu zweit an einem Gerät oder
online mit Raum-Code. Warteraum, Zuschauer, Reaktionen, Avatare und Tisch-Designs kommen aus `../shared/`,
siehe [`ARCHITECTURE.md`](../ARCHITECTURE.md).

- **Regeln**: Alle Züge inklusive Rochade, en passant und Umwandlung (Dame, Turm, Läufer oder Springer). Schach wird angezeigt, ein König im Schach muss gerettet werden.
- **Ende**: Matt gewinnt, Patt ist unentschieden. Ebenso dreimal dieselbe Stellung, 50 Züge ohne Bauernzug oder Schlag und zu wenig Material für ein Matt. Aufgeben geht jederzeit.
- **Hausregel „Schachuhr“**: 5 Minuten pro Spieler plus 3 Sekunden je Zug. Wer keine Zeit mehr hat, verliert.
- **Bedienung**: Figuren mit Maus oder Finger aufs Zielfeld ziehen (die Figur rastet ein oder springt zurück), oder Figur und Feld antippen. Mögliche Felder leuchten, geschlagene Figuren stehen unter den Namen, die Zugliste läuft in Standardnotation mit.
- **Einzelspieler**: Stufen Leicht, Normal, Profi und Zufällig. „Tipp“ zeigt den Zug, den der Computer spielen würde, „Zug zurück“ nimmt den eigenen Zug gegen den Computer zurück.
- **Computer**: Alpha-Beta-Suche mit Schlagsuche, Figurenwerten und Feldertabellen, mit etwas Zufall unter fast gleich guten Zügen.

## Entwicklung

    cd schach
    npm ci && npm start          # http://localhost:8080 (PORT ändert das)
    npm test

| Datei | Inhalt |
| --- | --- |
| `public/game.js` | Regeln, Zuggenerator, Bots, Tipp, Ansicht (`view`) |
| `public/app.js` | Brett mit Ziehen und Tippen, Zug-Animationen, Umwandlungs-Auswahl, Online |
| `public/index.html` | Layout, Figuren (SVG) und Spielregeln |
| `server.js` | Adapter um `shared/room-server.js` |
| `test/` | Zuggenerator (perft), Regeln und ein Durchlauf über WebSockets |

## Auf dem Server

Vom Repo-Ordner aus (der Build braucht `../shared`):

    cd schach
    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build

Läuft dann auf Port 8095 (`SCHACH_PORT` in `.env` ändert das) und im Tunnel als
`http://schach:8080`. Die `.env` mit `TUNNEL_NETWORK` und `PARTY_SECRET` liegt nicht im Repo.
