/**
 * /api/v1/transfers — phone-to-phone USDC transfers (PR C of 5)
 *
 * GET  /api/v1/transfers/lookup?phone=+E164  — resolve phone → wallet
 * POST /api/v1/transfers                     — create transfer (immediate or deferred)
 * POST /api/v1/transfers/:id/confirm         — Privy server-sign + broadcast
 * POST /api/v1/transfers/:id/cancel          — cancel pending transfer
 *
 * Flow (immediate path, recipient registered):
 *  1. POST /transfers builds the SPL Token Transfer ix, partial-signs with
 *     fee_payer, persists row (status=pending, expires_at=now+5min), stashes
 *     the unsigned tx in Redis with TTL 300s. Returns TransferResponse.
 *  2. POST /transfers/:id/confirm fetches the unsigned tx from Redis,
 *     signs with Privy (server-side using the user's embedded wallet),
 *     broadcasts via submitWithRetry, persists tx_signature.
 *
 * Flow (deferred path, recipient NOT registered):
 *  1. POST /transfers inserts row with status=awaiting_recipient (7d TTL),
 *     fires a WhatsApp message to the recipient via apps/whatsapp /reply.
 *     No on-chain action yet.
 *  2. When the recipient onboards (handled in apps/agent), the sender is
 *     re-prompted to confirm and the immediate path is taken.
 *
 * KYC limits enforced via @comadre/api/lib/kycLimits (cached on-chain config
 * with hardcoded fallback). Self-transfer rejected via wallet equality check.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { env } from "@comadre/config";
import { db, users, transfers } from "@comadre/db";
import { CreateTransferInput, LookupPhoneInput } from "@comadre/types";
import { getRedis } from "@comadre/cache";
import { buildUnsignedTx, submitWithRetry, getFeePayerKeypair, getConnection } from "@comadre/solana";
import { getUsdcMint } from "@comadre/anchor-client";
import { lookupByPhone } from "../lib/phoneLookup.js";
import { enforceKycLimit, KycLimitExceededError, type KycTier } from "../lib/kycLimits.js";
import { buildUsdcTransferIxs, usdcToMicro, microToUsdc } from "../lib/usdcTransfer.js";
import { signWithPrivy } from "../lib/privySigner.js";
import { createSavingsNudge } from "../lib/savings/nudges.js";
import type { AuthUser } from "../middlewares/auth.js";

export const transfersRouter = new Hono();

const TRANSFER_PENDING_TTL_SECONDS = 5 * 60; // 5 min — sender confirms or expires
const TRANSFER_DEFERRED_TTL_DAYS = 7; // 7 days — recipient onboarding window
const REDIS_TX_KEY_PREFIX = "transfer:tx:";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the Solana embedded wallet ID from Privy linked accounts. */
function extractPrivyWalletId(user: AuthUser): string | null {
  const accounts = user.linkedAccounts as Array<{
    type?: string;
    chainType?: string;
    id?: string;
    address?: string;
  }>;
  const solanaWallet = accounts.find(
    (a) => a.type === "wallet" && (a.chainType === "solana" || a.chainType === undefined)
  );
  return solanaWallet?.id ?? null;
}

