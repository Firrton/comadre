import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { env } from "@comadre/config";
import { db, savingsNudges } from "@comadre/db";
import { microToUsdc } from "../monadUsdcTransfer.js";
import { getWhatsAppRoute } from "./contactCrypto.js";

export const GUARDADITO_NUDGE_MESSAGE =
  "Te llegó platita, mija. ¿Querés que guardemos una parte para que no se quede quieta?";

function signWhatsAppReply(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret)
    .update(`POST\n/reply\n${timestamp}\n${body}`)
    .digest("hex");
}

async function sendWhatsApp(toE164: string, body: string): Promise<boolean> {
  const payload = JSON.stringify({ to: `whatsapp:${toE164}`, body });
  const timestamp = String(Date.now());
  const signature = signWhatsAppReply(env.INTERNAL_HMAC_SECRET, timestamp, payload);
  try {
    const res = await fetch(`${env.WA_URL}/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Signature": signature,
        "X-Internal-Timestamp": timestamp,
      },
      body: payload,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function createSavingsNudge(params: {
  userId: string;
  source: string;
  sourceRef: string;
  amountMicroUsdc: bigint;
  sendIfPossible?: boolean;
}): Promise<{ created: boolean; sent: boolean }> {
  const message = `${GUARDADITO_NUDGE_MESSAGE} Te puedo sugerir un monto cuidando que te quede algo disponible.`;
  const inserted = await db
    .insert(savingsNudges)
    .values({
      userId: params.userId,
      source: params.source,
      sourceRef: params.sourceRef,
      amountMicroUsdc: params.amountMicroUsdc,
      status: "pending",
      message,
    })
    .onConflictDoNothing()
    .returning({ id: savingsNudges.id });

  const nudge = inserted[0];
  if (!nudge || !params.sendIfPossible) {
    return { created: Boolean(nudge), sent: false };
  }

  const phone = await getWhatsAppRoute(params.userId);
  if (!phone) return { created: true, sent: false };

  const sent = await sendWhatsApp(
    phone,
    `${GUARDADITO_NUDGE_MESSAGE} Recibiste ${microToUsdc(params.amountMicroUsdc)} USDC.`,
  );

  if (sent) {
    await db
      .update(savingsNudges)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(savingsNudges.id, nudge.id));
  }

  return { created: true, sent };
}
