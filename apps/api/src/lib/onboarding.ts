/**
 * Onboarding helper — creates a Privy user + Solana embedded wallet for a phone number.
 *
 * Trust model: the caller (the agent service) has already verified the phone
 * via the Twilio webhook signature, so we treat the phone as authenticated
 * for the purposes of this server-side `importUser`. This is "auth-by-channel"
 * — the user proves control of the phone by sending a WhatsApp message that
 * Twilio signs. Acceptable for sandbox/hackathon. For mainnet add real OTP.
 *
 * Idempotency: if the phone is already linked to a Privy user, we just look
 * it up + ensure a Solana wallet exists. If the user already has a Solana
 * embedded wallet, we return it as-is.
 */
import { PrivyClient } from "@privy-io/server-auth";
import { db, users } from "@comadre/db";
import { hashPhone } from "@comadre/cache";
import { eq } from "drizzle-orm";

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

/**
 * Find a Solana embedded wallet inside a Privy user's linkedAccounts.
 *
 * Privy's linkedAccounts contains heterogeneous account types; we look for
 * `type=wallet`, `chainType=solana`, `walletClientType=privy` (the embedded
 * wallets created by Privy's own infrastructure).
 */
function findSolanaEmbeddedWallet(linkedAccounts: unknown[]): PrivyEmbeddedWallet | null {
  for (const account of linkedAccounts) {
    const a = account as PrivyEmbeddedWallet;
    if (a.type === "wallet" && a.chainType === "solana" && a.walletClientType === "privy") {
      return a;
    }
  }
  return null;
}

/**
 * Onboard a phone number: ensure a Privy user exists with a Solana embedded wallet,
 * then upsert into our `users` table.
 */
export async function onboardPhone(phoneE164: string): Promise<OnboardResult> {
  if (!phoneE164.startsWith("+")) {
    throw new Error(`[onboarding] phone must be E.164 (start with +), got: ${phoneE164}`);
  }

  const privy = getPrivy();
  let privyUser = await privy.getUserByPhoneNumber(phoneE164);
  let alreadyExisted = privyUser !== null;

  if (privyUser === null) {
    // New user — import with phone + create Solana embedded wallet in one call
    privyUser = await privy.importUser({
      linkedAccounts: [{ type: "phone", number: phoneE164 }],
      createSolanaWallet: true,
    });
  }

  // Find the Solana embedded wallet (or create one if it's an existing user without one)
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
      `[onboarding] failed to obtain Solana embedded wallet for ${phoneE164} (privy_user=${privyUser.id})`
    );
  }

  const walletAddress = solWallet.address;
  const walletId = solWallet.id;
  const phoneHash = await hashPhone(phoneE164);
  const now = new Date();

  // Upsert into our users table — onConflict on wallet
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

  return {
    walletAddress,
    walletId,
    privyUserId: privyUser.id,
    alreadyExisted,
  };
}
