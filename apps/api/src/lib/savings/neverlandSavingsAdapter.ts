/**
 * Neverland savings adapter — wraps neverlandAdapter.ts into the
 * SavingsStrategyAdapter contract consumed by routes/savings.ts.
 *
 * This adapter is selected when YIELD_STRATEGY_PROVIDER=neverland.
 * It requires NEVERLAND_POOL_ADDRESS and COMADRE_FEE_WALLET to be set;
 * if they are absent the adapter throws at call-time (never silently falls
 * back to a money-losing path).
 */

import { and, eq } from "drizzle-orm";
import { db, savingsPositions } from "@comadre/db";
import { env } from "@comadre/config";
import type { Address } from "viem";
import {
  depositToNeverland,
  withdrawFromNeverland,
  readNeverlandPosition,
  readNeverlandApy,
} from "../neverlandAdapter.js";
import type { BuiltStrategyTx, SavingsStrategyAdapter, SavingsSummary } from "./strategy.js";

export const NEVERLAND_STRATEGY_ID = "neverland-usdc-v1";

/**
 * Resolve and validate required env vars. Throws a descriptive error when
 * production config is incomplete rather than silently losing money.
 */
function resolveNeverlandConfig(): {
  feeBps: number;
  comadreFeeWallet: Address;
  neverlandPoolAddress: Address;
} {
  if (!env.COMADRE_FEE_WALLET) {
    throw new Error(
      "[neverlandSavingsAdapter] COMADRE_FEE_WALLET is not set. " +
        "Refusing to execute yield operations without a fee wallet — funds would be lost.",
    );
  }
  if (!env.NEVERLAND_POOL_ADDRESS) {
    throw new Error(
      "[neverlandSavingsAdapter] NEVERLAND_POOL_ADDRESS is not set. " +
        "Cannot route deposits/withdrawals without a pool address.",
    );
  }
  return {
    feeBps: env.COMADRE_YIELD_FEE_BPS,
    comadreFeeWallet: env.COMADRE_FEE_WALLET as Address,
    neverlandPoolAddress: env.NEVERLAND_POOL_ADDRESS as Address,
  };
}

/**
 * Fetch the deposited and withdrawn principal totals from the DB for a wallet.
 * Returns zeros if no position row exists yet (new user).
 */
async function getPrincipalsFromDb(
  walletAddress: string,
): Promise<{ deposited: bigint; withdrawn: bigint }> {
  const rows = await db
    .select({
      deposited: savingsPositions.depositedMicroUsdc,
      withdrawn: savingsPositions.principalWithdrawnMicroUsdc,
    })
    .from(savingsPositions)
    .where(
      and(
        eq(savingsPositions.userId, walletAddress),
        eq(savingsPositions.provider, "neverland"),
        eq(savingsPositions.strategyId, NEVERLAND_STRATEGY_ID),
        eq(savingsPositions.status, "active"),
      ),
    )
    .limit(1)
    .catch(() => []);

  const row = rows[0];
  return {
    deposited: row?.deposited ?? 0n,
    withdrawn: row?.withdrawn ?? 0n,
  };
}

export const neverlandSavingsAdapter: SavingsStrategyAdapter = {
  async getSummary(wallet: string): Promise<SavingsSummary> {
    const { feeBps } = resolveNeverlandConfig();
    const { deposited, withdrawn } = await getPrincipalsFromDb(wallet);

    const [position, apyData] = await Promise.all([
      readNeverlandPosition({
        smartWalletAddress: wallet as Address,
        principalDepositedMicroUsdc: deposited,
        principalWithdrawnMicroUsdc: withdrawn,
        feeBps,
      }),
      readNeverlandApy(),
    ]);

    // savedMicroUsdc = net USDC equivalent held on-chain (nUSDC balance ≈ USDC value)
    const savedMicroUsdc = position.currentValueMicroUsdc;

    return {
      provider: "neverland",
      strategyId: NEVERLAND_STRATEGY_ID,
      savedMicroUsdc,
      shareAmount: position.nUsdcBalance.toString(),
      // Convert decimal (0.05 = 5%) to percent (5.0) and round to 2 decimal places
      apyPercent: Math.round(apyData.totalApy * 10_000) / 100,
    };
  },

  async buildDeposit({ amountMicroUsdc }): Promise<BuiltStrategyTx> {
    // Validation only — the actual on-chain call happens at confirm time.
    // This keeps the prepare/confirm two-step consistent with the mock path.
    resolveNeverlandConfig(); // throws early if misconfigured

    return {
      provider: "neverland",
      strategyId: NEVERLAND_STRATEGY_ID,
      instructions: [],
      summary: `Neverland deposit preparado por ${amountMicroUsdc.toString()} micro-USDC.`,
    };
  },

  async buildWithdraw({ amountMicroUsdc }): Promise<BuiltStrategyTx> {
    resolveNeverlandConfig(); // throws early if misconfigured

    return {
      provider: "neverland",
      strategyId: NEVERLAND_STRATEGY_ID,
      instructions: [],
      summary: `Neverland retiro preparado por ${amountMicroUsdc.toString()} micro-USDC.`,
    };
  },
};

export { depositToNeverland, withdrawFromNeverland, readNeverlandPosition, getPrincipalsFromDb, resolveNeverlandConfig };
