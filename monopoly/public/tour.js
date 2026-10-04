// Tutorial steps for Monopoly (engine: shared/tutorial.js)
Tutorial.define({
  seed: 1,
  opponents: 1,
  game: (a) => [a[0], undefined, undefined, 2],
  steps: [
    { title: "Monopoly in einer Minute", text: "Kaufe Grundstücke, kassiere Miete und ruiniere deine Gegner. Wer als <b>Letzte:r</b> noch zahlen kann, gewinnt. Gleich startet eine Übungspartie gegen einen Computer-Gegner." },
    { target: "#board", text: "Das <b>Brett</b> mit 40 Feldern. Du ziehst im Uhrzeigersinn. Straßen und Bahnhöfe kannst du kaufen. Wer darauf landet und sie nicht besitzt, zahlt dir Miete." },
    { target: "#dock", place: "top", text: "Hier unten steht, wer dran ist und was gerade passiert. Du ziehst, und je nach Feld kaufst du, zahlst Miete oder Steuern, ziehst eine Karte oder landest im Gefängnis." },
    {
      target: ($) => $("#dock.myturn") ? $("#acts .btn-primary") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …", place: "top",
      text: "<b>Du bist dran!</b> Tippe auf <b>Würfeln</b>. Deine Figur zieht automatisch."
    },
    { title: "Kaufen oder versteigern", text: "Landest du auf einem freien Grundstück, kannst du es <b>kaufen</b>. Wenn nicht, wird es <b>versteigert</b>. Gehören dir alle Straßen einer Farbe, verdoppelt sich die Miete und du darfst <b>Häuser</b> bauen." },
    { title: "Weitere Möglichkeiten", text: "Mit <b>Hypotheken</b> bekommst du Geld für Grundstücke, mit <b>Tauschen</b> handelst du mit Mitspielern. Ein <b>Pasch</b> gibt einen Extrazug, dreimal Pasch führt ins <b>Gefängnis</b>. Danach beendest du deinen Zug mit <b>Zug beenden</b>." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Spiel die Partie einfach zu Ende. Viel Spaß!" }
  ]
});
