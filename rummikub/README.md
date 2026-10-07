# Rummikub

Rummikub für den Spieleabend: allein gegen den Computer oder online mit Raum-Code. Warteraum, Raum-Code mit QR, Zuschauer, Chat,
Computer-Gegner, Avatare und Tisch-Designs kommen aus `../shared/`, siehe
[`ARCHITECTURE.md`](../ARCHITECTURE.md).

- **Plättchen**: 106 Stück, je zweimal die Zahlen 1 bis 13 in vier Farben plus 2 Joker. Jeder bekommt 14.
- **Sätze**: eine Reihe (mindestens 3 Zahlen in Folge, eine Farbe, 13 und 1 hängen nicht zusammen) oder eine Gruppe (3 oder 4 gleiche Zahlen in verschiedenen Farben). Joker ersetzen jedes Plättchen.
- **Zug**: Plättchen vom Ständer auslegen und den Tisch beliebig umbauen, solange am Ende alles gültig ist, kein Plättchen vom Tisch fehlt und mindestens eins vom Ständer dazukam. Sonst auf den Vorrat tippen und ein Plättchen ziehen.
- **Erstes Auslegen**: mindestens 30 Punkte (einstellbar: 20 oder ohne Mindestwert), nur aus dem eigenen Ständer, der Tisch bleibt unberührt.
- **Rundenende**: Wer zuerst seinen Ständer leert, gewinnt und bekommt die Restpunkte der anderen, die anderen bekommen ihre eigenen als Minus (Joker 30). Ist der Vorrat leer und niemand kann mehr legen, gewinnt der kleinste Rest.
- **Spiel**: eine Runde, bis 2 oder bis 3 Siege. 2 bis 4 Spieler plus Zuschauer.
- **Bedienung**: Plättchen mit Maus oder Finger auf einen Satz, in den freien Platz („Neuer Satz“) oder zurück auf den Ständer ziehen. Oder antippen, dann das Ziel antippen. Der Zug gilt erst mit „Fertig“, „Zurück“ stellt den Tisch wie zu Beginn des Zuges her. Ungültige Sätze sind rot. Im Feld „Vorbereiten“ über dem Ständer kannst du neue Sätze schon planen, auch wenn die anderen dran sind; „Auslegen“ legt die gültigen davon auf den Tisch, „Fertig“ tut das auch von selbst. Der Schalter „123 / Regenbogen“ sortiert den Ständer nach Zahl oder Farbe (wie in Uno und Phase 10).
- **Computer**: Leicht (legt nur aus dem Ständer, zieht manchmal trotzdem), Normal (ergänzt Sätze auf dem Tisch) und Profi (baut den ganzen Tisch um, auch Joker-Tausch).

## Abweichungen von den Originalregeln

- Keine Zugzeit, kein Rückgängig nach „Fertig“.
- Beim Aufgeben gewinnt von den anderen der Spieler mit dem kleinsten Rest.

## Entwicklung

| Datei | Inhalt |
| --- | --- |
| `public/game.js` | Regeln (Sätze prüfen, ganzen Tisch prüfen), Computer-Suche, Ansicht (`view`) |
| `public/app.js` | Tisch mit Ziehen und Tippen, Arbeitskopie des Tisches, Flug-Animationen, Online |
| `public/index.html` | Layout, Plättchendesign und Spielregeln |
| `server.js` | Adapter um `shared/room-server.js` |
| `test/` | Regeln, Computer, feindliche Eingaben, Zeit und ein Durchlauf über WebSockets |

## Starten

    cd rummikub
    npm ci && npm start          # http://localhost:8080 (PORT ändert das)
    npm test

Auf dem Server, vom Repo-Ordner aus (der Build braucht `../shared`):

    cd rummikub
    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build

Läuft dann auf Port 8098 (`RUMMIKUB_PORT` in `.env` ändert das) und im Tunnel als
`http://rummikub:8080`. Die `.env` mit `TUNNEL_NETWORK` und `PARTY_SECRET` liegt nicht im Repo.
