// Machi Koro artwork: every building, landmark and symbol is drawn here as inline SVG, no image files.
// One style for all: 64x64 canvas, flat colours, thick dark outline.
(function (root) {
  "use strict";
  const O = "#1b1325";
  const pts = (list) => list.map((p) => p.join(",")).join(" ");
  const star = (cx, cy, r, ri, n) => {
    const out = [];
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? ri : r;
      out.push([+(cx + Math.cos(a) * rr).toFixed(1), +(cy + Math.sin(a) * rr).toFixed(1)]);
    }
    return pts(out);
  };
  const tree = (cx, by, s, fill) =>
    `<g transform="translate(${cx} ${by}) scale(${s})" stroke-width="${(2.6 / s).toFixed(2)}">` +
    `<path d="M-3 -9h6v11h-6z" fill="#8a5a2b"/>` +
    `<path d="M0 -48L-12 -30h7L-17 -11H17L5 -30h7z" fill="${fill}"/></g>`;
  const stalk = (cx, dy, s) =>
    `<g transform="translate(${(cx - 32 * s).toFixed(1)} ${dy}) scale(${s})" stroke-width="${(2.6 / s).toFixed(2)}">` +
    `<path d="M32 56V22" fill="none"/>` +
    `<ellipse cx="32" cy="13" rx="4.4" ry="8" fill="#f2c230"/>` +
    `<ellipse cx="26.5" cy="25" rx="4" ry="7" transform="rotate(-28 26.5 25)" fill="#f2c230"/>` +
    `<ellipse cx="37.5" cy="25" rx="4" ry="7" transform="rotate(28 37.5 25)" fill="#f2c230"/>` +
    `<ellipse cx="26.5" cy="38" rx="4" ry="7" transform="rotate(-28 26.5 38)" fill="#f2c230"/>` +
    `<ellipse cx="37.5" cy="38" rx="4" ry="7" transform="rotate(28 37.5 38)" fill="#f2c230"/></g>`;
  const windows = (x, y, cols, rows, w, h, gx, gy, fill) => {
    let s = "";
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) s += `<rect x="${x + c * gx}" y="${y + r * gy}" width="${w}" height="${h}" rx="1" fill="${fill}" stroke-width="1.6"/>`;
    return s;
  };
  const awning = () => {
    const top = [12, 18.7, 25.3, 32, 38.7, 45.3, 52], bot = [6, 15.7, 25.3, 35, 44.7, 54.3, 58];
    let s = `<path d="M12 14h40l6 14H6z" fill="#fff"/>`;
    for (let i = 0; i < 6; i += 2) s += `<path d="M${top[i]} 14L${top[i + 1]} 14L${bot[i + 1] - (i === 4 ? 0 : 0)} 28L${bot[i]} 28z" fill="#e0393e" stroke="none"/>`;
    return s + `<path d="M12 14h40l6 14H6z" fill="none"/><path d="M6 28q4.8 6 9.7 0q4.8 6 9.6 0q4.8 6 9.7 0q4.8 6 9.7 0q4.8 6 9.6 0q2 3 3.7 0" fill="#e0393e"/>`;
  };

  const ART = {
    wheat: () => `<ellipse cx="32" cy="57" rx="26" ry="5" fill="#8a5a2b"/>` + stalk(17, 4, 0.8) + stalk(47, 4, 0.8) + stalk(32, 0, 1),
    ranch: () =>
      `<ellipse cx="32" cy="57" rx="27" ry="5" fill="#7cc46a"/>` +
      `<path d="M52 28c6 1 7 6 5 11" fill="none"/><path d="M57 38l-2 4 4-1z" fill="${O}"/>` +
      `<rect x="20" y="38" width="6" height="18" rx="2.5" fill="#fff"/><rect x="29" y="38" width="6" height="18" rx="2.5" fill="#fff"/>` +
      `<rect x="40" y="38" width="6" height="18" rx="2.5" fill="#fff"/><rect x="47" y="38" width="6" height="18" rx="2.5" fill="#fff"/>` +
      `<rect x="14" y="22" width="40" height="22" rx="10" fill="#fff"/>` +
      `<path d="M30 23c6-1 9 3 7 7s-7 5-10 1-1-7 3-8z" fill="${O}" stroke="none"/><ellipse cx="47" cy="35" rx="4.5" ry="5.5" fill="${O}" stroke="none"/>` +
      `<path d="M10 20l-3-7M22 19l3-7" fill="none"/>` +
      `<rect x="5" y="20" width="19" height="19" rx="8" fill="#fff"/><rect x="5" y="30" width="13" height="9" rx="4.5" fill="#f4a6b5"/>` +
      `<circle cx="18" cy="27" r="2" fill="${O}" stroke="none"/><circle cx="9.5" cy="34.5" r="1.1" fill="${O}" stroke="none"/><circle cx="13.5" cy="34.5" r="1.1" fill="${O}" stroke="none"/>`,
    bakery: () =>
      `<rect x="6" y="46" width="52" height="8" rx="4" fill="#b07a45"/>` +
      `<path d="M9 46c0-16 10-26 23-26s23 10 23 26z" fill="#e8a64e"/>` +
      `<path d="M21 38l6-8M31 37l6-8M41 38l6-8" stroke="#b46f22" fill="none"/>` +
      `<path d="M15 34c2-7 6-11 11-13" stroke="#fff" opacity=".55" fill="none"/>` +
      `<path d="M50 14l2 5 5 1-4 3 1 5-4-3-4 3 1-5-4-3 5-1z" fill="#f2c230" stroke-width="1.8"/>`,
    cafe: () =>
      `<path d="M23 6c-3.5 4 3.5 6 0 10M32 4c-3.5 4 3.5 6 0 10M41 6c-3.5 4 3.5 6 0 10" stroke="#8c7aa8" stroke-width="2.4" fill="none"/>` +
      `<ellipse cx="32" cy="55" rx="27" ry="5" fill="#e9e1f5"/>` +
      `<path d="M46 29h5c6 0 6 11 0 11h-6" fill="none" stroke-width="3"/>` +
      `<path d="M12 24h36v14c0 10-8 17-18 17s-18-7-18-17z" fill="#fff"/>` +
      `<ellipse cx="30" cy="24" rx="18" ry="4.5" fill="#7a4a2a"/>` +
      `<path d="M13 36h34" stroke="#e0393e" stroke-width="3" fill="none"/>`,
    convenience: () =>
      `<rect x="9" y="26" width="46" height="30" fill="#fff3d6"/>` + awning() +
      `<rect x="26" y="38" width="13" height="18" rx="2" fill="#7fc4ef"/><circle cx="36" cy="48" r="1.3" fill="${O}" stroke="none"/>` +
      `<rect x="13" y="36" width="10" height="10" rx="1.5" fill="#bfe3ff"/><rect x="43" y="36" width="8" height="10" rx="1.5" fill="#bfe3ff"/>` +
      `<rect x="22" y="3" width="20" height="9" rx="3" fill="#2e9d57"/><text x="32" y="10.6" text-anchor="middle" font-family="Figtree,sans-serif" font-weight="800" font-size="8" fill="#fff" stroke="none">24h</text>`,
    forest: () => `<ellipse cx="32" cy="57" rx="27" ry="4.5" fill="#6fae5a"/>` + tree(14, 56, 0.72, "#59bd6b") + tree(50, 56, 0.72, "#59bd6b") + tree(32, 57, 1, "#2e9d57"),
    stadium: () =>
      `<path d="M9 40v7c0 7 10 11 23 11s23-4 23-11v-7z" fill="#b9b0d1"/>` +
      `<path d="M9 14v26M55 14v26" fill="none"/><rect x="3" y="7" width="12" height="8" rx="2" fill="#ffe27a"/><rect x="49" y="7" width="12" height="8" rx="2" fill="#ffe27a"/>` +
      `<ellipse cx="32" cy="38" rx="26" ry="15" fill="#d9d3e8"/><ellipse cx="32" cy="37" rx="19" ry="10" fill="#6fcf78"/>` +
      `<path d="M32 27.5v19" stroke="#fff" stroke-width="2" fill="none"/><ellipse cx="32" cy="37" rx="5" ry="3.4" stroke="#fff" stroke-width="2" fill="none"/>`,
    tv: () =>
      `<path d="M20 6l12 11 12-11" fill="none"/>` +
      `<path d="M16 52l-2 6M48 52l2 6" fill="none" stroke-width="3.2"/>` +
      `<rect x="6" y="16" width="52" height="37" rx="7" fill="#8b7ab0"/>` +
      `<rect x="11" y="21" width="33" height="27" rx="4" fill="#bfe3ff"/>` +
      `<path d="M23 27l13 7.5-13 7.5z" fill="#e0393e"/>` +
      `<circle cx="51" cy="28" r="3" fill="#f2c230" stroke-width="2"/><circle cx="51" cy="39" r="3" fill="#f2c230" stroke-width="2"/>`,
    business: () =>
      `<path d="M3 57h58" fill="none"/>` +
      `<rect x="34" y="26" width="24" height="31" fill="#a7b4d6"/>` + windows(38, 31, 2, 3, 6, 5, 11, 8, "#fff3a8") +
      `<path d="M21 13V5" fill="none"/><circle cx="21" cy="4" r="2.2" fill="#e0393e" stroke-width="1.6"/>` +
      `<rect x="8" y="13" width="26" height="44" fill="#7d8fb8"/>` + windows(12, 18, 3, 4, 5, 5, 7.5, 8, "#fff3a8") +
      `<rect x="17" y="48" width="8" height="9" fill="#3b3350"/>`,
    cheese: () =>
      `<ellipse cx="32" cy="57" rx="26" ry="4.5" fill="#e9e1f5"/>` +
      `<path d="M5 50L50 14c5 2 9 7 9 13v23z" fill="#f7cf3d"/>` +
      `<path d="M5 50L50 14c5 2 9 7 9 13" fill="none"/>` +
      `<circle cx="22" cy="44" r="4.5" fill="#e3a51c" stroke-width="2"/><circle cx="41" cy="38" r="4" fill="#e3a51c" stroke-width="2"/>` +
      `<circle cx="51" cy="44" r="3.4" fill="#e3a51c" stroke-width="2"/><circle cx="36" cy="29" r="2.6" fill="#e3a51c" stroke-width="2"/>`,
    furniture: () =>
      `<ellipse cx="34" cy="58" rx="24" ry="3.5" fill="#d8cdb8" stroke="none"/>` +
      `<rect x="14" y="44" width="7" height="14" rx="2" fill="#a86b32"/><rect x="43" y="44" width="7" height="14" rx="2" fill="#a86b32"/>` +
      `<rect x="14" y="5" width="9" height="43" rx="3" fill="#c98a4b"/>` +
      `<path d="M23 12h14M23 20h14M23 28h14" stroke-width="3" fill="none"/><path d="M37 10v22" stroke-width="3" fill="none"/>` +
      `<rect x="12" y="38" width="42" height="9" rx="4" fill="#e0a062"/>`,
    mine: () =>
      `<path d="M3 57l12-20 9 7 10-17 12 15 6-5 9 20z" fill="#a9a1b8"/>` +
      `<path d="M14 57l6-9 7 4 5-7 6 7 6-3 6 8z" fill="#8f87a1" stroke="none"/>` +
      `<path d="M20 52L44 12" stroke="${O}" stroke-width="8" fill="none"/><path d="M20 52L44 12" stroke="#c98a4b" stroke-width="3.6" fill="none"/>` +
      `<path d="M26 14C34 4 52 6 58 20c-8-6-16-5-22 1z" fill="#c3c7d6"/>` +
      `<path d="M47 50l5-6 5 6-5 7z" fill="#7fc4ef" stroke-width="2"/>`,
    family: () =>
      `<path d="M7 7v13c0 4 2 6 5 6s5-2 5-6V7M12 7v19M12 26v29" fill="none"/>` +
      `<path d="M57 7c-6 4-7 15-6 27h6z" fill="#e9e1f5"/><path d="M57 34v21" fill="none"/>` +
      `<circle cx="32" cy="32" r="19" fill="#fff"/><circle cx="32" cy="32" r="12" fill="#f4e7c8" stroke-width="1.8"/>` +
      `<path d="M27 34c0-5 3-8 5-8s5 3 5 8z" fill="#e0393e" stroke-width="1.8"/><path d="M32 26c0-3 1-4 3-5" fill="none" stroke-width="1.8"/>`,
    apple: () =>
      `<ellipse cx="32" cy="58" rx="20" ry="3.5" fill="#6fae5a"/>` +
      `<path d="M32 19c-6-5-21-4-21 13 0 14 10 25 21 25s21-11 21-25c0-17-15-18-21-13z" fill="#e0393e"/>` +
      `<path d="M17 32c0-5 2-9 6-11" stroke="#fff" stroke-width="3" opacity=".65" fill="none"/>` +
      `<path d="M32 19c0-6 1-10 4-13" fill="none"/>` +
      `<path d="M35 14c3-8 13-8 17-4-2 7-10 9-17 4z" fill="#3fae5f"/>`,
    fruit: () =>
      `<path d="M44 26l12-14-3 17z" fill="#f08a2c" stroke-width="2"/><path d="M50 14l-2-7M53 15l4-6" stroke="#2e9d57" stroke-width="3" fill="none"/>` +
      `<circle cx="21" cy="30" r="13" fill="#7fd06f"/><path d="M21 18c-5 6-5 15 0 24M21 18c5 6 5 15 0 24M10 30h22" stroke-width="1.8" fill="none"/>` +
      `<circle cx="42" cy="32" r="10" fill="#e0393e"/><path d="M36 24l6 3 6-3-3 6-6 0z" fill="#3fae5f" stroke-width="1.8"/>` +
      `<rect x="6" y="38" width="52" height="20" rx="3.5" fill="#c98a4b"/><path d="M6 46h52M6 52h52" stroke-width="2" fill="none"/>`,
    station: () =>
      `<path d="M2 58h60" stroke-width="3.2" fill="none"/>` +
      `<circle cx="16" cy="9" r="5" fill="#fff" stroke-width="2"/><circle cx="23" cy="5" r="4" fill="#fff" stroke-width="2"/>` +
      `<rect x="10" y="26" width="32" height="20" rx="5" fill="#3b5ea8"/>` +
      `<path d="M12 26v-10h9v10" fill="#3b3350"/><path d="M10 16h13" stroke-width="4" fill="none"/>` +
      `<rect x="38" y="14" width="19" height="32" rx="3" fill="#e0393e"/><rect x="42" y="19" width="11" height="10" rx="2" fill="#bfe3ff"/>` +
      `<path d="M4 46h58" stroke-width="3" fill="none"/><path d="M2 52l8-6" fill="none"/>` +
      `<circle cx="18" cy="51" r="7" fill="#f2c230"/><circle cx="34" cy="51" r="7" fill="#f2c230"/><circle cx="50" cy="52" r="5" fill="#f2c230"/>` +
      `<circle cx="18" cy="51" r="2" fill="${O}" stroke="none"/><circle cx="34" cy="51" r="2" fill="${O}" stroke="none"/>`,
    mall: () =>
      `<ellipse cx="32" cy="58" rx="24" ry="3.5" fill="rgba(0,0,0,.18)" stroke="none"/>` +
      `<path d="M22 24v-7a10 10 0 0 1 20 0v7" fill="none" stroke-width="3.2"/>` +
      `<path d="M10 24h44l-3.5 34h-37z" fill="#e0393e"/>` +
      `<polygon points="${star(32, 40, 10, 4.4, 5)}" fill="#fff" stroke-width="2"/>`,
    park: () => {
      let spokes = "", cabs = "";
      const cols = ["#e0393e", "#f2c230", "#3fae5f", "#3b8fe0", "#e0393e", "#f2c230", "#3fae5f", "#3b8fe0"];
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4, x = 32 + Math.cos(a) * 21, y = 27 + Math.sin(a) * 21;
        spokes += `M32 27L${x.toFixed(1)} ${y.toFixed(1)}`;
        cabs += `<circle cx="${x.toFixed(1)}" cy="${(y + 3).toFixed(1)}" r="4.2" fill="${cols[i]}" stroke-width="2"/>`;
      }
      return `<path d="M32 27L17 58M32 27L47 58M12 58h40" stroke-width="3.2" fill="none"/>` +
        `<circle cx="32" cy="27" r="21" fill="rgba(255,255,255,.35)" stroke-width="2.6"/><path d="${spokes}" stroke-width="1.8" fill="none"/>` +
        cabs + `<circle cx="32" cy="27" r="4" fill="#fff"/>`;
    },
    tower: () =>
      `<path d="M22 7a13 13 0 0 0 0 8M15 4a22 22 0 0 0 0 14M42 7a13 13 0 0 1 0 8M49 4a22 22 0 0 1 0 14" stroke-width="2.6" fill="none"/>` +
      `<path d="M32 12L19 58h9l4-14 4 14h9z" fill="#c3c7d6"/>` +
      `<path d="M26 34h12M23 46h18M29 22h6M29 22l-6 24M35 22l6 24" stroke-width="2.2" fill="none"/>` +
      `<circle cx="32" cy="11" r="4.4" fill="#e0393e"/><path d="M13 58h38" stroke-width="3.2" fill="none"/>`
  };

  const GLYPH = {
    blue: `<circle cx="12" cy="12" r="4.6" fill="currentColor"/><path d="M12 2v3.4M12 18.6V22M2 12h3.4M18.6 12H22M5 5l2.4 2.4M16.6 16.6L19 19M19 5l-2.4 2.4M7.4 16.6L5 19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>`,
    green: `<path d="M3.5 11L12 3.5 20.5 11V20.5h-17z" fill="currentColor"/><rect x="10" y="13" width="4" height="7.5" fill="#fff" opacity=".85"/>`,
    red: `<path d="M20 12H6m0 0l5-5m-5 5l5 5" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    purple: `<polygon points="${star(12, 12.6, 10, 4.4, 5)}" fill="currentColor"/>`,
    landmark: `<path d="M4 20h16M6 20V9l6-5 6 5v11M10 20v-6h4v6" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" fill="none"/>`
  };

  const svg = (inner, vb, cls) => `<svg class="${cls}" viewBox="${vb}" aria-hidden="true" focusable="false">${inner}</svg>`;

  root.MKArt = {
    has: (id) => Object.prototype.hasOwnProperty.call(ART, id),
    art: (id) => Object.prototype.hasOwnProperty.call(ART, id)
      ? svg(`<g stroke="${O}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" fill="none">${ART[id]()}</g>`, "0 0 64 64", "art") : "",
    glyph: (kind) => svg(GLYPH[kind] || GLYPH.landmark, "0 0 24 24", "glyph"),
    coin: (cls) => svg(
      `<circle cx="12" cy="12" r="10.4" fill="#f2c230" stroke="#b78d12" stroke-width="2"/>` +
      `<circle cx="12" cy="12" r="6.4" fill="none" stroke="#b78d12" stroke-width="1.6"/>` +
      `<path d="M12 8.6v6.8M10.2 10.4c0-1.3 3.6-1.3 3.6 0 0 1.4-3.6 1-3.6 2.6 0 1.3 3.6 1.3 3.6 0" stroke="#8a6a08" stroke-width="1.4" stroke-linecap="round" fill="none"/>`,
      "0 0 24 24", "coin" + (cls ? " " + cls : ""))
  };
})(typeof self !== "undefined" ? self : this);
