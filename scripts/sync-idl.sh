#!/usr/bin/env bash
# Copies the IDLs and generated types into packages/chain after `anchor build`,
# so the worker and the web app import them as JSON (bundler-friendly).
set -euo pipefail
cd "$(dirname "$0")/.."
cp target/idl/thesis.json packages/chain/idl/thesis.json
cp target/types/thesis.ts packages/chain/idl/thesis.ts
cp idls/full/pm_amm.json packages/chain/idl/pm_amm.json
echo "IDLs synced to packages/chain/idl"
