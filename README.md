# Spieleabend

Browser-Spiele für Android, iOS und Desktop. Jedes Spiel geht auf zwei Arten:

- **Jeder sein Handy**: Einer erstellt eine Party, die anderen scannen den QR-Code oder öffnen den Link; der Host startet das Spiel.
  Dafür läuft ein kleiner Node.js-Server, z. B. auf einem eigenen Server.
- **Einzelspieler**: allein gegen Computer-Gegner, geht auch ganz ohne Server.

Alle Spiele teilen sich ein einheitliches Design- und Server-System (Tisch-Designs,
Avatare, Raum-Verwaltung, Deployment) — beschrieben in [`ARCHITECTURE.md`](ARCHITECTURE.md).
Das ist der Bauplan für jedes neue Spiel in diesem Repo. Arbeitsanweisung für Mitwirkende und KI-Agenten: [`AGENTS.md`](AGENTS.md). Ein neues Spiel legt
`scripts/new-game <id> "<Titel>"` aus einer lauffähigen Vorlage an.

| Spiel | Ordner | Details |
| --- | --- | --- |
| Uno | [`uno/`](uno/) | 2–10 Spieler plus Zuschauer, Hausregeln, Computer-Gegner, Avatare, Tisch-Designs |
| Schiffe versenken | [`schiffe/`](schiffe/) | 2–4 Spieler plus Zuschauer, Felder von 5×5 (Swiftplay) bis 16×16, Sonderschiffe, Teams, Spezialwaffen, Computer-Gegner, Avatare, Tisch-Designs · Port 8081 |
| Vier gewinnt | [`viergewinnt/`](viergewinnt/) | 2 Spieler plus Zuschauer, Felder 7×6 bis 10×8, Pop Out, 5 gewinnt, Computer-Gegner, Avatare, Tisch-Designs · Port 8082 |
| Galgenmännchen | [`hangman/`](hangman/) | 1–8 Spieler plus Zuschauer, deutsche Zufallswörter oder ein Mitspieler denkt sich eins aus, Computer-Gegner, Chat · Port 8085 |
| Phase 10 | [`phase10/`](phase10/) | 2–6 Spieler plus Zuschauer, alle 10 Phasen oder kurz bis Phase 5, Joker, Aussetzen, Anlegen, Computer-Gegner, Animationen · Port 8086 |
| Würfelpoker | [`wuerfelpoker/`](wuerfelpoker/) | 2–8 Spieler plus Zuschauer, alle sehen live, welche Würfel behalten werden, Computer-Gegner, Avatare, Tisch-Designs · Port 8083 |
| Kniffel | [`kniffel/`](kniffel/) | 2–8 Spieler plus Zuschauer, 13 Felder mit Bonus, optionaler Joker, Computer-Gegner, Avatare, Tisch-Designs · Port 8087 |
| Poker (Texas Hold’em) | [`poker/`](poker/) | 2–8 Spieler plus Zuschauer, No-Limit-Turnier mit Blinds und Side Pots, private Karten (Übergabe-Bildschirm bei einem Handy), Computer-Gegner, Avatare, Tisch-Designs · Port 8088 |
| Mensch ärgere dich nicht | [`maedn/`](maedn/) | 2–8 Spieler plus Zuschauer (ab 5 auf dem Sechser- oder Achter-Brett), elf Hausregeln (Schlagpflicht, Teams, Schnellstart …), Computer-Gegner, Avatare, Tisch-Designs · Port 8084 |
| Sudoku | [`sudoku/`](sudoku/) | 1–8 Spieler plus Zuschauer, gleiches Rätsel für alle, Wettrennen gegen die Uhr, drei Schwierigkeiten, Computer-Gegner, Avatare, Tisch-Designs · Port 8089 |
| Machi Koro | [`machikoro/`](machikoro/) | Stadt bauen mit Würfeln, 2–4 Spieler plus Zuschauer, Computer-Gegner · Port 8091 |
| Carcassonne | [`carcassonne/`](carcassonne/) | Landschaft legen, Gefolgsleute setzen · 2–5 Spieler plus Zuschauer, Computer-Gegner · Port 8093 |
| Dame | [`dame/`](dame/) | Deutsche Regeln mit Schlagzwang und fliegenden Damen, Ziehen per Drag & Drop, 2 Spieler plus Zuschauer, Computer-Gegner · Port 8094 |
| Schach | [`schach/`](schach/) | Alle Regeln (Rochade, en passant, Umwandlung), Ziehen per Drag & Drop, optional Schachuhr, 2 Spieler plus Zuschauer, Computer-Gegner · Port 8095 |

Alle Spiele auf einen Blick: **https://games.cool-kidz.net** (Ordner [`start/`](start/)).

Jedes Spiel ist ein eigener Ordner mit Engine, Oberfläche, Dockerfile und Tests; den Server-Teil (Räume, Warteraum, Revanche, Computer-Gegner …) teilen sich alle in `shared/room-server.js`.

## Installation auf dem Server (Docker)

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

## Lizenz

[MIT](LICENSE). Enthalten ist eine Kopie von `qrcode-generator` (ebenfalls MIT, Kazuhiko Arase) unter
`start/public/vendor/qrcode.js`. Die Schriften Bowlby One und Figtree lädt der Browser von Google Fonts.

Die Tests aller Spiele und der Startseite laufen bei jedem Push über GitHub Actions
(`.github/workflows/test.yml`); lokal: `npm test` im jeweiligen Ordner.

„Uno“ ist eine Marke von Mattel. Dieses Projekt ist eine inoffizielle Umsetzung für
den privaten Spieleabend.
