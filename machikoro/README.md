# Machi Koro

Bau deine Stadt mit Würfeln und Gebäuden — wer zuerst alle Wahrzeichen fertig hat, gewinnt. Allein gegen den Computer oder online mit Freunden. Ein Spieleabend-Spiel: Warteraum, Raum-Code mit QR, Zuschauer, Chat,
Computer-Gegner, Avatare und Tisch-Designs kommen aus `../shared/`, siehe
[`ARCHITECTURE.md`](../ARCHITECTURE.md).

## Regeln (Kurz)

- Start: Getreidefeld + Bäckerei, 3 Münzen, vier Wahrzeichen im Bau.
- Zug: Würfeln → Einkommen → ein Gebäude oder Wahrzeichen bauen (oder passen).
- Blau zahlt immer, Grün/Lila nur im eigenen Zug, Rot nimmt vom Würfelnden.
- Wahrzeichen: Bahnhof (1–2 Würfel), Einkaufszentrum (+1 bei Brot/Café), Freizeitpark (Extra-Zug bei Pasch), Funkturm (einmal neu würfeln).
- Wer zuerst alle vier Wahrzeichen fertig hat, gewinnt die Runde.

## Starten

    cd machikoro
    npm ci && npm start          # http://localhost:8080 (PORT ändert das)
    npm test

Auf dem Server, vom Repo-Ordner aus (der Build braucht `../shared`):

    cd machikoro
    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build

Läuft dann auf Port 8091 (`MACHIKORO_PORT` in `.env` ändert das) und im Tunnel als
`http://machikoro:8080`. Die `.env` mit `TUNNEL_NETWORK` und `PARTY_SECRET` liegt nicht im Repo.

## Abweichungen vom Originalspiel

- **Freizeitpark:** kein zweiter Extra-Zug in Folge nach einem Pasch. Ein Pasch mit fertigem Freizeitpark gibt einen Extra-Zug; aus diesem Extra-Zug heraus gibt es bei erneutem Pasch keinen weiteren Extra-Zug (kein Ketten-Pasch).

