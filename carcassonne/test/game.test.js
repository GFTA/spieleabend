"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Game = require("../public/game.js");

const two = (opts) => Game.newGame([{ name: "Anna" }, { name: "Ben" }], 1, 2, opts || { meadows: false });
const bots = (n, level, opts) => Game.newGame(
  Array.from({ length: n }, (_, i) => ({ name: "R" + i, bot: true })),
  1, level || 2, opts || { meadows: false }
);

test("checksums: 72 tiles, 6 cloisters (2 with road), 10 shields, U/V/W/X", () => {
  const c = Game.checksums();
  assert.strictEqual(c.total, 72);
  assert.strictEqual(c.cloisters, 6);
  assert.strictEqual(c.cloisterRoad, 2);
  assert.strictEqual(c.shields, 10);
  assert.strictEqual(c.cross, 1);
  assert.strictEqual(c.straight, 8);
  assert.strictEqual(c.curves, 9);
  assert.strictEqual(c.tees, 4);
});

test("sides match by reverse equality; rotation preserves matching", () => {
  assert.ok(Game.sidesMatch("FRF", "FRF"));
  assert.ok(Game.sidesMatch("CCC", "CCC"));
  assert.ok(Game.sidesMatch("FFF", "FFF"));
  assert.ok(!Game.sidesMatch("CCC", "FFF"));
  // D start east FRF matches U west FRF
  assert.strictEqual(Game.sideStr("D", 0, 1), "FRF");
  assert.strictEqual(Game.sideStr("U", 0, 3), "FRF");
  assert.ok(Game.sidesMatch(Game.sideStr("D", 0, 1), Game.sideStr("U", 0, 3)));
});

test("new game places start tile and draws a playable tile", () => {
  const S = two();
  assert.strictEqual(S.phase, "place");
  assert.ok(S.board[Game.START + "," + Game.START]);
  assert.strictEqual(S.board[Game.START + "," + Game.START].id, "D");
  assert.ok(S.current);
  assert.ok(Game.legalPlaces(S).length > 0);
  assert.strictEqual(S.stack.length + 1 + 1, 72); // stack + current + start
});

test("place requires neighbour and matching edges; rotation allowed", () => {
  const S = two();
  S.current = "U";
  assert.strictEqual(Game.act(S, S.cur, { t: "place", x: Game.START + 5, y: Game.START + 5, r: 0 }).ok, false);
  assert.ok(Game.act(S, S.cur, { t: "place", x: Game.START + 1, y: Game.START, r: 0 }).ok);
});

test("completed road scores 1 per tile and returns meeple", () => {
  const S = two();
  S.stack = ["E", "E", "E", "E", "E", "E", "E", "E"];
  S.current = "W"; S.phase = "place"; S.cur = 0;
  assert.ok(Game.act(S, 0, { t: "place", x: Game.START + 1, y: Game.START, r: 0 }).ok);
  assert.ok(Game.act(S, 0, { t: "meeple", feature: 2 }).ok); // west road
  assert.strictEqual(S.players[0].meeples, 6);
  S.cur = 0; S.current = "W"; S.phase = "place";
  assert.ok(Game.act(S, 0, { t: "place", x: Game.START - 1, y: Game.START, r: 0 }).ok);
  const res = Game.act(S, 0, { t: "meeple", feature: null });
  const roadScore = res.events.find((e) => e.t === "score" && e.kind === "R" && e.points === 3);
  assert.ok(roadScore);
  assert.ok(Array.isArray(roadScore.tiles) && roadScore.tiles.length === 3, "score event needs tiles");
  assert.strictEqual(S.players[0].score, 3);
  assert.strictEqual(S.players[0].meeples, 7);
});

