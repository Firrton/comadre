/**
 * Onboarding helper — creates Privy user + Solana embedded wallet for a phone.
 *
 * Trust model: caller (agent service) has already verified phone ownership via
 * Twilio webhook signature. This is "auth-by-channel" for hackathon.
 *
 * Idempotent: existing phones return their current wallet.
 */
import { PrivyClient } from "@privy-io/server-auth";
import { db, users } from "@comadre/db";
import { hashPhone } from "@comadre/cache";
import { eq } from "drizzle-orm";

import { normalizePhoneE164 } from "./phoneNormalize.js";

interface OnboardResult {
  walletAddress: string;
  walletId: string;
  privyUserId: string;
  alreadyExisted: boolean;
}

let _privy: PrivyClient | null = null;
function getPrivy(): PrivyClient {
  if (_privy !== null) return _privy;
  const appId = process.env["PRIVY_APP_ID"];
  const appSecret = process.env["PRIVY_APP_SECRET"];
  if (!appId || !appSecret) {
    throw new Error("[onboarding] PRIVY_APP_ID and PRIVY_APP_SECRET are required");
  }
  _privy = new PrivyClient(appId, appSecret);
  return _privy;
}

interface PrivyEmbeddedWallet {
  type: string;
  chainType?: string;
  walletClientType?: string;
  address?: string;
  id?: string;
}

function findSolanaEmbeddedWallet(linkedAccounts: unknown[]): PrivyEmbeddedWallet | null {
  for (const account of linkedAccounts) {
    const a = account as PrivyEmbeddedWallet;
    if (a.type === "wallet" && a.chainType === "solana" && a.walletClientType === "privy") {
      return a;
    }
  }
  return null;
}

export async function onboardPhone(phoneRaw: string): Promise<OnboardResult> {
  if (!phoneRaw.startsWith("+")) {
    throw new Error(`[onboarding] phone must be E.164, got: ${phoneRaw}`);
  }
  const phoneE164 = normalizePhoneE164(phoneRaw);

  const privy = getPrivy();
  let privyUser = await privy.getUserByPhoneNumber(phoneE164);
  const alreadyExisted = privyUser !== null;

  if (privyUser === null) {
    privyUser = await privy.importUser({
      linkedAccounts: [{ type: "phone", number: phoneE164 }],
      createSolanaWallet: true,
    });
  }

  let solWallet = findSolanaEmbeddedWallet(privyUser.linkedAccounts);
  if (solWallet === null) {
    privyUser = await privy.createWallets({
      userId: privyUser.id,
      createSolanaWallet: true,
    });
    solWallet = findSolanaEmbeddedWallet(privyUser.linkedAccounts);
  }

  if (!solWallet || !solWallet.address || !solWallet.id) {
    throw new Error(
      `[onboarding] failed to obtain Solana embedded wallet for ${phoneE164}`,
    );
  }

  const walletAddress = solWallet.address;
  const walletId = solWallet.id;
  const phoneHash = await hashPhone(phoneE164);
  const now = new Date();

  const existing = await db
    .select({ wallet: users.wallet })
    .from(users)
    .where(eq(users.wallet, walletAddress))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(users).values({
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
  }

  return { walletAddress, walletId, privyUserId: privyUser.id, alreadyExisted };
}
