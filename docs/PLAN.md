# Thesis — Build plan by phase

Source of truth for scope: the build spec (Claude doc "Thesis — Build Spec"). This file
turns it into phases with exit criteria, so each phase ends with something that runs.

Deadline: **Dec 5, 2026**. As of Nov 18 there are 17 days. The spec's "build week"
maps onto Phases 1–6; Phase 0 runs now.

> Rule check first: ask the organisers whether code written before kickoff may be
> submitted. If not, Phase 0 stays a throwaway spike and gets re-typed after kickoff.

## Phase overview

| Phase | Spec days | Goal | Exit criterion |
|---|---|---|---|
| 0 — Foundations and spikes | before kickoff | Prove the two risks that can sink the build; set up the repo | PDA-authority market created, seeded, resolved through CPI (local + devnet); Pyth `PriceUpdateV2` decoded and checked; CU measured |
| 1 — Engine | Day 1–2 | `create_touch_market` (onchain opening price), `prove_touch`, `settle`, full resolver tests | 5-minute devnet market proven and settled by a script |
| 2 — Thesis layer + watcher | Day 3 | `Thesis`, `CreatorStats`, `create_thesis`, `trade` (fee attribution, self-trade flag), `claim_creator_fees`; watcher proves touches live | A thesis with two markets traded through `trade`; watcher proves a touch on devnet unaided |
| 3 — Offchain | Day 4 | One Railway worker (watcher, keeper, indexer loops), Postgres schema, API routes | Feed/thesis/stats API returns live devnet data; keeper settles and runs demo markets |
| 4 — Frontend | Day 5 | Feed, thesis page, create flow, burner wallets, share cards | A judge opens a link on a phone and trades in one tap |
| 5 — Mainnet + traction | Day 6 | Mainnet deploy with caps; sponsored theses; profile and stats pages | First real theses and trades on mainnet, numbers on `/stats` |
| 6 — Demo + submission | Day 7 | Demo video, README, submission | Submitted ≥ 12 h before the deadline, app running |

Cut order if behind (from the spec): Protect-only screen → `claim_seed_residuals`
automation → self-trade flag → settle share cards → LP rebate. Never the resolver.

## Phase 0 — Foundations and spikes (now)

**Code (this repo)**

- [x] Monorepo layout: `programs/thesis` (Anchor 1.0.1), `idls/` (pm-AMM IDL for
      `declare_program!`), `tests/`, `scripts/`, `docs/`. `apps/web` and
      `services/worker` arrive in Phases 3–4.
- [x] Spike A — PDA authority. `initialize_config`, `create_touch_market` (CPI
      `initialize_market` signed by the `Authority` PDA, then CPI
      `deposit_liquidity` from the treasury), `settle` (CPI `resolve_market`).
      Tested against the real pm-AMM bytecode cloned from devnet.
- [x] Spike B — Pyth proof. `prove_touch` with every check from spec §5, reading
      `PriceUpdateV2` by its documented layout (no receiver-SDK dependency, which
      pins an older Anchor). Tested with crafted price accounts.
- [x] Spike C — Numbers. Compute units for `create_touch_market`; price impact of
      $10 / $50 / $250 buys on $25 and $100 seeds.
- [x] Full lifecycle script (`scripts/devnet-spike.ts`) passes on a local validator
      that clones pm-AMM, Metaplex, mUSDC and the Pyth SOL/USD account from devnet.
- [ ] Devnet run: blocked on devnet SOL (public airdrops rate-limited). Fund the
      deployer with ~3 SOL, then `anchor deploy --provider.cluster devnet` and
      `pnpm devnet:spike`.

**Findings already confirmed from pm-AMM source** (commit `d5b407b`)

- `initialize_market` takes `authority: Signer` and uses it as rent payer. A
  system-owned PDA signing via `invoke_signed` satisfies both, so the `Authority`
  PDA must hold **no data** (as the spec says) and enough SOL for ~0.05 SOL/market.
- `resolve_market` checks only `market.authority == signer` and `now >= end_ts`.
- `swap` sends the creator half of the 2% fee to `creator_usdc`, which must be
  owned by `market.authority` → the treasury is the `Authority` PDA's USDC ATA.
- `swap` and `deposit_liquidity` require `now < end_ts`: **no trading in the grace
  window**, which closes that open question.