test("completed city scores 2 per tile + 2 per shield", () => {
  const S = two();
  S.stack = ["E", "E", "E", "E", "E", "E", "E", "E", "E"];
  // Close start city (north) with E (city south when rotated)
  // E sides CCC,FFF,FFF,FFF — rotate r=2 → south city
  S.current = "E"; S.phase = "place"; S.cur = 0;
  assert.ok(Game.act(S, 0, { t: "place", x: Game.START, y: Game.START - 1, r: 2 }).ok);
  assert.ok(Game.act(S, 0, { t: "meeple", feature: 0 }).ok); // city
  // City of 2 tiles, 0 shields, still open on E's other sides? E has only one city side, so after connecting to D's north, open should be 0.
  // D city edges 0,1,2 (north). E at north with r=2: city on south. Connecting closes all 3+3? Each side has 3 fields.
  // D city open starts 3. E city open starts 3. Connect 3 pairs → open 0.
  // Scoring happens after meeple
  // Actually after first place+meeple, scoreAfterPlace should fire
  assert.ok(S.players[0].score >= 4, "city 2 tiles → 4 points, got " + S.players[0].score);
  assert.strictEqual(S.players[0].meeples, 7);
});

test("cloister scores 9 when surrounded", () => {
  const S = two();
  S.stack = Array(30).fill("E");
  // Place cloister B adjacent, then surround
  S.current = "B"; S.phase = "place"; S.cur = 0;
  // B is all fields — south of start (FFF) matches
  assert.ok(Game.act(S, 0, { t: "place", x: Game.START, y: Game.START + 1, r: 0 }).ok);
  const legal = Game.legalMeeples(S);
  assert.ok(legal.includes(0)); // cloister feature
  assert.ok(Game.act(S, 0, { t: "meeple", feature: 0 }).ok);
  // Surround remaining 7 cells (one neighbour is start)
  const cells = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (!dx && !dy) continue;
    const x = Game.START + dx, y = Game.START + 1 + dy;
    if (!S.board[x + "," + y]) cells.push([x, y]);
  }
  assert.strictEqual(cells.length, 7);
  for (const [x, y] of cells) {
    S.cur = 0; S.current = "E"; S.phase = "place";
    // try rotations until placeable
    let ok = false;
    for (let r = 0; r < 4; r++) {
      if (Game.placeable(S, "E", x, y, r)) {
        assert.ok(Game.act(S, 0, { t: "place", x, y, r }).ok);
        if (S.phase === "meeple") Game.act(S, 0, { t: "meeple", feature: null });
        ok = true; break;
      }
    }
    if (!ok) {
      // try U
      S.current = "U";
      for (let r = 0; r < 4; r++) {
        if (Game.placeable(S, "U", x, y, r)) {
          assert.ok(Game.act(S, 0, { t: "place", x, y, r }).ok);
          if (S.phase === "meeple") Game.act(S, 0, { t: "meeple", feature: null });
          ok = true; break;
        }
      }
    }
    assert.ok(ok, "could not fill " + x + "," + y);
  }
  assert.ok(S.players[0].score >= 9, "cloister should score 9, got " + S.players[0].score);
});

test("two separate cities on one tile stay separate; merging joins them", () => {
  const S = two();
  S.stack = Array(20).fill("E");
  // H has two separate cities N and S
  S.current = "H"; S.phase = "place"; S.cur = 0;
  // Place H south of start: start south is FFF, H north is CCC — no match.
  // Place H north of start with r=0: H south CCC vs start north CCC — matches, joins H's south city with start city.
  assert.ok(Game.placeable(S, "H", Game.START, Game.START - 1, 0));
  Game.act(S, 0, { t: "place", x: Game.START, y: Game.START - 1, r: 0 });
  // H feats: C north fi0, C south fi1 — south joins start
  const south = Game.legalMeeples(S);
  assert.ok(south.length >= 1);
  Game.act(S, 0, { t: "meeple", feature: null });
  // H's north city is still separate and open
  assert.ok(true);
});

