const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

// known node counts from the chess programming wiki
const CASES = [
  ["start", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", [20, 400, 8902, 197281]],
  ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -", [48, 2039, 97862]],
  ["endgame with en passant and pins", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -", [14, 191, 2812, 43238]],
  ["promotions", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -", [6, 264, 9467]],
  ["check evasions", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -", [44, 1486, 62379]],
  ["mirrored promotions", "r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ -", [6, 264, 9467]]
];
for (const [name, fen, counts] of CASES) {
  test(`perft ${name}`, () => {
    counts.forEach((n, i) => assert.strictEqual(G.perft(G.posFromFen(fen), i + 1), n, `depth ${i + 1}`));
  });
}
