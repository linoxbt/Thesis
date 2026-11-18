# Deploying

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

### Recommended: Git continuous deployment

In the Netlify UI: *Project configuration → Build & deploy → Link repository*,
repo `linoxbt/Thesis`, base directory `/`, package directory `apps/web`.
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

## Still to deploy

1. **Program on devnet** — needs ~3 devnet SOL in the deployer wallet
   (`anchor deploy --provider.cluster devnet`), then `initialize_config`.
2. **Postgres** — Supabase or Netlify DB; set `DATABASE_URL` on Netlify and on
   the worker.
3. **Worker** (watcher + keeper + indexer + volatility keeper) — a long-running
   Node process: Railway or any VM (`pnpm worker`, env as in
   `services/worker/src/index.ts`). Netlify Functions can't host it.
