# Deploying

Everything deploys from **`main`**. The Railway worker builds on every push to
`main`. The Netlify site is built from `main` (CLI steps below) until the
repository is linked for continuous deployment (one-time step below).

## Web app — Netlify

Live: **https://thesis-calls.netlify.app** (project `thesis-calls`, team `linoxbt`).

Next.js runs on Netlify's OpenNext runtime (`@netlify/plugin-nextjs`, installed
automatically): pages and `/api/*` route handlers become one Netlify Function.
Build config: `apps/web/netlify.toml` (pnpm workspace package `@thesis/web`).

### Redeploy from a machine (CLI)

```bash
pnpm install
netlify link --id ff1fa544-069c-4a0a-9458-8fc147f43227 --filter @thesis/web   # once
netlify build --context production --filter @thesis/web
netlify deploy --prod --no-build --filter @thesis/web --dir apps/web/.netlify/static
```

`--dir apps/web/.netlify/static` matters for a separate build + deploy: the
runtime moves Next's static assets there, and a `--no-build` deploy otherwise
uploads `.next` and every `/_next/static` file 404s. (`netlify deploy --build
--prod --filter @thesis/web` in one step handles this itself.)

### Git continuous deployment from `main` (one-time link, in the Netlify UI)

*Project configuration → Build & deploy → Continuous deployment → Link
repository* → GitHub → `linoxbt/Thesis`, **branch to deploy `main`**, base
directory `/`, package directory `apps/web`. Environment variables are already
set on the project.
`netlify.toml` supplies the build command and publish directory.

### Environment variables (set in the Netlify UI, then redeploy)

| Variable | Scope | Value |
|---|---|---|
| `NEXT_PUBLIC_CLUSTER` | build | `devnet` (set in `netlify.toml`) or `mainnet-beta` |
| `NEXT_PUBLIC_RPC_URL` | build | optional; defaults to the public RPC of the cluster |
| `RPC_URL` | functions | server-side RPC (OrbitFlare or similar) |
| `DATABASE_URL` | functions | Postgres for the indexer's read cache (secret) |
| `TEAM_WALLETS` | functions | comma-separated, excluded from `/stats` |
| `NEXT_PUBLIC_PYTH_PRICE_ACCOUNT` | both | optional override of the SOL/USD price account (one variable for browser and server; `PYTH_PRICE_ACCOUNT` is still read as a fallback) |
| `FAUCET_SECRET_KEY` | functions | devnet SOL drip key (secret, see below) |
| `FAUCET_DAILY_SOL`, `FAUCET_PER_IP` | functions | faucet caps (default 3 SOL/day, 3 drips per IP per 12h) |
| `IP_HASH_SALT` | functions | salt for the hashed IPs used by rate limits (any random string) |
| `TELEGRAM_BOT_USERNAME` | functions | enables Connect Telegram (see below) |

The site sends a strict Content-Security-Policy (`apps/web/next.config.ts`):
the browser may only talk to this origin and the RPC in `NEXT_PUBLIC_RPC_URL`
(plus `*.solana.com`). Set `NEXT_PUBLIC_RPC_URL` before building if you move
RPC providers, or the app can't reach it.

Postgres connections use TLS for every non-local host (the Railway proxy
certificate isn't publicly verifiable, so it's encrypted but unverified;
`DATABASE_SSL=verify` to require a valid certificate, `DATABASE_SSL=off` to
disable).

### Preview mode

Until the program is deployed and a database is attached, `/api/health`
reports what's missing and every page shows a banner instead of failing:
data routes return empty results (`indexer: false`), `/api/config` answers 503.

## Deployed

| Piece | Where | Notes |
|---|---|---|
| Program | Solana devnet `9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h` | initialised by `scripts/init-devnet.ts`; keeper set by `scripts/set-keeper.ts` |
| Postgres | Railway (project `thesis`, service `Postgres`) | public TCP proxy for Netlify; the worker uses the private `DATABASE_URL` reference |
| Worker | Railway (service `worker`) | `services/worker/Dockerfile` (runs as the `node` user), builds on every push to `main`; vars: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `RPC_URL`, `PRICE_SOURCE=onchain`, `PYTH_PRICE_ACCOUNT`, `TREASURY_BUY_USDC`, `VOL_KEEPER=on`, `KEEPER_SECRET_KEY` (JSON byte array); optional `PRIORITY_FEE_MICROLAMPORTS`, `KEEPER_MIN_SOL`, `AUTHORITY_MIN_SOL` |
| Web | Netlify `thesis-calls` | `DATABASE_URL` set to the Railway public URL |

