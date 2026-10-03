// Tutorial steps for Exploding Kittens (engine: shared/tutorial.js)
Tutorial.define({
  opponents: 1,
  steps: [
    { title: "Exploding Kittens in einer Minute", text: "Ziel: Als <b>Letzte:r</b> übrig bleiben. Im Stapel stecken explodierende Katzen 💣. Wer eine zieht und nicht entschärfen kann, ist raus. Gleich startet eine Übungsrunde gegen einen Computer-Gegner." },
    { target: "#hand", place: "top", text: "Deine <b>Hand</b>: 7 Karten, darunter ein 🧯 <b>Entschärfen</b>. Tippe eine Karte an, um zu sehen, was sie kann." },
    { target: "#deck", text: "Der <b>Stapel</b>. Am Ende deines Zugs ziehst du hier eine Karte. Die Zahl zeigt, wie viele noch drin sind. Irgendwo steckt eine Katze." },
    { target: "#stackZone, #disc", text: "Gespielte Karten landen auf der <b>Ablage</b>. Spielst du eine Karte, können andere sie mit einem 🚫 <b>Nö!</b> abwehren. Dafür bleiben ein paar Sekunden." },
    { title: "Wichtige Karten", text: "⏭️ <b>Aussetzen</b>: Zug beenden ohne Ziehen. ⚔️ <b>Angriff</b>: Der Nächste muss 2 Züge machen. 🔮 <b>Zukunft</b>: Schau die obersten 3 Karten an. 🔀 <b>Mischen</b>. 🎁 <b>Gefallen</b>: Jemand gibt dir eine Karte. Zwei gleiche Katzenkarten klauen eine Karte." },
    {
      target: ($) => $("#dock.myturn") ? $("#drawBtn") : null, wait: "tap", idle: "Der Computer ist noch dran. Gleich bist du dran …", place: "top",
      text: "<b>Du bist dran!</b> Du kannst vorher beliebig viele Karten spielen (antippen, dann Tisch antippen). Dein Zug endet mit <b>Ziehen</b>. Tippe jetzt darauf."
    },
    { title: "Katze gezogen?", text: "Ziehst du eine 💣, brauchst du ein <b>Entschärfen</b>. Dann steckst du die Katze heimlich irgendwo in den Stapel zurück. Ohne Entschärfen bist du raus." },
    { target: "#menuBtn", text: "Im <b>Menü</b> findest du jederzeit Regeln und dieses Tutorial. Spiel die Runde einfach zu Ende. Viel Spaß!" }
  ]
});
