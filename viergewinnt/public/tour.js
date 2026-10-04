// Tutorial steps for Vier gewinnt (engine: shared/tutorial.js)
Tutorial.define({
  seed: 1,
  opponents: 1,
  game: (a) => [a[0], undefined, undefined, undefined, 2],
  steps: [
    { title: "Vier gewinnt in einer Minute", text: "Wer zuerst <b>vier eigene Scheiben</b> in einer Reihe hat, gewinnt: waagerecht, senkrecht oder schräg. Gleich startet eine Übungspartie gegen einen Computer-Gegner." },
    { target: "#board", text: "Das <b>Brett</b> mit seinen Spalten. Eine Scheibe fällt immer bis auf die unterste freie Stelle." },
    {
      target: ($) => $("#dock.myturn") ? $("#board") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …",
      text: "<b>Du bist dran!</b> Tippe auf eine <b>Spalte</b>. Tipp: Die mittlere Spalte ist am stärksten, weil sie die meisten Viererreihen ermöglicht."
    },
    { title: "Taktik", text: "Achte auf zwei Dinge: Bau eigene <b>Dreierreihen</b> mit zwei offenen Enden, dann kann der Gegner nicht beide blocken. Und <b>blockiere</b> seine Dreierreihen, bevor er sie vollendet." },
    { target: "#hintBtn", text: "Der <b>Tipp</b>-Knopf (sofern aktiv) zeigt dir einen guten Zug. Auf dem Computer geht auch die Tastatur: 1 bis 9 wählt die Spalte." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Spiel die Partie einfach zu Ende. Viel Spaß!" }
  ]
});
