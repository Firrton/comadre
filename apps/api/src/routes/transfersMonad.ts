/**
 * /api/v1/transfers-monad — phone-to-phone USDC transfers on Monad.
 *
 * POST /api/v1/transfers-monad
 *   body: { senderPhone, toPhone, amountUsdc, note? }
 *   internal HMAC auth (called by the agent service after WhatsApp verification).
 *
 * Flow:
 *   1. Resolve sender phone → smart_wallet (must exist; user must be onboarded)
 *   2. Resolve recipient phone → smart_wallet
 *      - If not registered → DB row with status=awaiting_recipient (deferred path)
 *      - If registered     → immediate path
 *   3. Validate amount ≤ session-key cap (50 USDC default for daily)
 *   4. Sign + send UserOperation through wallet-infra (Pimlico bundler)
 *   5. Persist DB row + tx hash
 *
 * Coexists with the Solana `/transfers` route until that flow is fully retired.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import { db, sessionKeys, smartWallets, transfers } from "@comadre/db";
import { lookupMonadByPhone } from "../lib/monadPhoneLookup.js";
import { buildUsdcTransferCalldata, microToUsdc, usdcToMicro } from "../lib/monadUsdcTransfer.js";
import { signMonadTransfer } from "../lib/monadSessionSigner.js";
import {
  buildConfirmationPrompt,
  buildConfirmationReprompt,
  buildConfirmationSuccessReply,
  evaluateRecipient,
  parseConfirmation,
} from "../lib/recipientPolicy.js";
import { requireInternalSignature } from "./onboarding.js";
import { getLogger } from "../middlewares/logger.js";
import {
  putPendingRecipientPhone,
  getPendingRecipientPhone,
  delPendingRecipientPhone,
} from "@comadre/cache";
import { checkDailyBudget } from "../lib/spendBudget.js";
import type { Address } from "viem";

export const transfersMonadRouter = new Hono();

const TRANSFER_DEFERRED_TTL_DAYS = 7;
const TRANSFER_CONFIRMATION_TTL_MS = 15 * 60 * 1000;
const CANCELLED_REPLY = "Cancelado, no envié nada.";

const TransferBody = z.object({
  senderPhone: z.string().regex(/^\+\d{6,15}$/, "E.164 required"),
  toPhone: z.string().regex(/^\+\d{6,15}$/, "E.164 required"),
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, "up to 6 decimals"),
  note: z.string().max(280).optional(),
});

const ResolveConfirmationBody = z.object({
  senderPhone: z.string().regex(/^\+\d{6,15}$/, "E.164 required"),
  message: z.string().min(1).max(4000),
});

transfersMonadRouter.post(
  "/",
  requireInternalSignature,
  zValidator("json", TransferBody, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const input = c.req.valid("json");
    const log = getLogger(c);

    const sender = await lookupMonadByPhone(input.senderPhone);
    if (!sender.registered || !sender.smartWalletAddress || !sender.userId) {
      return c.json(
        { error: "SENDER_NOT_ONBOARDED", message: "Aún no tenés cuenta. Decime que querés crearla." },
        404,
      );
    }

    const recipient = await lookupMonadByPhone(input.toPhone);
    if (recipient.registered && recipient.smartWalletAddress === sender.smartWalletAddress) {
      return c.json({ error: "SELF_TRANSFER", message: "No te podés mandar plata a vos mismo." }, 400);
    }

    let microUsdc: bigint;
    try {
      microUsdc = usdcToMicro(input.amountUsdc);
    } catch (err) {
      return c.json(
        { error: "INVALID_AMOUNT", message: err instanceof Error ? err.message : "monto inválido" },
        400,
      );
    }

    // ---- Deferred path: recipient not onboarded yet ----
    if (!recipient.registered) {
      const expiresAt = new Date(Date.now() + TRANSFER_DEFERRED_TTL_DAYS * 86400 * 1000);
      const inserted = await db
        .insert(transfers)
        .values({
          senderId: sender.userId,
          senderPhoneHash: sender.phoneHash,
          recipientPhoneHash: recipient.phoneHash,
          recipientId: null,
          recipientWallet: null,
          amountMicroUsdc: microUsdc,
          note: input.note ?? null,
          status: "awaiting_recipient",
          expiresAt,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("Insert returned no row");
      return c.json({
        ok: true,
        deferred: true,
        transferId: row.id,
        amountUsdc: microToUsdc(microUsdc),
        message: "Tu contacto todavía no tiene cuenta — le mando el aviso por WhatsApp.",
      });
    }

    const usdcAddress = process.env["USDC_CONTRACT_ADDRESS"];
    if (!usdcAddress) {
      return c.json(
        { error: "USDC_NOT_CONFIGURED", message: "USDC address no configurada (deploy pendiente)" },
        503,
      );
    }

    const key = await getActiveDailySessionKey(sender.smartWalletAddress);
    if (!key) {
      return c.json({ error: "NO_SESSION", message: "Tu sesión expiró. Te paso un link para renovarla." }, 400);
    }
    if (microUsdc > key.perCallCapMicroUsdc) {
      return c.json(
        {
          error: "CAP_EXCEEDED",
          message: "Esa cantidad supera tu límite de 50 USDC por operación. Para más grande te pido un código por SMS.",
          elevatedIntentRequired: true,
        },
        402,
      );
    }

    const calldata = buildUsdcTransferCalldata(
      recipient.smartWalletAddress as Address,
      microUsdc,
    );
    const policy = evaluateRecipient(key.allowedRecipients, calldata);

    if (!policy.ok) {
      const now = new Date();
      await expireAwaitingConfirmations(sender.userId, now);
      await db
        .update(transfers)
        .set({ status: "cancelled", failureReason: "superseded_by_new_confirmation" })
        .where(
          and(
            eq(transfers.senderId, sender.userId),
            eq(transfers.status, "awaiting_confirmation"),
            gt(transfers.expiresAt, now),
          ),
        );

      const expiresAt = new Date(Date.now() + TRANSFER_CONFIRMATION_TTL_MS);
      const inserted = await db
        .insert(transfers)
        .values({
          senderId: sender.userId,
          senderPhoneHash: sender.phoneHash,
          recipientPhoneHash: recipient.phoneHash,
          recipientId: recipient.userId!,
          recipientWallet: recipient.smartWalletAddress!,
          amountMicroUsdc: microUsdc,
          note: input.note ?? null,
          status: "awaiting_confirmation",
          expiresAt,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("Insert returned no row");

      await rememberPendingRecipientPhone(row.id, input.toPhone, expiresAt);
      const amountUsdc = microToUsdc(microUsdc);

      return c.json({
        ok: true,
        needsConfirmation: true,
        transferId: row.id,
        amountUsdc,
        confirmationPrompt: buildConfirmationPrompt(input.toPhone, amountUsdc),
        expiresAt: expiresAt.toISOString(),
      });
    }

    // ---- Immediate path: sign + broadcast ----
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
    const inserted = await db
      .insert(transfers)
      .values({
        senderId: sender.userId,
        senderPhoneHash: sender.phoneHash,
        recipientPhoneHash: recipient.phoneHash,
        recipientId: recipient.userId!,
        recipientWallet: recipient.smartWalletAddress!,
        amountMicroUsdc: microUsdc,
        note: input.note ?? null,
        status: "pending",
        expiresAt,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("Insert returned no row");

    // Daily aggregate cap check (B-2). Row is already inserted so the SUM
    // includes the caller's own row — concurrent transfers both see both rows.
    const budgetCheck = await checkDailyBudget(sender.userId);
    if (!budgetCheck.ok) {
      await db
        .update(transfers)
        .set({ status: "failed", failureReason: "daily_cap_exceeded" })
        .where(eqId(row.id));
      const spentUsdc = (Number(budgetCheck.spentMicroUsdc) / 1_000_000).toFixed(2);
      const capUsdc = (Number(budgetCheck.capMicroUsdc) / 1_000_000).toFixed(2);
      return c.json(
        {
          error: "DAILY_CAP_EXCEEDED",
          message: `Superaste el límite diario de ${capUsdc} USDC (llevas ${spentUsdc} USDC en las últimas 24 horas). Podés volver a enviar mañana.`,
          spentUsdc,
          capUsdc,
        },
        402,
      );
    }

    const signResult = await signMonadTransfer({
      smartWalletAddress: sender.smartWalletAddress as Address,
      to: usdcAddress as Address,
      data: calldata,
      amountMicroUsdc: microUsdc,
    });

    if (!signResult.ok) {
      await db
        .update(transfers)
        .set({ status: "failed", failureReason: signResult.reason })
        .where(eqId(row.id));

      if (signResult.reason === "recipient_not_allowed") {
        // COM-004: recipient not in user's contact allowlist.
        // Return 403 — caller should prompt user to add contact.
        return c.json(
          {
            error: "RECIPIENT_NOT_ALLOWED",
            message: "Ese destinatario no está en tu lista de contactos permitidos.",
          },
          403,
        );
      }

      if (signResult.reason === "cap_exceeded") {
        // Phase 1D handles the elevated-intent flow; for now signal the caller
        // that a higher-auth path is required.
        return c.json(
          {
            error: "CAP_EXCEEDED",
            message: "Esa cantidad supera tu límite de 50 USDC por operación. Para más grande te pido un código por SMS.",
            elevatedIntentRequired: true,
          },
          402,
        );
      }

      const message =
        signResult.reason === "no_session"
          ? `Tu sesión expiró. Te paso un link para renovarla.`
          : `No encontré tu cuenta. ¿Hacemos el alta?`;
      return c.json({ error: signResult.reason.toUpperCase(), message }, 400);
    }

    await db
      .update(transfers)
      .set({
        status: "confirmed",
        txSignature: signResult.txHash,
        confirmedAt: new Date(),
      })
      .where(eqId(row.id));

    log.info({ tx: signResult.txHash, transferId: row.id }, "[transfers-monad] confirmed");

    return c.json({
      ok: true,
      deferred: false,
      transferId: row.id,
      txHash: signResult.txHash,
      amountUsdc: microToUsdc(microUsdc),
    });
  },
);

/**
 * Atomically claims a transfer that is in `awaiting_confirmation` status by
 * transitioning it to `pending` in a single UPDATE … RETURNING CAS.
 *
 * Returns the claimed row when this caller wins the race, or null when another
 * concurrent caller already claimed it (or the transfer does not exist).
 *
 * This is an exported helper so it can be unit-tested in isolation without
 * spinning up the full HTTP stack.
 */
