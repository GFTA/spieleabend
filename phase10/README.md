# Phase 10

Phase 10 im Browser für Android, iOS und Desktop, im selben Stil wie die anderen
Spieleabend-Spiele. Zwei Spielarten:

- **Jeder sein Handy**: Einer erstellt einen Raum, die anderen scannen den QR-Code oder
  geben den 4-Buchstaben-Code ein. 2 bis 6 Spieler, weitere schauen zu. Braucht den Server.
- **Ein Gerät für alle**: Alle spielen am selben Gerät, zwischen zwei Menschen kommt ein
  Weitergabe-Bildschirm, damit keiner die Karten des anderen sieht. Allein gegen Computer
  geht auch, ohne Server als einzelne HTML-Datei.

**Regeln wie im Original**: 108 Karten (1–12 in vier Farben je doppelt, 8 Joker, 4
Aussetzen), 10 Karten auf die Hand. Ziehen (Stapel oder Ablage, kein Aussetzen), Phase
auslegen, danach bei allen anlegen, eine Karte abwerfen. Wer keine Karten mehr hat,
beendet die Runde; Strafpunkte 5 (1–9), 10 (10–12), 15 (Aussetzen), 25 (Joker). Wer
seine Phase gelegt hat, geht weiter. Wer zuerst Phase 10 (oder 5 in der kurzen Partie)
schafft, gewinnt, bei Gleichstand mit den wenigsten Punkten.

Die Phasen: 2 Drillinge · Drilling + 4er-Folge · Vierling + 4er-Folge · 7er-Folge ·
8er-Folge · 9er-Folge · 2 Vierlinge · 7 einer Farbe · Fünfling + Zwilling · Fünfling + Drilling.

- **Spielbrett**: Stapel und Ablage in der Mitte (mit Kartenhaufen), darunter deine
  Phasen-Felder, darunter die Hand. Die Gruppen der anderen liegen offen auf dem Brett.
- **Ziehen und Ablegen mit Maus oder Finger**: Karte vom Stapel oder der Ablage auf die
  Hand ziehen; Karten aus der Hand in die Phasen-Felder ziehen, sie rasten dort ein (auch
  schon vor dem Ziehen zum Planen) und lassen sich zurück in die Hand ziehen; auf die
  Ablage ziehen zum Abwerfen; auf eine eigene ausgelegte Gruppe ziehen zum Anlegen. Passt
  kein Ziel, fliegt die Karte zurück. Antippen und Tasten gehen weiterhin. „Vorschlag“
  füllt die Felder automatisch, „Auslegen“ legt sie hin.
- **Animationen**: Gezogene, abgeworfene, ausgelegte und angelegte Karten fliegen sichtbar
  dorthin, wo sie hingehen, auch bei den Zügen der anderen; zu Rundenbeginn wird ausgeteilt.
- **Hausregeln**: Aussetzen frei wählen (ab 3 Spielern), Zugzeit (45 s).
- **Computer-Gegner** in drei Stufen; sie sehen nur ihre eigene Hand.
- **Wie bei den anderen Spielen**: Warteraum mit Bereit und Revanche, Chat, Reaktionen,
  Avatare, Tisch-Designs, Bilanz, Spielverlauf mit Punkten pro Runde, Töne, Konfetti.
- **Am Computer**: D zieht vom Stapel, A von der Ablage, ←/→ wählt eine Karte, Enter
  wirft sie ab, P legt die Phase aus, S sortiert.

## Auf dem Mini-PC installieren

Vom Repo-Ordner aus (der Build braucht `../shared`):

    cd phase10
    echo TUNNEL_NETWORK=proxy > .env
    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build

Läuft dann auf Port 8086 (`PHASE10_PORT` in `.env` ändert das) und im Tunnel als
`http://phase10:8080`.

## Tests

    npm test
