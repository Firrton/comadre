/**
 * Savings strategy adapter contract.
 *
 * NOTE: The `instructions` field previously typed as Solana `TransactionInstruction[]`
 * has been replaced with a generic array in the Monad migration. On-chain Monad savings
 * integration is pending — for now only the `mock` provider is functional.
 */

export interface BuiltStrategyTx {
  provider: "mock" | "kamino";
  strategyId: string;
  /** Chain-specific instructions (currently unused; reserved for Monad integration). */
  instructions: unknown[];
  unsignedTxBase64?: string;
  summary: string;
}

export interface SavingsSummary {
  provider: "mock" | "kamino";
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
