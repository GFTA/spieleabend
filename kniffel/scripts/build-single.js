// Builds dist/kniffel.html: one self-contained file for the "one phone" mode.
// It opens straight from the phone's downloads, no server needed.
"use strict";
const fs = require("fs");
const path = require("path");

const pub = path.join(__dirname, "..", "public");
let html = fs.readFileSync(path.join(pub, "index.html"), "utf8");
// the shared base, waiting room and menu live in ../../shared
const shared = path.join(__dirname, "..", "..", "shared");
for (const f of ["kit.css", "room-ui.css"]) {
  const css = fs.readFileSync(path.join(shared, f), "utf8");
  html = html.replace(`<link rel="stylesheet" href="${f}">`, () => `<style>\n${css}</style>`);
}
for (const f of ["kit.js", "room-ui.js", "home-ui.js", "game.js", "app.js"]) {
  const js = fs.readFileSync(path.join(/^(kit|room-ui|home-ui)\.js$/.test(f) ? shared : pub, f), "utf8").replace(/<\/script/gi, "<\\/script");
  html = html.replace(`<script src="${f}"></script>`, () => `<script>\n${js}\n</script>`);
}
// links to files that only exist on the server
html = html.replace(/^<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n/gm, "");
fs.mkdirSync(path.join(__dirname, "..", "dist"), { recursive: true });
const out = path.join(__dirname, "..", "dist", "kniffel.html");
fs.writeFileSync(out, html);
console.log(`geschrieben: ${out} (${Math.round(html.length / 1024)} KB)`);