- Markets are PDAs on `["market", market_id]` in a namespace shared by every
  pm-AMM user, so Thesis must pick collision-resistant `market_id`s.

**Phase 0 results** (`pnpm test`, LiteSVM against devnet bytecode)

| Check | Result |
|---|---|
| pm-AMM accepts the `Authority` PDA as market authority via CPI | Yes: create, seed, resolve all work |
| Treasury receives the creator fee on a direct pm-AMM swap | Yes: exactly 1% of the USDC leg |
| `prove_touch` rejects partial, wrong feed, before start, after end, wrong expo, wide conf, no cross, wrong owner, second proof | All rejected; at-strike and late-in-grace proofs accepted |
| `settle` before `end + grace` | Rejected; YES after a proof, NO without |
| `create_touch_market` compute | 842k CU (fits 1.4M; one market per transaction) |
| `prove_touch` / `settle` compute | 8k / 21k CU |
| Real devnet `PriceUpdateV2` decodes with the hand-written reader | Yes (fixture in `tests/fixtures`) |

Price impact of a USDC→YES buy, 48h market opening at 25%:

| Seed | $10 buy | $50 buy | $250 buy |
|---|---|---|---|
| $25 | 25% → 55% | 25% → 96% | 25% → 100% |
| $100 | 25% → 34% | 25% → 61% | 25% → 99% |

Consequence for Phases 1 and 4: the $250 cover cap is far beyond what a $25–100
seed can absorb. Either seed protection markets much deeper, or cap cover in the
UI at what keeps impact under ~10 points (about $10 on a $100 seed). Decide
before Phase 4. Also: SOL is ~$75 today, so the spec's $250/$185 examples need
new numbers for the demo.

**People tasks (not code)**

- [ ] Ask organisers: start date, team size, prior-code rule, mainnet expected?
- [ ] Hermes API key (needed for the watcher and the "Prove it" button).
- [ ] OrbitFlare signup (claim the free Developer week when the hackathon opens).
- [ ] Line up 10–15 traders/KOLs to post a real thesis in Phase 5.
- [ ] Screen designs (Lovable or Figma), pitch line, README skeleton.

## Phase 1 — Engine (Day 1–2)

- Opening price onchain: `create_touch_market` takes a verified Pyth update for
  spot, reads σ from `Config.sol_vol_bps`, computes `initialPriceBps` with a
  fixed-point Φ, enforces the strike rules (0.5–50 % from spot, 1–99 %).
- Collision-resistant `market_id` (hash of program, creator, nonce).
- Resolver test matrix: valid proof, wrong feed, outside window, wide confidence,
  partial verification, wrong exponent, already touched/settled, settle NO after
  expiry, settle before grace.
- Devnet script: near-spot 5-minute market proven and settled.

## Phase 2 — Thesis layer + watcher (Day 3)

- `Thesis`, `CreatorStats`, `create_thesis`, `trade` (fee = treasury balance
  delta around the swap CPI; rejects touched markets), `claim_creator_fees`.
- Watcher: Hermes SSE → post update → `prove_touch` + treasury YES buy.
- Keep near-spot devnet markets running from here on, so a real touch is
  recorded for the demo (a market can't accept a price older than its creation).
- Checkpoint: resolver not working end to end tonight → ship protection-only
  touch markets.

## Phase 3 — Offchain (Day 4)

- `services/worker`: one process, three loops (watcher, keeper, indexer).
- Postgres (Supabase) schema from spec §7; OrbitFlare stream + backfill.
- API routes: feed, thesis, profile, stats, prove, OG card, faucet.

## Phase 4 — Frontend (Day 5)

- Next.js on Vercel: Feed, Thesis, Create, Protect, Profile, Stats.
- Burner wallets from the pm-AMM kit; quotes with `quoteSwap`; cover capped by
  measured price impact.

## Phase 5 — Mainnet + traction (Day 6)

- Deploy with caps and pause flag; budget a few SOL for program rent plus SOL
  for the watcher's Pyth posts; seed sponsored theses within the subsidy budget.

## Phase 6 — Demo + submission (Day 7)

- Demo per spec §12, with the replay cut from a real touch proven during the week.
- README: pitch, architecture, why pm-AMM, limitations, traction, program IDs.