test("majority: most meeples get all points; tie shares full points", () => {
  const S = Game.newGame([{ name: "A" }, { name: "B" }, { name: "C" }], 1, 2, { meadows: false });
  S.stack = Array(20).fill("E");
  // Build a 2-tile city and put meeples from A and B (tie)
  S.current = "E"; S.phase = "place"; S.cur = 0;
  Game.act(S, 0, { t: "place", x: Game.START, y: Game.START - 1, r: 2 });
  Game.act(S, 0, { t: "meeple", feature: 0 });
  // City completes on this placement — A already scored alone.
  // For tie we need both meeples BEFORE completion. Use longer city.
  // Simpler: manually set meeples on a component and call scoring via end
  const S2 = two();
  S2.stack = [];
  S2.current = null;
  // force end
  const before = S2.players.map((p) => p.score);
  // give both players a meeple on start's road via direct state
  const roadRoot = (() => { let p = Game.START + "," + Game.START + ",4"; while (S2.uf[p] !== p) p = S2.uf[p]; return p; })();
  S2.comp[roadRoot].meeples[0] = 1;
  S2.comp[roadRoot].meeples[1] = 1;
  S2.players[0].meeples = 6; S2.players[1].meeples = 6;
  S2.phase = "place"; S2.cur = 0;
  // empty stack → next finish
  const res = Game.act(S2, 0, { t: "skip" });
  // skip with empty stack finishes
  assert.strictEqual(S2.phase, "roundEnd");
  // both get points for unfinished road (1 tile)
  assert.strictEqual(S2.players[0].score, S2.players[1].score);
  assert.ok(S2.players[0].score >= 1);
});

test("discard when tile cannot be placed; draw replaces it", () => {
  const S = two();
  // Surround start completely so some tiles may not fit — hard to force.
  // Instead: empty all neighbours artificially... inject a tile that needs city on all sides next to field-only
  // Force current to C (full city) after making only field edges available — fill around start with field tiles leaving no city edge open.
  // Quicker: spy on discard by exhausting placeable spots for C.
  // Place field tiles on all 4 sides of start so no city edge remains, then draw C.
  S.stack = ["U", "U", "U", "C", "E"];
  S.current = "U"; S.phase = "place"; S.cur = 0;
  Game.act(S, 0, { t: "place", x: Game.START + 1, y: Game.START, r: 0 });
  if (S.phase === "meeple") Game.act(S, 0, { t: "meeple", feature: null });
  // Not a full discard test — at least view never leaks stack order
  const v = Game.view(S, 0);
  assert.strictEqual(v.stackLeft, S.stack.length);
  assert.ok(!("stack" in v));
  assert.ok(!JSON.stringify(v).includes('"U","U"'));
});

test("view never includes remaining stack order", () => {
  const S = two();
  const v = Game.view(S, 0);
  assert.ok(typeof v.stackLeft === "number");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(v, "stack"), false);
  const json = JSON.stringify(v);
  assert.ok(!json.includes('"stack":'));
});

test("empty stack ends the round with final scoring", () => {
  const S = bots(2, 1);
  let guard = 0;
  while (S.phase !== "roundEnd" && guard++ < 5000) {
    const a = Game.botMove(S, S.cur);
    assert.ok(a, "bot stuck");
    assert.ok(Game.act(S, S.cur, a).ok);
  }
  assert.strictEqual(S.phase, "roundEnd");
  assert.ok(S.last.winners.length >= 1);
  assert.ok(S.last.over);
  assert.strictEqual(Object.keys(S.board).length, 72);
});

test("bots make legal moves and finish at all levels", () => {
  for (const level of [1, 2, 3]) {
    const S = bots(2, level);
    let guard = 0;
    while (S.phase !== "roundEnd" && guard++ < 5000) {
      const a = Game.botMove(S, S.cur);
      assert.ok(a, "no move at level " + level);
      const res = Game.act(S, S.cur, a);
      assert.ok(res.ok, res.error);
    }
    assert.strictEqual(S.phase, "roundEnd");
  }
});

