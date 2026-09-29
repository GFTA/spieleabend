#!/usr/bin/env node
// Creates a new Spieleabend game from scripts/game-template (a small working "Pig" dice game).
//   scripts/new-game <id> "<Titel>" [--port N] [--sub name] [--max N] [--short "Kurzname"] [--desc "Text"] [--dry-run] [--repo dir]
"use strict";

const fs = require("fs");
const path = require("path");

function usage(msg) {
  if (msg) console.error("Fehler: " + msg + "\n");
  console.error('Aufruf: scripts/new-game <id> "<Titel>" [--port N] [--sub name] [--max N] [--short "Kurzname"] [--desc "Text"] [--dry-run]');
  process.exit(msg ? 1 : 0);
}

const argv = process.argv.slice(2);
const opt = { max: 4 };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") usage();
  else if (a === "--dry-run") opt.dry = true;
  else if (["--port", "--sub", "--max", "--short", "--desc", "--repo"].includes(a)) {
    if (i + 1 >= argv.length) usage(`${a} braucht einen Wert.`);
    opt[a.slice(2)] = argv[++i];
  } else if (a.startsWith("--")) usage(`Unbekannte Option ${a}.`);
  else pos.push(a);
}
if (pos.length !== 2) usage("Es fehlen <id> und/oder <Titel>.");

const [id, title] = pos;
const repo = path.resolve(opt.repo || path.join(__dirname, ".."));
const tpl = path.join(repo, "scripts", "game-template");

if (!/^[a-z][a-z0-9]{1,19}$/.test(id)) usage("Die id besteht aus 2–20 Kleinbuchstaben/Ziffern und beginnt mit einem Buchstaben (z. B. wuerfel).");
if (!title.trim() || /[<>"\\]/.test(title)) usage("Der Titel ist leer oder enthält Zeichen wie < > \" \\.");
const max = parseInt(opt.max, 10);
if (!(max >= 2 && max <= 10)) usage("--max muss zwischen 2 und 10 liegen.");
const sub = opt.sub || id;
if (!/^[a-z0-9-]+$/.test(sub)) usage("--sub darf nur Kleinbuchstaben, Ziffern und - enthalten.");
if (fs.existsSync(path.join(repo, id))) usage(`Der Ordner ${id}/ existiert schon.`);
if (!fs.existsSync(tpl)) usage(`Vorlage nicht gefunden: ${tpl}`);

const jsonPath = path.join(repo, "start", "games.json");
const games = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
if (games.some((g) => g.id === id)) usage(`${id} steht schon in start/games.json.`);

// next free host port: highest used in any */docker-compose.yml + 1 (8090 belongs to the start page)
const used = new Set([8090]);
for (const d of fs.readdirSync(repo, { withFileTypes: true })) {
  const f = path.join(repo, d.name, "docker-compose.yml");
  if (!d.isDirectory() || !fs.existsSync(f)) continue;
  for (const m of fs.readFileSync(f, "utf8").matchAll(/:-(\d+)\}:8080/g)) used.add(+m[1]);
}
let port = opt.port ? parseInt(opt.port, 10) : Math.max(...[...used].filter((p) => p < 8090)) + 1;
if (!(port >= 1024 && port <= 65535)) usage("--port ist keine gültige Portnummer.");
if (opt.port && used.has(port)) usage(`Port ${port} ist schon vergeben.`);
if (!opt.port) while (used.has(port)) port++;

const pascal = id.replace(/^./, (c) => c.toUpperCase());
const vars = {
  ID: id, KEY: id, TITLE: title.trim(), SHORT: (opt.short || title.trim()).slice(0, 12), GLOBAL: pascal + "Game",
  ENVPORT: id.toUpperCase() + "_PORT", PORT: String(port), MAX: String(max),
  DESC: opt.desc || "Ein neues Spiel für den Spieleabend, allein gegen den Computer oder online mit Freunden."
};
const subst = (s) => s.replace(/@@([A-Z]+)@@/g, (m, k) => (k in vars ? vars[k] : m));
const binary = /\.(png|ico|jpg|woff2?)$/i;

const plan = [];
(function walk(rel) {
  for (const e of fs.readdirSync(path.join(tpl, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) walk(r);
    else plan.push(r);
  }
})("");
const destName = (r) => (r === "gitignore" ? ".gitignore" : subst(r));

const startIcon = path.join(repo, "start", "public", id + ".svg");
const entry = {
  id, name: vars.TITLE, title: vars.TITLE, desc: vars.DESC,
  players: `2${max > 2 ? "–" + max : ""} Spieler + Zuschauer`,
  url: `https://${sub}.cool-kidz.net/`, max, status: `http://${id}:8080/info`
};

console.log(`Neues Spiel: ${vars.TITLE} (${id})  Port ${port}  bis ${max} Spieler  https://${sub}.cool-kidz.net/`);
if (opt.dry) {
  for (const r of plan) console.log("  + " + id + "/" + destName(r));
  console.log("  + start/public/" + id + ".svg\n  ~ start/games.json\n  ~ README.md\n(--dry-run: nichts geschrieben)");
  process.exit(0);
}

for (const r of plan) {
  const from = path.join(tpl, r), to = path.join(repo, id, destName(r));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (binary.test(r)) fs.copyFileSync(from, to);
  else fs.writeFileSync(to, subst(fs.readFileSync(from, "utf8")));
  fs.chmodSync(to, fs.statSync(from).mode);
}

// the tunnel network and the party secret are the same for every game: take them from a sibling
let envNote = "";
const sibling = games.map((g) => path.join(repo, g.id, ".env")).find((f) => fs.existsSync(f));
if (sibling) {
  fs.copyFileSync(sibling, path.join(repo, id, ".env"));
  fs.chmodSync(path.join(repo, id, ".env"), 0o600);
} else envNote = `\n  (Keine .env eines anderen Spiels gefunden: ${id}/.env selbst anlegen mit TUNNEL_NETWORK=<netzwerk-von-cloudflared> und PARTY_SECRET=…)`;

fs.copyFileSync(path.join(tpl, "public", "icon.svg"), startIcon);

games.push(entry);
fs.writeFileSync(jsonPath, JSON.stringify(games, null, 2) + "\n");

const readmePath = path.join(repo, "README.md");
let readme = fs.readFileSync(readmePath, "utf8").split("\n");
let last = -1;
readme.forEach((l, i) => { if (/^\| .*\[`[\w-]+\/`\]/.test(l)) last = i; });
if (last >= 0) {
  readme.splice(last + 1, 0, `| ${vars.TITLE} | [\`${id}/\`](${id}/) | Vorlage „Pig“, ${max > 2 ? `2–${max}` : "2"} Spieler plus Zuschauer, Computer-Gegner · Port ${port} |`);
  fs.writeFileSync(readmePath, readme.join("\n"));
}

console.log(`
Fertig: ${id}/ (läuft schon als kleines Würfelspiel „Pig“).${envNote}

Als Nächstes:
  1. Regeln in ${id}/public/game.js (Engine) und ${id}/public/app.js + index.html (Oberfläche) ersetzen.
     Tests: ${id}/test/ anpassen, dann  cd ${id} && npm ci && npm test
  2. Cloudflare: Tunnel-Ingress und DNS für ${sub}.cool-kidz.net auf http://${id}:8080 anlegen.
  3. Starten:  cd ${id} && docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
  4. Startseite aktualisieren:  docker restart spiele-start
  5. Committen und pushen.`);
