// Tutorial steps for Kniffel (engine: shared/tutorial.js)
Tutorial.define({
  seed: 0,
  opponents: 1,
  game: (a) => [a[0], { turnTimer: false }],
  steps: [
    { title: "Kniffel in einer Minute", text: "13 Runden lang würfelst du bis zu <b>dreimal</b> pro Zug und trägst dann genau ein Feld in deinen Block ein. Am Ende gewinnt, wer die meisten Punkte hat. Gleich startet eine Übungspartie gegen einen Computer-Gegner." },
    { target: "#sheetWrap", place: "top", text: "Dein <b>Block</b>. Oben zählen nur Würfel mit der passenden Augenzahl (ab 63 Punkten gibt es 35 Bonus). Unten stehen Dreierpasch, Viererpasch, Full House, Straßen, Kniffel (fünf gleiche) und Chance." },
    { target: "#felt", text: "Hier liegen die <b>fünf Würfel</b>. Darunter zeigen Punkte, wie viele Würfe du noch hast." },
    {
      target: ($) => $("#dock.myturn") ? $("#rollBtn") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …", place: "top",
      text: "<b>Du bist dran!</b> Tippe auf <b>Würfeln</b>."
    },
    { target: "#dice", text: "Tippe die Würfel an, die du <b>behalten</b> willst. Sie bleiben liegen, wenn du die anderen erneut würfelst. So arbeitest du auf einen Pasch oder eine Straße hin." },
    { target: "#sheetWrap", place: "top", text: "Wenn du zufrieden bist, tippe im Block auf das <b>Feld</b>, in das die Würfel passen. Die Zahl zeigt, was du bekommst. Passt nichts, streichst du ein Feld mit 0 Punkten." },
    { target: "#hintBtn", text: "Der <b>Tipp</b>-Knopf (sofern aktiv) schlägt dir ein Feld vor. Das ist ideal zum Lernen." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Punktestand, Regeln und dieses Tutorial. Spiel die Runde einfach zu Ende. Viel Spaß!" }
  ]
});