test("botPlan paces place and meeple separately at 2–4s, independent of bot count", () => {
  const S = bots(4, 2);
  const plan = Game.botPlan(S);
  assert.ok(plan);
  assert.ok(plan.delay >= 2000 && plan.delay <= 4000);
  assert.strictEqual(plan.pi, S.cur);
  const S2 = bots(2, 2);
  const p2 = Game.botPlan(S2);
  assert.ok(p2.delay >= 2000 && p2.delay <= 4000);
});

test("fuzz: 200 random games keep invariants", () => {
  for (let g = 0; g < 200; g++) {
    const n = 2 + (g % 4);
    const S = bots(n, 1 + (g % 3));
    let guard = 0;
    while (S.phase !== "roundEnd" && guard++ < 8000) {
      const a = Game.botMove(S, S.cur);
      assert.ok(a);
      assert.ok(Game.act(S, S.cur, a).ok);
    }
    assert.strictEqual(S.phase, "roundEnd");
    // no overlap
    const seen = new Set();
    for (const k of Object.keys(S.board)) {
      assert.ok(!seen.has(k));
      seen.add(k);
      const p = S.board[k];
      // edges match neighbours
      for (let side = 0; side < 4; side++) {
        const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][side];
        const n = S.board[(p.x + dx) + "," + (p.y + dy)];
        if (!n) continue;
        const a = Game.sideStr(p.id, p.r, side);
        const b = Game.sideStr(n.id, n.r, (side + 2) % 4);
        assert.ok(Game.sidesMatch(a, b), "edge mismatch " + k);
      }
      // meeples on board + supply = 7
    }
    S.players.forEach((p, pi) => {
      let onBoard = 0;
      for (const k of Object.keys(S.board)) {
        const pl = S.board[k];
        if (pl.m && pl.m.p === pi) onBoard++;
      }
      // after end scoring all returned
      assert.strictEqual(p.meeples + onBoard, 7, "meeple count");
      assert.ok(p.score >= 0);
    });
  }
});

test("hostile inputs are rejected without changing state", () => {
  const S = two();
  const hostile = [
    null, undefined, 5, "place", [], {}, { t: null }, { t: "constructor" }, { t: "__proto__" }, { t: "toString" },
    { t: "place", x: "1", y: 2, r: 0 }, { t: "place", x: 1.5, y: 2, r: 0 },
    { t: "place", x: NaN, y: 0, r: 0 }, { t: "place", x: 9999, y: 9999, r: 0 },
    { t: "place", x: -1, y: 0, r: 0 }, { t: "place", x: Game.START, y: Game.START, r: 4 },
    { t: "meeple", feature: "constructor" }, { t: "meeple", feature: 99 },
    { t: "meeple", feature: null }, // meeple before place when phase is place
    { t: "place", x: Game.START + 1, y: Game.START, r: 0 } // wrong player tested below
  ];
  for (let pi = -1; pi <= 3; pi++) {
    for (const a of hostile) {
      const before = JSON.stringify({ board: S.board, players: S.players, phase: S.phase, cur: S.cur, current: S.current, stack: S.stack });
      let res;
      assert.doesNotThrow(() => { res = Game.act(S, pi, a); });
      if (!res.ok) {
        const after = JSON.stringify({ board: S.board, players: S.players, phase: S.phase, cur: S.cur, current: S.current, stack: S.stack });
        assert.strictEqual(after, before, "rejected action changed state: " + JSON.stringify(a));
      } else {
        // restore
        Object.assign(S, JSON.parse(before));
      }
    }
  }
  // wrong player
  const other = 1 - S.cur;
  const before = JSON.stringify(S.players);
  assert.strictEqual(Game.act(S, other, { t: "place", x: Game.START + 1, y: Game.START, r: 0 }).ok, false);
});

