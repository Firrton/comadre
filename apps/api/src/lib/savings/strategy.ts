/**
 * Savings strategy adapter contract.
 *
 * Providers:
 *   - `mock`      — in-memory demo, no on-chain calls. Default in dev.
 *   - `kamino`    — Kamino Lend on Solana (legacy; returns 501 post Monad migration).
 *   - `neverland` — Neverland (Aave V3 fork) on Monad mainnet. Active when
 *                   YIELD_STRATEGY_PROVIDER=neverland and NEVERLAND_POOL_ADDRESS is set.
 */

export interface BuiltStrategyTx {
  provider: "mock" | "kamino" | "neverland";
  strategyId: string;
  /** Chain-specific instructions (currently unused; reserved for Monad integration). */
  instructions: unknown[];
  unsignedTxBase64?: string;
  summary: string;
}

export interface SavingsSummary {
  provider: "mock" | "kamino" | "neverland";
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
