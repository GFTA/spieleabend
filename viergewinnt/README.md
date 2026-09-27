# Vier gewinnt

Vier gewinnt im Browser für Android, iOS und Desktop, im selben Stil wie Pass-Uno und
Schiffe versenken. Zwei Spielarten:

- **Jeder sein Handy**: Einer erstellt einen Raum, der Gegner scannt den QR-Code (oder
  gibt den 4-Buchstaben-Code ein). Wer später kommt oder wenn beide Plätze belegt sind,
  schaut zu. Braucht den kleinen Server unten.
- **Ein Gerät für beide**: Beide spielen abwechselnd am selben Handy, Tablet oder
  Rechner. Geht auch allein gegen den Computer und ohne Server als einzelne HTML-Datei.

Wer dran ist, tippt auf eine Spalte, die Scheibe fällt bis ganz nach unten. Wer zuerst
vier in einer Reihe hat (waagerecht, senkrecht oder schräg), gewinnt. Ist das Brett
voll, ist es unentschieden. In jeder Runde beginnt der andere.

- **Spielfelder**: 7×6 (klassisch), 8×7 und 10×8. Spielziel: eine Runde, bis 2 oder bis
  3 Siege.
- **Hausregeln**: Pop Out (eigene Scheibe unten herausziehen, alles rutscht nach),
  5 gewinnt, Zugzeit (15 Sekunden, sonst Zufallszug).
- **Computer-Gegner** in drei Stufen: Leicht, Normal und Profi. Er rechnet mit Minimax
  und Alpha-Beta-Suche mehrere Züge voraus.
- **Wie bei den anderen Spielen**: Raum-Code mit QR, Zuschauer mit „Mitspielen“,
  Emoji-Reaktionen und Schnellnachrichten, Avatare, Tisch-Designs (Nacht, Filz, Ozean,
  Hell) und Brettgröße, Bilanz auf dem Startbildschirm, Spielverlauf im Menü, Töne,
  Vibration und Konfetti.
- **Am Computer**: breites Layout, beim Überfahren zeigt eine halbdurchsichtige Scheibe,
  wo sie landet. Tasten: 1–9 (0 für Spalte 10) wirft ein, ←/→ und Enter, P für Pop Out,
  Esc schließt Fenster.

## Auf dem Mini-PC installieren

Ein einzelnes Node.js-Programm (`server.js`) ohne Datenbank, Spielstände landen in
`data/rooms.json`. Läuft neben Uno (8080) und Schiffe versenken (8081) im WLAN auf
Port **8082**.

### Mit Docker (empfohlen)

```sh
git clone https://github.com/GFTA/spieleabend.git
cd spieleabend/viergewinnt
docker compose up -d --build
```

Aktualisieren: `git pull && docker compose up -d --build`.

### Über einen Cloudflare-Tunnel

Läuft schon ein `cloudflared`-Container, hängt sich das Spiel in dessen Netzwerk; im
Tunnel zeigt dann ein Hostname auf `http://viergewinnt:8080`.

```sh
echo "TUNNEL_NETWORK=<netzwerk-von-cloudflared>" > .env   # docker inspect cloudflared
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
```

Ist Port 8082 schon belegt, zusätzlich `VIER_PORT=8083` in `.env` eintragen.

### Ohne Docker (Linux mit systemd)

```sh
sudo mkdir -p /opt/viergewinnt
sudo cp -r server.js package.json package-lock.json public /opt/viergewinnt/
cd /opt/viergewinnt && sudo npm ci --omit=dev
sudo cp ~/spieleabend/viergewinnt/deploy/viergewinnt.service /etc/systemd/system/
sudo systemctl enable --now viergewinnt
```

Einstellungen über Umgebungsvariablen: `PORT` (Standard 8080), `HOST`, `DATA_DIR`,
`BOT_MS` (Bedenkzeit des Computers, Standard 1100 ms).

## Entwicklung

```sh
npm install
npm test              # Spielregeln, Computer-Gegner und Server-Protokoll
npm start             # http://localhost:8080
npm run build:single  # dist/viergewinnt.html: „Ein Gerät für beide“ als einzelne Datei
```

| Datei | Inhalt |
| --- | --- |
| `public/game.js` | Spielregeln und Computer-Gegner, läuft im Browser und auf dem Server |
| `public/app.js` | Oberfläche, Online-Verbindung |
| `public/index.html` | Layout und Stil |
| `server.js` | Webserver und WebSocket-Räume |