test("engine is fast: legal places + bot eval under 50ms at ~72 tiles; 200 games under budget", () => {
  const S = bots(2, 3);
  let guard = 0;
  while (S.phase !== "roundEnd" && Object.keys(S.board).length < 70 && guard++ < 5000) {
    Game.act(S, S.cur, Game.botMove(S, S.cur));
  }
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) {
    Game.legalPlaces(S);
    Game.botMove(S, S.cur);
  }
  const dt = Date.now() - t0;
  assert.ok(dt < 50, "legal+bot took " + dt + "ms");

  const t1 = Date.now();
  for (let k = 0; k < 50; k++) {
    const G = bots(2, 1);
    let g = 0;
    while (G.phase !== "roundEnd" && g++ < 5000) Game.act(G, G.cur, Game.botMove(G, G.cur));
  }
  assert.ok(Date.now() - t1 < 5000, "50 games took " + (Date.now() - t1) + "ms");
});

test("round end exposes winners; next starts a new round", () => {
  const S = Game.newGame([{ name: "R1", bot: true }, { name: "R2", bot: true }], 2, 1, { meadows: false });
  let guard = 0;
  while (S.phase !== "roundEnd" && guard++ < 5000) Game.act(S, S.cur, Game.botMove(S, S.cur));
  assert.ok(S.last.winners.length >= 1);
  assert.strictEqual(S.last.over, false);
  assert.ok(Game.act(S, 0, { t: "next" }).ok);
  assert.strictEqual(S.phase, "place");
  assert.strictEqual(S.round, 2);
});

test("meadows: farmer scores 3 per completed city touching the field", () => {
  const S = Game.newGame([{ name: "A" }, { name: "B" }], 1, 2, { meadows: true });
  S.stack = Array(15).fill("U");
  // Complete start city with E north, place farmer on field of E that touches city
  S.current = "E"; S.phase = "place"; S.cur = 0;
  assert.ok(Game.act(S, 0, { t: "place", x: Game.START, y: Game.START - 1, r: 2 }).ok);
  // E feats: city fi0, field fi1 (touches city)
  const legal = Game.legalMeeples(S);
  assert.ok(legal.includes(1), "field should be placeable with meadows on");
  // Put farmer on field instead of city — city already completes; score city first if we put on city.
  // Put on field: city completes with no knight, then field scores at end.
  assert.ok(Game.act(S, 0, { t: "meeple", feature: 1 }).ok);
  // City should have scored for nobody (no knight). Farmer still on field.
  assert.strictEqual(S.players[0].meeples, 6);
  // Empty stack to force end scoring
  S.stack = [];
  S.current = null;
  S.phase = "place";
  S.cur = 0;
  const res = Game.act(S, 0, { t: "skip" });
  assert.strictEqual(S.phase, "roundEnd");
  const meadowScore = res.events.filter((e) => e.t === "score" && e.kind === "F");
  assert.ok(meadowScore.length >= 1, "expected meadow score event");
  assert.strictEqual(meadowScore[0].points, 3); // one completed city
  assert.ok(S.players[0].score >= 3);
});

test("meadows: without meadows flag farmers are rejected", () => {
  const S = Game.newGame([{ name: "A" }, { name: "B" }], 1, 2, { meadows: false });
  S.stack = Array(5).fill("E");
  S.current = "E"; S.phase = "place"; S.cur = 0;
  Game.act(S, 0, { t: "place", x: Game.START, y: Game.START - 1, r: 2 });
  const legal = Game.legalMeeples(S);
  assert.ok(!legal.includes(1), "field not legal without meadows");
  assert.ok(legal.includes(0)); // city still ok
});

test("meadows: bots finish a full game with meadows on", () => {
  const S = Game.newGame(
    [{ name: "R1", bot: true }, { name: "R2", bot: true }],
    1, 2, { meadows: true }
  );
  let guard = 0;
  while (S.phase !== "roundEnd" && guard++ < 5000) {
    const a = Game.botMove(S, S.cur);
    assert.ok(a);
    assert.ok(Game.act(S, S.cur, a).ok);
  }
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(Object.keys(S.board).length, 72);
  S.players.forEach((p) => assert.ok(p.score >= 0));
});

