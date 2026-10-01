# Phase 10

Phase 10 im Browser für Android, iOS und Desktop, im selben Stil wie die anderen
Spieleabend-Spiele. Zwei Spielarten:

- **Jeder sein Handy**: Einer erstellt einen Raum, die anderen scannen den QR-Code oder
  geben den 4-Buchstaben-Code ein. 2 bis 6 Spieler, weitere schauen zu. Braucht den Server.
- **Einzelspieler**: Allein gegen 1 bis 5 Computer-Gegner, ohne Server als einzelne
  HTML-Datei.

**Regeln wie im Original**: 108 Karten (1–12 in vier Farben je doppelt, 8 Joker, 4
Aussetzen), 10 Karten auf die Hand. Ziehen (Stapel oder Ablage, kein Aussetzen), Phase
auslegen, danach bei allen anlegen, eine Karte abwerfen. Wer keine Karten mehr hat,
beendet die Runde; Aussetzen: ab drei Spielern suchst du aus, wen es trifft (zu zweit
den Gegner). Wer seine Phase gelegt hat, darf Joker in ausgelegten Gruppen (auch bei den
anderen) gegen die echte Karte tauschen und den Joker selbst weiterverwenden; Strafpunkte 5 (1–9), 10 (10–12), 15 (Aussetzen), 25 (Joker). Wer
seine Phase gelegt hat, geht weiter. Wer zuerst Phase 10 (oder 5 in der kurzen Partie)
schafft, gewinnt, bei Gleichstand mit den wenigsten Punkten.

Die Phasen: 2 Drillinge · Drilling + 4er-Folge · Vierling + 4er-Folge · 7er-Folge ·
8er-Folge · 9er-Folge · 2 Vierlinge · 7 einer Farbe · Fünfling + Zwilling · Fünfling + Drilling.

- **Phasenleiter**: Links (am breiten Desktop) stehen alle Phasen untereinander, bei jeder die Avatare der Spieler, die gerade darauf sind, in der Farbe ihres Platzes (gleiche Farbe als Streifen an der Spielerkarte oben). Der Spieler am Zug leuchtet, ein Haken heißt: Phase liegt. Auf Handy und schmalem Fenster öffnet der Listen-Knopf oben die Leiter als Fenster.
- **Spielbrett**: Stapel und Ablage in der Mitte (mit Kartenhaufen), darunter deine
  Phasen-Felder, darunter die Hand. Die Gruppen der anderen liegen offen auf dem Brett.
- **Ziehen und Ablegen mit Maus oder Finger**: Karte vom Stapel oder der Ablage auf die
  Hand ziehen; Karten aus der Hand in die Phasen-Felder ziehen, sie rasten dort ein (auch
  schon vor dem Ziehen zum Planen) und lassen sich zurück in die Hand ziehen; auf die
  Ablage ziehen zum Abwerfen; auf eine ausgelegte Gruppe ziehen zum Anlegen, auf einen Joker darin zum Tauschen. Passt
  kein Ziel, fliegt die Karte zurück. Antippen und Tasten gehen weiterhin. „Vorschlag“
  füllt die Felder automatisch, „Auslegen“ legt sie hin.
- **Animationen**: Gezogene, abgeworfene, ausgelegte und angelegte Karten fliegen sichtbar
  dorthin, wo sie hingehen, auch bei den Zügen der anderen; zu Rundenbeginn wird ausgeteilt.
- **Hausregeln**: Raus-Bonus (wer die Runde beendet,
  bekommt 10 Strafpunkte abgezogen), Zugzeit (45 s).
- **Tipp und Fortschritt**: Der Tipp-Button lässt die passende Karte oder den Stapel
  aufleuchten (Ziehen, Auslegen, Anlegen oder Abwerfen, wie der Profi-Computer es spielen würde).
  Über den Phasen-Feldern zeigt eine Leiste, wie viele Karten für die Phase schon in deiner Hand sind.
- **Computer-Gegner** in drei Stufen; sie sehen nur ihre eigene Hand.
- **Wie bei den anderen Spielen**: Warteraum mit Bereit und Revanche, Chat, Reaktionen,
  Avatare, Tisch-Designs, Bilanz, Spielverlauf mit Punkten pro Runde, Töne, Konfetti.
- **Am Computer**: D zieht vom Stapel, A von der Ablage, ←/→ wählt eine Karte, Enter
  wirft sie ab, P legt die Phase aus, S sortiert.

## Auf dem Server installieren

Vom Repo-Ordner aus (der Build braucht `../shared`):

    cd phase10
    echo TUNNEL_NETWORK=<netzwerk-von-cloudflared> > .env
    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build

Läuft dann auf Port 8086 (`PHASE10_PORT` in `.env` ändert das) und im Tunnel als
`http://phase10:8080`.

## Tests

    npm test
