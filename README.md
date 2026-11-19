# Thesis

Post your trade. The crowd bets on it. Your downside is covered by a price proof
anyone can submit.

A *thesis* is a public trade call with two live onchain markets on the
[pm-AMM](https://predict-pm-amm.dev): a conviction market the crowd can back or
challenge (the take profit), and a protection market that pays out if price
touches the trader's liquidation level. Both resolve from a Pyth-signed price
that anyone can submit; settlement needs no admin.

Status: live on devnet. Web: https://thesis-calls.netlify.app (landing at `/`,
app at `/app`), deployed from `main`. Program `9yVcFaDE…` on devnet; worker and
Postgres on Railway. See [`docs/DEPLOY.md`](docs/DEPLOY.md) and
[`docs/PLAN.md`](docs/PLAN.md).

## Layout

| Path | What |
|---|---|
| `programs/thesis` | Anchor 1.0.1 program (instructions below) |
| `services/worker` | One process: watcher (proves touches), keeper (settles, redeems the treasury's positions), indexer (chain → Postgres), volatility keeper, Telegram alerts |
| `apps/web` | Next.js 16 app: feed, trade pages, Post, Protect, Profile, Stats, and the API routes |
| `packages/chain` | IDLs, Pyth decoding, the `prove_touch` rules mirrored offchain, pricing, position math |
| `packages/db` | Postgres schema (migrations), reads, writes, abuse guards |
| `idls/pm_amm.json` | Trimmed pm-AMM IDL for `declare_program!` (`scripts/trim-idl.js` from `idls/full`, MIT, [sparkfun-labs/pm-amm](https://github.com/sparkfun-labs/pm-amm)) |
| `tests/harness` | LiteSVM tests against the real pm-AMM and Metaplex bytecode |
| `scripts/` | Local stack, e2e, devnet seeding, migrations, preflight checks |

### Program instructions

| Group | Instructions |
|---|---|
| Config | `initialize_config`, `update_config` (bounded; proposes a new admin), `accept_admin`, `set_volatility`, `migrate_config` (one-off v1 → v2 resize) |
| Markets | `create_touch_market` (opening price computed onchain; sponsored markets may name a beneficiary), `prove_touch` (until `end_ts` + grace), `settle` |
| Theses | `create_thesis` (links markets within 15 min of opening), `trade` (fees attributed, cover capped per wallet), `claim_creator_fees` |
| Treasury | `treasury_buy_yes` (keeper, after a proven touch, needs a 1% edge), `treasury_redeem` (anyone, after settlement: seed residuals + winnings back to the treasury) |

Creator fees owed are reserved onchain (`creator_fees_owed`): sponsored seeds
and treasury buys can't spend them.

## Program IDs

| Program | Devnet | Mainnet |
|---|---|---|
| Thesis | `9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h` | — |
| pm-AMM | `GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y` | same |
| Pyth receiver | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | same |

## Build and test

Toolchain: Rust stable, Solana CLI 3.0.14, Anchor CLI 1.0.1, Node 22, pnpm 10.
CI (`.github/workflows/ci.yml`) runs all of the below except the e2e.

```bash
pnpm install
cargo build-sbf --tools-version v1.52 --manifest-path programs/thesis/Cargo.toml
scripts/fetch-fixtures.sh            # dump pm-AMM + Metaplex from devnet
pnpm test                            # LiteSVM: 34 program tests
npx tsc --noEmit -p tsconfig.json    # scripts, worker, packages
(cd apps/web && npx tsc --noEmit)
(cd packages/db && pnpm test)        # needs Postgres on :5433 (database thesis_test)
pnpm test:worker                     # watcher, indexer, alerts, layout (Postgres on :5433)
```

The database tests refuse to run against anything but a local server.

`cargo build-sbf` needs platform tools v1.52 for the edition-2024 crates in the
lockfile, the same as pm-AMM's own devnet build. The LiteSVM harness has its own
workspace and lockfile because it needs a newer Cargo than the platform tools
ship. After changing the program: `anchor idl build -p thesis -o
target/idl/thesis.json -t target/types/thesis.ts && scripts/sync-idl.sh`.

### End to end, locally

```bash
PG_URL=postgres://postgres@localhost:5433 scripts/local-stack.sh   # validator, worker, seed, web on :3100
BASE_URL=http://localhost:3100 npx tsx scripts/ui-e2e.ts            # 29 browser checks
```

## Known limitations (devnet)

- **Proofs come from one onchain price account.** The watcher reads Pyth's
  sponsored SOL/USD account, which on devnet updates about every 30 minutes.
  Only prints that land there can prove a touch: a wick between two prints
  can't be proven. Posting exact prints from Pyth's Hermes service would close
  the gap; it needs a Hermes API key.
- **Stale opening spot on devnet.** Market creation accepts a spot print up
  to `max_spot_age_secs` old: one hour on devnet (the feed updates every ~30
  minutes), so a market can open against a price that has since moved past
  its strike. Mainnet uses 60 seconds (`scripts/mainnet-preflight.ts`).
- **Instant wallets** are devnet keys kept in the browser's local storage.
- **Keys:** the upgrade authority and config admin are one hot key. Before
  mainnet, move both to a multisig (`update_config` then `accept_admin`, and
  `solana program set-upgrade-authority`).

## License

MIT
