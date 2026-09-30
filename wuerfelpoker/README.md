# Würfelpoker

Würfelpoker im Browser für Android, iOS und Desktop, im Stil von Uno und Schiffe
versenken. Online mit eigenen Handys (Raum-Code und QR-Code) oder mit einem Handy für alle.
Nichts ist geheim: Alle sehen jeden Wurf mit und live, welche Würfel behalten werden.

## Regeln

Wer dran ist, hat bis zu drei Würfe. Nach jedem Wurf werden die Würfel angetippt, die man
**behalten** will, der Rest wird neu gewürfelt; mit **Fertig** hört man früher auf. Sind alle
dran gewesen, gewinnt die beste Hand die Runde (Gleichstand: alle mit derselben Hand).
Gespielt wird bis 3, 5 oder 7 Siege oder eine einzelne Runde.

Rangfolge, beste zuerst: Fünfling · Vierling · Full House · Große Straße (2–6) ·
Kleine Straße (1–5) · Drilling · Zwei Paare · Ein Paar · Nichts. Bei gleicher Hand
entscheiden die höheren Augen, danach die Beizahlen.

**Wer dran ist**, sieht, welche Hand zu schlagen ist, und live die Chance, mit dem nächsten Wurf
besser zu werden oder den Führenden zu schlagen (ändert sich mit jedem behaltenen Würfel).
Die Rangfolge im Menü zeigt die Wahrscheinlichkeit jeder Hand und folgt den Hausregeln.

**Hausregeln**: Der Erste gibt die Würfe vor · Straße schlägt Full House · Stechen bei Gleichstand · Zugzeit 30 Sekunden
(nur online). Dazu Computer-Gegner in drei Stärken, Avatare, Tisch-Designs, Würfelgröße,
Emoji-Reaktionen und Tastenkürzel am Computer (Leertaste würfeln, Enter fertig, 1–5 behalten,
H Tipp).

## Installation auf dem Server

```sh
cd spieleabend/wuerfelpoker
echo "TUNNEL_NETWORK=<netzwerk-von-cloudflared>" > .env   # nur mit Cloudflare-Tunnel
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
```

Ohne Tunnel reicht `docker compose up -d --build`. Im WLAN läuft das Spiel auf Port 8083
(`WUERFEL_PORT` in `.env` ändert das), im Tunnel ist es `http://wuerfelpoker:8080`.

## Entwicklung

```sh
npm install
npm test              # Regeln, Computer-Gegner, Server
npm start             # http://localhost:8080
npm run build:single  # dist/wuerfelpoker.html: „Ein Handy für alle“ als einzelne Datei
```