/** Build the explorer URL based on env.SOLANA_CLUSTER. */
function explorerUrlFor(signature: string): string {
  const cluster = env.SOLANA_CLUSTER;
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

/**
 * Send a WhatsApp message to the recipient via apps/whatsapp /reply (HMAC).
 * Best-effort — failure is logged but does not abort the transfer creation
 * (the row is still persisted; sender can be informed and retry).
 */
async function sendWhatsAppToRecipient(toE164: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const url = `${env.WA_URL}/reply`;
  const payload = JSON.stringify({ to: `whatsapp:${toE164}`, body });
  const signature = createHmac("sha256", env.INTERNAL_HMAC_SECRET).update(payload).digest("hex");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Auth": signature,
      },
      body: payload,
    });
    if (!res.ok) {
      return { ok: false, error: `wa /reply -> ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/transfers/lookup?phone=+...
// ---------------------------------------------------------------------------
transfersRouter.get(
  "/lookup",
  zValidator("query", LookupPhoneInput, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const { phone } = c.req.valid("query");
    const lookup = await lookupByPhone(phone);
    return c.json(lookup);
  }
);

// ---------------------------------------------------------------------------
// POST /api/v1/transfers
// ---------------------------------------------------------------------------
transfersRouter.post(
  "/",
  zValidator("json", CreateTransferInput, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const input = c.req.valid("json");
    const user = (c.get as (k: string) => unknown)("user") as AuthUser;

    // 1. Sender's row (we need phone_hash + kyc_tier from DB)
    const senderRows = await db.select().from(users).where(eq(users.wallet, user.walletAddress)).limit(1);
    const senderRow = senderRows[0];
    if (!senderRow) {
      return c.json(
        { error: "USER_NOT_FOUND", message: "Tu cuenta no está registrada todavía. Hacé KYC primero." },
        404
      );
    }

    // 2. Recipient resolution
    const recipient = await lookupByPhone(input.toPhone);

    // 3. Self-transfer check (by wallet)
    if (recipient.registered && recipient.wallet === user.walletAddress) {
      return c.json(
        { error: "SELF_TRANSFER", message: "No te puedes mandar plata a vos misma, mija." },
        400
      );
    }

    // 4. Amount conversion + KYC enforcement
    let microUsdc: bigint;
    try {
      microUsdc = usdcToMicro(input.amountUsdc);
    } catch (err) {
      return c.json({ error: "INVALID_AMOUNT", message: err instanceof Error ? err.message : "Invalid amount" }, 400);
    }

    try {
      await enforceKycLimit(senderRow.kycTier as KycTier, microUsdc);
    } catch (err) {
      if (err instanceof KycLimitExceededError) {
        return c.json(
          {
            error: err.code,
            message: `Tu nivel KYC (${err.tier}) permite hasta $${err.limitUsdc} USDC por tx.`,
            tier: err.tier,
            limitUsdc: err.limitUsdc,
          },
          400
        );
      }
      throw err;
    }

    // 5. Branch: deferred (recipient not registered) vs immediate
    if (!recipient.registered) {
      const expiresAt = new Date(Date.now() + TRANSFER_DEFERRED_TTL_DAYS * 24 * 60 * 60 * 1000);
      const inserted = await db
        .insert(transfers)
        .values({
          senderWallet: user.walletAddress,
          senderPhoneHash: senderRow.phoneHash,
          recipientPhoneHash: recipient.phoneHash,
          recipientWallet: null,
          amountMicroUsdc: microUsdc,
          note: input.note ?? null,
          status: "awaiting_recipient",
          expiresAt,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("Insert returned no row");

      const senderName = senderRow.countryCode ? `Alguien` : `Alguien`; // refinement: pull from a profile name field if added later
      const senderNumberDisplay = env.TWILIO_WHATSAPP_FROM.replace("whatsapp:", "");
      const messageBody = `${senderName} te quiere mandar ${microToUsdc(microUsdc)} USDC. Para reclamar, escribime "aceptar" al ${senderNumberDisplay}`;

      // Best-effort WA send (don't block transfer creation if WA is down)
      await sendWhatsAppToRecipient(input.toPhone, messageBody);

      return c.json({
        mode: "deferred" as const,
        transferId: row.id,
        recipient: { registered: false as const, phone: input.toPhone },
        amount: { usdc: input.amountUsdc, microUsdc: microUsdc.toString() },
        expiresAt: expiresAt.toISOString(),
        message: messageBody,
      });
    }

    // 6. Immediate path: build SPL Token Transfer tx
    const senderPubkey = new PublicKey(user.walletAddress);
    const recipientPubkey = new PublicKey(recipient.wallet ?? "");
    const usdcMint = getUsdcMint();
    const feePayer = getFeePayerKeypair();
    const connection = getConnection();

    const { instructions } = await buildUsdcTransferIxs({
      from: senderPubkey,
      to: recipientPubkey,
      amountMicroUsdc: microUsdc,
      mint: usdcMint,
      payer: feePayer.publicKey,
      connection,
    });

    const built = await buildUnsignedTx({
      instructions,
      payer: feePayer,
      connection,
    });

    const expiresAt = new Date(Date.now() + TRANSFER_PENDING_TTL_SECONDS * 1000);
    const inserted = await db
      .insert(transfers)
      .values({
        senderWallet: user.walletAddress,
        senderPhoneHash: senderRow.phoneHash,
        recipientPhoneHash: recipient.phoneHash,
        recipientWallet: recipient.wallet ?? null,
        amountMicroUsdc: microUsdc,
        note: input.note ?? null,
        status: "pending",
        expiresAt,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("Insert returned no row");

    // Stash the unsigned tx in Redis (TTL = pending window)
    try {
      await getRedis().set(`${REDIS_TX_KEY_PREFIX}${row.id}`, built.unsignedTxBase64, {
        ex: TRANSFER_PENDING_TTL_SECONDS,
      });
    } catch {
      // Redis unavailable in some envs (test); the confirm endpoint will surface
      // a clear EXPIRED error in that case.
    }

    return c.json({
      mode: "immediate" as const,
      transferId: row.id,
      recipient: {
        registered: true as const,
        phone: input.toPhone,
        wallet: recipient.wallet!,
        walletPreview: recipient.walletPreview ?? "",
      },
      amount: { usdc: input.amountUsdc, microUsdc: microUsdc.toString() },
      unsignedTxBase64: built.unsignedTxBase64,
      expiresAt: expiresAt.toISOString(),
    });
  }
);

// ---------------------------------------------------------------------------
// POST /api/v1/transfers/:id/confirm
// ---------------------------------------------------------------------------
transfersRouter.post("/:id/confirm", async (c) => {
  const transferId = c.req.param("id");
  const user = (c.get as (k: string) => unknown)("user") as AuthUser;

  const rows = await db.select().from(transfers).where(eq(transfers.id, transferId)).limit(1);
  const row = rows[0];
  if (!row) return c.json({ error: "NOT_FOUND" }, 404);
  if (row.senderWallet !== user.walletAddress) {
    return c.json({ error: "FORBIDDEN", message: "Esta transferencia no es tuya" }, 403);
  }
  if (row.status !== "pending") {
    return c.json({ error: "INVALID_STATUS", status: row.status }, 409);
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return c.json({ error: "EXPIRED" }, 409);
  }

  // Fetch the partial-signed tx from Redis
  let unsignedTxBase64: string | null = null;
  try {
    unsignedTxBase64 = (await getRedis().get<string>(`${REDIS_TX_KEY_PREFIX}${transferId}`)) ?? null;
  } catch {
    /* fallthrough */
  }
  if (!unsignedTxBase64) {
    return c.json(
      { error: "EXPIRED", message: "Tx blockhash expired; please retry the transfer." },
      409
    );
  }

  const tx = VersionedTransaction.deserialize(Buffer.from(unsignedTxBase64, "base64"));

  // Privy server-side sign with the user's embedded Solana wallet
  const walletId = extractPrivyWalletId(user);
  if (!walletId) {
    return c.json({ error: "NO_WALLET", message: "No se encontró un Solana embedded wallet" }, 400);
  }

  let signedTx: VersionedTransaction;
  try {
    const result = await signWithPrivy({ walletId, transaction: tx });
    signedTx = result.signedTransaction;
  } catch (err) {
    await db
      .update(transfers)
      .set({ status: "failed", failureReason: `privy-sign: ${err instanceof Error ? err.message : String(err)}` })
      .where(eq(transfers.id, transferId));
    return c.json(
      { error: "PRIVY_SIGN_FAILED", message: err instanceof Error ? err.message : "Sign failed" },
      502
    );
  }

  let signature: string;
  try {
    const result = await submitWithRetry(signedTx);
    signature = result.signature;
  } catch (err) {
    await db
      .update(transfers)
      .set({ status: "failed", failureReason: `broadcast: ${err instanceof Error ? err.message : String(err)}` })
      .where(eq(transfers.id, transferId));
    return c.json(
      { error: "BROADCAST_FAILED", message: err instanceof Error ? err.message : "Broadcast failed" },
      502
    );
  }

  await db
    .update(transfers)
    .set({ status: "confirmed", txSignature: signature, confirmedAt: new Date() })
    .where(eq(transfers.id, transferId));

  if (row.recipientWallet) {
    await createSavingsNudge({
      userWallet: row.recipientWallet,
      source: "p2p_transfer",
      sourceRef: transferId,
      amountMicroUsdc: row.amountMicroUsdc,
      sendIfPossible: true,
    }).catch(() => undefined);
  }

  // Cleanup Redis (best-effort)
  try {
    await getRedis().del(`${REDIS_TX_KEY_PREFIX}${transferId}`);
  } catch {
    /* ignore */
  }

  return c.json({
    signature,
    status: "confirmed" as const,
    explorerUrl: explorerUrlFor(signature),
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/transfers/:id/cancel
// ---------------------------------------------------------------------------
transfersRouter.post("/:id/cancel", async (c) => {
  const transferId = c.req.param("id");
  const user = (c.get as (k: string) => unknown)("user") as AuthUser;

  const rows = await db.select().from(transfers).where(eq(transfers.id, transferId)).limit(1);
  const row = rows[0];
  if (!row) return c.json({ error: "NOT_FOUND" }, 404);
  if (row.senderWallet !== user.walletAddress) {
    return c.json({ error: "FORBIDDEN" }, 403);
  }
  if (row.status !== "pending" && row.status !== "awaiting_recipient") {
    return c.json({ error: "INVALID_STATUS", status: row.status }, 409);
  }

  await db.update(transfers).set({ status: "cancelled" }).where(eq(transfers.id, transferId));
  try {
    await getRedis().del(`${REDIS_TX_KEY_PREFIX}${transferId}`);
  } catch {
    /* ignore */
  }
  return c.json({ status: "cancelled" as const, transferId });
});
