#!/usr/bin/env bash
# Regenerate TS client from Anchor IDL
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROGRAM_DIR="$ROOT/packages/anchor-program"
CLIENT_DIR="$ROOT/packages/anchor-client"

cd "$PROGRAM_DIR"
anchor build

mkdir -p "$CLIENT_DIR/src/idl"
cp "$PROGRAM_DIR/target/idl/comadre.json" "$CLIENT_DIR/src/idl/comadre.json"
cp "$PROGRAM_DIR/target/types/comadre.ts" "$CLIENT_DIR/src/idl/comadre.ts" || true

echo "✓ IDL + types copied to packages/anchor-client/src/idl/"
echo "TODO: write src/index.ts to export typed Program + PDA helpers"
