// Carcassonne tile art: every tile type is drawn once (100 x 100 units, unrotated) from its features.
(() => {
  "use strict";
  const G = window.CarcassonneGame;
  const GRASS = "#7aa83f", CITY = "#d9b66c", WALL = "#7b4f27", ROADE = "#8d7650", ROADF = "#eddcb2";

  const edgePt = (ei) => {
    const s = (ei / 3) | 0, t = ((ei % 3) + 0.5) / 3 * 100;
    return [[t, 0], [100, t], [100 - t, 100], [0, 100 - t]][s];
  };
  const rotPt = (p, k) => { let [x, y] = p; for (let i = 0; i < ((k % 4) + 4) % 4; i++) [x, y] = [100 - y, x]; return [x, y]; };
  const rotAttr = (k) => (k ? ` transform="rotate(${90 * k} 50 50)"` : "");
  const f1 = (n) => Math.round(n * 10) / 10;

  function cityGeom(sides) {
    const n = sides.length;
    if (n === 1) return { d: "M0,0H100C90,40 10,40 0,0Z", w: "M100,0C90,40 10,40 0,0", k: sides[0], at: [62, 15], shield: [30, 12] };
    if (n === 4) return { d: "M0,0H100V100H0Z", w: "", k: 0, at: [50, 54], shield: [24, 24] };
    if (n === 3) {
      const miss = [0, 1, 2, 3].find((s) => !sides.includes(s));
      return { d: "M0,0H100V100C85,62 15,62 0,100Z", w: "M100,100C85,62 15,62 0,100", k: (miss + 2) % 4, at: [50, 42], shield: [24, 20] };
    }
    const [a, b] = sides;
    if ((b - a) % 4 === 2 || (a - b) % 4 === 2) return { d: "M0,0H100Q58,50 100,100H0Q42,50 0,0Z", w: "M100,0Q58,50 100,100M0,0Q42,50 0,100", k: a % 2, at: [50, 52], shield: [50, 20] };
    const first = sides.includes(0) && sides.includes(3) ? 3 : Math.min(a, b);
    return { d: "M0,0H100V100Q30,70 0,0Z", w: "M100,100Q30,70 0,0", k: first, at: [66, 34], shield: [34, 22] };
  }

  const MEADOW_AT = {
    "A:2": [20, 22], "B:1": [20, 22]
  };

  function features(id) {
    const type = G.TYPES[id];
    const hasK = type.feats.some((f) => f.k === "K");
    return type.feats.map((f, fi) => {
      if (f.k === "K") return { k: "K", at: [50, 52] };
      if (f.k === "C") {
        const sides = [...new Set(f.e.map((e) => (e / 3) | 0))].sort();
        const g = cityGeom(sides);
        return { k: "C", g, at: rotPt(g.at, g.k), shield: f.s ? rotPt(g.shield, g.k) : null };
      }
      if (f.k === "R") {
        const pts = f.e.map(edgePt);
        if (pts.length === 1) {
          const end = [50, hasK ? 58 : 50];
          return { k: "R", d: `M${pts[0]}L${end}`, at: [pts[0][0] * 0.65 + 50 * 0.35, pts[0][1] * 0.65 + 50 * 0.35] };
        }
        const sd = Math.abs(((f.e[0] / 3) | 0) - ((f.e[1] / 3) | 0));
        if (sd === 2) return { k: "R", d: `M${pts[0]}L${pts[1]}`, at: [50, 50] };
        return { k: "R", d: `M${pts[0]}Q50,50 ${pts[1]}`, at: [f1(pts[0][0] / 4 + 25 + pts[1][0] / 4), f1(pts[0][1] / 4 + 25 + pts[1][1] / 4)] };
      }
      const key = id + ":" + fi;
      if (MEADOW_AT[key]) return { k: "F", at: MEADOW_AT[key] };
      const pts = f.e.map(edgePt);
      const m = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
      const w = pts.length <= 2 ? 0.22 : pts.length <= 5 ? 0.45 : 0.6;
      return { k: "F", at: [f1(m[0] + w * (50 - m[0])), f1(m[1] + w * (50 - m[1]))] };
    });
  }

  const SHIELD = (x, y) => `<g transform="translate(${x} ${y})"><path d="M-8,-9H8V2Q8,10 0,14Q-8,10 -8,2Z" fill="#3a66c8" stroke="#fff" stroke-width="1.6"/><path d="M0,-6V9M-4.5,-2H4.5" stroke="#f2c230" stroke-width="2.4" stroke-linecap="round"/></g>`;

  function tileDef(id) {
    const type = G.TYPES[id], fs = features(id);
    let s = `<g id="ct-${id}"><rect width="100" height="100" fill="url(#ccGrass)"/>`;
    const roads = fs.filter((f) => f.k === "R");
    for (const f of roads) s += `<path d="${f.d}" fill="none" stroke="${ROADE}" stroke-width="13"/>`;
    for (const f of roads) s += `<path d="${f.d}" fill="none" stroke="${ROADF}" stroke-width="8.5"/>`;
    if (roads.length >= 3) s += `<circle cx="50" cy="50" r="8.5" fill="${ROADF}" stroke="${ROADE}" stroke-width="2.5"/>`;
    for (const f of fs) {
      if (f.k !== "C") continue;
      s += `<path d="${f.g.d}"${rotAttr(f.g.k)} fill="${CITY}"/><path d="${f.g.d}"${rotAttr(f.g.k)} fill="url(#ccBrick)"/>`;
      if (f.g.w) s += `<path d="${f.g.w}"${rotAttr(f.g.k)} fill="none" stroke="${WALL}" stroke-width="3.6" stroke-linecap="round"/>`;
    }
    for (const f of fs) if (f.k === "C" && f.shield) s += SHIELD(f.shield[0], f.shield[1]);
    if (fs.some((f) => f.k === "K")) {
      s += `<g><rect x="33" y="43" width="34" height="27" rx="2" fill="#efe4cf" stroke="#6d5a3f" stroke-width="2"/>` +
        `<path d="M28,45L50,22L72,45Z" fill="#b94a3b" stroke="#6d2a20" stroke-width="2" stroke-linejoin="round"/>` +
        `<rect x="45" y="55" width="10" height="15" rx="5" fill="#6d4a2a"/>` +
        `<path d="M50,12V24M45,17H55" stroke="#f2c230" stroke-width="2.6" stroke-linecap="round"/></g>`;
    }
    s += `<rect width="100" height="100" fill="none" stroke="rgba(20,10,0,.22)" stroke-width="1.4"/></g>`;
    return s;
  }

  const defs = () => {
    let s = `<pattern id="ccGrass" width="22" height="22" patternUnits="userSpaceOnUse"><rect width="22" height="22" fill="${GRASS}"/>` +
      `<circle cx="4" cy="6" r="1.3" fill="#6a9a35"/><circle cx="15" cy="3" r="1" fill="#8bb851"/><circle cx="11" cy="15" r="1.4" fill="#6a9a35"/><circle cx="19" cy="19" r="1" fill="#8bb851"/><circle cx="3" cy="18" r="1" fill="#8bb851"/></pattern>` +
      `<pattern id="ccBrick" width="16" height="10" patternUnits="userSpaceOnUse"><path d="M0,5H16M4,0V5M12,5V10" stroke="rgba(92,55,18,.28)" stroke-width="1" fill="none"/></pattern>` +
      `<symbol id="ccMeeple" viewBox="0 0 24 26"><path d="M12,1.2a4,4 0 1 1 0,8a4,4 0 1 1 0,-8ZM12,9.6c-2.6,0 -3.6,1.3 -4.8,2.3L2.2,13.3c-1.5,0.5 -1.4,2.3 -0.1,2.7L7.3,16.2L4.6,23.3c-0.4,1.1 0.3,2 1.4,2H10c0.8,0 1.4,-0.5 1.6,-1.2L12,22.2l0.4,1.9c0.2,0.7 0.8,1.2 1.6,1.2H18c1.1,0 1.8,-0.9 1.4,-2L16.7,16.2l5.2,-0.2c1.3,-0.4 1.4,-2.2 -0.1,-2.7L16.8,11.9C15.6,10.9 14.6,9.6 12,9.6Z" fill="currentColor" stroke="rgba(0,0,0,.6)" stroke-width="1.1" stroke-linejoin="round"/></symbol>`;
    for (const id of Object.keys(G.TYPES)) s += tileDef(id);
    return s;
  };

  function anchor(id, fi, r) {
    const f = features(id)[fi];
    return f ? rotPt(f.at, r || 0) : [50, 50];
  }

  window.CarcTiles = { defs, anchor, features, rotPt };
})();