export async function claimAwaitingConfirmation(
  transferId: string,
  // Injectable for unit tests: module-level mocks of @comadre/db leak across
  // bun test files in the same process, so the race tests pass a fake handle.
  dbi: Pick<typeof db, "update"> = db,
): Promise<typeof transfers.$inferSelect | null> {
  const rows = await dbi
    .update(transfers)
    .set({ status: "pending" })
    .where(and(eq(transfers.id, transferId), eq(transfers.status, "awaiting_confirmation")))
    .returning();
  return rows[0] ?? null;
}

transfersMonadRouter.post(
  "/resolve-confirmation",
  requireInternalSignature,
  zValidator("json", ResolveConfirmationBody, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const input = c.req.valid("json");
    const sender = await lookupMonadByPhone(input.senderPhone);
    if (!sender.registered || !sender.smartWalletAddress || !sender.userId) {
      return c.json({ handled: false });
    }

    const now = new Date();
    await expireAwaitingConfirmations(sender.userId, now);

    // Read the most recent awaiting_confirmation transfer for this sender.
    // We use a SELECT here only to determine which transfer to act on and to
    // read fields needed for the reply (amount, recipient phone). The actual
    // ownership claim happens below via a CAS UPDATE.
    const pendingRows = await db
      .select()
      .from(transfers)
      .where(
        and(
          eq(transfers.senderId, sender.userId),
          eq(transfers.status, "awaiting_confirmation"),
          gt(transfers.expiresAt, now),
        ),
      )
      .orderBy(desc(transfers.createdAt))
      .limit(1);

    const candidate = pendingRows[0];
    if (!candidate) return c.json({ handled: false });

    const outcome = parseConfirmation(input.message);
    const amountUsdc = microToUsdc(candidate.amountMicroUsdc);
    const recipientPhone = await recipientPhoneForReply(candidate.id);

    if (outcome === "ambiguous") {
      return c.json({
        handled: true,
        outcome: "reprompted",
        reply: buildConfirmationReprompt(recipientPhone, amountUsdc),
      });
    }

    if (outcome === "negative") {
      // CAS cancel: only cancel if still in awaiting_confirmation — races with
      // a concurrent confirm are safe; whichever wins the UPDATE acts, the
      // other gets no row and returns handled:true silently.
      const cancelled = await db
        .update(transfers)
        .set({ status: "cancelled" })
        .where(
          and(eq(transfers.id, candidate.id), eq(transfers.status, "awaiting_confirmation")),
        )
        .returning();
      if (cancelled.length > 0) {
        await forgetPendingRecipientPhone(candidate.id);
      }
      return c.json({
        handled: true,
        outcome: "cancelled",
        reply: CANCELLED_REPLY,
      });
    }

    // ---- Affirmative path ----
    // Atomic claim: transition awaiting_confirmation → pending.
    // Only the first concurrent caller gets a row back; the rest return
    // handled:true (same shape as "no pending transfer") so Twilio retries
    // and double-taps are silently dropped without exposing an error to the
    // user.
    const claimed = await claimAwaitingConfirmation(candidate.id);
    if (!claimed) {
      // Lost the CAS race — another concurrent request already claimed or
      // confirmed this transfer.
      return c.json({ handled: true });
    }

    // From here we own the row (status="pending"). Use `claimed` for all
    // subsequent reads so we operate on the row we atomically claimed.

    // Daily aggregate cap check (B-2). Row is already pending so the SUM
    // includes it — same concurrency guarantee as the immediate path.
    const budgetCheck = await checkDailyBudget(sender.userId);
    if (!budgetCheck.ok) {
      await markTransferFailed(claimed.id, "daily_cap_exceeded");
      await forgetPendingRecipientPhone(claimed.id);
      const spentUsdc = (Number(budgetCheck.spentMicroUsdc) / 1_000_000).toFixed(2);
      const capUsdc = (Number(budgetCheck.capMicroUsdc) / 1_000_000).toFixed(2);
      return c.json({
        handled: true,
        outcome: "failed",
        reply: `Superaste el límite diario de ${capUsdc} USDC (llevas ${spentUsdc} USDC en las últimas 24 horas). Podés volver a enviar mañana.`,
      });
    }

    if (!claimed.recipientWallet) {
      await markTransferFailed(claimed.id, "missing_recipient_wallet");
      await forgetPendingRecipientPhone(claimed.id);
      return c.json({
        handled: true,
        outcome: "failed",
        reply: "No pude completar la transferencia. ¿Probamos de nuevo?",
      });
    }

    // Single-statement JSONB append — atomic on its own. signMonadTransfer
    // (network call) deliberately happens outside any DB transaction.
    const appendResult = await appendAllowedRecipient(
      sender.smartWalletAddress as string,
      claimed.recipientWallet as string,
    );

    if (!appendResult.ok) {
      await markTransferFailed(claimed.id, appendResult.reason);
      await forgetPendingRecipientPhone(claimed.id);
      return c.json({
        handled: true,
        outcome: "failed",
        reply:
          appendResult.reason === "no_session"
            ? "Tu sesión expiró. Te paso un link para renovarla."
            : "No pude completar la transferencia. ¿Probamos de nuevo?",
      });
    }

    const usdcAddress = process.env["USDC_CONTRACT_ADDRESS"];
    if (!usdcAddress) {
      await markTransferFailed(claimed.id, "usdc_not_configured");
      await forgetPendingRecipientPhone(claimed.id);
      return c.json({
        handled: true,
        outcome: "failed",
        reply: "No pude completar la transferencia. ¿Probamos de nuevo?",
      });
    }

    const calldata = buildUsdcTransferCalldata(
      claimed.recipientWallet as Address,
      claimed.amountMicroUsdc,
    );

    // Network call — outside any DB transaction.
    const signResult = await signMonadTransfer({
      smartWalletAddress: sender.smartWalletAddress as Address,
      to: usdcAddress as Address,
      data: calldata,
      amountMicroUsdc: claimed.amountMicroUsdc,
    });

    if (!signResult.ok) {
      await markTransferFailed(claimed.id, signResult.reason);
      await forgetPendingRecipientPhone(claimed.id);
      return c.json({
        handled: true,
        outcome: "failed",
        reply:
          signResult.reason === "cap_exceeded"
            ? "Esa cantidad supera tu límite por operación. No envié nada."
            : "No pude completar la transferencia. ¿Probamos de nuevo?",
      });
    }

    await db
      .update(transfers)
      .set({
        status: "confirmed",
        txSignature: signResult.txHash,
        confirmedAt: new Date(),
      })
      .where(eqId(claimed.id));

    await forgetPendingRecipientPhone(claimed.id);
    return c.json({
      handled: true,
      outcome: "confirmed",
      reply: buildConfirmationSuccessReply(recipientPhone, amountUsdc),
      txHash: signResult.txHash,
    });
  },
);

