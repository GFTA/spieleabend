# Monopoly

Monopoly für 2–6 Spieler (Mensch oder Computer), lokal oder online im Raum. Die Regeln liegen in `public/game.js` (ohne DOM), `public/fx.js` steuert die Animationen.

## Hausregeln (in der Lobby einstellbar)
- **Doppelt auf LOS:** Wer genau auf LOS landet, bekommt 400 statt 200 (Standard: an).
- **Frei Parken:** Steuern und Gebühren landen im Topf, wer auf Frei Parken landet, bekommt ihn (Standard: aus).
- **Versteigerung:** Wer nicht kauft, löst eine Versteigerung aus (Standard: an).
- Startgeld und Zuglimit (Standard 40 Züge pro Spieler) sind wählbar. Bei Limit gewinnt das höchste Vermögen.

## Abweichungen vom Brettspiel
- Pleite an die Bank: Grundstücke werden wieder frei. Pleite an einen Spieler: Häuser werden entfernt, Hypotheken bleiben.
- Keine 10 % Gebühr beim Tausch hypothekarisch belasteter Grundstücke.
- „Alle zahlen“-Karten: Wer nicht zahlen kann, gibt ab, was er hat.
- Computer bieten nur Tausche an, die ihnen die letzte Straße einer Farbgruppe bringen. Gebäude in einer Gruppe blockieren Tausche.
- Nur Computer mit „Ohne Limit“ können ewig weiterspielen, deshalb gilt standardmäßig das Zuglimit.
