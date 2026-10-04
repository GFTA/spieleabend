// Tutorial steps for Carcassonne (engine: shared/tutorial.js)
Tutorial.define({
  seed: 1,
  opponents: 1,
  game: (a) => [a[0], undefined, 2, { meadows: true }],
  steps: [
    { title: "Carcassonne in einer Minute", text: "Ihr baut gemeinsam eine Landschaft aus <b>Plättchen</b> und setzt <b>Gefolgsleute</b> darauf. Wer mit Straßen, Städten und Klöstern die meisten Punkte macht, gewinnt. Gleich startet eine Übungspartie gegen einen Computer-Gegner." },
    { target: "#boardWrap", text: "Das <b>Spielfeld</b>. Es wächst mit jedem Plättchen. Mit zwei Fingern oder dem Mausrad zoomst du, mit den Knöpfen rechts auch. Das Ziel-Symbol zeigt wieder alles." },
    { target: "#curTile", place: "top", text: "Dein aktuelles <b>Plättchen</b>. Zieh es auf einen leuchtenden Platz. Die Kanten müssen zu den Nachbarn passen: Straße an Straße, Stadt an Stadt, Wiese an Wiese." },
    {
      target: ($) => $("#dock.myturn") ? $("#rotBtn") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …", place: "top",
      text: "<b>Du bist dran!</b> Tippe auf <b>Drehen</b>, um das Plättchen zu drehen, bis es passt."
    },
    { target: ($) => $("#dock.myturn") ? $("#placeBtn") : null, wait: "tap", idle: "Gleich geht es weiter …", place: "top", text: "Passt es auf einen der leuchtenden Plätze? Tippe den Platz an und dann auf <b>Legen</b>. Du kannst es auch direkt dorthin ziehen." },
    { title: "Gefolgsleute", text: "Danach darfst du <b>einen Gefolgsmann</b> auf ein freies Merkmal dieses Plättchens setzen (Straße, Stadt, Kloster oder Wiese) oder <b>ohne</b> weitermachen. Dein Vorrat steht neben dem Plättchen. Du bekommst ihn zurück, wenn das Merkmal fertig ist." },
    { title: "Wertung", text: "Fertige <b>Straßen</b> (1 Punkt je Plättchen), <b>Städte</b> (2 je Plättchen plus 2 je Wappen) und <b>Klöster</b> (9) werden sofort gewertet. Am Ende zählen auch unfertige Merkmale und Wiesen." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Spiel die Partie einfach zu Ende. Viel Spaß!" }
  ]
});
