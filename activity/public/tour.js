// Tutorial steps for Activity (engine: shared/tutorial.js)
Tutorial.define({
  seed: 0,
  opponents: 1,
  game: (a) => [a[0], undefined, undefined, undefined, 2],
  steps: [
    { title: "Activity in einer Minute", text: "Reihum stellt jemand einen <b>Begriff</b> dar, die anderen raten. Je nach Runde <b>zeichnest</b>, <b>erklärst</b> oder machst du <b>Pantomime</b>. Gleich startet eine Übungsrunde. Im Einzelspiel stellst du immer selbst dar, die Computer-Gegner raten mit." },
    { target: ($) => $("#card:not([hidden])") || $("#wordLine"), idle: "Gleich geht es los …", text: "Hier steht dein <b>Begriff</b> und wie du ihn darstellst. Nur du siehst ihn. Schwere Begriffe geben mehr Punkte. Mit <b>Anderen Begriff</b> tauschst du ihn einmal aus." },
    { target: ($) => $("#goBtn:not([hidden])"), wait: "tap", idle: "Es läuft schon. Weiter geht es gleich.", place: "top", text: "Bereit? Tippe auf <b>Los geht’s</b>. Nach 20 Sekunden startet die Runde von selbst." },
    { target: ($) => $("#tools:not([hidden])") ? [$("#canvasWrap"), $("#tools")] : $("#wordLine"), text: "<b>Zeichnen</b>: Male mit dem Finger oder der Maus, mit den Werkzeugen wechselst du Farbe und Stärke. <b>Erklären</b>: Beschreibe den Begriff, ohne ihn selbst zu nennen. <b>Pantomime</b>: Stelle ihn ohne Worte dar." },
    { title: "Raten und Punkte", text: "Unter dem Begriff erscheinen die <b>Tipps</b> der anderen. Wer richtig rät, bekommt Punkte, je schneller desto mehr. Auch du bekommst Punkte für jeden, der es errät." },
    { target: ($) => $("#giveBtn:not([hidden])"), idle: "Gerade ist niemand am Darstellen.", place: "top", text: "Kommst du nicht weiter, kannst du <b>aufgeben</b>. Nach der halben und nach drei Vierteln der Zeit wird ein Buchstabe des Begriffs verraten." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Spiel die Runde einfach zu Ende. Viel Spaß!" }
  ]
});
