import { createDecipheriv, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { env } from "@comadre/config";
import { contactRoutes, db } from "@comadre/db";

function key(): Buffer {
  return createHash("sha256")
    .update(env.CONTACT_ENCRYPTION_KEY ?? "dev-only-contact-encryption-key")
    .digest();
}

export function decryptPhoneE164(ciphertext: string): string {
  const [ivB64, tagB64, encryptedB64] = ciphertext.split(".");
  if (!ivB64 || !tagB64 || !encryptedB64) throw new Error("Invalid phone ciphertext");

  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function getWhatsAppPhone(userWallet: string): Promise<string | null> {
  const rows = await db
    .select({ phoneCiphertext: contactRoutes.phoneCiphertext })
    .from(contactRoutes)
    .where(and(eq(contactRoutes.userWallet, userWallet), eq(contactRoutes.channel, "whatsapp")))
    .limit(1);

  return rows[0]?.phoneCiphertext ? decryptPhoneE164(rows[0].phoneCiphertext) : null;
}

export async function sendWhatsApp(toE164: string, body: string): Promise<boolean> {
  const payload = JSON.stringify({ to: `whatsapp:${toE164}`, body });
  const signature = createHmac("sha256", env.INTERNAL_HMAC_SECRET).update(payload).digest("hex");
  try {
    const res = await fetch(`${env.WA_URL}/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Auth": signature,
      },
      body: payload,
    });
    return res.ok;
  } catch {
    return false;
  }
}
