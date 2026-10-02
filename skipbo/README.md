# Skip-Bo

Skip-Bo für den Spieleabend: allein gegen den Computer oder online mit Raum-Code, 2 bis 6 Spieler plus
Zuschauer. Warteraum, Reaktionen, Avatare und Tisch-Designs kommen aus `../shared/`, siehe
[`ARCHITECTURE.md`](../ARCHITECTURE.md).

- **Karten**: 162 Stück, je 12 mal die 1 bis 12 und 18 Skip-Bo-Joker. Ein Joker steht für die Zahl, die der Haufen gerade braucht.
- **Vorratsstapel**: 30 Karten bei 2 bis 4 Spielern, 20 ab 5 Spielern. Einstellbar: „Mittel“ (20) und „Kurz“ (10). Die oberste Karte ist offen, wer den Stapel zuerst leer spielt, gewinnt die Runde.
- **Zug**: bis auf fünf Handkarten nachziehen, beliebig viele Karten legen (Hand, Vorrat, oberste Karte der eigenen Ablagestapel) und zum Schluss eine Handkarte auf einen von vier eigenen Ablagestapeln legen. Sind alle Handkarten gelegt, gibt es sofort fünf neue und der Zug geht weiter.
- **Bauhaufen**: vier Haufen in der Mitte wachsen von 1 bis 12. Ein voller Haufen wird abgeräumt und später in den Nachziehstapel gemischt.
- **Spiel**: eine Runde, bis 2 oder bis 3 Siege.
- **Bedienung**: Karten mit Maus oder Finger auf einen Haufen (oder Handkarten auf die Ablage) ziehen. Oder antippen, dann den Haufen antippen; zweites Antippen spielt die Karte automatisch auf den ersten passenden Haufen.
- **Computer**: Leicht, Normal und Profi. Normal spielt zuerst den Vorrat und baut Ketten dorthin, Profi spart Joker auf und füttert keine Gegner kurz vor dem Sieg.

## Abweichungen von den Originalregeln

- Vorratsgröße nach Spielerzahl und einstellbar, bis 6 Spieler; ein Haufen wird bei der 12 sofort abgeräumt.
- Ist der Nachziehstapel leer und liegen keine abgeräumten Haufen mehr bereit, passt, wer keine Handkarten hat. Nach zwei Runden reihum ohne gelegte Karte endet die Runde, der kleinste Vorrat gewinnt.
- Wer aufgibt, übergibt die Runde an den Spieler mit dem kleinsten Vorrat.

## Entwicklung

    cd skipbo
    npm ci && npm start          # http://localhost:8080 (PORT ändert das)
    npm test

| Datei | Inhalt |
| --- | --- |
| `public/game.js` | Regeln, Computer, Ansicht (`view`) |
| `public/app.js` | Tisch mit Ziehen und Tippen, Flug-Animationen, Online |
| `public/index.html` | Layout, Kartendesign und Spielregeln |
| `server.js` | Adapter um `shared/room-server.js` |
| `test/` | Regeln, Computer, feindliche Eingaben, Zeit und ein Durchlauf über WebSockets |

## Auf dem Server

Vom Repo-Ordner aus (der Build braucht `../shared`):

    cd skipbo
    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build

Läuft dann auf Port 8097 (`SKIPBO_PORT` in `.env` ändert das) und im Tunnel als
`http://skipbo:8080`. Die `.env` mit `TUNNEL_NETWORK` und `PARTY_SECRET` liegt nicht im Repo.
