# ============================================================
# Comadre — experimental/openwa sandbox
# TEMPORARY: throwaway test only, NOT for production.
#
# Strategy: clone OpenWA inside the build so none of their
# code lives in our repo. Pin via OPENWA_REF build arg.
# ============================================================

# ---- Build stage: clone + compile ----
FROM node:22-slim AS builder

# Build-time pin — override with a commit SHA for reproducibility:
#   docker build --build-arg OPENWA_REF=<sha> .
# Pinned SHA: 0fbee7fbee9d746050a20c57544bf7bbb80e65d2 (HEAD of main, 2026-06-11)
ARG OPENWA_REF=0fbee7fbee9d746050a20c57544bf7bbb80e65d2

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Activate pnpm via corepack (ships with Node 22) — pnpm is the only
# package manager we use, even inside containers.
#
# Pinned to v9 because v10+ refuses to compile native bindings
# (sqlite3, ssh2, puppeteer) without explicit per-package approval.
# OpenWA needs those to run. v9 warns but doesn't fail.
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /build

RUN git clone --depth 1 --branch "${OPENWA_REF}" \
    https://github.com/rmyndharis/OpenWA.git . 2>/dev/null || \
    (git clone --depth 1 https://github.com/rmyndharis/OpenWA.git . && \
     git checkout "${OPENWA_REF}")

# OpenWA's package.json declares some deps incorrectly (uses 'dotenv' and
# '@nestjs/websockets' in code without listing them — npm hides this with
# flat hoisting). Force pnpm to mimic npm's flat layout so transitive
# deps are importable.
RUN printf 'shamefully-hoist=true\nauto-install-peers=true\nstrict-peer-dependencies=false\n' > .npmrc

# Upstream ships package-lock.json. Import to pnpm-lock.yaml if possible,
# then install. Resolution may differ slightly from upstream npm install;
# acceptable for a sandbox.
#
# BuildKit cache mount persists pnpm's content-addressable store across
# builds, so failed/retried builds don't redownload tarballs.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm import 2>/dev/null || echo "no package-lock.json to import"
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile

RUN pnpm run build

# Strip dev deps from node_modules
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm prune --prod


# ---- Production stage ----
FROM node:22-slim AS production

# Chromium and all Puppeteer system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    dumb-init \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the system Chromium, not download its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy compiled output and runtime node_modules from builder
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./package.json

# Data directories (session + media) — populated by compose volume
RUN mkdir -p /app/data/sessions /app/data/media

EXPOSE 2785

# dumb-init: proper PID 1, prevents Chromium zombie processes
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:2785/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