The worker image pins pnpm 10.28.0 for the install (Corepack otherwise fetches
the newest pnpm, whose default `minimumReleaseAge` rejects packages published
in the last day) and starts `tsx` directly, so nothing is downloaded at start.
The worker applies database migrations on start (one at a time, under an
advisory lock); the web app expects them, so deploy the worker first when a
change adds a migration.

## Upgrading the program

```bash
cargo build-sbf --tools-version v1.52 --manifest-path programs/thesis/Cargo.toml
solana program show 9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h -u devnet   # Data Length
solana program extend 9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h <bytes> -u devnet  # if the .so grew past it
solana program deploy target/deploy/thesis.so --program-id 9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h -u devnet --use-rpc
```

The deploy needs the .so's size in SOL as a temporary buffer (about 3.3 SOL
for 475 KB; refunded when it completes). A program whose Config was created
before v2 needs `RPC_URL=… npx tsx scripts/migrate-config.ts --send` right
after the upgrade (it resizes Config and records the creator fees already
owed); every instruction fails until it runs. Devnet was migrated on
2026-11-18.

A fresh deploy must be initialised right away, from the deploying key:
`initialize_config` makes its signer the admin, so whoever calls it first owns
the config. Check `admin` in the Config account afterwards, and redeploy to a
new program id if it isn't yours. Set `max_spot_age_secs` to 60 on mainnet.

Changing the admin is two steps: `update_config { admin }` proposes, and the
new key signs `accept_admin`.

## Operator alerts

With `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID` on the worker, the
operator chat gets: keeper SOL low, Authority PDA float low (it fronts ~0.04
SOL of rent per market creation), a touch proof lost because the price print
was overwritten, and failed settlements or treasury redemptions.

## Telegram alerts (optional)

Off until a bot exists. To switch on:

1. In Telegram, message **@BotFather** → `/newbot` → pick a name and a username
   ending in `bot` (e.g. `ThesisAlertsBot`). It replies with a token.
2. **Railway → worker → Variables:** `TELEGRAM_BOT_TOKEN` = the token (keep it
   secret). Optional: `TELEGRAM_ADMIN_CHAT_ID` = your own chat id for operator
   alerts (keeper SOL low, worker start), and `SITE_URL` if the site moves.
3. **Netlify → Environment variables:** `TELEGRAM_BOT_USERNAME` = the bot's
   username (no @), then redeploy the site.

Users connect from Profile → Settings → Connect Telegram: the wallet signs a
message, the site returns a one-time `t.me/<bot>?start=<code>` link (15 min),
and pressing Start in Telegram links the chat. `/stop` unlinks. Alerts: take
profit or liquidation touched, markets settled (called it / missed it / your
side won / cover paid), and others backing or challenging your call. Each alert
is recorded before it is sent, so a restart never repeats one.

## Faucet SOL (devnet)

The pm-AMM faucet gives test USDC but often no SOL, so the site tops up
instant wallets itself from a devnet-only hot key: `FAUCET_SECRET_KEY` on
Netlify (JSON byte array). Wallets under 0.05 SOL are topped up to 0.15 SOL
(enough to trade and post a protected trade), once per wallet per 12h, three
wallets per IP per 12h, and `FAUCET_DAILY_SOL` (default 3) per day overall,
tracked in `faucet_claims`. The limits are checked and the claim recorded in one
transaction; a claim whose transfer fails is released.
Refill the key with devnet SOL when it runs low.

## Market rent

Creating a market costs its creator ~0.0375 SOL: pm-AMM's accounts (market,
two mints, vault, two Metaplex metadata accounts, and the LP position when
sponsored) are paid by the Authority PDA during the CPI, and the creator repays
exactly that amount in the same instruction, so the Authority's float never
drains. Posting a protected trade (two markets) needs ~0.085 SOL.
