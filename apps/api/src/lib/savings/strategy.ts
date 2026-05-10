import type { TransactionInstruction } from "@solana/web3.js";

export interface BuiltStrategyTx {
  provider: "mock" | "kamino";
  strategyId: string;
  instructions: TransactionInstruction[];
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
