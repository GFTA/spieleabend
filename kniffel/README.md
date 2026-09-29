# Kniffel

Kniffel im Browser für Android, iOS und Desktop, im Stil der anderen Spieleabend-Spiele.
Online mit eigenen Handys (Raum-Code und QR-Code) oder mit einem Handy für alle.
Nichts ist geheim: Alle sehen jeden Wurf, welche Würfel behalten werden und die Blöcke aller Mitspieler.
Das Würfelsystem (Würfel, Behalten, Wurf-Animation, Wurf-Anzeige) stammt aus Würfelpoker.

## Regeln

13 Runden lang würfelt jeder pro Zug bis zu **dreimal**. Nach jedem Wurf werden die Würfel
angetippt, die man **behalten** will, der Rest wird neu gewürfelt. Danach trägt man genau **ein
Feld** in seinen Block ein: Feld antippen (Vorschau der Punkte), nochmal antippen oder
**Eintragen** tippen. Passt nichts, streicht man ein Feld mit 0 Punkten.

| Oben | Unten |
| --- | --- |
| Einser bis Sechser: nur Würfel dieser Augenzahl zählen | Dreierpasch, Viererpasch: alle Augen · Full House 25 · Kleine Straße (4 in Folge) 30 · Große Straße (5 in Folge) 40 · Kniffel 50 · Chance: alle Augen |

Ab **63 Punkten** oben gibt es **35 Bonus**. Nach dem 13. Zug gewinnt, wer die meisten Punkte hat
(Gleichstand: alle mit den meisten). Danach Revanche oder zurück in den Warteraum.

**Hausregeln**: Kniffel-Bonus und Joker (jeder weitere Kniffel gibt 100, wenn im Kniffel-Feld 50
stehen; er muss zuerst ins obere Feld seiner Zahl, dann in ein freies unteres Feld, Full House und
Straßen zählen dann voll) · Zugzeit 30 Sekunden (nur online, danach wird das beste freie Feld eingetragen).
Dazu Computer-Gegner in drei Stärken, Avatare, Tisch-Designs, Würfelgröße, Emoji-Reaktionen, Chat
und Tastenkürzel am Computer (Leertaste würfeln, Enter eintragen, 1–5 behalten, H Tipp).

## Installation auf dem Mini-PC

```sh
cd spieleabend/kniffel
echo "TUNNEL_NETWORK=<netzwerk-von-cloudflared>" > .env   # nur mit Cloudflare-Tunnel
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
```

Ohne Tunnel reicht `docker compose up -d --build`. Im WLAN läuft das Spiel auf Port 8087
(`KNIFFEL_PORT` in `.env` ändert das), im Tunnel ist es `http://kniffel:8080`.
Für die Startseite fehlen dann noch Tunnel-Ingress und DNS-Eintrag für `kniffel.cool-kidz.net`.

## Entwicklung

```sh
npm install
npm test              # Regeln, Computer-Gegner, Server
npm start             # http://localhost:8080
npm run build:single  # dist/kniffel.html: „Ein Handy für alle“ als einzelne Datei
```
