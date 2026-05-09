import { Hono } from "hono";
import { logger } from "hono/logger";
import { eq } from "drizzle-orm";
import { db, savingsNudges, users } from "@comadre/db";
import { HeliusWebhookPayload } from "@comadre/types";
import { extractIncomingUsdc } from "./lib/heliusSavings.js";
import { getWhatsAppPhone, safeEqual, sendWhatsApp } from "./lib/contactCrypto.js";

const app = new Hono();
app.use("*", logger());

app.get("/health", (c) => c.json({ ok: true, service: "indexer" }));

app.post("/webhook", async (c) => {
  const secret = process.env["HELIUS_WEBHOOK_SECRET"];
  if (secret) {
    const provided = c.req.header("X-Helius-Webhook-Secret") ?? c.req.header("Authorization") ?? "";
    if (!safeEqual(provided.replace(/^Bearer\s+/i, ""), secret)) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }

  const parsed = HeliusWebhookPayload.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.format() }, 400);
  }

  let created = 0;
  let sent = 0;
  for (const incoming of extractIncomingUsdc(parsed.data)) {
    const userRows = await db
      .select({ wallet: users.wallet })
      .from(users)
      .where(eq(users.wallet, incoming.wallet))
      .limit(1);
    if (!userRows[0]) continue;

    const inserted = await db
      .insert(savingsNudges)
      .values({
        userWallet: incoming.wallet,
        source: "helius_usdc_incoming",
        sourceRef: incoming.sourceRef,
        amountMicroUsdc: incoming.amountMicroUsdc,
        status: "pending",
        message: "Te llegó platita, mija. ¿Querés que guardemos una parte para que no se quede quieta?",
      })
      .onConflictDoNothing()
      .returning({ id: savingsNudges.id });

    if (!inserted[0]) continue;
    created++;

    const phone = await getWhatsAppPhone(incoming.wallet);
    if (phone) {
      const ok = await sendWhatsApp(
        phone,
        "Te llegó platita, mija. ¿Querés que guardemos una parte para que no se quede quieta?",
      );
      if (ok) {
        sent++;
        await db
          .update(savingsNudges)
          .set({ status: "sent", sentAt: new Date() })
          .where(eq(savingsNudges.id, inserted[0].id));
      }
    }
  }

  return c.json({ ok: true, created, sent });
});

// TODO: POST /reindex (admin: reindex desde slot N)

const port = Number(process.env.PORT ?? 3004);
export default { port, fetch: app.fetch };
