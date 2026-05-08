/**
 * Stub helpers for tx-build endpoints.
 *
 * The Anchor program ID is still a placeholder (`CMDRxxxx…`).
 * These helpers return a well-shaped `UnsignedTransactionResponse`
 * with a valid-format (but inert) unsigned_tx so the client can parse
 * the response shape without errors.
 *
 * When deploy lands, replace `STUB_UNSIGNED_TX` with the actual base64
 * serialized VersionedTransaction from `@comadre/anchor-client`.
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
