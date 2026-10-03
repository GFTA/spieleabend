// Tutorial steps for Uno (engine: shared/tutorial.js)
Tutorial.define({
  opponents: 1,
  steps: [
    { title: "Uno in einer Minute", text: "Ziel: Als Erste:r alle Handkarten loswerden. Gleich startet eine Übungsrunde gegen einen Computer-Gegner. Ich zeige dir, was du siehst und was du tun kannst." },
    { target: "#hand", place: "top", text: "Das ist deine <b>Hand</b>. Karten, die du jetzt legen darfst, sind hell, die anderen abgedunkelt." },
    { target: "#discard", text: "Die <b>Ablage</b>. Deine Karte muss zur obersten Karte passen: gleiche <b>Farbe</b>, gleiche <b>Zahl</b> oder gleiches <b>Symbol</b>. Farbwahl-Karten passen immer." },
    { target: "#drawPile", text: "Der <b>Stapel</b>. Hast du nichts Passendes, ziehst du hier eine Karte. Die Zahl darunter zeigt, wie viele noch drin sind." },
    { target: ".tinfo", text: "Hier steht die <b>aktuelle Farbe</b> und die <b>Spielrichtung</b>. Ein Richtungswechsel dreht die Reihenfolge um." },
    { target: "#dock .who", text: "Hier steht, wer gerade dran ist. Bei dir leuchtet die Leiste auf.", place: "top" },
    {
      target: ($) => $("#dock.myturn") ? ($("#hand .card.ok") || $("#drawPile")) : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …",
      text: "<b>Du bist dran!</b> Tippe eine helle Karte an, sie hebt sich. Tippe sie nochmal an oder zieh sie auf die Ablage, dann ist sie gelegt. Hast du keine passende, tippe den Stapel an."
    },
    { title: "Besondere Karten", text: "<b>Aussetzen</b>: der Nächste ist nicht dran. <b>Richtungswechsel</b>: die Reihenfolge dreht sich. <b>+2</b>: der Nächste zieht 2 und setzt aus. <b>Farbwahl</b> und <b>+4</b>: du darfst die Farbe bestimmen." },
    { title: "UNO!", text: "Hast du nur noch <b>eine Karte</b>, erscheint der große UNO!-Knopf. Drück ihn schnell, sonst ziehst du 2 Strafkarten." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Punktestand, Regeln und dieses Tutorial. Spiel die Runde einfach zu Ende. Viel Spaß!" }
  ]
});

