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
import { eq } from "drizzle-orm";
import { db, transfers } from "@comadre/db";
import { lookupMonadByPhone } from "../lib/monadPhoneLookup.js";
import { buildUsdcTransferCalldata, microToUsdc, usdcToMicro } from "../lib/monadUsdcTransfer.js";
import { signMonadTransfer } from "../lib/monadSessionSigner.js";
import { requireInternalSignature } from "./onboarding.js";
import { getLogger } from "../middlewares/logger.js";
import type { Address } from "viem";

export const transfersMonadRouter = new Hono();

const TRANSFER_DEFERRED_TTL_DAYS = 7;

const TransferBody = z.object({
  senderPhone: z.string().regex(/^\+\d{6,15}$/, "E.164 required"),
  toPhone: z.string().regex(/^\+\d{6,15}$/, "E.164 required"),
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, "up to 6 decimals"),
  note: z.string().max(280).optional(),
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

    const usdcAddress = process.env["USDC_CONTRACT_ADDRESS"];
    if (!usdcAddress) {
      return c.json(
        { error: "USDC_NOT_CONFIGURED", message: "USDC address no configurada (deploy pendiente)" },
        503,
      );
    }

    const calldata = buildUsdcTransferCalldata(
      recipient.smartWalletAddress as Address,
      microUsdc,
    );

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

function eqId(id: string) {
  return eq(transfers.id, id);
}
