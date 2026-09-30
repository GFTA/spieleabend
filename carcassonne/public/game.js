// Carcassonne engine. Pure state + rules, shared by browser and Node server. No DOM.
// Grundspiel: 72 Plättchen, Straßen/Städte/Klöster (Etappe 1) + Wiesen/Bauern (Etappe 2).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CarcassonneGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PLAYERS = 5;
  const MEEPLES = 7;
  const BOARD = 145; // Koordinaten 0..144, Start in der Mitte
  const START = 72;
  const BOT_NAMES = ["Robo Rudi", "Käpt'n Chip", "Pixel Paula", "Byte Ben", "Turbo Tina"];
  const AVATARS = (typeof module === "object" && module.exports ? require("../../shared/avatars.js") : self.SAAvatars).AVATARS;
  const BOT_AVATAR = "🤖";
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi" };
  const GOALS = { 1: "Eine Runde", 2: "Bis 2 Siege", 3: "Bis 3 Siege" };
  const COLORS = ["#e0393e", "#3b82f6", "#22c55e", "#eab308", "#a855f7"];

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const normGoal = (n) => (own(GOALS, String(+n)) ? +n : 1);
  const normLevel = (n) => (own(LEVELS, String(+n)) ? +n : 2);
  const avatarOf = (p, i) => (p.bot ? BOT_AVATAR : AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % AVATARS.length]);
  const rand = (n) => Math.floor(Math.random() * n);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  const keyXY = (x, y) => x + "," + y;

  // ---- Plättchen-Typen (Capaldi A–X, offizielle Verteilung inkl. Start) ----
  // sides: N,E,S,W je 3 Kantenfelder außen L→R (F/R/C). Passt wenn reverse equal.
  // feats: Merkmale; e = Kantenfeld-Indizes 0..11; s = Wappen; cities = lokale Stadt-Indizes (Wiese).
  // Kloster: k:'K' ohne Kanten. Straße/Stadt: offene Enden = Kanten ohne Nachbar.
  // Indizes: N:0,1,2  E:3,4,5  S:6,7,8  W:9,10,11
  const TYPES = {
    A: { n: 2, sides: ["FFF", "FFF", "FRF", "FFF"], feats: [
      { k: "K" },
      { k: "R", e: [7] },
      { k: "F", e: [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11], cities: [] }
    ]},
    B: { n: 4, sides: ["FFF", "FFF", "FFF", "FFF"], feats: [
      { k: "K" },
      { k: "F", e: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], cities: [] }
    ]},
    C: { n: 1, sides: ["CCC", "CCC", "CCC", "CCC"], feats: [
      { k: "C", e: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], s: 1 }
    ]},
    D: { n: 4, start: true, sides: ["CCC", "FRF", "FFF", "FRF"], feats: [
      { k: "C", e: [0, 1, 2], s: 0 },
      { k: "R", e: [4, 10] },
      { k: "F", e: [3, 11], cities: [0] },
      { k: "F", e: [5, 6, 7, 8, 9], cities: [] }
    ]},
    E: { n: 5, sides: ["CCC", "FFF", "FFF", "FFF"], feats: [
      { k: "C", e: [0, 1, 2], s: 0 },
      { k: "F", e: [3, 4, 5, 6, 7, 8, 9, 10, 11], cities: [0] }
    ]},
    F: { n: 2, sides: ["CCC", "FFF", "CCC", "FFF"], feats: [
      { k: "C", e: [0, 1, 2, 6, 7, 8], s: 1 },
      { k: "F", e: [3, 4, 5], cities: [0] },
      { k: "F", e: [9, 10, 11], cities: [0] }
    ]},
    G: { n: 1, sides: ["CCC", "FFF", "CCC", "FFF"], feats: [
      { k: "C", e: [0, 1, 2, 6, 7, 8], s: 0 },
      { k: "F", e: [3, 4, 5], cities: [0] },
      { k: "F", e: [9, 10, 11], cities: [0] }
    ]},
    H: { n: 3, sides: ["CCC", "FFF", "CCC", "FFF"], feats: [
      { k: "C", e: [0, 1, 2], s: 0 },
      { k: "C", e: [6, 7, 8], s: 0 },
      { k: "F", e: [3, 4, 5], cities: [0, 1] },
      { k: "F", e: [9, 10, 11], cities: [0, 1] }
    ]},
    I: { n: 2, sides: ["CCC", "FFF", "FFF", "CCC"], feats: [
      { k: "C", e: [0, 1, 2], s: 0 },
      { k: "C", e: [9, 10, 11], s: 0 },
      { k: "F", e: [3, 4, 5, 6, 7, 8], cities: [0, 1] }
    ]},
    J: { n: 3, sides: ["CCC", "FRF", "FRF", "FFF"], feats: [
      { k: "C", e: [0, 1, 2], s: 0 },
      { k: "R", e: [4, 7] },
      { k: "F", e: [3, 11, 10, 9, 8], cities: [0] },
      { k: "F", e: [5, 6], cities: [] }
    ]},
    K: { n: 3, sides: ["CCC", "FFF", "FRF", "FRF"], feats: [
      { k: "C", e: [0, 1, 2], s: 0 },
      { k: "R", e: [7, 10] },
      { k: "F", e: [3, 4, 5, 6, 11], cities: [0] },
      { k: "F", e: [8, 9], cities: [] }
    ]},
    L: { n: 3, sides: ["CCC", "FRF", "FRF", "FRF"], feats: [
      { k: "C", e: [0, 1, 2], s: 0 },
      { k: "R", e: [4] },
      { k: "R", e: [7] },
      { k: "R", e: [10] },
      { k: "F", e: [3, 11], cities: [0] },
      { k: "F", e: [5, 6], cities: [] },
      { k: "F", e: [8, 9], cities: [] }
    ]},
    M: { n: 2, sides: ["CCC", "CCC", "FFF", "FFF"], feats: [
      { k: "C", e: [0, 1, 2, 3, 4, 5], s: 1 },
      { k: "F", e: [6, 7, 8, 9, 10, 11], cities: [0] }
    ]},
    N: { n: 3, sides: ["CCC", "CCC", "FFF", "FFF"], feats: [
      { k: "C", e: [0, 1, 2, 3, 4, 5], s: 0 },
      { k: "F", e: [6, 7, 8, 9, 10, 11], cities: [0] }
    ]},
    O: { n: 2, sides: ["CCC", "CCC", "FRF", "FFF"], feats: [
      { k: "C", e: [0, 1, 2, 3, 4, 5], s: 1 },
      { k: "R", e: [7] },
      { k: "F", e: [6, 8, 9, 10, 11], cities: [0] }
    ]},
    P: { n: 3, sides: ["CCC", "CCC", "FRF", "FFF"], feats: [
      { k: "C", e: [0, 1, 2, 3, 4, 5], s: 0 },
      { k: "R", e: [7] },
      { k: "F", e: [6, 8, 9, 10, 11], cities: [0] }
    ]},
    Q: { n: 1, sides: ["CCC", "CCC", "FFF", "CCC"], feats: [
      { k: "C", e: [0, 1, 2, 3, 4, 5, 9, 10, 11], s: 1 },
      { k: "F", e: [6, 7, 8], cities: [0] }
    ]},
    R: { n: 3, sides: ["CCC", "CCC", "FFF", "CCC"], feats: [
      { k: "C", e: [0, 1, 2, 3, 4, 5, 9, 10, 11], s: 0 },
      { k: "F", e: [6, 7, 8], cities: [0] }
    ]},
    S: { n: 2, sides: ["CCC", "CCC", "FRF", "CCC"], feats: [
      { k: "C", e: [0, 1, 2, 3, 4, 5, 9, 10, 11], s: 1 },
      { k: "R", e: [7] },
      { k: "F", e: [6, 8], cities: [0] }
    ]},
    T: { n: 1, sides: ["CCC", "CCC", "FRF", "CCC"], feats: [
      { k: "C", e: [0, 1, 2, 3, 4, 5, 9, 10, 11], s: 0 },
      { k: "R", e: [7] },
      { k: "F", e: [6, 8], cities: [0] }
    ]},
    U: { n: 8, sides: ["FFF", "FRF", "FFF", "FRF"], feats: [
      { k: "R", e: [4, 10] },
      { k: "F", e: [0, 1, 2, 3, 11], cities: [] },
      { k: "F", e: [5, 6, 7, 8, 9], cities: [] }
    ]},
    V: { n: 9, sides: ["FFF", "FFF", "FRF", "FRF"], feats: [
      { k: "R", e: [7, 10] },
      { k: "F", e: [0, 1, 2, 3, 4, 5, 6, 11], cities: [] },
      { k: "F", e: [8, 9], cities: [] }
    ]},
    W: { n: 4, sides: ["FFF", "FRF", "FRF", "FRF"], feats: [
      { k: "R", e: [4] },
      { k: "R", e: [7] },
      { k: "R", e: [10] },
      { k: "F", e: [0, 1, 2, 3, 11], cities: [] },
      { k: "F", e: [5, 6], cities: [] },
      { k: "F", e: [8, 9], cities: [] }
    ]},
    X: { n: 1, sides: ["FRF", "FRF", "FRF", "FRF"], feats: [
      { k: "R", e: [1] },
      { k: "R", e: [4] },
      { k: "R", e: [7] },
      { k: "R", e: [10] },
      { k: "F", e: [0, 11], cities: [] },
      { k: "F", e: [2, 3], cities: [] },
      { k: "F", e: [5, 6], cities: [] },
      { k: "F", e: [8, 9], cities: [] }
    ]}
  };

  // Terrain-Char je Kantenfeld eines Typs (unge dreht)
  function edgeTerrain(typeId, ei) {
    const t = TYPES[typeId];
    const side = (ei / 3) | 0;
    const pos = ei % 3;
    return t.sides[side][pos];
  }

  function rotateSides(sides, r) {
    const out = [];
    for (let i = 0; i < 4; i++) out.push(sides[(i - r + 4) % 4]);
    return out;
  }
  function rotEdge(ei, r) { return (ei + r * 3) % 12; }
  function sideStr(typeId, r, side) { return rotateSides(TYPES[typeId].sides, r)[side]; }
  function sidesMatch(a, b) { return a === b.split("").reverse().join(""); }

  function buildDeck() {
    const deck = [];
    let startId = null;
    for (const id of Object.keys(TYPES)) {
      const t = TYPES[id];
      for (let i = 0; i < t.n; i++) {
        if (t.start && startId == null) { startId = id; continue; }
        deck.push(id);
      }
    }
    return { start: startId || "D", deck: shuffle(deck) };
  }

  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 80) S.log.shift();
  }

  // ---- Union-Find über Brett-Kantenfelder ----
  // Jedes belegte Kantenfeld: "x,y,ei"
  function ufParent(S, id) {
    const p = S.uf[id];
    if (p == null) { S.uf[id] = id; return id; }
    if (p !== id) S.uf[id] = ufParent(S, p);
    return S.uf[id];
  }
  function ufUnion(S, a, b) {
    const ra = ufParent(S, a), rb = ufParent(S, b);
    if (ra === rb) return ra;
    S.uf[rb] = ra;
    // merge meta
    const A = S.comp[ra] || emptyComp(), B = S.comp[rb] || emptyComp();
    delete S.comp[rb];
    A.tiles = Object.assign(A.tiles, B.tiles);
    A.shields += B.shields;
    A.open += B.open;
    A.kind = A.kind || B.kind;
    for (const pi of Object.keys(B.meeples)) A.meeples[pi] = (A.meeples[pi] || 0) + B.meeples[pi];
    // field→cities
    for (const ck of Object.keys(B.cities || {})) A.cities[ck] = true;
    S.comp[ra] = A;
    return ra;
  }
  function emptyComp() {
    return { kind: null, tiles: Object.create(null), shields: 0, open: 0, meeples: Object.create(null), cities: Object.create(null) };
  }
  function edgeId(x, y, ei) { return x + "," + y + "," + ei; }

  // Nachbar-Kantenfeld über die Brettkante (gleiche physische Kante)
  const OPP = [[0, -1, 2], [1, 0, 3], [0, 1, 0], [-1, 0, 1]]; // side → (dx,dy,oppSide)
  function neighborEdge(x, y, ei) {
    const side = (ei / 3) | 0;
    const pos = ei % 3;
    const [dx, dy, os] = OPP[side];
    return { x: x + dx, y: y + dy, ei: os * 3 + (2 - pos) };
  }

  function ensureComp(S, root, kind) {
    if (!S.comp[root]) S.comp[root] = emptyComp();
    if (kind) S.comp[root].kind = kind;
    return S.comp[root];
  }

  // Plättchen an (x,y) mit Rotation r einbinden (nachdem board[xy] gesetzt)
  function linkTile(S, x, y, typeId, r, localShields) {
    const placed = S.board[keyXY(x, y)];
    const type = TYPES[typeId];
    // lokale Feature → initial eigene Komponenten
    const featRoots = [];
    type.feats.forEach((f, fi) => {
      if (f.k === "K") {
        const id = "K:" + x + "," + y;
        S.uf[id] = id;
        const c = ensureComp(S, id, "K");
        c.tiles[keyXY(x, y)] = true;
        featRoots[fi] = id;
        return;
      }
      if (!f.e || !f.e.length) { featRoots[fi] = null; return; }
      // alle Kantenfelder dieses Merkmals verbinden
      let root = null;
      for (const lei of f.e) {
        const ei = rotEdge(lei, r);
        const id = edgeId(x, y, ei);
        S.uf[id] = id;
        if (root == null) root = id;
        else root = ufUnion(S, root, id);
      }
      const c = ensureComp(S, ufParent(S, root), f.k);
      c.tiles[keyXY(x, y)] = true;
      if (f.s) c.shields += f.s;
      // offene Enden: jedes Kantenfeld zählt +1 open, Nachbar später −2 (beide Seiten)
      c.open += f.e.length;
      featRoots[fi] = ufParent(S, root);
      // Wiesen: angrenzende Städte dieses Plättchens vormerken (als "x,y,fi")
      if (f.k === "F" && f.cities) {
        for (const ci of f.cities) c.cities[x + "," + y + "," + ci] = true;
      }
    });
    placed.featRoots = featRoots;

    // mit Nachbarn verbinden
    for (let ei = 0; ei < 12; ei++) {
      const terr = edgeTerrain(typeId, (ei - r * 3 + 12) % 12);
      // terrain of this edge after rotation: sideStr
      const side = (ei / 3) | 0;
      const pos = ei % 3;
      const ch = sideStr(typeId, r, side)[pos];
      const nb = neighborEdge(x, y, ei);
      const nk = keyXY(nb.x, nb.y);
      if (!S.board[nk]) continue;
      const id = edgeId(x, y, ei);
      const nid = edgeId(nb.x, nb.y, nb.ei);
      if (S.uf[nid] == null) continue;
      // open: zwei offene Enden schließen sich (−1 je Seite)
      const ra = ufParent(S, id), rb = ufParent(S, nid);
      if (ra !== rb) {
        const A = ensureComp(S, ra), B = ensureComp(S, rb);
        // vor Union open anpassen
        A.open -= 1; B.open -= 1;
        ufUnion(S, ra, rb);
      } else {
        ensureComp(S, ra).open -= 2;
      }
    }
  }

  function placeable(S, typeId, x, y, r) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= BOARD || y >= BOARD) return false;
    if (!Number.isInteger(r) || r < 0 || r > 3) return false;
    if (S.board[keyXY(x, y)]) return false;
    let neighbors = 0;
    for (let side = 0; side < 4; side++) {
      const [dx, dy] = OPP[side];
      const nx = x + dx, ny = y + dy;
      const n = S.board[keyXY(nx, ny)];
      if (!n) continue;
      neighbors++;
      const my = sideStr(typeId, r, side);
      const their = sideStr(n.id, n.r, (side + 2) % 4);
      if (!sidesMatch(my, their)) return false;
    }
    return neighbors > 0;
  }

  function legalPlaces(S, typeId) {
    const tid = typeId || S.current;
    if (!tid || !own(TYPES, tid)) return [];
    const seen = Object.create(null);
    const out = [];
    for (const k of Object.keys(S.board)) {
      const [bx, by] = k.split(",").map(Number);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const x = bx + dx, y = by + dy;
        const ck = keyXY(x, y);
        if (S.board[ck] || seen[ck]) continue;
        seen[ck] = true;
        for (let r = 0; r < 4; r++) if (placeable(S, tid, x, y, r)) out.push({ x, y, r });
      }
    }
    return out;
  }

  function componentOf(S, x, y, fi) {
    const p = S.board[keyXY(x, y)];
    if (!p || p.featRoots == null || fi < 0 || fi >= p.featRoots.length) return null;
    const root = p.featRoots[fi];
    if (root == null) return null;
    return ufParent(S, root);
  }

  function featureFree(S, root) {
    const c = S.comp[root];
    if (!c) return true;
    for (const pi of Object.keys(c.meeples)) if (c.meeples[pi] > 0) return false;
    return true;
  }

  function legalMeeples(S) {
    // Merkmale des gerade gelegten Plättchens, die frei sind (Straßen/Städte/Klöster; Wiesen Etappe 2)
    if (S.phase !== "meeple" || !S.lastPlace) return [];
    const { x, y } = S.lastPlace;
    const p = S.board[keyXY(x, y)];
    if (!p) return [];
    const type = TYPES[p.id];
    const out = [];
    const me = S.players[S.cur];
    if (!me || me.meeples <= 0) return out;
    type.feats.forEach((f, fi) => {
      if (f.k === "F" && !S.meadows) return; // Etappe 1: keine Bauern
      if (f.k !== "R" && f.k !== "C" && f.k !== "K" && f.k !== "F") return;
      const root = componentOf(S, x, y, fi);
      if (root != null && featureFree(S, root)) out.push(fi);
    });
    return out;
  }

  function cloisterDone(S, x, y) {
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      if (S.board[keyXY(x + dx, y + dy)]) n++;
    }
    return n;
  }

  function scoreComponent(S, root, endGame, events) {
    const c = S.comp[root];
    if (!c || c.scored) return;
    const kind = c.kind;
    if (kind !== "R" && kind !== "C" && kind !== "K") return;
    let points = 0, done = false;
    const tileCount = Object.keys(c.tiles).length;
    if (kind === "R") {
      done = c.open <= 0;
      if (done || endGame) points = tileCount * 1;
    } else if (kind === "C") {
      done = c.open <= 0;
      if (done) points = tileCount * 2 + c.shields * 2;
      else if (endGame) points = tileCount * 1 + c.shields * 1;
    } else if (kind === "K") {
      const xy = Object.keys(c.tiles)[0].split(",").map(Number);
      const neigh = cloisterDone(S, xy[0], xy[1]);
      done = neigh === 8;
      if (done) points = 9;
      else if (endGame) points = 1 + neigh;
    }
    if (!done && !endGame) return;
    if (points <= 0 && !Object.keys(c.meeples).some((pi) => c.meeples[pi] > 0)) {
      if (done) c.scored = true;
      return;
    }
    // Mehrheit
    let best = 0;
    const holders = [];
    for (const pi of Object.keys(c.meeples)) {
      const n = c.meeples[pi];
      if (n > best) { best = n; holders.length = 0; holders.push(+pi); }
      else if (n === best && n > 0) holders.push(+pi);
    }
    if (best > 0 && points > 0) {
      for (const pi of holders) {
        S.players[pi].score += points;
        const tiles = Object.keys(c.tiles).map((tk) => { const [tx, ty] = tk.split(",").map(Number); return { x: tx, y: ty }; });
        events.push({ t: "score", pi, points, kind, done: !!done, end: !!endGame, tiles });
        log(S, `${S.players[pi].name} +${points} (${kind === "R" ? "Straße" : kind === "C" ? "Stadt" : "Kloster"}${done && !endGame ? "" : endGame ? ", Ende" : ""}).`);
      }
    }
    // Meeples zurück
    for (const pi of Object.keys(c.meeples)) {
      const n = c.meeples[pi];
      if (n > 0) S.players[pi].meeples += n;
      c.meeples[pi] = 0;
    }
    // Meeple-Marker auf Plättchen entfernen
    for (const tk of Object.keys(c.tiles)) {
      const pl = S.board[tk];
      if (pl && pl.m && componentOf(S, pl.x, pl.y, pl.m.f) === ufParent(S, root)) pl.m = null;
    }
    c.scored = true;
  }

  function scoreAfterPlace(S, x, y, events) {
    const p = S.board[keyXY(x, y)];
    if (!p) return;
    const seen = Object.create(null);
    TYPES[p.id].feats.forEach((f, fi) => {
      if (f.k !== "R" && f.k !== "C" && f.k !== "K") return;
      const root = componentOf(S, x, y, fi);
      if (root == null || seen[root]) return;
      seen[root] = true;
      scoreComponent(S, root, false, events);
    });
    // Klöster in der 3×3-Nachbarschaft prüfen
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const nx = x + dx, ny = y + dy;
      const np = S.board[keyXY(nx, ny)];
      if (!np) continue;
      TYPES[np.id].feats.forEach((f, fi) => {
        if (f.k !== "K") return;
        const root = componentOf(S, nx, ny, fi);
        if (root == null || seen[root]) return;
        seen[root] = true;
        scoreComponent(S, root, false, events);
      });
    }
  }

  function isCityComplete(S, cityKey) {
    // cityKey = "x,y,localFi"
    const [xs, ys, fis] = cityKey.split(",");
    const x = +xs, y = +ys, fi = +fis;
    const root = componentOf(S, x, y, fi);
    if (root == null) return false;
    const c = S.comp[root];
    return !!(c && c.kind === "C" && c.open <= 0);
  }

  function scoreMeadows(S, events) {
    if (!S.meadows) return;
    const seen = Object.create(null);
    for (const k of Object.keys(S.board)) {
      const p = S.board[k];
      TYPES[p.id].feats.forEach((f, fi) => {
        if (f.k !== "F") return;
        const root = componentOf(S, p.x, p.y, fi);
        if (root == null || seen[root]) return;
        seen[root] = true;
        const c = S.comp[root];
        if (!c) return;
        // fertige Städte an der Wiese
        const cities = Object.create(null);
        for (const ck of Object.keys(c.cities || {})) {
          if (!isCityComplete(S, ck)) continue;
          // Stadt-Komponente als Einheit
          const [xs, ys, fis] = ck.split(",");
          const cr = componentOf(S, +xs, +ys, +fis);
          if (cr) cities[cr] = true;
        }
        const nCities = Object.keys(cities).length;
        if (!nCities) {
          // Meeples trotzdem zurück
          for (const pi of Object.keys(c.meeples)) {
            const n = c.meeples[pi];
            if (n > 0) S.players[pi].meeples += n;
            c.meeples[pi] = 0;
          }
          for (const tk of Object.keys(c.tiles)) {
            const pl = S.board[tk];
            if (pl && pl.m && componentOf(S, pl.x, pl.y, pl.m.f) === ufParent(S, root)) pl.m = null;
          }
          return;
        }
        const points = nCities * 3;
        let best = 0;
        const holders = [];
        for (const pi of Object.keys(c.meeples)) {
          const n = c.meeples[pi];
          if (n > best) { best = n; holders.length = 0; holders.push(+pi); }
          else if (n === best && n > 0) holders.push(+pi);
        }
        if (best > 0) {
          for (const pi of holders) {
            S.players[pi].score += points;
            const tiles = Object.keys(c.tiles).map((tk) => { const [tx, ty] = tk.split(",").map(Number); return { x: tx, y: ty }; });
            events.push({ t: "score", pi, points, kind: "F", done: true, end: true, tiles });
            log(S, `${S.players[pi].name} +${points} (Wiese, ${nCities} Städte).`);
          }
        }
        for (const pi of Object.keys(c.meeples)) {
          const n = c.meeples[pi];
          if (n > 0) S.players[pi].meeples += n;
          c.meeples[pi] = 0;
        }
        for (const tk of Object.keys(c.tiles)) {
          const pl = S.board[tk];
          if (pl && pl.m && componentOf(S, pl.x, pl.y, pl.m.f) === ufParent(S, root)) pl.m = null;
        }
        c.scored = true;
      });
    }
  }

  function endGameScoring(S, events) {
    const seen = Object.create(null);
    for (const k of Object.keys(S.comp)) {
      const root = ufParent(S, k);
      if (seen[root]) continue;
      seen[root] = true;
      scoreComponent(S, root, true, events);
    }
    scoreMeadows(S, events);
  }

  function drawTile(S, events) {
    while (S.stack.length) {
      const id = S.stack.pop();
      S.current = id;
      events.push({ t: "draw", id, left: S.stack.length });
      if (legalPlaces(S, id).length) return true;
      // unlegbar → ablegen
      events.push({ t: "discard", id });
      log(S, `Plättchen ${id} nicht legbar — abgelegt.`);
      S.discarded.push(id);
      S.current = null;
    }
    S.current = null;
    return false;
  }

  function beginTurn(S, pi, events) {
    S.cur = pi;
    S.turn++;
    S.phase = "place";
    S.lastPlace = null;
    if (!drawTile(S, events)) {
      // Stapel leer → Schlusswertung
      finishRound(S, events);
    }
  }

  function finishRound(S, events) {
    endGameScoring(S, events);
    events.push({ t: "endScore" });
    // Gewinner
    let best = -1;
    const winners = [];
    S.players.forEach((p, i) => {
      if (p.score > best) { best = p.score; winners.length = 0; winners.push(i); }
      else if (p.score === best) winners.push(i);
    });
    for (const w of winners) S.players[w].wins++;
    const over = winners.some((w) => S.players[w].wins >= S.goal);
    S.phase = "roundEnd";
    S.cur = -1;
    S.current = null;
    S.last = { winners, over, scores: S.players.map((p) => p.score) };
    log(S, winners.length > 1
      ? `Gleichstand: ${winners.map((i) => S.players[i].name).join(", ")}!`
      : `${S.players[winners[0]].name} ${over ? "gewinnt das Spiel" : "gewinnt die Runde"}!`);
    events.push({ t: "end", winners });
  }

  function nextPlayer(S, events) {
    if (!S.stack.length && !S.current) { finishRound(S, events); return; }
    beginTurn(S, (S.cur + 1) % S.players.length, events);
  }

  function newGame(players, goal, level, opts) {
    const meadows = !opts || opts.meadows !== false; // Etappe 2: Wiesen an (Tests können abschalten)
    const { start, deck } = buildDeck();
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p, i) => ({
        name: p.name, bot: !!p.bot, avatar: avatarOf(p, i),
        wins: 0, score: 0, meeples: MEEPLES, color: COLORS[i % COLORS.length]
      })),
      goal: normGoal(goal), level: normLevel(level),
      meadows: !!meadows,
      round: 0, starter: rand(Math.max(1, players.length)),
      log: [], last: null,
      board: Object.create(null),
      stack: [], discarded: [],
      current: null,
      uf: Object.create(null),
      comp: Object.create(null),
      phase: "play",
      cur: 0, turn: 0,
      lastPlace: null
    };
    startRound(S);
    return S;
  }

  function startRound(S) {
    S.round++;
    S.log = [];
    S.last = null;
    S.board = Object.create(null);
    S.uf = Object.create(null);
    S.comp = Object.create(null);
    S.discarded = [];
    S.players.forEach((p) => { p.score = 0; p.meeples = MEEPLES; });
    const { start, deck } = buildDeck();
    S.stack = deck;
    // Startplättchen
    const sx = START, sy = START;
    S.board[keyXY(sx, sy)] = { id: start, x: sx, y: sy, r: 0, m: null, featRoots: [] };
    linkTile(S, sx, sy, start, 0);
    const first = S.starter % S.players.length;
    S.starter = (S.starter + 1) % S.players.length;
    S.turn = 0;
    log(S, `Runde ${S.round}: Startplättchen gelegt. ${S.players[first].name} beginnt.`);
    const events = [];
    beginTurn(S, first, events);
    S._bootEvents = events;
  }

  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events });
    const ok = () => ({ ok: true, events });
    const P = S.players[pi];
    if (!P) return fail("Unbekannter Spieler.");
    if (!a || typeof a !== "object" || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
      if (S.last && S.last.over) { S.players.forEach((p) => { p.wins = 0; }); S.round = 0; }
      startRound(S);
      return ok();
    }
    if (a.t === "skip") {
      if (S.phase === "roundEnd") return fail("Die Runde ist vorbei.");
      log(S, `${S.players[S.cur].name} wird übersprungen.`);
      if (S.phase === "meeple") {
        // ohne Meeple weiter
        scoreAfterPlace(S, S.lastPlace.x, S.lastPlace.y, events);
        nextPlayer(S, events);
      } else nextPlayer(S, events);
      return ok();
    }
    if (a.t === "giveup") {
      if (S.phase !== "place" && S.phase !== "meeple") return fail("Jetzt kann man nicht aufgeben.");
      const rest = S.players.map((_, i) => i).filter((i) => i !== pi).sort((x, y) => S.players[y].score - S.players[x].score);
      if (!rest.length) return fail("Allein kann man nicht aufgeben.");
      log(S, `${P.name} gibt auf.`);
      events.push({ t: "giveup", pi });
      // Sofort Rundenende — Aufgabe = bester anderer gewinnt (nach Schlusswertung).
      endGameScoring(S, events);
      events.push({ t: "endScore" });
      const winners = [rest[0]];
      S.players[winners[0]].wins++;
      const over = S.players[winners[0]].wins >= S.goal;
      S.phase = "roundEnd";
      S.cur = -1;
      S.current = null;
      S.last = { winners, over, scores: S.players.map((p) => p.score) };
      events.push({ t: "end", winners });
      return ok();
    }

    if (S.phase !== "place" && S.phase !== "meeple") return fail("Gerade ist niemand dran.");
    if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);

    if (a.t === "place") {
      if (S.phase !== "place") return fail("Jetzt wird ein Gefolgsmann gesetzt.");
      const x = a.x, y = a.y, r = a.r;
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(r)) return fail("Ungültige Koordinaten.");
      if (x < 0 || y < 0 || x >= BOARD || y >= BOARD || r < 0 || r > 3) return fail("Außerhalb des Bretts.");
      if (!S.current || !own(TYPES, S.current)) return fail("Kein Plättchen.");
      if (!placeable(S, S.current, x, y, r)) return fail("So lässt sich das Plättchen nicht anlegen.");
      const id = S.current;
      S.board[keyXY(x, y)] = { id, x, y, r, m: null, featRoots: [] };
      linkTile(S, x, y, id, r);
      S.current = null;
      S.lastPlace = { x, y, r, id };
      S.phase = "meeple";
      events.push({ t: "place", pi, id, x, y, r });
      log(S, `${P.name} legt ${id} auf (${x - START},${y - START}).`);
      // Wenn keine Meeples / keine legalen Merkmale: auto-skip meeple
      if (P.meeples <= 0 || legalMeeples(S).length === 0) {
        scoreAfterPlace(S, x, y, events);
        nextPlayer(S, events);
      }
      return ok();
    }

    if (a.t === "meeple") {
      if (S.phase !== "meeple") return fail("Zuerst ein Plättchen legen.");
      if (!S.lastPlace) return fail("Kein Plättchen gelegt.");
      const { x, y } = S.lastPlace;
      const feat = a.feature;
      if (feat != null) {
        if (!Number.isInteger(feat)) return fail("Ungültiges Merkmal.");
        const legal = legalMeeples(S);
        if (!legal.includes(feat)) return fail("Dieses Merkmal ist besetzt oder ungültig.");
        if (P.meeples <= 0) return fail("Keine Gefolgsleute mehr.");
        const p = S.board[keyXY(x, y)];
        const type = TYPES[p.id];
        if (feat < 0 || feat >= type.feats.length) return fail("Ungültiges Merkmal.");
        const f = type.feats[feat];
        if (f.k === "F" && !S.meadows) return fail("Bauern erst in Etappe 2.");
        const root = componentOf(S, x, y, feat);
        if (root == null || !featureFree(S, root)) return fail("Merkmal besetzt.");
        P.meeples--;
        const c = ensureComp(S, root, f.k);
        c.meeples[pi] = (c.meeples[pi] || 0) + 1;
        p.m = { p: pi, f: feat };
        events.push({ t: "meeple", pi, x, y, feature: feat, kind: f.k });
        log(S, `${P.name} setzt einen Gefolgsmann (${f.k === "R" ? "Straße" : f.k === "C" ? "Stadt" : f.k === "K" ? "Kloster" : "Wiese"}).`);
      } else {
        events.push({ t: "meeple", pi, x, y, feature: null });
      }
      scoreAfterPlace(S, x, y, events);
      nextPlayer(S, events);
      return ok();
    }

    return fail("Unbekannte Aktion.");
  }

  // ---- Bot ----
  function peekNeighborRoot(S, x, y, ei) {
    const nb = neighborEdge(x, y, ei);
    if (!S.board[keyXY(nb.x, nb.y)]) return null;
    const nid = edgeId(nb.x, nb.y, nb.ei);
    if (S.uf[nid] == null) return null;
    return ufParent(S, nid);
  }

  function meadowFarmerValue(S, type, f, x, y, r) {
    // >0 nur wenn fertige/fast fertige Städte an der Wiese
    let v = 0;
    for (const ci of (f.cities || [])) {
      const cf = type.feats[ci];
      if (!cf || cf.k !== "C" || !cf.e) continue;
      let open = cf.e.length;
      for (const lei of cf.e) {
        if (peekNeighborRoot(S, x, y, rotEdge(lei, r)) != null) open--;
      }
      if (open <= 0) v += 3;
      else if (open <= 2) v += 1;
    }
    for (const lei of (f.e || [])) {
      const root = peekNeighborRoot(S, x, y, rotEdge(lei, r));
      if (root == null) continue;
      const c = S.comp[root];
      if (!c || c.kind !== "F") continue;
      for (const ck of Object.keys(c.cities || {})) {
        if (isCityComplete(S, ck)) { v += 2; continue; }
        const parts = ck.split(",");
        const cr = componentOf(S, +parts[0], +parts[1], +parts[2]);
        if (cr && S.comp[cr] && S.comp[cr].open <= 2) v += 1;
      }
    }
    return v;
  }

  function botScoreMove(S, move, feat, pi, level) {
    // Stufe 2: gierige Heuristik. Stufe 3: eigene Fertigstellung / Gegner blocken, Bauern selektiv.
    let s = level >= 3 ? rand(1) * 0.5 : rand(3);
    const type = TYPES[S.current];
    const { x, y, r } = move;
    if (type.feats.some((f) => f.k === "C" && f.s)) s += 2;
    if (type.feats.some((f) => f.k === "K")) s += 1;
    s -= (Math.abs(x - START) + Math.abs(y - START)) * 0.01;

    type.feats.forEach((f, fi) => {
      if (f.k !== "R" && f.k !== "C") return;
      const edges = f.e || [];
      let connects = 0, touchOwn = 0, touchOpp = 0, touchFree = 0, minOpen = 99;
      const seen = Object.create(null);
      for (const lei of edges) {
        const root = peekNeighborRoot(S, x, y, rotEdge(lei, r));
        if (root == null) continue;
        connects++;
        if (seen[root]) continue;
        seen[root] = true;
        const c = S.comp[root];
        if (!c || c.kind !== f.k) continue;
        if (c.open < minOpen) minOpen = c.open;
        let own = 0, opp = 0;
        for (const pj of Object.keys(c.meeples)) {
          if ((c.meeples[pj] || 0) <= 0) continue;
          if (+pj === pi) own += c.meeples[pj];
          else opp += c.meeples[pj];
        }
        if (own > 0) touchOwn++;
        else if (opp > 0) touchOpp++;
        else touchFree++;
      }
      // grob: alle Kanten treffen Nachbarn → Merkmal wird oft fertig
      const likelyClose = edges.length > 0 && connects >= edges.length;
      if (level >= 3) {
        if (touchOwn > 0) s += likelyClose ? 14 : 5;
        if (touchOpp > 0 && likelyClose) {
          if (feat === fi) s += 6; // mitbesetzen / Mehrheit
          else s -= 12; // Gegner nicht fertigmachen
        }
        if (touchFree > 0 && (likelyClose || minOpen <= 2)) s += feat === fi ? 7 : 2;
      } else {
        if (touchOwn > 0) s += 3;
        if (touchFree > 0 && likelyClose) s += 2;
      }
    });

    // Kloster: eigene Füllung + Nachbar-Klöster
    if (type.feats.some((f) => f.k === "K")) s += cloisterDone(S, x, y) * (level >= 3 ? 1.5 : 0.6);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const np = S.board[keyXY(x + dx, y + dy)];
      if (!np) continue;
      const nt = TYPES[np.id];
      if (!nt.feats.some((f) => f.k === "K")) continue;
      const root = componentOf(S, np.x, np.y, nt.feats.findIndex((f) => f.k === "K"));
      if (root == null) continue;
      const c = S.comp[root];
      if (!c) continue;
      const mine = (c.meeples[pi] || 0) > 0;
      if (mine) s += level >= 3 ? 4 : 1.5;
      else if (level >= 3 && Object.keys(c.meeples).some((pj) => c.meeples[pj] > 0 && +pj !== pi)) s += 0.5;
    }

    if (feat != null) {
      const f = type.feats[feat];
      if (f.k === "C") s += level >= 3 ? 4 : 3;
      else if (f.k === "K") s += 5;
      else if (f.k === "R") s += level >= 3 ? 2 : 1;
      else if (f.k === "F") {
        if (level >= 3) {
          const mv = meadowFarmerValue(S, type, f, x, y, r);
          s += mv > 0 ? mv + 1 : -6;
        } else s += 0.5;
      }
    } else if (level >= 3) {
      s += 0.2; // gelegentlich sparen ok
    }
    return s;
  }

  function botMove(S, pi) {
    if (!S.players[pi] || !S.players[pi].bot) return null;
    if (S.phase === "place" && S.cur === pi) {
      const places = legalPlaces(S);
      if (!places.length) return null;
      const level = S.level || 2;
      if (level === 1) return Object.assign({ t: "place" }, places[rand(places.length)]);
      let best = null, bestS = -1e9;
      for (const m of places) {
        const feats = [null];
        TYPES[S.current].feats.forEach((f, fi) => {
          if (f.k === "R" || f.k === "C" || f.k === "K" || (f.k === "F" && S.meadows)) feats.push(fi);
        });
        for (const feat of feats) {
          const sc = botScoreMove(S, m, feat, pi, level) + (level >= 3 ? 0 : rand(2));
          if (sc > bestS) { bestS = sc; best = Object.assign({ t: "place" }, m, { _feat: feat }); }
        }
      }
      S._botFeat = best && best._feat !== undefined ? best._feat : null;
      if (best) { delete best._feat; return best; }
      return Object.assign({ t: "place" }, places[0]);
    }
    if (S.phase === "meeple" && S.cur === pi) {
      const legal = legalMeeples(S);
      const level = S.level || 2;
      if (!legal.length || S.players[pi].meeples <= 0) return { t: "meeple", feature: null };
      if (level === 1) {
        if (Math.random() < 0.4) return { t: "meeple", feature: null };
        return { t: "meeple", feature: legal[rand(legal.length)] };
      }
      let prefer = S._botFeat;
      S._botFeat = null;
      if (prefer != null && legal.includes(prefer)) {
        // Stufe 3: Bauern nur bei guter Wiese
        if (level >= 3 && S.lastPlace) {
          const { x, y } = S.lastPlace;
          const type = TYPES[S.board[keyXY(x, y)].id];
          const f = type.feats[prefer];
          if (f && f.k === "F" && meadowFarmerValue(S, type, f, x, y, S.lastPlace.r) <= 0) {
            prefer = null;
          } else return { t: "meeple", feature: prefer };
        } else return { t: "meeple", feature: prefer };
      }
      const { x, y } = S.lastPlace;
      const type = TYPES[S.board[keyXY(x, y)].id];
      const scored = legal.map((fi) => {
        const f = type.feats[fi];
        let sc = { K: 4, C: 3, R: 2, F: 1 }[f.k] || 0;
        if (level >= 3 && f.k === "F") {
          const mv = meadowFarmerValue(S, type, f, x, y, S.lastPlace.r);
          sc = mv > 0 ? 1 + mv : -9;
        }
        return { fi, sc };
      }).sort((a, b) => b.sc - a.sc);
      if (level === 2 && Math.random() < 0.25) return { t: "meeple", feature: null };
      if (level >= 3 && scored[0].sc < 0) return { t: "meeple", feature: null };
      return { t: "meeple", feature: scored[0].fi };
    }
    return null;
  }

  function botPlan(S) {
    if (!S || (S.phase !== "place" && S.phase !== "meeple")) return null;
    const P = S.players[S.cur];
    if (!P || !P.bot) return null;
    let delay = 2000 + Math.floor(Math.random() * 2000); // 2–4 s, unabhängig von Bot-Anzahl
    if (typeof process !== "undefined" && process.env && process.env.BOT_MS) {
      const n = +process.env.BOT_MS;
      if (Number.isFinite(n) && n >= 0) delay = n;
    }
    return { pi: S.cur, delay, key: `bot:${S.round}:${S.turn}:${S.phase}:${S.cur}` };
  }

  function view(S, pi) {
    const me = S.players[pi] ? pi : -1;
    const board = [];
    for (const k of Object.keys(S.board)) {
      const p = S.board[k];
      board.push({ id: p.id, x: p.x, y: p.y, r: p.r, m: p.m ? { p: p.m.p, f: p.m.f } : null });
    }
    return {
      me, phase: S.phase, cur: S.cur, turn: S.turn, round: S.round,
      goal: S.goal, level: S.level || 2, meadows: !!S.meadows,
      stackLeft: S.stack.length,
      current: S.current,
      board,
      lastPlace: S.lastPlace ? { x: S.lastPlace.x, y: S.lastPlace.y, r: S.lastPlace.r, id: S.lastPlace.id } : null,
      players: S.players.map((p, i) => ({
        name: p.name, bot: p.bot, avatar: avatarOf(p, i), wins: p.wins,
        score: p.score, meeples: p.meeples, color: p.color
      })),
      log: S.log.slice(), last: S.last, nextStarter: S.starter % S.players.length
    };
  }

  // Hilfs-API für UI/Tests
  function tileTypes() { return TYPES; }
  function checksums() {
    let total = 0, cloisters = 0, cloisterRoad = 0, shields = 0, cross = 0, straight = 0, curves = 0, tees = 0;
    for (const id of Object.keys(TYPES)) {
      const t = TYPES[id];
      total += t.n;
      if (t.feats.some((f) => f.k === "K")) {
        cloisters += t.n;
        if (t.feats.some((f) => f.k === "R")) cloisterRoad += t.n;
      }
      for (const f of t.feats) if (f.s) shields += f.s * t.n;
      if (id === "X") cross += t.n;
      if (id === "U") straight += t.n;
      if (id === "V") curves += t.n;
      if (id === "W") tees += t.n;
    }
    return { total, cloisters, cloisterRoad, shields, cross, straight, curves, tees };
  }

  return {
    MAX_PLAYERS, MEEPLES, BOARD, START, BOT_NAMES, AVATARS, BOT_AVATAR, LEVELS, GOALS, COLORS, TYPES,
    normGoal, normLevel, newGame, startRound, act, botMove, botPlan, view,
    legalPlaces, legalMeeples, placeable, sidesMatch, sideStr, tileTypes, checksums, buildDeck
  };
});
