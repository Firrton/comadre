/**
 * Auth middleware — Privy JWT verification.
 *
 * Reads `Authorization: Bearer <jwt>`, verifies with Privy server SDK,
 * and sets `c.set("user", { userId, walletAddress, linkedAccounts })`.
 *
 * Dev-mode bypass (NODE_ENV !== "production"):
 *   X-Dev-Wallet: <solana-pubkey>
 *   X-Dev-User-Id: <string>
 * This lets us test before Privy is fully wired.
 */

import type { MiddlewareHandler } from "hono";
import { PrivyClient } from "@privy-io/server-auth";
import { getLogger } from "./logger.js";

export type AuthUser = {
  userId: string;
  walletAddress: string;
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

  // Dev-mode bypass — accept header-injected identity (non-production only)
  if (nodeEnv !== "production") {
    const devWallet = c.req.header("X-Dev-Wallet");
    const devUserId = c.req.header("X-Dev-User-Id");

    if (devWallet && devUserId) {
      logger.warn(
        { dev_wallet: devWallet, dev_user_id: devUserId },
        "[auth] DEV-MODE bypass active — do not use in production"
      );

      c.set("user" as never, {
        userId: devUserId,
        walletAddress: devWallet,
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
    const walletAddress = solanaAccount?.address ?? claims.userId;

    c.set("user" as never, {
      userId: claims.userId,
      walletAddress,
      linkedAccounts: allAccounts,
    } satisfies AuthUser);

    return next();
  } catch (_err) {
    logger.warn({ err: _err }, "[auth] token verification failed");
    return c.json({ error: "unauthorized", message: "Invalid or expired token" }, 401);
  }
};