function eqId(id: string) {
  return eq(transfers.id, id);
}

async function getActiveDailySessionKey(smartWalletAddress: string): Promise<{
  id: string;
  perCallCapMicroUsdc: bigint;
  allowedRecipients: string[];
} | null> {
  const rows = await db
    .select({
      id: sessionKeys.id,
      perCallCapMicroUsdc: sessionKeys.perCallCapMicroUsdc,
      allowedRecipients: sessionKeys.allowedRecipients,
    })
    .from(smartWallets)
    .innerJoin(sessionKeys, eq(sessionKeys.smartWalletId, smartWallets.id))
    .where(
      and(
        eq(smartWallets.smartWalletAddress, smartWalletAddress.toLowerCase()),
        eq(sessionKeys.kind, "daily"),
        eq(sessionKeys.status, "active"),
        gt(sessionKeys.validUntil, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    perCallCapMicroUsdc: row.perCallCapMicroUsdc,
    allowedRecipients: Array.isArray(row.allowedRecipients) ? row.allowedRecipients as string[] : [],
  };
}

async function expireAwaitingConfirmations(senderId: string, now: Date): Promise<void> {
  await db
    .update(transfers)
    .set({ status: "expired" })
    .where(
      and(
        eq(transfers.senderId, senderId),
        eq(transfers.status, "awaiting_confirmation"),
        lte(transfers.expiresAt, now),
      ),
    );
}

async function appendAllowedRecipient(
  smartWalletAddress: string,
  recipientWallet: string,
): Promise<{ ok: true } | { ok: false; reason: "no_session" | "wallet_not_found" }> {
  const key = await getActiveDailySessionKey(smartWalletAddress);
  if (!key) return { ok: false, reason: "no_session" };

  const recipientLower = recipientWallet.toLowerCase();
  const recipientJson = JSON.stringify([recipientLower]);
  await db
    .update(sessionKeys)
    .set({
      allowedRecipients: sql`CASE WHEN ${sessionKeys.allowedRecipients} @> ${recipientJson}::jsonb THEN ${sessionKeys.allowedRecipients} ELSE ${sessionKeys.allowedRecipients} || ${recipientJson}::jsonb END`,
    })
    .where(eq(sessionKeys.id, key.id));

  return { ok: true };
}

async function markTransferFailed(id: string, failureReason: string): Promise<void> {
  await db
    .update(transfers)
    .set({ status: "failed", failureReason })
    .where(eqId(id));
}

async function rememberPendingRecipientPhone(
  transferId: string,
  phone: string,
  expiresAt: Date,
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
  await putPendingRecipientPhone(transferId, phone, ttlSeconds);
}

async function recipientPhoneForReply(transferId: string): Promise<string> {
  const phone = await getPendingRecipientPhone(transferId);
  return phone ?? "ese número";
}

async function forgetPendingRecipientPhone(transferId: string): Promise<void> {
  await delPendingRecipientPhone(transferId);
}
