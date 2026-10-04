// Tutorial steps for Skip-Bo (engine: shared/tutorial.js)
Tutorial.define({
  seed: 1,
  opponents: 1,
  game: (a) => [a[0], undefined, undefined, 2],
  steps: [
    { title: "Skip-Bo in einer Minute", text: "Ziel: Als Erste:r deinen <b>Vorratsstapel</b> leer spielen. Gleich startet eine Übungsrunde gegen einen Computer-Gegner. Ich zeige dir den Tisch." },
    { target: "#myStock", place: "top", text: "Dein <b>Vorratsstapel</b>. Nur die oberste Karte ist offen und spielbar. Ist der Stapel leer, hast du gewonnen. Die Zahl zeigt, wie viele noch drin sind." },
    { target: "#builds", text: "Die vier <b>Bauhaufen</b> in der Mitte. Auf jeden kommt der Reihe nach 1, 2, 3 … bis 12. Ein voller Haufen wird abgeräumt." },
    { target: "#hand", place: "top", text: "Deine <b>Hand</b>: bis zu 5 Karten. Am Anfang jedes Zugs wird sie aufgefüllt. Der <b>Skip-Bo-Joker</b> ersetzt jede Zahl." },
    { target: "#myDisc", place: "top", text: "Deine vier <b>Ablagestapel</b>. Hier darf alles liegen, gespielt wird nur die oberste Karte. Dein Zug <b>endet</b>, wenn du eine Handkarte hierher legst." },
    {
      target: ($) => $("#dock.myturn") ? $("#hand") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …", place: "top",
      text: "<b>Du bist dran!</b> Tippe eine Handkarte an, dann den Bauhaufen, auf den sie passt (oder zieh sie hin). Gute Karten zuerst: die Vorratskarte loszuwerden ist das Wichtigste."
    },
    { title: "Zug beenden", text: "Passt nichts mehr, legst du eine Handkarte auf einen Ablagestapel. Dann ist der Computer dran. Tipp: Sortiere die Ablagestapel nach Zahlen, dann kannst du später mehrere Karten hintereinander spielen." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Punktestand, Regeln und dieses Tutorial. Spiel die Runde einfach zu Ende. Viel Spaß!" }
  ]
});
