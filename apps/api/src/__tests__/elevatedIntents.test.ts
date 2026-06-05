/**
 * elevatedIntents.test.ts — F-2: ownership check on elevated-intent confirm.
 *
 * Security contract: an elevated intent that belongs to user A must NOT be
 * confirmable by a different authenticated user B. B must get 404 (we do not
 * leak that the intent exists).
 *
 *   RED  (before fix): the handler looks up the intent by :id ONLY and never
 *                      reads the authenticated user, so B reaches the OTP step
 *                      (401/502) instead of 404 → test 1 fails.
 *   GREEN (after fix): the lookup is scoped to the authenticated owner, so a
 *                      non-owner finds no row → 404.
 *
 * Integration test — seeds Postgres. OFF by default (env-gated) so the unit
 * suite stays green without a DB. Run it as E2E when a migrated DB is up:
 *   cd apps/api && RUN_DB_TESTS=1 bun test --env-file .env.test ./src/__tests__/elevatedIntents.test.ts
 * Requires DEV_AUTH_BYPASS=true (set in beforeAll) and DATABASE_URL in .env.test.
 *
 * Note: all addresses are EVM/Monad hex stored lowercase (schema contract).
 */
import { describe, it, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import app from "../server.js";
import { db, users, smartWallets, elevatedIntents } from "@comadre/db";
import { otp } from "@comadre/wallet-infra";

// Gate: this file does real DB I/O. Opt in with RUN_DB_TESTS=1 (see header).
const runDbTests = process.env["RUN_DB_TESTS"] === "1";

const OWNER = "0x" + "a1".repeat(20); // seeded owner (lowercase)
const OWNER_MIXED_CASE = "0x" + "A1".repeat(20); // same address, different case
const ATTACKER = "0x" + "b2".repeat(20); // a different authenticated user
const OWNER_PHONE = "+5215555550123";

let intentId: string;

function devHeaders(wallet: string): Record<string, string> {
  return {
    "X-Dev-Wallet": wallet,
    "X-Dev-User-Id": `test-${wallet.slice(2, 8)}`,
    "Content-Type": "application/json",
    // Unique per request so the idempotency middleware never returns a cached body.
    "X-Idempotency-Key": crypto.randomUUID(),
  };
}

// NOTE: beforeAll/afterAll MUST live inside the describe so they don't run as
// file-level hooks when the suite is gated off (that's what hit the DB before).
if (runDbTests)
  describe("POST /api/v1/elevated-intents/:id/confirm — ownership (F-2)", () => {
    beforeAll(async () => {
      process.env["NODE_ENV"] = "test";
      process.env["DEV_AUTH_BYPASS"] = "true";

      // Keep OTP verification from making real network calls. The owner path
      // reaches it; a non-owner must be rejected BEFORE this is ever called.
      try {
        spyOn(otp, "checkOtp").mockResolvedValue({ approved: false, status: "pending" });
      } catch {
        /* otp shape differs — owner test still asserts non-404 */
      }

      // Clean leftovers from a prior failed run (cascades to smart_wallets + intents).
      await db.delete(users).where(eq(users.wallet, OWNER));

      await db.insert(users).values({
        wallet: OWNER,
        phoneHash: "f2-test-phone-hash",
        createdAt: new Date(),
      });

      const sw = await db
        .insert(smartWallets)
        .values({
          userWallet: OWNER,
          privyUserId: "f2-test-privy",
          ownerAddress: OWNER,
          smartWalletAddress: "0x" + "c3".repeat(20),
          chainId: 10143,
        })
        .returning({ id: smartWallets.id });

      const intent = await db
        .insert(elevatedIntents)
        .values({
          smartWalletId: sw[0]!.id,
          actionPayload: { phoneE164: OWNER_PHONE, kind: "transfer", amountMicroUsdc: "100000000" },
          twilioVerifySid: "VA_test_f2",
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        })
        .returning({ id: elevatedIntents.id });

      intentId = intent[0]!.id;
    });

    afterAll(async () => {
      // Deleting the user cascades to smart_wallets → elevated_intents.
      await db.delete(users).where(eq(users.wallet, OWNER));
    });

    it("returns 404 when a different user confirms someone else's intent", async () => {
      const res = await app.request(`/api/v1/elevated-intents/${intentId}/confirm`, {
        method: "POST",
        headers: devHeaders(ATTACKER),
        body: JSON.stringify({ code: "123456" }),
      });

      // Non-owner must not reach OTP verification on another user's intent.
      expect(res.status).toBe(404);
    });

    it("does not 404 the legitimate owner (case-insensitive match)", async () => {
      const res = await app.request(`/api/v1/elevated-intents/${intentId}/confirm`, {
        method: "POST",
        headers: devHeaders(OWNER_MIXED_CASE),
        body: JSON.stringify({ code: "000000" }),
      });

      // Owner passes the ownership gate and reaches OTP verification (mocked → 401).
      // Guards against an over-aggressive fix and proves case-insensitive matching.
      expect(res.status).not.toBe(404);
    });
  });