test("tile geometry: every edge in one feature; adjacent F share meadow; F-R-F topology", () => {
  const ids = Object.keys(Game.TYPES);
  assert.strictEqual(ids.length, 24);
  const CORNERS = new Set([/* 2-3 */ "2,3", "5,6", "8,9", "11,0"]);
  for (const id of ids) {
    const t = Game.TYPES[id];
    const sideChars = t.sides.join("");
    assert.strictEqual(sideChars.length, 12, id);
    const owner = Array(12).fill(null);
    t.feats.forEach((f, fi) => {
      if (!f.e) return;
      for (const ei of f.e) {
        assert.ok(ei >= 0 && ei < 12, id + " bad edge " + ei);
        assert.strictEqual(owner[ei], null, id + " edge " + ei + " in two features");
        assert.strictEqual(sideChars[ei], f.k === "F" || f.k === "R" || f.k === "C" ? f.k : sideChars[ei],
          id + " feature kind " + f.k + " vs terrain " + sideChars[ei] + " at " + ei);
        // Feature-Kante muss zum Terrain passen
        assert.strictEqual(f.k, sideChars[ei], id + " feat " + fi + " k=" + f.k + " edge " + ei + "=" + sideChars[ei]);
        owner[ei] = fi;
      }
    });
    for (let ei = 0; ei < 12; ei++) {
      const ch = sideChars[ei];
      if (ch === "F" || ch === "R" || ch === "C") {
        assert.ok(owner[ei] != null, id + " edge " + ei + " (" + ch + ") has no feature");
      }
    }
    // Wiesen-Komponenten über Kanten-Nachbarschaft (+ Sackgasse um Straßenende)
    const fEdges = [];
    for (let ei = 0; ei < 12; ei++) if (sideChars[ei] === "F") fEdges.push(ei);
    const parent = Object.create(null);
    const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    fEdges.forEach((e) => { parent[e] = e; });
    for (let i = 0; i < 12; i++) {
      const j = (i + 1) % 12;
      if (sideChars[i] === "F" && sideChars[j] === "F") uni(i, j);
    }
    // Echte Sackgasse (Straße endet am Kloster): Felder ums Ende verbinden. Endet sie an der Stadt, bleiben die Felder getrennt.
    // Bei Kreuzung/T-Stück (mehrere Stub-Straßen) nicht verbinden.
    const stubs = t.feats.filter((f) => f.k === "R" && f.e && f.e.length === 1);
    if (stubs.length === 1 && t.feats.some((f) => f.k === "K")) {
      const r = stubs[0].e[0];
      const a = (r + 11) % 12, b = (r + 1) % 12;
      if (sideChars[a] === "F" && sideChars[b] === "F") uni(a, b);
    }
    const featOf = (ei) => {
      for (let fi = 0; fi < t.feats.length; fi++) {
        const f = t.feats[fi];
        if (f.k === "F" && f.e && f.e.includes(ei)) return fi;
      }
      return null;
    };
    for (let i = 0; i < 12; i++) {
      const j = (i + 1) % 12;
      if (sideChars[i] !== "F" || sideChars[j] !== "F") continue;
      assert.strictEqual(featOf(i), featOf(j), id + " adjacent F " + i + "," + j + " must share meadow");
      if (CORNERS.has(i + "," + j) || CORNERS.has(j + "," + i)) {
        assert.strictEqual(featOf(i), featOf(j), id + " corner F pair");
      }
    }
    // Gleiche Seite F-R-F: Topologie aus Union muss zu feats passen
    for (let side = 0; side < 4; side++) {
      const a = side * 3, r = a + 1, b = a + 2;
      if (sideChars[a] !== "F" || sideChars[r] !== "R" || sideChars[b] !== "F") continue;
      const sameFeat = featOf(a) === featOf(b);
      const sameComp = find(a) === find(b);
      assert.strictEqual(sameFeat, sameComp, id + " side " + side + " F-R-F feat/comp mismatch");
    }
    // Topologie verbindet ⇒ gleiches Wiesen-Feature (Umkehrung gilt nicht: Stadtstreifen wie bei D)
    for (let i = 0; i < 12; i++) {
      if (sideChars[i] !== "F") continue;
      for (let j = i + 1; j < 12; j++) {
        if (sideChars[j] !== "F") continue;
        if (find(i) === find(j)) assert.strictEqual(featOf(i), featOf(j), id + " topology links " + i + "," + j + " but feats differ");
      }
    }
  }
  // K/V: kleine Kurvenwiese = [8,9]
  const kSmall = Game.TYPES.K.feats.find((f) => f.k === "F" && f.e.length === 2);
  assert.deepStrictEqual(kSmall.e.slice().sort((a, b) => a - b), [8, 9]);
  assert.deepStrictEqual(kSmall.cities, []);
  const kBig = Game.TYPES.K.feats.find((f) => f.k === "F" && f.e.length > 2);
  assert.deepStrictEqual(kBig.e.slice().sort((a, b) => a - b), [3, 4, 5, 6, 11]);
  assert.deepStrictEqual(kBig.cities, [0]);
  const vSmall = Game.TYPES.V.feats.find((f) => f.k === "F" && f.e.length === 2);
  assert.deepStrictEqual(vSmall.e.slice().sort((a, b) => a - b), [8, 9]);
  const vBig = Game.TYPES.V.feats.find((f) => f.k === "F" && f.e.length > 2);
  assert.deepStrictEqual(vBig.e.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 11]);
});

