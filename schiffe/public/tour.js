// Tutorial steps for Schiffe versenken (engine: shared/tutorial.js)
Tutorial.define({
  seed: 0,
  opponents: 1,
  game: (a) => [a[0], undefined, undefined, undefined, 2],
  steps: [
    { title: "Schiffe versenken in einer Minute", text: "Jede:r versteckt eine <b>Flotte</b> auf einem Gitter. Reihum schießt ihr auf Felder des anderen. Wer zuerst alle gegnerischen Schiffe versenkt, gewinnt. Gleich startet eine Übungspartie gegen einen Computer-Gegner." },
    { target: ($) => $("#placeBar:not([hidden])") ? [$("#harbor"), $("#board")] : null, idle: "Die Flotte steht schon.", text: "Erst stellst du deine Flotte auf: Tippe ein <b>Schiff</b> im Hafen an, dann das Feld für den Bug, oder zieh es aufs Gitter. Ein Tipp aufs Schiff dreht es." },
    { target: ($) => $("#placeBar:not([hidden])") ? $("#randBtn") : null, wait: "tap", idle: "Die Flotte steht schon.", place: "top", text: "Keine Lust auf Basteln? <b>Zufällig</b> verteilt alle Schiffe auf einmal. Tippe darauf." },
    { target: ($) => $("#fleetBtn:not([hidden])"), wait: "tap", idle: "Gleich geht es weiter …", place: "top", text: "Passt alles? Dann tippe auf <b>Fertig, Flotte steht</b>." },
    {
      target: ($) => $("#dock.myturn:not(.placing)") ? $("#board") : null, wait: { tap: "#board" }, idle: "Der Computer ist noch dran. Gleich bist du dran …",
      text: "Jetzt schießt du auf die Flotte des Gegners: <b>Tippe ein Feld</b> an und dann auf <b>Feuer!</b> (oder tippe dasselbe Feld nochmal). Weißer Punkt: Wasser. Rotes Kreuz: Treffer."
    },
    { target: "#mine, #duoOwn", place: "top", text: "Unten siehst du <b>deine Flotte</b> und wohin der Gegner schon geschossen hat. Sind alle Teile eines Schiffs getroffen, ist es versenkt." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Spiel die Partie einfach zu Ende. Viel Spaß!" }
  ]
});
