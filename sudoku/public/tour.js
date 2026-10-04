// Tutorial steps for Sudoku (engine: shared/tutorial.js)
Tutorial.define({
  seed: 0,
  opponents: 0,
  game: (a) => [a[0], undefined, 1],
  steps: [
    { title: "Sudoku in einer Minute", text: "Fülle das Gitter mit den Zahlen <b>1 bis 9</b>, sodass in jeder Zeile, jeder Spalte und jedem 3×3-Block jede Zahl genau einmal vorkommt. Gleich startet ein Übungsrätsel." },
    { target: "#grid", text: "Das <b>Gitter</b>. Die dunklen Zahlen sind vorgegeben, die leeren Felder füllst du aus." },
    { target: "#grid button:not(.given)", wait: "tap", text: "Tippe ein <b>leeres Feld</b> an. Zeile, Spalte und Block werden hervorgehoben, so siehst du, welche Zahlen dort schon vorkommen." },
    { target: "#pad", place: "top", wait: "tap", text: "Tippe jetzt eine <b>Zahl</b> im Zahlenfeld. Sie landet im gewählten Feld. Auf dem Computer geht auch die Tastatur. Falsche Zahlen werden rot markiert." },
    { target: "#noteBtn", place: "top", text: "Unsicher? Mit <b>Notiz</b> schreibst du kleine Bleistift-Zahlen in ein Feld, ohne dich festzulegen. <b>Löschen</b> entfernt eine Zahl." },
    { target: "#submitBtn", place: "top", text: "Sind alle Felder gefüllt, gibst du mit <b>Fertig</b> ab. Ist die Lösung falsch, kostet das einen Fehlversuch und das Rätsel läuft weiter." },
    { target: "#timer", text: "Die <b>Zeit</b> läuft mit. Gegen andere im Wettrennen gewinnt, wer zuerst die richtige Lösung abgibt." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Löse das Rätsel einfach in Ruhe zu Ende. Viel Spaß!" }
  ]
});
