# Thesis — Build plan by phase

Source of truth for scope: the build spec ("Thesis — Build Spec"). This file
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

- [x] Opening price onchain: `create_touch_market` reads a fully verified Pyth
      spot (≤ `max_spot_age_secs` old) and `Config.sol_vol_bps` (≤ 3 days old),
      computes `P = 2Φ(−|ln(K/S)|/σ√τ)` (`programs/thesis/src/pricing.rs`, f64
      soft-float, A&S 7.1.26 Φ) and passes it to pm-AMM. Never a caller input.
- [x] Strike rules: right side of spot, 0.5–50 % away, opening P within 1–99 %.
- [x] Creation open to anyone, seeded from the creator's USDC; admin/keeper may
      sponsor from the treasury within `sponsor_budget`.
- [x] `update_config` (admin, every field optional, `Config::validate` bounds)
      and `set_volatility` (keeper or admin).
- [x] Market ids: client-random u64, retried on collision. Decided against a
      program-derived id: anything the program derives is predictable, so
      easier to squat in pm-AMM's shared id space.
- [x] Resolver matrix: partial, wrong feed, before start, after end, wrong expo,
      wide confidence, non-positive price, no cross, wrong owner, second proof,
      proof after settle, settle before grace, late proof inside grace.
- [ ] Devnet run of a near-spot market: still blocked on devnet SOL. Without a
      Hermes key, the devnet config accepts a 1-hour-old spot so Pyth's
      sponsored feed (updates ~every 30 min on devnet) can be the spot source.

**Phase 1 results** (`pnpm test`: 7 unit + 12 LiteSVM tests)

| Check | Result |
|---|---|
| Onchain opening price vs host vs Python `erfc` | Identical bps on every case (5.55 %, 2.15 %, 24.81 %, 52.00 %, 20.48 %, 34.66 %, 2.82 %) |
| `create_touch_market` compute | 887k CU (pricing adds ~45k) |
| Direct pm-AMM swap compute | 173–197k CU on a fresh market, **530–610k CU once time has passed** (pm-AMM accrues L_eff decay first) |
| Short windows | At σ 60 %, a 10-min market 1 % from spot opens at 0.01 % and is refused; 0.5 % away opens at 5.55 % |

Consequences for Phase 2:

- One pm-AMM swap per transaction. The watcher's "prove + treasury YES buy"
  fits (≈ 8k + 610k), but `trade` must request ~1M CU and can never batch two
  swaps. Clients must always prepend a compute-budget instruction.
- Demo markets (10 min) must sit 0.5–0.6 % from spot; anything farther is
  refused by the 1 % floor.
- Hermes needs an API key (401 without one; the Pyth docs don't say which
  header). The watcher, the "Prove it" button and fresh mainnet spot depend on
  it, so it is the first thing to settle in Phase 2.

## Phase 2 — Thesis layer + watcher (Day 3)

Onchain (`programs/thesis`):

- [x] `Thesis` (`["thesis", creator, id]`) and `CreatorStats` (`["creator", creator]`).
- [x] `create_thesis`: links the creator's own unlinked, open conviction market
      and an optional protection market (opposite direction, same feed and end).
- [x] `trade`: buy/sell YES/NO through pm-AMM. Fee attribution = treasury
      balance change around the swap CPI; creator self-trades flagged; closed
      once touched; protection cover capped by the wallet's YES balance.
- [x] `claim_creator_fees`: pays `fees_attributed × share − fees_claimed`; a
      second call with nothing new is refused.
- [x] `treasury_buy_yes`: keeper only, only after a proven touch.
- [x] `settle` records the thesis outcome and the creator's hit/miss; thesis
      accounts are required for thesis markets, so stats can't be skipped.
- [x] `prove_touch` also refuses a future-dated price (defence in depth).

Worker (`services/worker`, TypeScript):

- [x] One process: watcher (proves touches, bundles the treasury buy for
      sponsored markets, retries the proof alone if the bundle fails) and
      keeper (settles after `end + grace`, passing thesis accounts).
- [x] Pluggable `PriceSource`. Default `onchain`: subscribes to a Pyth price
      feed account, which is itself a verified `PriceUpdateV2`, so it doubles
      as the proof. **No Hermes needed.** Limitation: only prints that land in
      that account can prove a touch (on devnet, about every 30 min).
- [x] `provable()` mirrors every `prove_touch` check; unit-tested.
- [ ] Hermes source (exact crossing print, posted through the receiver): needs
      an API key; deferred. The interface is ready for it.
- [ ] Keep near-spot devnet markets running so a real touch is recorded for
      the demo: needs the devnet deploy (devnet SOL).

**Phase 2 results**

| Check | Result |
|---|---|
| `trade` compute | 226k CU fresh market, 509k after time passes |
| Watcher bundle (`prove_touch` + `treasury_buy_yes`) | 658k CU, one transaction |
| Treasury buy right after a touch | Paid 4.95 USDC for 22.4 YES (each pays $1 at settle) |
| Fee attribution | Equals the treasury's fee income exactly, buys and sells |
| Tests | 7 unit + 12 program + 7 thesis (LiteSVM) + 4 worker unit |

## Phase 3 — Offchain (Day 4)

Workspace: `packages/chain` (IDLs, Pyth decoding, `provable()`, pm-AMM price),
`packages/db` (schema, writes, API queries), `services/worker`, `apps/web`.

