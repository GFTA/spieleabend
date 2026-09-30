# Spieleabend – Startseite

Eine Übersichtsseite mit allen Spielen (`games.cool-kidz.net`). Pro Spiel gibt es einen
Knopf zum Spielen, Party-Code mit Teilen-Sheet (QR) und eine
Live-Anzeige, ob der Spiel-Server läuft und wie viele Räume offen sind.

**Party**: Einer erstellt eine Party (4-Buchstaben-Code oder Link), die anderen treten bei. Nur der
Host wählt das Spiel, dann landen alle automatisch im selben Raum (Name und Avatar wandern mit).
Hat die Party mehr Leute als das Spiel Plätze, spielen der Host und alle mit „Bereit“, die anderen
schauen zu. Im Spiel führt „Zurück zur Party“ wieder her. Dafür
braucht es `PARTY_SECRET` (derselbe Wert in der `.env` von Startseite und Spielen).

Die Spiele stehen in [`games.json`](games.json). Ein neues Spiel ist ein neuer Eintrag
(Name, Beschreibung, öffentliche Adresse, interne Status-Adresse im Docker-Netzwerk) plus
ein Icon `public/<id>.svg`.

`games.json` und `public/` werden per Volume live aus dem Repo gelesen: Nach einem `git pull`
steht ein neues Spiel sofort auf der Seite, ohne Rebuild (nur einmal nach dieser Umstellung
braucht es `up -d --build`).

## Starten

Auf dem Server, im selben Docker-Netzwerk wie `cloudflared`, `pass-uno`, `schiffe`, `viergewinnt`, `wuerfelpoker` und `maedn`:

```sh
cd spieleabend/start
echo "TUNNEL_NETWORK=<netzwerk-von-cloudflared>" > .env
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
```

Im Tunnel zeigt `games.cool-kidz.net` auf `http://spiele-start:8080`. Im WLAN ist die Seite
unter Port 8090 erreichbar (`START_PORT` in `.env` ändert das). Keine Abhängigkeiten,
`npm test` prüft Seite, Status-Abfrage und Party-Logik.
