#!/usr/bin/env bash
# ============================================================
# Comadre — experimental/openwa sandbox setup
# TEMPORARY: throwaway test only, NOT for production.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

OPENWA_PORT="${OPENWA_PORT:-3005}"

# ---- Pre-flight checks ----

if ! command -v docker &> /dev/null; then
  echo "ERROR: Docker is not installed or not in PATH."
  echo "Install Docker Desktop from https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker info &> /dev/null; then
  echo "ERROR: Docker daemon is not running. Start Docker Desktop and retry."
  exit 1
fi

if lsof -i :"${OPENWA_PORT}" &> /dev/null 2>&1; then
  echo "WARNING: Port ${OPENWA_PORT} is already in use."
  echo "Either stop the conflicting process or set OPENWA_PORT to a different value:"
  echo "  OPENWA_PORT=3010 ./setup.sh"
  exit 1
fi

# ---- Environment ----

if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
  echo "IMPORTANT: Edit .env and set API_MASTER_KEY to a strong random value."
else
  echo ".env already exists — skipping copy."
fi

# ---- Data directories ----
# These are gitignored. Named Docker volumes are used in compose,
# but create them locally too for any bind-mount fallback.

mkdir -p sessions data
chmod 700 sessions data
echo "Created sessions/ and data/ with restricted permissions."

# ---- Build ----

echo ""
echo "Building OpenWA image (this clones the repo and installs Chromium deps)..."
echo "First build takes 3-5 minutes. Subsequent builds use Docker cache."
echo ""
docker compose build

# ---- Done ----

echo ""
echo "Build complete. Next steps:"
echo ""
echo "  1. Start OpenWA:"
echo "       docker compose up -d"
echo ""
echo "  2. Watch logs and scan the QR code:"
echo "       docker compose logs -f openwa"
echo "     The QR will appear in the terminal. Scan it with WhatsApp on your phone:"
echo "     Settings > Linked Devices > Link a Device"
echo ""
echo "  3. Verify the API is up:"
echo "       curl -s http://localhost:${OPENWA_PORT}/api/health"
echo ""
echo "  4. Swagger docs:"
echo "       open http://localhost:${OPENWA_PORT}/api/docs"
echo ""
echo "  5. To stop:"
echo "       docker compose down"
echo ""
echo "  6. To remove everything (volumes + images):"
echo "       docker compose down -v --rmi local"
echo "       cd ../.. && rm -rf experimental/openwa"
echo ""
