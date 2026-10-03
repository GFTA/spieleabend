// Tutorial steps (engine: shared/tutorial.js). Replace the texts and selectors with the real game.
Tutorial.define({
  opponents: 1,
  steps: [
    { title: "Kurz erklärt", text: "Ziel des Spiels in ein bis zwei Sätzen. Gleich startet eine Übungspartie gegen einen Computer-Gegner." },
    { target: "#die", text: "Hier siehst du den <b>Würfel</b>." },
    {
      target: ($) => $("#dock.myturn") ? $("#rollBtn") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …", place: "top",
      text: "<b>Du bist dran!</b> Tippe auf <b>Würfeln</b>."
    },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Spiel die Partie einfach zu Ende. Viel Spaß!" }
  ]
});
