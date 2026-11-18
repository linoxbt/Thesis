#!/usr/bin/env bash
# Dumps the external programs the LiteSVM harness runs against, from devnet.
set -euo pipefail
cd "$(dirname "$0")/../tests/fixtures"
solana program dump -u devnet GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y pm_amm.so
solana program dump -u devnet metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s mpl_token_metadata.so
echo "pm_amm.so sha256 (Phase 0 used f8c52a12…3460):"
sha256sum pm_amm.so