- [x] Postgres schema (spec section 7): markets, theses, trades, crossings,
      price_points, spot_samples, profiles, fee_claims, indexer cursors,
      `creator_stats` view. Plain SQL migrations (`pnpm --filter @thesis/db migrate`).
- [x] Indexer loop in the worker: account snapshots (state), Thesis program
      transactions (Anchor events: created/proof/settle txs, trades via
      Thesis, treasury buys, fee claims, crossings), direct pm-AMM swaps on our
      markets (decoded from instructions + token balance changes, including
      the treasury's 1 %), pool price points every 30 s, spot samples.
      Idempotent: clear the cursors to rebuild. Works over any RPC (OrbitFlare
      or public); Yellowstone gRPC can replace polling later.
- [x] Volatility keeper: 7-day realised vol from spot samples, posted when it
      moves >10 % or is a day old; re-posts the current value if data is thin.
- [x] API (Next.js route handlers in `apps/web`): `GET /api/theses?sort=`,
      `GET /api/theses/:pda`, `POST /api/theses/:pda/text` (accepted only if it
      hashes to the onchain `text_hash`), `GET /api/profiles/:wallet`,
      `GET /api/stats` (team wallets and treasury excluded),
      `POST /api/prove/:market` (Hermes-free: unsigned `prove_touch` tx from the
      onchain Pyth account, or 409 with the reason), `GET /api/og/thesis/:pda`
      (share card), `POST /api/faucet` (devnet only).
- [ ] `POST /api/profiles/:wallet` (display name / X handle) needs a signed
      message check; deferred to Phase 4 with the wallet UI.
- [ ] `claim_seed_residuals` for sponsored markets: cut (spec cut line).
- [ ] Supabase project + Railway service: not created yet; both take
      `DATABASE_URL` / env only.

**Phase 3 results**

| Check | Result |
|---|---|
| DB tests (real Postgres 16) | 5 pass: migrations idempotent, feed sorts, detail, text hash check, profile, stats exclusions |
| Worker tests | 8 pass incl. realised vol within 12 % on simulated paths (σ 30/60/120 %) |
| Local end-to-end (validator cloning devnet pm-AMM + Postgres) | 13/13 pass: watcher proved the touch and bought YES for the treasury in one tx, keeper settled YES, thesis hit recorded; indexer wrote created/proof/settle txs, the Thesis trade (side, amount, self-trade flag), the direct pm-AMM swap (amount, exact 1 % treasury fee), the treasury buy, one crossing and 30 price points |
| API smoke test against that data | every route correct, bad inputs 400/404/409 |

## Phase 4 — Frontend (Day 5)

`apps/web` (Next.js 16, Tailwind 4). Visual language after the **Cryptix** Framer
template (a crypto-trading dashboard: https://www.framer.com/marketplace/templates/cryptix/),
adapted, not copied: near-black `#08070e`, one neon-mint accent `#00FFB2` for
YES/back and calls to action, amber for protection, Instrument Sans display
type, Inter body, JetBrains Mono for every number and section label, mono
"▍ LABEL" headers, hairline panels, mint glow behind charts, pill buttons, a
dashboard sidebar, "Quick trade" panels shaped like a swap box. Chart-mark
colours (`#00ad78`, `#bf8620`) validated with the dataviz palette checker.

- [x] Feed `/`: Hot / New / Ending soon; each card has the creator, the call in
      one line, live YES %, protection badge, 24h volume, time left, and Back /
      Challenge that trade inline without leaving the feed.
- [x] Thesis `/t/:pda`: the call, creator record, SOL/USD (Pyth) with target and
      cover strikes, conviction and protection panels (YES-price chart, trade,
      Open → Touched → Settled → Claim, "Prove it"), creator fee claim, recent
      trades with explorer links, share on X.
- [x] Create `/new`: direction, target, window (10-min demo on devnet, 24h,
      48h, 7d), text, seed, "Protect me" (liquidation price + cover spend); live
      opening odds from the program's formula and the onchain strike rules; one
      button, then a progress tracker over 3–5 transactions that resumes from a
      failed step.
- [x] Protect `/protect`: long/short, liquidation price, window, spend; "pays $X
      if SOL touches $K before T, costs $Y"; creates the market and buys cover.
- [x] Profile `/u/:wallet` and Stats `/stats` (proof transaction links).
- [x] Wallets: instant burner on devnet (localStorage key, funded through
      `/api/faucet`) plus any Wallet Standard wallet.
- [x] Exact quotes by simulating the real transaction (no pm-AMM maths copied);
      protection buys moving the pool > 10 points are refused (Phase 0 finding).
- [x] Every transaction: pending / confirmed / failed + explorer link; units on
      every number; devnet/mainnet badge; plain-language risk copy.
- [ ] Display name / X handle on profiles (needs a signed-message check).

**Phase 4 results** (`scripts/ui-e2e.ts`, Playwright against a local validator
cloning devnet pm-AMM, the worker, Postgres and `next start`): 10/10 — feed
renders, instant wallet funded, exact quote, Back confirmed onchain, full create
flow (2 markets, thesis, $2 cover paying $6.85, text), thesis panels, profile,
stats, no console errors. All six screens fit a 390 px phone viewport.

## Phase 5 — Mainnet + traction (Day 6)

- Deploy with caps and pause flag; budget a few SOL for program rent plus SOL
  for the watcher's Pyth posts; seed sponsored theses within the subsidy budget.

## Phase 6 — Demo + submission (Day 7)

- Demo per spec §12, with the replay cut from a real touch proven during the week.
- README: pitch, architecture, why pm-AMM, limitations, traction, program IDs.
