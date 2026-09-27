# Spieleabend – Startseite

Eine Übersichtsseite mit allen Spielen (`games.cool-kidz.net`). Pro Spiel gibt es einen
Knopf zum Spielen, ein Feld für den Raum-Code (springt direkt in den Raum) und eine
Live-Anzeige, ob der Spiel-Server läuft und wie viele Räume offen sind.

Die Spiele stehen in [`games.json`](games.json). Ein neues Spiel ist ein neuer Eintrag
(Name, Beschreibung, öffentliche Adresse, interne Status-Adresse im Docker-Netzwerk) plus
ein Icon `public/<id>.svg`.

`games.json` und `public/` werden per Volume live aus dem Repo gelesen: Nach einem `git pull`
steht ein neues Spiel sofort auf der Seite, ohne Rebuild (nur einmal nach dieser Umstellung
braucht es `up -d --build`).

## Starten

Auf dem Mini-PC, im selben Docker-Netzwerk wie `cloudflared`, `pass-uno`, `schiffe`, `viergewinnt`, `wuerfelpoker` und `maedn`:

```sh
cd spieleabend/start
echo "TUNNEL_NETWORK=<netzwerk-von-cloudflared>" > .env
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
```

Im Tunnel zeigt `games.cool-kidz.net` auf `http://spiele-start:8080`. Im WLAN ist die Seite
unter Port 8090 erreichbar (`START_PORT` in `.env` ändert das). Keine Abhängigkeiten,
`npm test` prüft Seite und Status-Abfrage.
