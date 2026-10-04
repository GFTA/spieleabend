// Tutorial steps for Mensch ärgere dich nicht (engine: shared/tutorial.js)
Tutorial.define({
  seed: 1,
  opponents: 1,
  game: (a) => [a[0], undefined, undefined, 2],
  arrange: (S) => { S.rig = [6, 4, 3, 5, 2]; },
  steps: [
    { title: "Mensch ärgere dich nicht in einer Minute", text: "Bringe als Erster alle vier <b>Figuren</b> einmal ums Brett in dein Ziel. Gleich startet eine Übungspartie gegen einen Computer-Gegner." },
    { target: "#board", text: "Das <b>Brett</b>. Jede Farbe hat vier Figuren im <b>Haus</b>, ein <b>Startfeld</b> und ein <b>Ziel</b>. Rund ums Brett geht es im Uhrzeigersinn." },
    { title: "Raus aus dem Haus", text: "Mit einer <b>6</b> kommt eine Figur auf dein Startfeld. Hast du noch keine draußen, darfst du bis zu dreimal würfeln. Nach einer 6 bist du <b>nochmal</b> dran." },
    {
      target: ($) => $("#dock.myturn") ? $("#dieBtn") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …", place: "top",
      text: "<b>Du bist dran!</b> Tippe auf den <b>Würfel</b>."
    },
    {
      target: ($) => $("#board .piece.can") || ($("#dock.myturn") ? $("#dieBtn") : null), wait: { tap: "#board .piece.can" },
      idle: "Der Computer ist dran. Gleich geht es weiter …", place: "top",
      text: "Tippe auf eine <b>leuchtende Figur</b>, um sie zu ziehen. Der Ring zeigt, wo sie landet. Leuchtet keine, konnte mit dieser Zahl keine Figur ziehen (du brauchst eine <b>6</b>): würfle beim nächsten Mal wieder oder tippe auf „Überspringen“."
    },
    { title: "Schlagen und Ziel", text: "Landest du auf einer <b>fremden Figur</b>, fliegt sie zurück ins Haus. Auf eigene darfst du nicht ziehen. Im <b>Ziel</b> musst du genau treffen." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Spiel die Partie einfach zu Ende. Viel Spaß!" }
  ]
});
