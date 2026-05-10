/**
 * Onboarding helper — backend-custodial model.
 * Generates a server-managed Solana keypair per user. WhatsApp ownership
 * (verified via Twilio webhook signature upstream) IS the auth.
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { eq } from "drizzle-orm";
import { db, users, userKeypairs } from "@comadre/db";
import { hashPhone } from "@comadre/cache";
import { normalizePhoneE164 } from "./phoneNormalize.js";
import { bootstrapOnChainProfile, airdropIfNeeded } from "./anchorBootstrap.js";

interface OnboardResult {
  walletAddress: string;
  alreadyExisted: boolean;
}

const LAMPORTS_PER_SOL = 1_000_000_000;

export async function onboardPhone(phoneRaw: string): Promise<OnboardResult> {
  if (!phoneRaw.startsWith("+")) throw new Error(`phone must be E.164, got: ${phoneRaw}`);
  const phoneE164 = normalizePhoneE164(phoneRaw);
  const phoneHash = await hashPhone(phoneE164);
  const now = new Date();

  const existing = await db.select({ wallet: users.wallet }).from(users).where(eq(users.phoneHash, phoneHash)).limit(1);
  if (existing.length > 0) {
    return { walletAddress: existing[0]!.wallet, alreadyExisted: true };
  }

  const kp = Keypair.generate();
  const walletAddress = kp.publicKey.toBase58();
  const secretKeyB58 = bs58.encode(kp.secretKey);

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      wallet: walletAddress,
      phoneHash,
      kycTier: "t0_demo",
      reputationScore: 0,
      tandasCompleted: 0,
      tandasDefaulted: 0,
      tandasCreated: 0n,
      loansRepaid: 0,
      loansDefaulted: 0,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(userKeypairs).values({
      wallet: walletAddress,
      secretKeyB58,
      createdAt: now,
    });
  });

  // Best-effort on-chain bootstrap — DO NOT swallow errors silently for the demo.
  // Airdrop SOL FIRST so the user wallet has rent; bootstrap pays from fee_payer
  // for init_user_profile rent so this is purely defensive.
  try {
    await airdropIfNeeded(walletAddress, 0.05 * LAMPORTS_PER_SOL);
    console.log(`[onboarding] airdropped 0.05 SOL to ${walletAddress}`);
  } catch (err) {
    console.error(`[onboarding] airdrop failed for ${walletAddress}:`, err);
  }

  try {
    await bootstrapOnChainProfile({ walletAddress, phoneHashHex: phoneHash, countryCode: "MX" });
    console.log(`[onboarding] on-chain profile bootstrapped for ${walletAddress}`);
    await db.update(users).set({ kycTier: "t1_lite", updatedAt: new Date() }).where(eq(users.wallet, walletAddress));
  } catch (err) {
    console.error(`[onboarding] on-chain bootstrap failed for ${walletAddress}:`, err);
  }

  return { walletAddress, alreadyExisted: false };
}
