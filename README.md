# Thesis

**Prove you called it.**

Thesis turns a trade call into a live onchain market. A trader posts a call
("SOL touches $76.70 by Saturday"), the protocol prices it the moment it is
posted, the crowd backs or challenges it, and an oracle settles it with no
admin in the loop. Every result is scored against the odds the call was given,
so a trader's record measures real edge rather than volume of safe calls.

| Edition | Network | Status | App |
|---|---|---|---|
| **Thesis on QIE** | QIE mainnet (chain 1990) | Live, contract verified | https://thesis-qie.netlify.app |
| **Thesis on Solana** | Solana devnet | Live (test assets) | https://thesis-calls.netlify.app |

The QIE edition is a port of the original Solana build, rewritten in Solidity
for the QIE Blockchain. Its own documentation is in [`qie/README.md`](qie/README.md).

---

## Contents

- [The problem](#the-problem)
- [How it works](#how-it-works)
- [Skill score](#skill-score)
- [Thesis on QIE](#thesis-on-qie)
- [Thesis on Solana](#thesis-on-solana)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Security model and known limitations](#security-model-and-known-limitations)
- [License](#license)

## The problem

Trading calls are everywhere and accountable nowhere. Anyone can claim they
called the move after the fact; nothing prices a call when it is made, and
nothing keeps a record that can't be edited. Hit rate is easy to game: post
only near-certain calls and you are always right.

Thesis addresses all three:

- **Priced at posting.** Opening odds are computed onchain from distance to
  target, time to deadline and volatility, using the reflection-principle
  probability that price touches a level: `P = 2Φ(−|ln(K/S)| / σ√τ)`.
- **Settled by an oracle, not a person.** A call resolves YES the first time
  an oracle price inside the window reaches the target, and NO at the
  deadline otherwise. Anyone can trigger settlement; nobody can choose the
  outcome.
- **Scored against the odds.** The record rewards calls that beat the market,
  not calls that were obvious.

## How it works

1. **Post.** The trader picks an asset, a direction, a take-profit level and a
   deadline, and seeds the market. The contract computes the opening odds and
   opens the market at that price.
2. **Trade.** Others back the call (YES) or challenge it (NO). Every trade pays
   a 2% fee, part of which goes to the creator of the call.
3. **Resolve.** The first qualifying oracle price at or past the target settles
   the call YES. If none appears before the deadline, it settles NO after a
   short grace period.
4. **Claim and score.** Winners claim their payout; the creator's onchain
   record (hits, misses, skill) updates.

## Skill score

Each settled call scores `(1 if hit, else 0) − opening probability`, using the
odds computed onchain when the call was posted:

| Call | Opening odds | Outcome | Score |
|---|---|---|---|
| Long shot | 20% | Hit | **+0.80** |
| Coin flip | 50% | Missed | −0.50 |
| Near-certain | 90% | Missed | **−0.90** |

Calls posted at fair odds average zero over time, so the leaderboard only rises
for traders with genuine edge.

## Thesis on QIE

A single Solidity contract, `ThesisCalls`, implements pari-mutuel call markets
on QIE mainnet, using the QIE stack end to end:

| QIE component | Role |
|---|---|
| **QIE Blockchain** | `ThesisCalls` on mainnet: [`0x6945294DD8E8Cab0A39aff48Df97EaAB67742AEf`](https://mainnet.qie.digital/address/0x6945294DD8E8Cab0A39aff48Df97EaAB67742AEf#code) (verified source) |
| **QIE Oracle** | BTC, ETH and SOL feeds price each call at posting, settle it round by round (`getRoundData`), and supply realised volatility |
| **QUSDC** | Seeds, stakes, payouts and fees |
| **QIE Wallet** | Discovered via EIP-6963; one-click network switch and signing |

**Design highlights**

- **Every oracle round counts.** Before accepting a bet, and before settling NO,
  the contract scans every oracle round it has not yet checked. A touch can't
  be missed, and nobody gains by racing to submit or withhold a proof.
- **Onchain odds and scoring.** `TouchMath` computes touch probabilities with
  fixed-point `ln`, `exp`, `sqrt` and `erfc`; creator statistics (posted, hits,
  misses, skill, volume) live in contract storage.
- **Creator earnings.** Half of every 2% fee accrues to the call's creator,
  claimable at any time.
- **Bounded administration.** Two-step ownership transfer, bounded parameters
  and a pause switch. No owner function sets or changes a call's outcome.
- **No backend required.** The web app is a static site that reads the contract
  and its events directly; an optional keeper proves touches and settles calls
  promptly.

Contract, tests, keeper and app: [`qie/`](qie/). Details and the deployment
record: [`qie/README.md`](qie/README.md).

## Thesis on Solana

The original edition: an Anchor program in which each thesis links two
[pm-AMM](https://predict-pm-amm.dev) markets, settled by Pyth.

- **Conviction market:** "SOL touches the take profit before the deadline."
  The crowd backs or challenges it; the creator earns a share of fees.
- **Protection market:** "SOL touches the liquidation price before the
  deadline." Cover pays $1 per share if it does.
- **Permissionless proofs:** the first fully verified Pyth print past a strike
  inside the window resolves the touch. A watcher submits proofs
  automatically; anyone else can too.
- **Solana Actions (Blinks):** every call is shareable as an action with
  Back / Challenge buttons.

```
 browser ──► Next.js (Netlify) ── API routes ──► Postgres ◄── indexer ─┐
    │                                                                   │
    └── signs ──► Thesis program ──CPI──► pm-AMM          worker ───────┤
                     ▲  prove_touch / settle / treasury_redeem ◄── watcher, keeper
                     └── Pyth SOL/USD (PriceUpdateV2)
```

| Program | Devnet |
|---|---|
| Thesis | `9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h` |
| pm-AMM | `GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y` |
| Pyth receiver | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` |

Operations: [`docs/DEPLOY.md`](docs/DEPLOY.md) ·
[`docs/MAINNET.md`](docs/MAINNET.md) · [`docs/DEMO.md`](docs/DEMO.md).

## Repository layout

| Path | Contents |
|---|---|
| `qie/contracts` | QIE edition: `ThesisCalls` and `TouchMath` (Solidity 0.8.24), Hardhat tests, deploy scripts, keeper |
| `qie/app` | QIE edition: static Next.js app (viem, EIP-6963 wallets) |
| `programs/thesis` | Solana edition: Anchor 1.0.1 program |
| `services/worker` | Solana edition: watcher, keeper, indexer, volatility updates, alerts |
| `apps/web` | Solana edition: Next.js app and API routes |
| `packages/chain` | Shared chain logic: IDLs, Pyth decoding, pricing, position maths |
| `packages/db` | Postgres schema, migrations and queries |
| `tests/harness` | LiteSVM tests against the real pm-AMM and Metaplex bytecode |
| `scripts/` | Local stack, end-to-end tests, seeding, preflight checks |

## Development

**QIE edition** (Node 22):

```bash
cd qie/contracts && npm ci
npx hardhat test                      # contract unit tests
FORK=1 npx hardhat test test/fork.test.js   # against live QIE Oracle feeds

# Local end to end: chain, demo data, app, browser tests
npx hardhat node &
npx hardhat run scripts/dev-chain.js --network localhost
cd ../app && NEXT_PUBLIC_QIE_NETWORK=local npx next build && npx serve out -l 3200 &
node e2e/ui.e2e.cjs
```

**Solana edition** (Rust stable, Solana CLI 3.0.14, Anchor CLI 1.0.1, Node 22,
pnpm 10):

```bash
pnpm install
cargo build-sbf --tools-version v1.52 --manifest-path programs/thesis/Cargo.toml
scripts/fetch-fixtures.sh             # pm-AMM and Metaplex fixtures from devnet
pnpm test                             # LiteSVM program tests
(cd packages/db && pnpm test)         # needs local Postgres on :5433
pnpm test:worker
```

Continuous integration runs in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Security model and known limitations

- **Oracle cadence.** Calls settle from published oracle prices. A wick that
  starts and ends between two oracle updates can't be counted on either
  edition.
- **Keys.** On both editions, administrative keys are held by a single wallet
  today. Ownership should move to a multisig before significant value is at
  stake.
- **Unaudited.** The contracts have extensive tests but no third-party audit.
  Use small amounts.
- **Not financial advice.** Thesis is an experimental protocol.

## License

[MIT](LICENSE)
