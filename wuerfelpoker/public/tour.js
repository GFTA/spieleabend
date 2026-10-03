// Tutorial steps for Würfelpoker (engine: shared/tutorial.js)
Tutorial.define({
  opponents: 1,
  steps: [
    { title: "Würfelpoker in einer Minute", text: "Jede:r hat pro Runde bis zu <b>drei Würfe</b> und versucht, die beste Pokerhand mit fünf Würfeln zu bekommen. Gleich startet eine Übungspartie gegen einen Computer-Gegner." },
    { target: "#felt", text: "Hier liegen deine <b>fünf Würfel</b>. Darunter zeigen Punkte, wie viele Würfe du noch hast." },
    {
      target: ($) => $("#dock.myturn") ? $("#rollBtn") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …", place: "top",
      text: "<b>Du bist dran!</b> Tippe auf <b>Würfeln</b>."
    },
    { target: "#dice", text: "Tippe die Würfel an, die du <b>behalten</b> willst, und würfle den Rest neu. Alle sehen live, welche Würfel du behältst." },
    { target: "#handName", text: "Hier steht, welche <b>Hand</b> du gerade hast: Fünfling, Vierling, Full House, Straße, Drilling, zwei Paare, Paar oder nichts." },
    { target: "#stopBtn", place: "top", text: "Mit <b>Fertig</b> hörst du früher auf, wenn dir die Hand reicht. Wenn alle dran waren, gewinnt die beste Hand die Runde." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Rangfolge, Regeln und dieses Tutorial. Spiel die Runde einfach zu Ende. Viel Spaß!" }
  ]
});
