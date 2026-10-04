// Tutorial steps for Poker (engine: shared/tutorial.js)
Tutorial.define({
  seed: 0,
  opponents: 1,
  game: (a) => [a[0], undefined, { turnTimer: false }, false],
  steps: [
    { title: "Poker in einer Minute", text: "Texas Hold’em: Jede:r bekommt <b>zwei Karten</b> auf die Hand, dazu kommen fünf gemeinsame Karten auf den Tisch. Du bildest die beste Hand aus fünf der sieben Karten. Gleich startet eine Übungspartie gegen einen Computer-Gegner." },
    { target: "#hole", place: "top", text: "Das sind deine <b>zwei Karten</b>. Nur du siehst sie." },
    { target: "#felt", text: "In der Mitte liegen die <b>gemeinsamen Karten</b>: erst der Flop (3), dann Turn (1) und River (1). Darüber steht der <b>Pot</b>, also alle gesetzten Chips." },
    { target: "#players", text: "Die Spieler mit ihren <b>Chips</b>. Das <b>D</b> markiert den Dealer, links davon zahlen zwei Spieler die Blinds, damit immer etwas im Pot liegt." },
    {
      target: ($) => $("#dock.myturn") ? $("#actsPlay") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …", place: "top",
      text: "<b>Du bist dran!</b> <b>Passen</b>: Hand aufgeben. <b>Check</b>: weitermachen, wenn niemand gesetzt hat. <b>Mitgehen</b>: den Einsatz bezahlen. <b>Erhöhen</b>: mehr setzen. Tippe jetzt einen Knopf."
    },
    { target: "#handNow", text: "Hier steht, welche <b>Hand</b> du gerade hast, zum Beispiel Paar oder Straße. Die Rangfolge steht im Menü unter Spielregeln." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Rangfolge, Regeln und dieses Tutorial. Spiel die Hand einfach zu Ende. Viel Spaß!" }
  ]
});
