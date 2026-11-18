# Thesis

Post your trade. The crowd bets on it. Your downside is covered by a price proof
anyone can submit.

A *thesis* is a public trade call with two live onchain markets on the
[pm-AMM](https://predict-pm-amm.dev): a conviction market the crowd can back or
challenge, and a protection market that pays out if price touches the trader's
liquidation level. Both settle from a Pyth-signed price that anyone can submit,
with no admin.

Status: **Phase 2** (thesis layer + watcher) done; devnet deploy pending devnet SOL. See [`docs/PLAN.md`](docs/PLAN.md).

## Layout

| Path | What |
|---|---|
| `programs/thesis` | Anchor 1.0.1 program: config (`initialize_config`, `update_config`, `set_volatility`), markets (`create_touch_market` with onchain opening price, `prove_touch`, `settle`), theses (`create_thesis`, `trade`, `claim_creator_fees`), `treasury_buy_yes` |
| `services/worker` | Watcher (proves touches) + keeper (settles); `pnpm worker` |
| `idls/pm_amm.json` | pm-AMM IDL (MIT, [sparkfun-labs/pm-amm](https://github.com/sparkfun-labs/pm-amm) `d5b407b`) for `declare_program!` |
| `tests/harness` | LiteSVM tests against the real pm-AMM and Metaplex bytecode |
| `tests/fixtures` | A real Pyth `PriceUpdateV2` account; programs dumped by `scripts/fetch-fixtures.sh` |
| `scripts/devnet-spike.ts` | Full lifecycle on devnet (or a local validator) |
| `docs/PLAN.md` | Phased build plan and Phase 0 results |

## Program IDs

| Program | Devnet | Mainnet |
|---|---|---|
| Thesis | `9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h` (not deployed yet) | — |
| pm-AMM | `GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y` | same |
| Pyth receiver | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | same |

## Build and test

Toolchain: Rust stable, Solana CLI 3.0.14, Anchor CLI 1.0.1, Node 22, pnpm.

```bash
pnpm install
anchor build            # program + IDL (target/idl, target/types)
cargo test -p thesis    # unit tests (Pyth decoding)
scripts/fetch-fixtures.sh  # dump pm-AMM + Metaplex from devnet
pnpm test               # LiteSVM spikes against pm-AMM bytecode
```

`cargo build-sbf` needs platform tools v1.52 for the edition-2024 crates in the
lockfile (`cargo build-sbf --tools-version v1.52`), the same as pm-AMM's own
devnet build. The LiteSVM harness has its own workspace and lockfile because it
needs a newer Cargo than the platform tools ship.

## Devnet

```bash
solana config set -u devnet
curl -X POST https://pm-amm-devnet.vercel.app/api/faucet \
  -H 'content-type: application/json' -d "{\"wallet\":\"$(solana address)\"}"   # mUSDC
anchor deploy --provider.cluster devnet      # ~2 SOL of program rent
pnpm devnet:spike --distance-bps 60 --window 7200 --seed 25
```

The spike creates a sponsored TouchBelow market 0.6% under spot (opening price computed onchain), buys YES directly on
the pm-AMM, proves a touch from Pyth's sponsored SOL/USD account if price
crosses, and settles after the 120 s grace period.

## License

MIT