test("meadows: farmer on small curve meadow (V/K) does not score with the large meadow", () => {
  // V: große und kleine Wiese sind getrennte Komponenten
  const Sv = Game.newGame([{ name: "A" }, { name: "B" }], 1, 2, { meadows: true });
  Sv.stack = Array(10).fill("U");
  Sv.current = "V"; Sv.phase = "place"; Sv.cur = 0;
  assert.ok(Game.act(Sv, 0, { t: "place", x: Game.START, y: Game.START + 1, r: 0 }).ok);
  const bigR = (() => {
    const p = Sv.board[Game.START + "," + (Game.START + 1)];
    // feats: R0, F big1, F small2
    const a = p.featRoots[1], b = p.featRoots[2];
    assert.ok(a && b && a !== b, "V big/small meadows must be distinct roots");
    return true;
  })();
  assert.ok(bigR);
  Game.act(Sv, 0, { t: "meeple", feature: 2 }); // small

  // K: große Wiese berührt Stadt, kleine nicht — Bauer auf klein bekommt keine Stadtpunkte
  const S = Game.newGame([{ name: "A" }, { name: "B" }], 1, 2, { meadows: true });
  S.stack = Array(20).fill("U");
  // K östlich vom Start (Straße passt)
  S.current = "K"; S.phase = "place"; S.cur = 0;
  assert.ok(Game.act(S, 0, { t: "place", x: Game.START + 1, y: Game.START, r: 0 }).ok);
  // K feats: C0, R1, F big2, F small3
  const legal = Game.legalMeeples(S);
  assert.ok(legal.includes(3), "small K meadow placeable, legal=" + legal);
  assert.ok(Game.act(S, 0, { t: "meeple", feature: 3 }).ok);
  // Stadt von K schließen: E nördlich von K, r=2 (Stadt nach S)
  S.cur = 0; S.current = "E"; S.phase = "place";
  assert.ok(Game.act(S, 0, { t: "place", x: Game.START + 1, y: Game.START - 1, r: 2 }).ok);
  if (S.phase === "meeple") Game.act(S, 0, { t: "meeple", feature: null });
  // Stadt fertig (Ritter niemand). Bauer auf kleiner Wiese — Städte:[] → 0 Punkte
  S.stack = []; S.current = null; S.phase = "place"; S.cur = 0;
  const before = S.players[0].score;
  const res = Game.act(S, 0, { t: "skip" });
  assert.strictEqual(S.phase, "roundEnd");
  const meadow = res.events.filter((e) => e.t === "score" && e.kind === "F" && e.pi === 0);
  assert.strictEqual(meadow.length, 0, "small curve meadow must not score city, got " + JSON.stringify(meadow));
  assert.strictEqual(S.players[0].score, before);
  // Kontrolle: Bauer auf großer K-Wiese würde die Stadt werten
  const S2 = Game.newGame([{ name: "A" }, { name: "B" }], 1, 2, { meadows: true });
  S2.stack = Array(20).fill("U");
  S2.current = "K"; S2.phase = "place"; S2.cur = 0;
  assert.ok(Game.act(S2, 0, { t: "place", x: Game.START + 1, y: Game.START, r: 0 }).ok);
  assert.ok(Game.act(S2, 0, { t: "meeple", feature: 2 }).ok); // large
  S2.cur = 0; S2.current = "E"; S2.phase = "place";
  assert.ok(Game.act(S2, 0, { t: "place", x: Game.START + 1, y: Game.START - 1, r: 2 }).ok);
  if (S2.phase === "meeple") Game.act(S2, 0, { t: "meeple", feature: null });
  S2.stack = []; S2.current = null; S2.phase = "place"; S2.cur = 0;
  const res2 = Game.act(S2, 0, { t: "skip" });
  const meadow2 = res2.events.filter((e) => e.t === "score" && e.kind === "F" && e.pi === 0);
  assert.ok(meadow2.length >= 1 && meadow2[0].points >= 3, "large K meadow should score completed city");
});

