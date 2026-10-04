// Tutorial steps for Galgenmännchen (engine: shared/tutorial.js)
Tutorial.define({
  seed: 1,
  opponents: 1,
  game: (a) => [a[0], undefined, "random", undefined, 2],
  steps: [
    { title: "Galgenmännchen in einer Minute", text: "Ein deutsches Wort ist gesucht. Ihr ratet reihum <b>Buchstaben</b>. Gleich startet eine Übungsrunde gegen einen Computer-Gegner." },
    { target: "#word", text: "Das ist das <b>Wort</b>. Jedes Feld ist ein Buchstabe. Über dem Wort steht die Kategorie." },
    { target: "#gallows", text: "Der <b>Galgen</b>. Jeder falsche Buchstabe baut ein Stück. Nach 10 Fehlern (bzw. 6 in der Hausregel „Schwer“) ist die Runde verloren." },
    {
      target: ($) => $("#dock.myturn") ? $("#kbd") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …", place: "top",
      text: "<b>Du bist dran!</b> Tippe einen <b>Buchstaben</b>. Kommt er vor, wird er überall aufgedeckt, du bekommst einen Punkt pro Vorkommen und bist nochmal dran. Kommt er nicht vor, ist der Nächste dran."
    },
    { target: "#wrong", text: "Hier stehen die bisher <b>falschen Buchstaben</b> und deine Fehler. Auf dem Computer kannst du auch einfach auf der Tastatur tippen." },
    { target: "#solveBtn", place: "top", text: "Kennst du das Wort schon? Mit <b>Wort lösen</b> tippst du es ganz ein: richtig gibt Punkte für jeden noch verdeckten Buchstaben plus Bonus, falsch zählt als Fehler." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Spiel die Runde einfach zu Ende. Viel Spaß!" }
  ]
});
