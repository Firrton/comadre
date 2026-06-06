/**
 * Auth middleware — Privy JWT verification.
 *
 * Reads `Authorization: Bearer <jwt>`, verifies with Privy server SDK,
 * and sets `c.set("user", { userId, walletAddress, linkedAccounts })`.
 *
 * Dev-mode bypass — opt-in via explicit env flag (audit COM-006):
 *   DEV_AUTH_BYPASS=true   ← MUST be explicitly set; default OFF
 *   AND NODE_ENV !== "production"
 *
 * Then accepts:
 *   X-Dev-Wallet: <solana-pubkey>
 *   X-Dev-User-Id: <string>
 *
 * Previously the bypass was active for any non-production NODE_ENV. That made
 * a single env misconfig collapse all user auth to whoever held the HMAC secret.
 */

import type { MiddlewareHandler } from "hono";
import { PrivyClient } from "@privy-io/server-auth";
import { db, users } from "@comadre/db";
import { eq } from "drizzle-orm";
import { getLogger } from "./logger.js";

export type AuthUser = {
  id: string; // users.id (UUID) — canonical identity
  ownerAddress: string; // Privy owner address (lowercase 0x)
  privyUserId: string;
  linkedAccounts: unknown[];
};

let _privy: PrivyClient | null = null;

function getPrivy(): PrivyClient {
  if (_privy !== null) return _privy;

  const appId = process.env["PRIVY_APP_ID"];
  const appSecret = process.env["PRIVY_APP_SECRET"];

  if (!appId || !appSecret) {
    throw new Error("[auth] PRIVY_APP_ID and PRIVY_APP_SECRET are required");
  }

  _privy = new PrivyClient(appId, appSecret);
  return _privy;
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const logger = getLogger(c);
  const nodeEnv = process.env["NODE_ENV"] ?? "development";
  const devBypassEnabled = process.env["DEV_AUTH_BYPASS"] === "true";

  // Audit COM-006: dev-mode bypass now requires BOTH the explicit env flag AND
  // non-production NODE_ENV. The flag MUST be explicitly set; default is OFF
  // (i.e. unset, "false", or anything other than "true" rejects the bypass).
  if (nodeEnv === "production" && devBypassEnabled) {
    logger.error("[auth] DEV_AUTH_BYPASS=true in production — refusing to honor");
  }

  if (nodeEnv !== "production" && devBypassEnabled) {
    const devWallet = c.req.header("X-Dev-Wallet");
    const devUserId = c.req.header("X-Dev-User-Id");

    if (devWallet && devUserId) {
      logger.warn(
        { dev_wallet: devWallet, dev_user_id: devUserId },
        "[auth] DEV-MODE bypass active — do not use in production"
      );

      c.set("user" as never, {
        id: devUserId,
        ownerAddress: (devWallet ?? "").toLowerCase(),
        privyUserId: devUserId,
        linkedAccounts: [],
      } satisfies AuthUser);

      return next();
    }
  }

  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized", message: "Missing Bearer token" }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const privy = getPrivy();

    // Race against a 3s abort so test environments don't hang on fake credentials
    const verifyPromise = privy.verifyAuthToken(token);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Privy verification timeout")), 3000)
    );
    const claims = await Promise.race([verifyPromise, timeoutPromise]);

    // Extract the embedded Solana wallet address from linked accounts if available.
    // Fall back to the DID's sub field (userId) if no embedded wallet is linked.
    const allAccounts = (claims as unknown as { linkedAccounts?: Array<{ type?: string; address?: string }> })?.linkedAccounts ?? [];
    const solanaAccount = allAccounts.find(
      (a) => a.type === "wallet" && typeof a.address === "string"
    );
    const ownerAddress = (solanaAccount?.address ?? claims.userId).toLowerCase();

    // Resolve the Privy owner address → canonical users.id (UUID identity).
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.ownerAddress, ownerAddress))
      .limit(1);

    if (!rows[0]) {
      return c.json(
        { error: "unauthorized", message: "user not provisioned" },
        401
      );
    }

    c.set("user" as never, {
      id: rows[0].id,
      ownerAddress,
      privyUserId: claims.userId,
      linkedAccounts: allAccounts,
    } satisfies AuthUser);

    return next();
  } catch (_err) {
    logger.warn({ err: _err }, "[auth] token verification failed");
    return c.json({ error: "unauthorized", message: "Invalid or expired token" }, 401);
  }
};
