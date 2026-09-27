"use strict";
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

// one game server that answers, one that is down
const up = http.createServer((req, res) => res.end(JSON.stringify({ uno: true, rooms: 3 }))).listen(0);
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "start-")), "games.json");
process.env.PORT = "0";
process.env.GAMES_FILE = file;

test.after(() => { up.close(); setImmediate(() => process.exit()); });

test("lists games and reports which servers are up", async () => {
  await new Promise((r) => up.listening ? r() : up.on("listening", r));
  fs.writeFileSync(file, JSON.stringify([
    { id: "uno", name: "Uno", url: "https://uno.example/", status: `http://127.0.0.1:${up.address().port}/info` },
    { id: "gone", name: "Weg", url: "https://gone.example/", status: "http://127.0.0.1:9/info" }
  ]));
  const { server } = require("../server.js");
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const games = await (await fetch(base + "/games.json")).json();
  assert.deepStrictEqual(games.map((g) => g.id), ["uno", "gone"]);
  assert.ok(games.every((g) => !("status" in g)), "internal addresses stay on the server");

  const st = await (await fetch(base + "/status.json")).json();
  assert.deepStrictEqual(st, [{ id: "uno", online: true, rooms: 3 }, { id: "gone", online: false, rooms: 0 }]);

  const page = await fetch(base + "/");
  assert.match(await page.text(), /Spieleabend/);
  assert.strictEqual(page.headers.get("cache-control"), "no-store");
  assert.strictEqual((await fetch(base + "/../server.js")).status, 404);
  server.close();
});
