#!/usr/bin/env bash
# Full local stack for UI work and the Playwright run:
#   validator (clones devnet pm-AMM, Metaplex, mUSDC, Pyth SOL/USD, your
#   wallet's mUSDC) -> fresh Postgres DB -> worker -> seed -> web on :3100.
#
#   PG_URL=postgres://postgres@localhost:5433 scripts/local-stack.sh
# Logs and the ledger go to $STACK_DIR (default /tmp/thesis-stack).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
STACK_DIR=${STACK_DIR:-/tmp/thesis-stack}
PG_URL=${PG_URL:-postgres://postgres@localhost:5433}
DB=${DB:-thesis_local}
RPC=http://127.0.0.1:8899
mkdir -p "$STACK_DIR"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

WALLET=$(solana-keygen pubkey ~/.config/solana/id.json)
MUSDC=3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ
ata() { node -e "const {getAssociatedTokenAddressSync:g}=require('@solana/spl-token');const {PublicKey:P}=require('@solana/web3.js');console.log(g(new P('$MUSDC'),new P('$1'),true).toBase58())"; }
WALLET_USDC=$(ata "$WALLET")
DAO_USDC=$(ata 4qXyczAr5DuBVaHUwmZT5Xt6hgQ6RwqBYcFGtrv8QEph)

echo "stopping anything already running"
pkill -f solana-test-validator || true
pkill -f "services/worker/src/index.ts" || true
pkill -f next-server || true
sleep 2

echo "validator"
rm -rf "$STACK_DIR/ledger"
setsid solana-test-validator -q --ledger "$STACK_DIR/ledger" -u devnet \
  --clone-upgradeable-program GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y \
  --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
  --clone "$MUSDC" --clone "$WALLET_USDC" --clone "$DAO_USDC" \
  --clone 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE \
  --upgradeable-program 9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h target/deploy/thesis.so "$WALLET" \
  > "$STACK_DIR/validator.log" 2>&1 < /dev/null &
until solana -u localhost cluster-version >/dev/null 2>&1; do sleep 2; done
solana -u localhost airdrop 100 "$WALLET" >/dev/null

echo "database $DB"
psql "$PG_URL/postgres" -qc "drop database if exists $DB" -c "create database $DB"
export DATABASE_URL="$PG_URL/$DB"

echo "worker"
DATABASE_URL=$DATABASE_URL RPC_URL=$RPC VOL_KEEPER=off INDEXER_INTERVAL_MS=5000 KEEPER_INTERVAL_MS=10000 \
  setsid nohup npx tsx services/worker/src/index.ts > "$STACK_DIR/worker.log" 2>&1 < /dev/null &
until psql "$DATABASE_URL" -tAc "select 1 from schema_migrations limit 1" >/dev/null 2>&1; do sleep 1; done

echo "seed"
RPC_URL=$RPC DATABASE_URL=$DATABASE_URL npx tsx scripts/local-seed.ts | grep -v bigint | tail -3

echo "web"
(cd apps/web && NEXT_PUBLIC_RPC_URL=$RPC NEXT_PUBLIC_CLUSTER=devnet NEXT_TELEMETRY_DISABLED=1 npx next build >"$STACK_DIR/web-build.log" 2>&1)
(cd apps/web && DATABASE_URL=$DATABASE_URL RPC_URL=$RPC DEV_FAUCET_KEYPAIR=$HOME/.config/solana/id.json NEXT_TELEMETRY_DISABLED=1 \
  setsid nohup npx next start -p 3100 > "$STACK_DIR/web.log" 2>&1 < /dev/null &)
until curl -s -o /dev/null http://localhost:3100/api/stats; do sleep 1; done
echo "up: http://localhost:3100  (logs in $STACK_DIR)"
cd "$ROOT"
