# Carcassonne

Landschaftsplättchen legen, Gefolgsleute setzen, Punkte sammeln. Inoffizielle Umsetzung
des Grundspiels für den privaten Spieleabend (2–5 Spieler). **„Carcassonne“ ist eine Marke
von Hans im Glück** — dies ist keine offizielle Version.

- **Jeder sein Handy**: Raum per QR-Code/Link, Host startet. Bis 5 spielen mit, danach Zuschauer.
- **Einzelspieler**: Mensch plus 1–4 Computer-Gegner (Stufen Leicht / Normal / Profi). Kein Hot-Seat.
- **Zug**: Plättchen ziehen → anlegen (Kanten passen, drehen ok) → optional 1 Gefolgsmann auf ein
  freies Merkmal dieses Plättchens → Wertung fertiger Straßen/Städte/Klöster.
- **Unlegbares Plättchen** wird abgelegt (sichtbar) und neu gezogen.
- **Spielende** (Stapel leer): Schlusswertung unfertiger Merkmale und Wiesen.

## Abweichungen vom Originalspiel

- Keine Wertungsleiste als physisches Brett — Punkte stehen bei den Spielernamen.
- Plättchen-Grafiken sind vereinfachte SVG-Darstellungen (keine Original-Illustrationen).
- Computer-Gegner nutzen eine Heuristik, keine vollständige Baumsuche.
- Mehrere Tisch-Designs und Revanche wie bei den anderen Spielen im Repo.
- Offizielle Plättchenverteilung (72 inkl. Start); Kontrollsummen in den Tests.

## Entwicklung

```sh
npm ci
npm test
npm start             # http://localhost:8080
```

| Datei | Inhalt |
| --- | --- |
| `public/game.js` | Regeln, Bots, Bot-Tempo (`botPlan`) |
| `public/app.js` | Oberfläche, Brett, Online |
| `public/index.html` | Layout |
| `server.js` | Adapter um `shared/room-server.js` |
