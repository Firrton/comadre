#!/usr/bin/env bash
# Deploy the Anchor program to a target cluster (devnet by default)
set -euo pipefail

CLUSTER="${1:-devnet}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT/packages/anchor-program"

echo "Building..."
anchor build

echo "Deploying to $CLUSTER..."
anchor deploy --provider.cluster "$CLUSTER"

echo "✓ Deployed. Updating IDL on-chain..."
anchor idl init -f target/idl/comadre.json $(solana-keygen pubkey target/deploy/comadre-keypair.json) --provider.cluster "$CLUSTER" || \
  anchor idl upgrade -f target/idl/comadre.json $(solana-keygen pubkey target/deploy/comadre-keypair.json) --provider.cluster "$CLUSTER"

echo "✓ Done. Run 'bun run codegen:client' next."
