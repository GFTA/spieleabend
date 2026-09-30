# Sudoku

Klassisches Sudoku im Browser für Android, iOS und Desktop, im selben Stil wie die anderen
Spieleabend-Spiele. Zwei Spielarten:

- **Jeder sein Handy**: Einer erstellt einen Raum, die anderen scannen den QR-Code oder
  geben den 4-Buchstaben-Code ein. Alle bekommen **dasselbe** Rätsel und füllen ihr eigenes
  Gitter — wer zuerst die richtige Lösung abgibt, gewinnt (Zeit zählt). Bis zu 8 Spieler,
  weitere schauen zu. Braucht den Server.
- **Einzelspieler**: allein oder gegen Computer-Gegner am selben Gerät, ohne Server.

**Ablauf**: Tippe ein leeres Feld an und setze 1–9. „Notiz“ schaltet Bleistift-Markierungen.
„Fertig“ prüft deine Lösung; falsch zählt als Fehlversuch, richtig beendet die Runde.
Wer das letzte Feld richtig setzt, ist ebenfalls fertig. Schwierigkeit Leicht / Normal / Schwer
bestimmt, wie viele Zahlen vorgegeben sind und wie schnell Computer-Gegner füllen.

- **Privat**: Im Mehrspieler siehst du nur dein Gitter; die anderen nur deinen Fortschritt.
- **Computer-Gegner** füllen nach und nach richtige Zellen und geben ab, wenn sie fertig sind.
- **Wie bei den anderen Spielen**: Warteraum mit Bereit und Revanche, Chat, Reaktionen,
  Avatare, Tisch-Designs, Bilanz, Töne, Konfetti.

## Auf dem Server installieren

Vom Repo-Ordner aus (der Build braucht `../shared`):

    cd sudoku
    echo TUNNEL_NETWORK=<netzwerk-von-cloudflared> > .env
    # PARTY_SECRET wie bei den anderen Spielen ergänzen
    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build

Läuft dann auf Port 8089 (`SUDOKU_PORT` in `.env` ändert das) und im Tunnel als
`http://sudoku:8080`.

## Tests

    npm test
