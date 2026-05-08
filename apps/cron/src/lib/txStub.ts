/**
 * Tx-build stub for the cron service.
 *
 * Mirrors the same pattern as apps/api/src/lib/stubs.ts.
 * Replace with real anchor-client calls once the program deploys.
 */

import { logger } from "./logger.js";

export const STUB_UNSIGNED_TX =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export type TxPlan = {
  instruction: string;
  args: Record<string, unknown>;
};

export function makeTxStub(idempotencyKey: string, plan: TxPlan): void {
  logger.info(
    { stub: true, idempotencyKey, plan },
    `[stub] tx-build "${plan.instruction}" (${idempotencyKey})`
  );
}
