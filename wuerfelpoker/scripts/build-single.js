// Builds dist/wuerfelpoker.html: one self-contained file for the "one phone" mode.
// It opens straight from the phone's downloads, no server needed.
"use strict";
const fs = require("fs");
const path = require("path");

const pub = path.join(__dirname, "..", "public");
let html = fs.readFileSync(path.join(pub, "index.html"), "utf8");
// the shared waiting room and menu live in ../../shared
const shared = path.join(__dirname, "..", "..", "shared");
const css = fs.readFileSync(path.join(shared, "room-ui.css"), "utf8");
html = html.replace('<link rel="stylesheet" href="room-ui.css">', () => `<style>\n${css}</style>`);
for (const f of ["room-ui.js", "game.js", "app.js"]) {
  const js = fs.readFileSync(path.join(f === "room-ui.js" ? shared : pub, f), "utf8").replace(/<\/script/gi, "<\\/script");
  html = html.replace(`<script src="${f}"></script>`, () => `<script>\n${js}\n</script>`);
}
// links to files that only exist on the server
html = html.replace(/^<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n/gm, "");
fs.mkdirSync(path.join(__dirname, "..", "dist"), { recursive: true });
const out = path.join(__dirname, "..", "dist", "wuerfelpoker.html");
fs.writeFileSync(out, html);
console.log(`geschrieben: ${out} (${Math.round(html.length / 1024)} KB)`);
