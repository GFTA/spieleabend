// Tutorial steps for Rummikub (engine: shared/tutorial.js)
Tutorial.define({
  opponents: 1,
  steps: [
    { title: "Rummikub in einer Minute", text: "Ziel: Als Erste:r alle Plättchen vom <b>Ständer</b> auf den Tisch bringen. Gleich startet eine Übungsrunde gegen einen Computer-Gegner." },
    { target: "#rack", place: "top", text: "Dein <b>Ständer</b> mit 14 Plättchen. Mit dem Knopf daneben sortierst du nach Farbe oder Zahl." },
    { target: "#sets", text: "Der <b>Tisch</b>. Hier liegen nur gültige Sätze: eine <b>Reihe</b> (mindestens 3 Zahlen in Folge, gleiche Farbe) oder eine <b>Gruppe</b> (3 oder 4 gleiche Zahlen in verschiedenen Farben)." },
    { target: "#pool", place: "top", text: "Der <b>Vorrat</b>. Kannst du nichts legen, ziehst du hier ein Plättchen. Der Joker ersetzt jedes Plättchen." },
    { title: "Erstes Auslegen", text: "Dein erstes Auslegen muss mindestens <b>30 Punkte</b> zählen und kommt nur aus deinem eigenen Ständer. Danach darfst du den ganzen Tisch umbauen, solange am Ende alles gültig ist." },
    {
      target: ($) => $("#dock.myturn") ? [$("#rack"), $("#drawBtn")] : null, wait: { tap: "#drawBtn, #rack .tile" }, idle: "Der Computer ist noch dran. Gleich bist du dran …", place: "top",
      text: "<b>Du bist dran!</b> Zieh Plättchen vom Ständer auf den Tisch (oder tippe erst das Plättchen, dann das Ziel). Mit <b>Fertig</b> bestätigst du, mit <b>Zurück</b> nimmst du alles zurück. Hast du nichts zum Legen, tippe <b>Ziehen</b>."
    },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Spiel die Runde einfach zu Ende. Viel Spaß!" }
  ]
});
