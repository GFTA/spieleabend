# Galgenmännchen

Hangman mit deutschen Wörtern im Browser für Android, iOS und Desktop, im selben Stil wie
die anderen Spieleabend-Spiele. Zwei Spielarten:

- **Jeder sein Handy**: Einer erstellt einen Raum, die anderen scannen den QR-Code oder
  geben den 4-Buchstaben-Code ein. Bis zu 8 Spieler, weitere schauen zu. Braucht den Server.
- **Ein Gerät für alle**: Alle raten abwechselnd am selben Gerät, auch allein oder gegen
  Computer-Gegner, ohne Server als einzelne HTML-Datei.

**Wortwahl** (im Warteraum einstellbar):

- **Zufallswort**: ein deutsches Wort aus der eingebauten Liste (über 450 Wörter in 14
  Kategorien wie Tiere, Essen & Trinken, Berufe), die Kategorie steht als Hinweis dabei.
- **Ein Mitspieler**: jede Runde denkt sich ein zufällig gewählter Spieler ein Wort aus,
  jeder kommt etwa gleich oft dran, und rät in dieser Runde nicht mit. Optional mit
  Hinweis. Computer-Gegner nehmen ein Zufallswort.

**Spielablauf**: Wer dran ist, tippt einen Buchstaben (A–Z, Ä, Ö, Ü, ß). Kommt er vor,
gibt es einen Punkt pro Vorkommen und man ist nochmal dran, sonst wächst der Galgen und
der Nächste ist dran. „Wort lösen“ gibt einen Punkt pro noch verdecktem Buchstaben plus
3 Bonus, falsch zählt als Fehler. Nach 10 Fehlern hängt das Männchen und wer das Wort
ausgesucht hat, bekommt 5 Punkte. Nach 3, 5 oder 8 Runden gewinnt, wer die meisten Punkte hat.

- **Hausregeln**: Anfang und Ende (erster und letzter Buchstabe aufgedeckt), Schwer (nur
  6 Fehler), Zugzeit (20 Sekunden pro Tipp, 60 Sekunden zum Aussuchen).
- **Computer-Gegner** in drei Stufen. Sie sehen nur, was alle sehen, raten erst die häufigsten
  Buchstaben und erkennen das Wort erst, wenn ein guter Teil davon steht (Profi früher).
- **Wie bei den anderen Spielen**: Warteraum mit Bereit und Revanche, Chat, Reaktionen,
  Avatare, Tisch-Designs, Bilanz, Töne, Konfetti. Am Computer einfach Buchstaben tippen,
  Enter öffnet „Wort lösen“.

## Auf dem Server installieren

Vom Repo-Ordner aus (der Build braucht `../shared`):

    cd hangman
    echo TUNNEL_NETWORK=<netzwerk-von-cloudflared> > .env
    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build

Läuft dann auf Port 8085 (`HANGMAN_PORT` in `.env` ändert das) und im Tunnel als
`http://hangman:8080`.

## Tests

    npm test
