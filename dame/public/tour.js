// Tutorial steps for Dame (engine: shared/tutorial.js)
Tutorial.define({
  opponents: 1,
  steps: [
    { title: "Dame in einer Minute", text: "Schlage alle gegnerischen Steine oder nimm dem Gegner alle Züge. Gespielt wird auf den <b>dunklen Feldern</b>. Gleich startet eine Übungspartie gegen einen Computer-Gegner." },
    { target: "#board", text: "Das <b>Brett</b>. Ein Stein zieht ein Feld <b>schräg vorwärts</b>. Eine <b>Dame</b> zieht beliebig weit in alle vier Diagonalen." },
    { title: "Schlagen", text: "Du schlägst, indem du über einen gegnerischen Stein auf das freie Feld dahinter springst. <b>Schlagzwang</b>: Wer schlagen kann, <b>muss</b> schlagen. Geht es danach weiter, musst du im selben Zug weiterspringen. Männer schlagen auch rückwärts." },
    { title: "Dame werden", text: "Erreicht ein Stein die <b>letzte Reihe</b> des Gegners, wird er zur Dame. Sein Zug endet dort." },
    {
      target: ($) => $("#dock.myturn") ? $("#board") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …",
      text: "<b>Du bist dran!</b> Halte einen Stein fest und schiebe ihn aufs Zielfeld, oder tippe erst den Stein, dann das Feld. Mögliche Felder werden markiert."
    },
    { target: "#hintBtn", text: "Der <b>Tipp</b>-Knopf (sofern aktiv) zeigt einen guten Zug, <b>Zug zurück</b> nimmt deinen letzten zurück." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Spiel die Partie einfach zu Ende. Viel Spaß!" }
  ]
});
