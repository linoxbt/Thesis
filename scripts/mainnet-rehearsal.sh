#!/usr/bin/env bash
# Rehearses the mainnet deploy on a local validator cloned from mainnet-beta:
# the real pm-AMM, Metaplex, USDC mint, sponsored SOL/USD account and the
# pm-AMM DAO's USDC account. Runs the same deploy command (with --max-len),
# scripts/init-mainnet.ts with the mainnet caps, then posts a sponsored market
# and a thesis and trades through it. Throwaway keys; nothing touches mainnet.
#
#   scripts/mainnet-rehearsal.sh            (logs in $DIR, default /tmp/thesis-rehearsal)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
DIR=${DIR:-/tmp/thesis-rehearsal}
RPC=http://127.0.0.1:8899
USDC=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
mkdir -p "$DIR"

solana-keygen new -s --no-bip39-passphrase -f -o "$DIR/admin.json" >/dev/null
solana-keygen new -s --no-bip39-passphrase -f -o "$DIR/keeper.json" >/dev/null
ADMIN=$(solana-keygen pubkey "$DIR/admin.json")
ata() { node -e "const {getAssociatedTokenAddressSync:g}=require('@solana/spl-token');const {PublicKey:P}=require('@solana/web3.js');console.log(g(new P('$USDC'),new P('$1'),true).toBase58())"; }
DAO_USDC=$(ata 4qXyczAr5DuBVaHUwmZT5Xt6hgQ6RwqBYcFGtrv8QEph)
# The admin's USDC (a local fiction: 1,000 USDC so the treasury can be funded).
npx tsx scripts/rehearsal-usdc-account.ts "$ADMIN" "$DIR/admin-usdc.json" 2>/dev/null

pkill -f solana-test-validator || true
sleep 1
rm -rf "$DIR/ledger"
setsid solana-test-validator -q --ledger "$DIR/ledger" -u mainnet-beta \
  --clone-upgradeable-program GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y \
  --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
  --clone "$USDC" --clone "$DAO_USDC" --clone 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE \
  --account "$(ata "$ADMIN")" "$DIR/admin-usdc.json" \
  > "$DIR/validator.log" 2>&1 < /dev/null &
until solana -u localhost cluster-version >/dev/null 2>&1; do sleep 2; done
solana -u localhost airdrop 20 "$ADMIN" >/dev/null

echo "== deploy (the mainnet command, against the clone)"
MAX_LEN=$(RPC_URL=https://api.mainnet-beta.solana.com npx tsx scripts/mainnet-preflight.ts 2>/dev/null | sed -n 's/.*--max-len \([0-9]*\).*/\1/p')
solana program deploy target/deploy/thesis.so -u localhost --program-id target/deploy/thesis-keypair.json \
  --upgrade-authority "$DIR/admin.json" --keypair "$DIR/admin.json" --max-len "$MAX_LEN"
solana program show 9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h -u localhost | grep -E "Authority|Data Length"

echo "== init (mainnet caps)"
REHEARSAL=1 RPC_URL=$RPC ADMIN_KEYPAIR="$DIR/admin.json" KEEPER_PUBKEY=$(solana-keygen pubkey "$DIR/keeper.json") \
  npx tsx scripts/init-mainnet.ts --send --treasury-usdc 100 2>/dev/null

echo "== smoke: sponsored market, thesis, trade"
RPC_URL=$RPC ADMIN_KEYPAIR="$DIR/admin.json" npx tsx scripts/rehearsal-smoke.ts 2>/dev/null
pkill -f solana-test-validator || true
