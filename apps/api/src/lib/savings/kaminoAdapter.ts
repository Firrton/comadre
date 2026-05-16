import { env } from "@comadre/config";
import type { BuiltStrategyTx, SavingsStrategyAdapter, SavingsSummary } from "./strategy.js";

function assertKaminoConfigured(): { market: string; reserve: string; mint: string } {
  if (!env.KAMINO_MARKET || !env.KAMINO_USDC_RESERVE || !env.KAMINO_USDC_MINT) {
    throw new Error("Kamino Guardadito requires KAMINO_MARKET, KAMINO_USDC_RESERVE, and KAMINO_USDC_MINT");
  }
  return {
    market: env.KAMINO_MARKET,
    reserve: env.KAMINO_USDC_RESERVE,
    mint: env.KAMINO_USDC_MINT,
  };
}

/**
 * Kamino adapter boundary.
 *
 * The production integration lives behind this adapter so the rest of Comadre
 * stays stable. The default provider remains `mock`; enabling `kamino` without
 * wiring the SDK fails closed instead of moving funds through an unknown path.
 */
export const kaminoSavingsAdapter: SavingsStrategyAdapter = {
  async getSummary(): Promise<SavingsSummary> {
    const cfg = assertKaminoConfigured();
    return {
      provider: "kamino",
      strategyId: `kamino:${cfg.market}:${cfg.reserve}`,
      savedMicroUsdc: 0n,
      shareAmount: "0",
      // APR fetch from Kamino SDK is gated behind YIELD_STRATEGY_PROVIDER=kamino;
      // adapter is wired but SDK calls are intentionally disabled (see buildDeposit).
      apyPercent: 0,
    };
  },

  async buildDeposit(): Promise<BuiltStrategyTx> {
    const cfg = assertKaminoConfigured();
    throw new Error(
      `Kamino adapter configured for ${cfg.market}/${cfg.reserve}, but SDK tx building is intentionally disabled in this build. Use YIELD_STRATEGY_PROVIDER=mock for demo.`,
    );
  },

  async buildWithdraw(): Promise<BuiltStrategyTx> {
    const cfg = assertKaminoConfigured();
    throw new Error(
      `Kamino adapter configured for ${cfg.market}/${cfg.reserve}, but SDK tx building is intentionally disabled in this build. Use YIELD_STRATEGY_PROVIDER=mock for demo.`,
    );
  },
};
