/**
 * Stub helpers for pending tx-build endpoints during Monad migration.
 *
 * Returns a well-shaped response with a placeholder so the client can parse
 * the response without errors while on-chain Monad integration is pending.
 */

/** A valid-base64, harmless zero-byte placeholder for stub tx-build. */
export const STUB_UNSIGNED_TX =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 zero bytes, base64

export type TxPlan = {
  instruction: string;
  args: Record<string, unknown>;
  accounts: Record<string, unknown>;
};

export function makeTxStub(idempotencyKey: string, plan: TxPlan) {
  return {
    unsigned_tx: STUB_UNSIGNED_TX,
    idempotency_key: idempotencyKey,
    plan, // extra field for developer visibility; ignored by the Zod schema
  };
}
