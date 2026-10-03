// Tutorial steps for Phase 10 (engine: shared/tutorial.js)
Tutorial.define({
  opponents: 1,
  steps: [
    { title: "Phase 10 in einer Minute", text: "Ziel: Zehn <b>Phasen</b> nacheinander schaffen. In jeder Runde sammelst du Karten, die zu deiner Phase passen (z. B. zwei Drillinge), legst sie aus und wirst deine Karten los." },
    { target: "#deckPile", text: "Der <b>Stapel</b> (Zahlen 1–12 in vier Farben, Joker und Aussetzen). Zu Beginn deines Zugs ziehst du hier eine Karte." },
    { target: "#discardPile", text: "Die <b>Ablage</b>. Du darfst stattdessen die oberste Karte nehmen, nur ein Aussetzen nicht. Am Ende des Zugs wirfst du hier eine Karte ab." },
    { target: "#hand", place: "top", text: "Deine <b>Hand</b>: 10 Karten. Mit dem Sortier-Knopf ordnest du nach Zahl oder Farbe." },
    { target: "#myZone", text: "Hier siehst du deine <b>Phase</b>. Du kannst Karten in die Felder ziehen, sie rasten ein, sobald sie passen. „Vorschlag“ sucht eine Aufteilung für dich.", pre: ($) => { const z = $("#myZone"); if (z && z.hidden) z.scrollIntoView({ block: "nearest" }); } },
    {
      target: ($) => $("#dock.myturn") ? $("#dock .hand, #hand") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …", place: "top",
      text: "<b>Du bist dran!</b> 1. Ziehe eine Karte (Stapel oder Ablage antippen). 2. Tippe eine Handkarte an und dann auf „Abwerfen“ oder die Ablage. Hast du deine Phase, legst du sie vorher aus."
    },
    { title: "Anlegen und Ausspielen", text: "Liegt deine Phase, darfst du Karten <b>anlegen</b>: an deine und an fremde Gruppen. Karte antippen, dann die Gruppe. Wer zuerst keine Karten mehr hat, beendet die Runde. Alle anderen bekommen Strafpunkte. Der <b>Tipp</b>-Knopf hilft dir, wenn du nicht weiterweißt." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Punktestand, Regeln und dieses Tutorial. Spiel die Runde einfach zu Ende. Viel Spaß!" }
  ]
});
