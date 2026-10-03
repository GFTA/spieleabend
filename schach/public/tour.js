// Tutorial steps for Schach (engine: shared/tutorial.js)
Tutorial.define({
  opponents: 1,
  steps: [
    { title: "Schach in einer Minute", text: "Setze den gegnerischen <b>König</b> matt: Er wird bedroht und kann nicht mehr entkommen. Weiß beginnt. Gleich startet eine Übungspartie gegen einen Computer-Gegner." },
    { target: "#board", text: "Das <b>Brett</b>. Jede Figur zieht auf ihre Art: <b>Bauer</b> ein Feld vor (schlägt schräg), <b>Turm</b> gerade, <b>Läufer</b> schräg, <b>Dame</b> beides, <b>Springer</b> L-förmig und über andere hinweg, <b>König</b> ein Feld in jede Richtung." },
    { title: "Schach und Matt", text: "<b>Schach</b>: Dein König wird bedroht, du musst das sofort beenden. Geht das nicht mehr, ist es <b>Matt</b> und die Partie verloren. Kein erlaubter Zug ohne Schach heißt <b>Patt</b>: unentschieden." },
    { title: "Sonderzüge", text: "<b>Rochade</b>: Der König zieht zwei Felder zum Turm hin, der Turm springt auf die andere Seite. <b>En passant</b> und die <b>Umwandlung</b> eines Bauern auf der letzten Reihe (in Dame, Turm, Läufer oder Springer) kennt das Spiel selbst und bietet sie dir an." },
    {
      target: ($) => $("#dock.myturn") ? $("#board") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …",
      text: "<b>Du bist dran!</b> Halte eine Figur fest und schiebe sie aufs Zielfeld, oder tippe erst die Figur, dann das Feld. Gelb markierte Felder sind erlaubt."
    },
    { target: "#hintBtn", text: "Der <b>Tipp</b>-Knopf (sofern aktiv) zeigt einen guten Zug, <b>Zug zurück</b> nimmt deinen letzten zurück." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Spiel die Partie einfach zu Ende. Viel Spaß!" }
  ]
});
