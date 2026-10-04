// Tutorial steps for Catan (engine: shared/tutorial.js)
Tutorial.define({
  seed: 1,
  opponents: 1,
  game: (a) => [a[0], undefined, undefined, 2],
  steps: [
    { title: "Catan in einer Minute", text: "Baue Straßen, Siedlungen und Städte und sammle als Erster <b>10 Siegpunkte</b>. Gleich startet eine Übungspartie gegen einen Computer-Gegner." },
    { target: "#board", text: "Die Insel aus <b>Rohstofffeldern</b> (Wald, Lehm, Schaf, Getreide, Erz, Wüste). Jedes Feld trägt eine <b>Zahl</b>. Wird sie gewürfelt, bekommen alle mit einer Siedlung daran den Rohstoff." },
    { target: "#hand", place: "top", text: "Deine <b>Rohstoffe</b>. Damit bezahlst du Bauten. Straße: Holz und Lehm. Siedlung: Holz, Lehm, Schaf und Getreide. Stadt: 2 Getreide und 3 Erz." },
    {
      target: ($) => $("#dock.myturn") ? $("#board") : null, wait: { tap: "#board" }, idle: "Der Computer ist noch dran. Gleich bist du dran …",
      text: "<b>Aufbau</b>: Jeder setzt zwei Siedlungen mit je einer Straße. Tippe auf einen <b>leuchtenden Platz</b>, um deine erste Siedlung zu setzen. Wähle Plätze an Feldern mit vielen und guten Zahlen (6 und 8 kommen am häufigsten)."
    },
    {
      target: ($) => $("#dock.myturn") ? $("#board") : null, wait: { tap: "#board" }, idle: "Der Computer ist noch dran. Gleich bist du dran …",
      text: "Jetzt eine <b>Straße</b> an deine Siedlung: Tippe auf einen leuchtenden Weg. Danach setzt der Gegner, und du setzt die zweite Siedlung. Die bringt gleich Rohstoffe."
    },
    { title: "Dein Zug", text: "Danach läuft jeder Zug so: <b>Würfeln</b>, Rohstoffe kassieren, dann <b>bauen</b> (Teil aufs Brett ziehen oder antippen), <b>handeln</b> (mit Bank 4:1, mit Hafen besser, mit Spielern) oder <b>Entwicklungskarten</b> spielen, am Ende <b>Zug beenden</b>." },
    { title: "Die 7 und der Räuber", text: "Bei einer <b>7</b> geben alle mit mehr als 7 Karten die Hälfte ab. Dann versetzt der Würfler den <b>Räuber</b>: Er blockiert ein Feld, und du stiehlst eine Karte von einem Nachbarn." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Spiel die Partie einfach zu Ende. Viel Spaß!" }
  ]
});
