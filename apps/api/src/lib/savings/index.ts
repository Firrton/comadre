import { env } from "@comadre/config";
import { kaminoSavingsAdapter } from "./kaminoAdapter.js";
import { mockSavingsAdapter } from "./mockAdapter.js";
import { neverlandSavingsAdapter } from "./neverlandSavingsAdapter.js";
import type { SavingsStrategyAdapter } from "./strategy.js";

export function getSavingsAdapter(): SavingsStrategyAdapter {
  if (env.YIELD_STRATEGY_PROVIDER === "kamino") return kaminoSavingsAdapter;
  if (env.YIELD_STRATEGY_PROVIDER === "neverland") return neverlandSavingsAdapter;
  return mockSavingsAdapter;
}

export type {
  BuiltStrategyTx,
  SavingsStrategyAdapter,
  SavingsSummary,
} from "./strategy.js";
