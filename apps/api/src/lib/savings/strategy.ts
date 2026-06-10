/**
 * Savings strategy adapter contract.
 *
 * Providers:
 *   - `mock`      — in-memory demo, no on-chain calls. Default in dev.
 *   - `neverland` — Neverland (Aave V3 fork) on Monad. Active when
 *                   YIELD_STRATEGY_PROVIDER=neverland and NEVERLAND_POOL_ADDRESS is set.
 */

export interface BuiltStrategyTx {
  provider: "mock" | "neverland";
  strategyId: string;
  /** Chain-specific instructions (currently unused; reserved for Monad integration). */
  instructions: unknown[];
  unsignedTxBase64?: string;
  summary: string;
}

export interface SavingsSummary {
  provider: "mock" | "neverland";
  strategyId: string;
  savedMicroUsdc: bigint;
  shareAmount: string;
  /** Current annualized yield, percent (e.g. 5.4 = 5.4% APR). Variable, not guaranteed. */
  apyPercent: number;
}

export interface SavingsStrategyAdapter {
  getSummary(wallet: string): Promise<SavingsSummary>;
  buildDeposit(params: { wallet: string; amountMicroUsdc: bigint }): Promise<BuiltStrategyTx>;
  buildWithdraw(params: { wallet: string; amountMicroUsdc: bigint }): Promise<BuiltStrategyTx>;
}
