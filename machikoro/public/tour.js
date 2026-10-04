// Tutorial steps for Machi Koro (engine: shared/tutorial.js)
Tutorial.define({
  seed: 1,
  opponents: 1,
  game: (a) => [a[0], undefined, 2],
  steps: [
    { title: "Machi Koro in einer Minute", text: "Baue deine Stadt aus: Wer zuerst alle <b>vier Wahrzeichen</b> (Bahnhof, Einkaufszentrum, Freizeitpark, Funkturm) gebaut hat, gewinnt. Gleich startet eine Übungspartie gegen einen Computer-Gegner." },
    { target: "#cities", place: "top", text: "Deine <b>Stadt</b> und die deines Gegners. Du startest mit einem Getreidefeld, einer Bäckerei und 3 Münzen. Tippe eine Karte an, um Details zu sehen." },
    { target: "#market", text: "Der <b>Markt</b>. Hier kaufst du neue Gebäude. Jedes hat eine Zahl: Wird sie gewürfelt, bringt es Münzen. <b>Blau</b> zahlt immer, <b>Grün</b> und <b>Lila</b> nur in deinem Zug, <b>Rot</b> nimmt dem Würfelnden Münzen weg." },
    {
      target: ($) => $("#dock.myturn") ? $("#dice") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …", place: "top",
      text: "<b>Du bist dran!</b> Tippe auf den <b>Würfel</b>. Alle Gebäude mit der gewürfelten Zahl zahlen aus."
    },
    { target: "#market", text: "Danach darfst du <b>ein Gebäude</b> vom Markt kaufen, ein <b>Wahrzeichen</b> bauen oder <b>passen</b>. Tippe die Karte an und bestätige den Kauf. Wahrzeichen sind teuer, aber sie sind dein Ziel." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Spiel die Partie einfach zu Ende. Viel Spaß!" }
  ]
});
