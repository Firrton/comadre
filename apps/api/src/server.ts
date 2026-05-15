/**
 * Hono server bootstrap — apps/api
 *
 * Middleware order (applied to all routes unless noted):
 *   1. loggerMiddleware     — req_id injection + pino start/end logs
 *   2. errorHandler         — catches unhandled errors; Zod → 400, rest → 500
 *   3. rateLimitMiddleware  — per-user 100 req/min (skipped on /health + /webhooks/*)
 *   4. authMiddleware       — Privy JWT (skipped on /health + /webhooks/*)
 *   5. idempotencyMiddleware — POST-only X-Idempotency-Key enforcement (applied per-router)
 *
 * Routers mounted:
 *   /api/v1/users/*         — users router
 *   /api/v1/tandas/*        — tandas router
 *   /api/v1 (disputes)      — disputes router (mixed paths)
 *   /api/v1/kyc/*           — kyc router
 *   /api/v1 (ramps)         — ramps router
 *   /webhooks/*             — webhooks router (public, no auth)
 */

import { Hono } from "hono";

import { loggerMiddleware } from "./middlewares/logger.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { authMiddleware } from "./middlewares/auth.js";
import { rateLimitMiddleware } from "./middlewares/rateLimit.js";
import { idempotencyMiddleware } from "./middlewares/idempotency.js";

import { usersRouter } from "./routes/users.js";
import { tandasRouter } from "./routes/tandas.js";
import { disputesRouter } from "./routes/disputes.js";
import { kycRouter } from "./routes/kyc.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { rampsRouter } from "./routes/ramps.js";
import { transfersRouter } from "./routes/transfers.js";
import { transfersMonadRouter } from "./routes/transfersMonad.js";
import { onboardingRouter } from "./routes/onboarding.js";
import { walletRouter } from "./routes/wallet.js";
import { savingsRouter } from "./routes/savings.js";

const app = new Hono();

// ── Global middlewares ────────────────────────────────────────────────────────
app.use("*", loggerMiddleware);
app.use("*", errorHandler);

// ── Health (no auth, no rate limit) ──────────────────────────────────────────
app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
  })
);

// ── Webhooks (public — own auth via HMAC / Privy signature) ──────────────────
app.route("/webhooks", webhooksRouter);

// ── Onboarding + Monad transfers (public — agent uses internal HMAC auth) ────
// Mounted BEFORE the /api/* middleware chain so unregistered phones can register
// and so the agent can issue Monad transfers without a Privy JWT.
app.route("/api/v1/onboarding", onboardingRouter);
app.route("/api/v1/transfers-monad", transfersMonadRouter);

// ── Authenticated routes ──────────────────────────────────────────────────────
const ONBOARDING_PREFIX = "/api/v1/onboarding";
const TRANSFERS_MONAD_PREFIX = "/api/v1/transfers-monad";

app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith(ONBOARDING_PREFIX)) return next();
  if (c.req.path.startsWith(TRANSFERS_MONAD_PREFIX)) return next();
  return rateLimitMiddleware(c, next);
});
app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith(ONBOARDING_PREFIX)) return next();
  if (c.req.path.startsWith(TRANSFERS_MONAD_PREFIX)) return next();
  return authMiddleware(c, next);
});

// Idempotency — POST routes only (after auth so userId is available)
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "POST") return next();
  if (c.req.path.startsWith(ONBOARDING_PREFIX)) return next();
  if (c.req.path.startsWith(TRANSFERS_MONAD_PREFIX)) return next();
  return idempotencyMiddleware(c, next);
});

// Mount routers
app.route("/api/v1/users", usersRouter);
app.route("/api/v1/wallet", walletRouter);
app.route("/api/v1/savings", savingsRouter);
app.route("/api/v1/tandas", tandasRouter);
app.route("/api/v1/transfers", transfersRouter);
app.route("/api/v1", disputesRouter);
app.route("/api/v1/kyc", kycRouter);
app.route("/api/v1", rampsRouter);

export default app;