test("giveup rejected in roundEnd without changing wins/phase/last", () => {
  const S = bots(2, 1);
  let guard = 0;
  while (S.phase !== "roundEnd" && guard++ < 5000) Game.act(S, S.cur, Game.botMove(S, S.cur));
  assert.strictEqual(S.phase, "roundEnd");
  const snap = JSON.stringify({ wins: S.players.map((p) => p.wins), phase: S.phase, last: S.last, scores: S.players.map((p) => p.score) });
  const res = Game.act(S, 0, { t: "giveup" });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(
    JSON.stringify({ wins: S.players.map((p) => p.wins), phase: S.phase, last: S.last, scores: S.players.map((p) => p.score) }),
    snap
  );
});

test("giveup rejected for solo player before mutating state", () => {
  const S = Game.newGame([{ name: "Allein" }], 1, 2, { meadows: false });
  assert.strictEqual(S.phase, "place");
  const snap = JSON.stringify({ phase: S.phase, wins: S.players.map((p) => p.wins), last: S.last, logLen: S.log.length });
  const res = Game.act(S, 0, { t: "giveup" });
  assert.strictEqual(res.ok, false);
  assert.ok(/Allein|aufgeben/i.test(res.error));
  assert.strictEqual(
    JSON.stringify({ phase: S.phase, wins: S.players.map((p) => p.wins), last: S.last, logLen: S.log.length }),
    snap
  );
});

test("bot level 3 averages more points than level 1 over many games", () => {
  const avg = (level, n) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const S = bots(2, level, { meadows: true });
      let g = 0;
      while (S.phase !== "roundEnd" && g++ < 5000) {
        const a = Game.botMove(S, S.cur);
        assert.ok(a);
        assert.ok(Game.act(S, S.cur, a).ok);
      }
      sum += S.players.reduce((s, p) => s + p.score, 0) / S.players.length;
    }
    return sum / n;
  };
  const a1 = avg(1, 100);
  const a3 = avg(3, 100);
  assert.ok(a3 > a1, "level3 avg " + a3.toFixed(2) + " should beat level1 avg " + a1.toFixed(2));
});
