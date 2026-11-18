// Regenerates idls/pm_amm.json (the CPI bindings `declare_program!` compiles)
// from the full pm-AMM IDL, keeping only what Thesis calls. A smaller IDL keeps
// the program small and avoids stack-heavy generated code.
//
//   node scripts/trim-idl.js
const fs = require("fs");
const full = JSON.parse(fs.readFileSync("idls/full/pm_amm.json", "utf8"));
const INSTRUCTIONS = ["claim_winnings", "deposit_liquidity", "initialize_market", "resolve_market", "swap", "claim_lp_residuals"];
const ACCOUNTS = ["LpPosition", "Market"];
const TYPES = ["LpPosition", "Market", "Side", "SwapDirection"];
const out = {
  ...full,
  instructions: full.instructions.filter((i) => INSTRUCTIONS.includes(i.name)),
  accounts: full.accounts.filter((a) => ACCOUNTS.includes(a.name)),
  events: [],
  types: full.types.filter((t) => TYPES.includes(t.name)),
};
const missing = [...INSTRUCTIONS.filter((n) => !out.instructions.some((i) => i.name === n)), ...TYPES.filter((n) => !out.types.some((t) => t.name === n))];
if (missing.length) throw new Error("missing in full IDL: " + missing.join(", "));
fs.writeFileSync("idls/pm_amm.json", JSON.stringify(out, null, 2) + "\n");
console.log("idls/pm_amm.json:", out.instructions.map((i) => i.name).join(", "));
