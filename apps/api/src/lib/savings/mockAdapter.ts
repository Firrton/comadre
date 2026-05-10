import { and, eq } from "drizzle-orm";
import { db, savingsPositions } from "@comadre/db";
import type { BuiltStrategyTx, SavingsStrategyAdapter, SavingsSummary } from "./strategy.js";

export const MOCK_STRATEGY_ID = "guardadito-mock-usdc";

async function getMockPosition(wallet: string): Promise<bigint> {
  const rows = await db
    .select({ amount: savingsPositions.lastKnownUnderlyingMicroUsdc })
    .from(savingsPositions)
    .where(
      and(
        eq(savingsPositions.userWallet, wallet),
        eq(savingsPositions.provider, "mock"),
        eq(savingsPositions.strategyId, MOCK_STRATEGY_ID),
        eq(savingsPositions.status, "active"),
      ),
    )
    .limit(1)
    .catch(() => []);

  return rows[0]?.amount ?? 0n;
}

function built(type: "deposit" | "withdraw", amountMicroUsdc: bigint): BuiltStrategyTx {
  return {
    provider: "mock",
    strategyId: MOCK_STRATEGY_ID,
    instructions: [],
    summary:
      type === "deposit"
        ? `Guardadito demo preparado por ${amountMicroUsdc.toString()} micro-USDC.`
        : `Retiro demo preparado por ${amountMicroUsdc.toString()} micro-USDC.`,
  };
}

export const mockSavingsAdapter: SavingsStrategyAdapter = {
  async getSummary(wallet: string): Promise<SavingsSummary> {
    const savedMicroUsdc = await getMockPosition(wallet);
    // Deterministic mock APR that varies day-to-day in a believable range (4.5% - 6.5%).
    const dayOfYear = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86400000);
    const apyPercent = 4.5 + ((dayOfYear * 7) % 21) / 10; // pseudo-noise in [4.5, 6.5]
    return {
      provider: "mock",
      strategyId: MOCK_STRATEGY_ID,
      savedMicroUsdc,
      shareAmount: savedMicroUsdc.toString(),
      apyPercent: Math.round(apyPercent * 100) / 100,
    };
  },

  async buildDeposit({ amountMicroUsdc }): Promise<BuiltStrategyTx> {
    return built("deposit", amountMicroUsdc);
  },

  async buildWithdraw({ amountMicroUsdc }): Promise<BuiltStrategyTx> {
    return built("withdraw", amountMicroUsdc);
  },
};
