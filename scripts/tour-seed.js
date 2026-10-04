// Seed finder for scripted tutorials: node scripts/tour-seed.js <game> [maxSeed]
// Prints, per seed, who moves first after the tour's `game` hook was applied.
global.window = global;
const root = require("path").resolve(__dirname, "..");
require(root + "/shared/tutorial.js");
const T = global.Tutorial;
const g = process.argv[2], max = +process.argv[3] || 16;
let def = null;
global.Tutorial = Object.assign({}, T, { define(d) { def = d; } });
global.document = { title: g };
require(`${root}/${g}/public/tour.js`);
global.Tutorial = T;
const G = require(`${root}/${g}/public/game.js`);
const bots = g === "sudoku" ? 0 : Math.max(1, (def.opponents || 1));
const list = [{ name: "Du", bot: false, avatar: "🙂" }].concat(Array.from({ length: bots }, (_, i) => ({ name: "Robo " + i, bot: true })));
for (let seed = 0; seed < max; seed++) {
  const prev = Math.random; Math.random = T._stream("s" + seed, "newGame", 0);
  let S; try { S = G.newGame(...def.game([list])); if (def.arrange) def.arrange(S, G); } catch (e) { Math.random = prev; console.log(g, "ERR", e.stack); break; }
  Math.random = prev;
  let plan = null; try { plan = G.botPlan ? G.botPlan(S) : null; } catch (e) {}
  const brief = def.describe ? def.describe(S) : "";
  console.log(g, "seed", seed, "cur", S.cur, "dealer", S.dealer, "phase", S.phase, "plan", plan ? plan.pi : "-", brief);
}
