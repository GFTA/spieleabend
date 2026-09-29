# Poker (Texas Hold’em)

Texas Hold’em im Browser für Android, iOS und Desktop, im Stil der anderen Spieleabend-Spiele.
Online mit eigenen Handys (Raum-Code und QR-Code) oder mit einem Handy für alle
(mit Übergabe-Bildschirm, damit niemand fremde Karten sieht). Gespielt wird No Limit als Turnier:
Alle starten mit gleich vielen Chips, wer keine mehr hat, scheidet aus, und wer am Ende alle hat, gewinnt.

## Regeln

Jeder bekommt **zwei Karten** auf die Hand, dazu kommen **Flop** (3), **Turn** (1) und **River** (1)
auf den Tisch. Die Hand besteht aus den besten fünf der sieben Karten. Vor dem Flop und nach jeder
Karte wird gesetzt: **passen**, **checken**, **mitgehen**, **erhöhen** (Regler, Vorgaben Min / ½ Pot /
¾ Pot / Pot) oder **All-in**. Die zwei Spieler links vom Dealer (D) zahlen vorher Small und Big Blind;
zu zweit ist der Dealer der Small Blind. Die Mindesterhöhung ist so groß wie die letzte Erhöhung, eine zu
kleine All-in-Erhöhung eröffnet das Setzen nicht neu. Wer All-in ist, gewinnt nur so viel, wie er selbst
gesetzt hat; der Rest geht in **Nebenpots**. Sind alle All-in, werden die Karten aufgedeckt und die Tischkarten
einzeln ausgeteilt. Gleichstände werden geteilt.

Rangfolge, beste zuerst: Royal Flush / Straight Flush · Vierling · Full House · Flush · Straße · Drilling ·
Zwei Paare · Ein Paar · Hohe Karte.

**Startchips** 1.000, 2.000 oder 5.000 (Blinds 1 % / 2 %). **Hausregeln**: Blinds steigen (alle 8 Hände
doppelt so hoch) · Zugzeit 30 Sekunden (nur online, danach wird gecheckt oder gepasst). **Handstärke:** Unter den eigenen Karten zeigen fünf Punkte, wie gut die Hand inklusive Tischkarten ist (1–2 rot, 3 gelb, 4–5 grün); liegt die Hand nur am Tisch, zählt sie als 1. **Spannung:** Karten werden verteilt und umgedreht, Chips fliegen in den Pot und zum Gewinner, der Showdown deckt die Karten nacheinander auf, bei All-in gibt es einen Effekt und während der Tischkarten die Gewinnchancen in Prozent. Dazu Computer-Gegner
in drei Stärken (sie schätzen ihre Gewinnchance per Simulation und setzen nach Pot-Odds), Tipp-Knopf, Avatare,
Tisch-Designs, Kartengröße, Emoji-Reaktionen, Chat und Tastenkürzel am Computer (F passen, C/Leertaste
checken/mitgehen, R erhöhen, Enter bestätigen, H Tipp).

## Installation auf dem Server

```sh
cd spieleabend/poker
echo "TUNNEL_NETWORK=<netzwerk-von-cloudflared>" > .env   # nur mit Cloudflare-Tunnel
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
```

Ohne Tunnel reicht `docker compose up -d --build`. Im WLAN läuft das Spiel auf Port 8088
(`POKER_PORT` in `.env` ändert das), im Tunnel ist es `http://poker:8080`.

## Entwicklung

```sh
npm install
npm test              # Karten, Wetten, Side Pots, Computer-Gegner, Server
npm start             # http://localhost:8080
npm run build:single  # dist/poker.html: „Ein Handy für alle“ als einzelne Datei
```
