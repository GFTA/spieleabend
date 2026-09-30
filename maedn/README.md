# Mensch ärgere dich nicht

Mensch ärgere dich nicht im Browser für Android, iOS und Desktop, im selben Stil wie
die anderen Spiele im Repo. Zwei Spielarten:

- **Jeder sein Handy**: Einer erstellt einen Raum, die anderen scannen den QR-Code (oder
  geben den 4-Buchstaben-Code ein). Bis zu 8 spielen mit, wer später kommt, schaut zu.
  Braucht den kleinen Server unten.
- **Ein Gerät für alle**: 2 bis 8 Spieler reichen ein Handy, Tablet oder den Rechner
  herum, freie Plätze übernimmt der Computer. Geht auch ohne Server als einzelne HTML-Datei.

Tippe auf den Würfel. Mit einer 6 kommt eine Figur aus dem Haus, danach geht es einmal
ums Brett und in dein Ziel. Wer auf einer fremden Figur landet, wirft sie raus. Wer
zuerst alle vier Figuren im Ziel hat, gewinnt. Zu zweit sitzt ihr euch gegenüber
(Rot gegen Grün). Ab 5 Spielern wächst das Brett: 5 bis 6 spielen auf einem Brett mit
sechs Armen (60 Felder), 7 bis 8 auf einem mit acht Armen (80 Felder), jeweils mit
den Farben Rot, Blau, Grün, Gelb, Lila, Türkis, Orange und Rosa.

- **Spielziel**: „Erster gewinnt“ oder „Alle Plätze“ (weiterspielen bis zum letzten Platz).
- **Grundregeln**: Rauskommen und das Startfeld räumen sind Pflicht, nach einer 6 wird
  nochmal gewürfelt, im Ziel muss man genau treffen und darf nicht über eigene Figuren
  springen.
- **Hausregeln** (einzeln zuschaltbar): Dreimal würfeln (Standard an), Schlagpflicht,
  Startfeld ist sicher, Freie Wahl bei der 6, Raus mit 1 oder 6, Schnellstart (eine Figur
  steht schon draußen), Im Ziel überspringen, Nach dem Schlagen nochmal, Ziel = nochmal (auch eine Figur im Ziel bringt einen weiteren Wurf), Drei Sechsen
  (die dritte verfällt), Teams (zu viert, Gegenüber spielen zusammen, wer fertig ist,
  würfelt für den Partner) und Zugzeit (20 Sekunden).
- **Tipp und Zughilfe**: Der Tipp-Button lässt die beste Figur aufleuchten und sagt, warum
  (er rechnet wie der Profi-Computer). Die Zughilfe (Menü, Spiel-Einstellungen, nur für dich)
  markiert am Zielring jedes möglichen Zugs, ob die Figur dort sicher steht, bedroht ist,
  schlägt oder ins Ziel kommt.
- **Computer-Gegner** in drei Stufen. Er wägt jeden Zug ab: rauswerfen, rauskommen,
  ins Ziel ziehen, und ab „Normal“ auch, wie gefährdet eine Figur danach steht.
- **Online**: Wer mitten im Spiel den Raum verlässt, wird vom Computer ersetzt, das Spiel
  läuft weiter. Wer aufgibt, landet auf dem letzten Platz.
- **Wie bei den anderen Spielen**: Raum-Code mit QR, Zuschauer mit „Mitspielen“,
  Emoji-Reaktionen und Schnellnachrichten, Avatare, Tisch-Designs (Nacht, Filz, Ozean,
  Hell) und Brettgröße, Bilanz auf dem Startbildschirm, Spielverlauf im Menü, Töne,
  Vibration und Konfetti. Figuren laufen Feld für Feld, geschlagene fliegen zurück ins Haus.
- **Am Computer**: breites Layout. Leertaste würfelt, 1–4 oder ←/→ und Enter ziehen,
  Esc schließt Fenster.

## Auf dem Server installieren

Ein einzelnes Node.js-Programm (`server.js`) ohne Datenbank, Spielstände landen in
`data/rooms.json`. Läuft neben den anderen Spielen im WLAN auf Port **8084**, über den
Cloudflare-Tunnel unter **https://mensch.cool-kidz.net**.

### Mit Docker (empfohlen)

```sh
git clone https://github.com/GFTA/spieleabend.git
cd spieleabend/maedn
docker compose up -d --build
```

Aktualisieren: `git pull && docker compose up -d --build`.

### Über einen Cloudflare-Tunnel

Läuft schon ein `cloudflared`-Container, hängt sich das Spiel in dessen Netzwerk; im
Tunnel zeigt dann ein Hostname auf `http://maedn:8080`.

```sh
echo "TUNNEL_NETWORK=<netzwerk-von-cloudflared>" > .env   # docker inspect cloudflared
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
```

Ist Port 8084 schon belegt, zusätzlich `MAEDN_PORT=8085` in `.env` eintragen.

### Ohne Docker (Linux mit systemd)

```sh
sudo mkdir -p /opt/maedn
sudo cp -r server.js package.json package-lock.json public /opt/maedn/
cd /opt/maedn && sudo npm ci --omit=dev
sudo cp ~/spieleabend/maedn/deploy/maedn.service /etc/systemd/system/
sudo systemctl enable --now maedn
```

Einstellungen über Umgebungsvariablen: `PORT` (Standard 8080), `HOST`, `DATA_DIR`,
`BOT_MS` (Bedenkzeit des Computers, Standard 1100 ms).

## Entwicklung

```sh
npm install
npm test              # Spielregeln, Hausregeln, Computer-Gegner und Server-Protokoll
npm start             # http://localhost:8080
npm run build:single  # dist/maedn.html: „Ein Gerät für alle“ als einzelne Datei
```

| Datei | Inhalt |
| --- | --- |
| `public/game.js` | Spielregeln und Computer-Gegner, läuft im Browser und auf dem Server |
| `public/app.js` | Oberfläche, Brett, Online-Verbindung |
| `public/index.html` | Layout und Stil |
| `server.js` | Webserver und WebSocket-Räume |
