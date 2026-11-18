# Deploying

Everything deploys from **`main`**: on every push, Vercel builds the web app
and Railway builds the worker. Work happens on feature branches and lands on
`main` to go live.

## Web app — Vercel

Live: **https://thesis-linoxbt1.vercel.app** (project `thesis`, team `linoxbt1`).

The project is linked to `linoxbt/Thesis` with production branch **`main`**:
every push to `main` deploys to production, and other branches get preview
deployments. Root directory `apps/web`; Vercel installs the pnpm workspace from
the repository root. Node 22. Framework: Next.js.

Deployment protection (Vercel Authentication) covers **preview deployments
only**; production is public.

### Environment variables (Vercel project settings)

| Variable | Environments | Value |
|---|---|---|
| `NEXT_PUBLIC_CLUSTER` | all | `devnet` or `mainnet-beta` |
| `NEXT_TELEMETRY_DISABLED` | all | `1` |
| `DATABASE_URL` | production, preview | Railway Postgres public URL (sensitive) |
| `NEXT_PUBLIC_RPC_URL` | optional | defaults to the public RPC of the cluster |
| `RPC_URL` | optional | server-side RPC |
| `TEAM_WALLETS` | optional | comma-separated, excluded from `/stats` |
| `PYTH_PRICE_ACCOUNT` / `NEXT_PUBLIC_PYTH_PRICE_ACCOUNT` | optional | override of the SOL/USD price account |

### Preview mode

Until the program is deployed and a database is attached, `/api/health`
reports what's missing and every page shows a banner instead of failing:
data routes return empty results (`indexer: false`), `/api/config` answers 503.

## Deployed

| Piece | Where | Notes |
|---|---|---|
| Program | Solana devnet `9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h` | initialised by `scripts/init-devnet.ts`; keeper set by `scripts/set-keeper.ts` |
| Postgres | Railway (project `thesis`, service `Postgres`) | public TCP proxy for the web app; the worker uses the private `DATABASE_URL` reference |
| Worker | Railway (service `worker`) | `services/worker/Dockerfile`, builds on every push to `main`; vars: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `RPC_URL`, `PRICE_SOURCE=onchain`, `PYTH_PRICE_ACCOUNT`, `TREASURY_BUY_USDC`, `VOL_KEEPER=on`, `KEEPER_SECRET_KEY` (JSON byte array) |
| Web | Vercel `thesis` | `DATABASE_URL` set to the Railway public URL |

The worker image pins pnpm 10.28.0: Corepack otherwise fetches the newest pnpm,
whose default `minimumReleaseAge` rejects packages published in the last day.
