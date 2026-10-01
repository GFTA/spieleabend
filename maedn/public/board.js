// Mensch ärgere dich nicht board geometry. A star with 4, 6 or 8 arms: every arm is three fields wide,
// the track runs clockwise (10 fields per arm), each player has a yard next to their arm and a goal lane at the end of their lap.
// Coordinates are top-left corners of 1×1 cells. No DOM, so the tests can check the layout.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MaednBoard = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const cache = {};
  const r6 = (n) => Math.round(n * 1e6) / 1e6;

  function build(arms) {
    const phi = (2 * Math.PI) / arms, dc = 1 / Math.tan(phi / 2); // distance of the inner corner along an arm
    const dt = dc + 4; // the arm tip
    const ang = (s) => Math.PI + s * phi; // seat 0 is the left arm, then clockwise (screen y points down)
    const u = (s) => [Math.cos(ang(s)), Math.sin(ang(s))];
    const w = (s) => [-Math.sin(ang(s)), Math.cos(ang(s))]; // clockwise side of the arm
    const pt = (s, d, off) => [u(s)[0] * d + w(s)[0] * off, u(s)[1] * d + w(s)[1] * off];

    // 10 fields per seat, starting with the start field on the arm of the seat
    const track = [];
    for (let s = 0; s < arms; s++) {
      const n = (s + 1) % arms;
      for (let i = 0; i <= 4; i++) track.push(pt(s, dt - i, 1)); // outer end -> inner corner
      for (let i = 1; i <= 4; i++) track.push(pt(n, dc + i, -1)); // up the next arm
      track.push(pt(n, dt, 0)); // its tip
    }
    // a lap is 40 steps; on the big boards it ends 3 arms ahead (30 steps), so the games stay as short as on 4 arms.
    // Goal lane `s` is the one player `s` walks into, it lies on arm (s + lap/10) % arms.
    const lap = arms === 4 ? 40 : 30, lane = (s) => (s + lap / 10) % arms;
    const goal = [], yard = [];
    for (let s = 0; s < arms; s++) {
      goal.push([0, 1, 2, 3].map((i) => pt(lane(s), dt - 1 - i, 0)));
    }

    // yards sit in the gap between an arm and the next; close to the middle, but clear of all arms and each other
    const half = 1.12 + 0.1;
    const clear = (c, s) => { // box around c must miss every arm rectangle
      for (let a = 0; a < arms; a++) {
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const px = c[0] + sx * half, py = c[1] + sy * half;
          const d = px * u(a)[0] + py * u(a)[1], l = px * w(a)[0] + py * w(a)[1];
          if (d > 0 && d < dt + 0.6 && Math.abs(l) < 1.6) return false;
        }
      }
      return true;
    };
    let rho = arms === 4 ? 4.5 * Math.SQRT2 : 3;
    const centre = (s, rho2) => { const b = ang(s) + phi / 2; return [Math.cos(b) * rho2, Math.sin(b) * rho2]; };
    if (arms !== 4) {
      const apart = (rho2) => {
        const a = centre(0, rho2), b = centre(1, rho2);
        return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) >= 2 * half;
      };
      while (!(clear(centre(0, rho), 0) && apart(rho))) rho += 0.05;
    }
    const yc = [];
    for (let s = 0; s < arms; s++) yc.push(centre(s, rho));
    for (let s = 0; s < arms; s++) {
      const [x, y] = yc[s];
      yard.push([[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]);
    }

    // shift so the board starts at 0,0; cells are 1×1 with their corner at the coordinate
    const all = [];
    for (const p of track) all.push([p[0] - 0.5, p[1] - 0.5]);
    for (const g of goal) for (const p of g) all.push([p[0] - 0.5, p[1] - 0.5]);
    for (const y of yard) for (const p of y) all.push(p);
    const minx = Math.min(...all.map((p) => p[0])), miny = Math.min(...all.map((p) => p[1]));
    const maxx = Math.max(...all.map((p) => p[0])) + 1, maxy = Math.max(...all.map((p) => p[1])) + 1;
    const tl = (p, dx) => [r6(p[0] - minx + (dx || 0)), r6(p[1] - miny + (dx || 0))];
    return {
      arms, lap, w: r6(maxx - minx), h: r6(maxy - miny), dc: r6(dc),
      track: track.map((p) => tl(p, -0.5)),
      goal: goal.map((g) => g.map((p) => tl(p, -0.5))),
      yard: yard.map((y) => y.map((p) => tl(p, 0))),
      centre: [r6(-minx - 0.5), r6(-miny - 0.5)]
    };
  }

  function geometry(arms) {
    arms = arms === 6 || arms === 8 ? arms : 4;
    return cache[arms] || (cache[arms] = build(arms));
  }
  return { geometry };
});
