# Deploying

Everything deploys from **`main`**: the Railway worker builds on every push to
`main`, and the Netlify site is meant to as well (link step below). Work
happens on feature branches and lands on `main` to go live.

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
| `PYTH_PRICE_ACCOUNT` / `NEXT_PUBLIC_PYTH_PRICE_ACCOUNT` | both | optional override of the SOL/USD price account |

### Preview mode

Until the program is deployed and a database is attached, `/api/health`
reports what's missing and every page shows a banner instead of failing:
data routes return empty results (`indexer: false`), `/api/config` answers 503.

## Deployed

| Piece | Where | Notes |
|---|---|---|
| Program | Solana devnet `9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h` | initialised by `scripts/init-devnet.ts`; keeper set by `scripts/set-keeper.ts` |
| Postgres | Railway (project `thesis`, service `Postgres`) | public TCP proxy for Netlify; the worker uses the private `DATABASE_URL` reference |
| Worker | Railway (service `worker`) | `services/worker/Dockerfile`, builds on every push to `main`; vars: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `RPC_URL`, `PRICE_SOURCE=onchain`, `PYTH_PRICE_ACCOUNT`, `TREASURY_BUY_USDC`, `VOL_KEEPER=on`, `KEEPER_SECRET_KEY` (JSON byte array) |
| Web | Netlify `thesis-calls` | `DATABASE_URL` set to the Railway public URL |

The worker image pins pnpm 10.28.0: Corepack otherwise fetches the newest pnpm,
whose default `minimumReleaseAge` rejects packages published in the last day.
