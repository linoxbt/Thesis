# Mainnet runbook

Rehearsed end to end on a local validator cloned from mainnet-beta
(`scripts/mainnet-rehearsal.sh`, 2026-11-19): the deploy command below, init
with the mainnet caps, then a sponsored market, a thesis and a 1 USDC trade
against the real pm-AMM, USDC mint, SOL/USD price account and pm-AMM DAO fee
account. All passed.

## 0. Decide

- **Do the organisers expect mainnet?** If not, stay on devnet; nothing below
  is needed for the submission.
- **Program id.** Either keep devnet's id (`9yVcFaDE…`, the same on both
  clusters, like pm-AMM) or create a new one.
  - Same id: the deploy needs the program keypair from the machine that
    deployed devnet (`target/deploy/thesis-keypair.json`, gitignored). Today it
    exists only in the build container, which is temporary: if it's lost,
    only the new-id path remains.
  - New id: `solana-keygen new -o thesis-mainnet.json` on your machine, put its
    address in `declare_id!` (`programs/thesis/src/lib.rs`) and `Anchor.toml`,
    rebuild, regenerate the IDL (`anchor idl build … && scripts/sync-idl.sh`),
    and build the mainnet web and worker from that commit.
- **Keys.** A deployer key (hot, used once), an admin that ends up in a
  multisig (Squads), and a separate keeper key for the worker. The admin key
  must not be the keeper.

## 1. Money

From `scripts/mainnet-preflight.ts` against mainnet (live rent):

| Item | SOL |
|---|---|
| Program data, 530 KB slot (kept) | 2.69 |
| Deploy buffer (refunded when the deploy completes) | 2.69 |
| Config + Authority PDA float (fronts market rent, repaid by creators) | 0.50 |
| Fees | ~0.05 |
| **Peak on the deployer** | **≈ 5.94** |
| **Locked afterwards** | **≈ 3.25** |
| Keeper (proofs, settlements, redemptions) | 0.3–0.5 |

Plus USDC for the treasury: at least the sponsor budget (100 at launch).

## 2. Deploy

```bash
RPC_URL=<mainnet rpc> npx tsx scripts/mainnet-preflight.ts <deployer pubkey>   # every line PASS
cargo build-sbf --tools-version v1.52 --manifest-path programs/thesis/Cargo.toml
solana program deploy target/deploy/thesis.so -u <mainnet rpc> \
  --program-id <program keypair> --keypair <deployer> --upgrade-authority <deployer> \
  --max-len 530000 --use-rpc
```

**Immediately** (whoever initialises first becomes admin):

```bash
RPC_URL=<mainnet rpc> ADMIN_KEYPAIR=<admin> KEEPER_PUBKEY=<keeper pubkey> \
  npx tsx scripts/init-mainnet.ts --send --treasury-usdc 100
```

It refuses anything but mainnet, refuses keeper = admin, and fails loudly if
the Config admin isn't you (then redeploy under a new id). Caps: seeds 5–25
USDC, cover 100 USDC per wallet, sponsor budget 100 USDC, spot age 60 s; raise
later with `update_config`.

## 3. Hand over the keys

```bash
solana program set-upgrade-authority <program id> --new-upgrade-authority <multisig vault> \
  --skip-new-upgrade-authority-signer-check -u <mainnet rpc> --keypair <deployer>
```

Then `update_config { admin: <multisig vault> }` from the admin, and
`accept_admin` from the multisig (a Squads transaction). Until accepted, the
old admin stays in control.

## 4. Services

- **Worker** (a second Railway service, or a new environment): `RPC_URL` =
  your mainnet provider, `KEEPER_SECRET_KEY` = the keeper, a **separate**
  Postgres, `TREASURY_BUY_USDC` (e.g. 2), `PRIORITY_FEE_MICROLAMPORTS` (e.g.
  10000), `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ADMIN_CHAT_ID` for operator alerts.
- **Web** (a second Netlify site): build with `NEXT_PUBLIC_CLUSTER=mainnet-beta`
  and `NEXT_PUBLIC_RPC_URL` = the provider (the CSP only allows that origin),
  `RPC_URL`, `DATABASE_URL` (the mainnet Postgres), `TEAM_WALLETS`. No
  `FAUCET_SECRET_KEY`: the faucet is devnet-only and the instant wallet is
  hidden on mainnet.

## 5. Smoke test, then open

1. Post one sponsored house call from the admin (or keeper); trade 1 USDC
   through it from a normal wallet; check it on `/t/<pda>` and `/stats`.
2. Watch the operator chat for a day.
3. If anything is wrong: `update_config { paused: true }` stops new markets,
   theses and trades. Proofs, settlement and claims keep working, so users can
   always exit.

## Rehearse again

```bash
scripts/mainnet-rehearsal.sh   # throwaway keys, local validator, nothing touches mainnet
```
