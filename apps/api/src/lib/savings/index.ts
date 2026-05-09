import { env } from "@comadre/config";
import { kaminoSavingsAdapter } from "./kaminoAdapter.js";
import { mockSavingsAdapter } from "./mockAdapter.js";
import type { SavingsStrategyAdapter } from "./strategy.js";

export function getSavingsAdapter(): SavingsStrategyAdapter {
  return env.YIELD_STRATEGY_PROVIDER === "kamino"
    ? kaminoSavingsAdapter
    : mockSavingsAdapter;
}

export type {
  BuiltStrategyTx,
  SavingsStrategyAdapter,
  SavingsSummary,
} from "./strategy.js";
