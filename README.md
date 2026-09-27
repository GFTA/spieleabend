# Spieleabend

Browser-Spiele für Android, iOS und Desktop. Jedes Spiel geht auf zwei Arten:

- **Jeder sein Handy**: Einer erstellt einen Raum, die anderen scannen den QR-Code.
  Dafür läuft ein kleiner Node.js-Server, z. B. zu Hause auf einem Mini-PC.
- **Ein Handy für alle**: Das Handy wird herumgereicht, zwischen den Zügen kommt ein
  Sichtschutz. Geht auch ganz ohne Server.

| Spiel | Ordner | Details |
| --- | --- | --- |
| Uno („Pass-Uno“) | [`uno/`](uno/) | 2–10 Spieler, Hausregeln, Computer-Gegner, Avatare, Tisch-Designs |
| Schiffe versenken | [`schiffe/`](schiffe/) | 2–4 Spieler, Felder von 5×5 (Swiftplay) bis 16×16, Sonderschiffe, Teams, Spezialwaffen, Computer-Gegner, Avatare, Tisch-Designs · Port 8081 |
| Vier gewinnt | [`viergewinnt/`](viergewinnt/) | 2 Spieler plus Zuschauer, Felder 7×6 bis 10×8, Pop Out, 5 gewinnt, Computer-Gegner, Avatare, Tisch-Designs · Port 8082 |

Alle Spiele auf einen Blick: **https://games.cool-kidz.net** (Ordner [`start/`](start/)).

Jedes Spiel ist ein eigenständiger Ordner mit eigenem Server, Dockerfile und Tests.

## Installation auf dem Mini-PC (Docker)

```sh
git clone https://github.com/GFTA/spieleabend.git
cd spieleabend/uno
docker compose up -d --build
```

Läuft schon ein `cloudflared`-Container (Cloudflare-Tunnel), stattdessen:

```sh
echo "TUNNEL_NETWORK=<netzwerk-von-cloudflared>" > .env
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
```

Update: `git pull` im Repo, dann denselben `docker compose … up -d --build` im Spiel-Ordner.
Alles Weitere steht in der README des jeweiligen Spiels.

„Uno“ ist eine Marke von Mattel. Dieses Projekt ist eine inoffizielle Umsetzung für
den privaten Spieleabend.
