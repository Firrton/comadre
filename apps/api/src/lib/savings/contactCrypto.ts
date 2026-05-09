import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { env } from "@comadre/config";
import { contactRoutes, db } from "@comadre/db";
import { hashPhone } from "@comadre/cache";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const configured = env.CONTACT_ENCRYPTION_KEY;
  if (!configured && env.NODE_ENV === "production") {
    throw new Error("CONTACT_ENCRYPTION_KEY is required in production");
  }

  return createHash("sha256")
    .update(configured ?? "dev-only-contact-encryption-key")
    .digest();
}

export function encryptPhoneE164(phoneE164: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(phoneE164, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptPhoneE164(ciphertext: string): string {
  const [ivB64, tagB64, encryptedB64] = ciphertext.split(".");
  if (!ivB64 || !tagB64 || !encryptedB64) {
    throw new Error("Invalid phone ciphertext");
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export async function upsertContactRoute(params: {
  userWallet: string;
  phoneE164: string;
}): Promise<void> {
  const phoneHash = await hashPhone(params.phoneE164);
  await db
    .insert(contactRoutes)
    .values({
      userWallet: params.userWallet,
      phoneHash,
      phoneCiphertext: encryptPhoneE164(params.phoneE164),
      channel: "whatsapp",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [contactRoutes.userWallet, contactRoutes.channel],
      set: {
        phoneHash,
        phoneCiphertext: encryptPhoneE164(params.phoneE164),
        updatedAt: new Date(),
      },
    });
}

export async function getWhatsAppRoute(userWallet: string): Promise<string | null> {
  const rows = await db
    .select({ phoneCiphertext: contactRoutes.phoneCiphertext })
    .from(contactRoutes)
    .where(and(eq(contactRoutes.userWallet, userWallet), eq(contactRoutes.channel, "whatsapp")))
    .limit(1);

  const ciphertext = rows[0]?.phoneCiphertext;
  return ciphertext ? decryptPhoneE164(ciphertext) : null;
}
