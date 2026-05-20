import { getTurnkeyClient } from "./client.js";

// ---------------------------------------------------------------------------
// Agent policy helpers
// ---------------------------------------------------------------------------

export interface CreateAgentPolicyParams {
  /** Sub-organization ID that owns the wallet. */
  subOrgId: string;
  /** Wallet ID to scope the ALLOW policy to. */
  walletId: string;
  /** Human-readable name for the policy, e.g. "comadre-default". */
  policyName: string;
}

export interface CreateAgentPolicyResult {
  /** Turnkey policy ID (UUID). */
  policyId: string;
}

/**
 * Creates a scoped ALLOW policy in the sub-org that permits the signing actions
 * the Comadre agent needs (raw payload + chain-aware transaction signing),
 * restricted to the specified wallet.
 *
 * Design notes:
 * - We include ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2 because UserOp signing works
 *   through signRawPayload (pre-hashed digest). This is intentional and matches
 *   the signEvmPayload helper in client.ts.
 * - The policy is wallet-scoped (wallet.id == '<WALLET_ID>') as required by
 *   provisioning-agent rule 2: "Every signing ALLOW policy must include wallet.id
 *   or wallet_account.address scope."
 * - The consensus expression uses a catch-all approver check because in a
 *   sub-org with a single root user there is only one possible approver and
 *   Turnkey evaluates consensus at the organization member level. The root user's
 *   auto-vote satisfies the clause immediately.
 */
export async function createAgentPolicy(
  params: CreateAgentPolicyParams,
): Promise<CreateAgentPolicyResult> {
  const tk = getTurnkeyClient();
  const client = tk.apiClient();

  const result = await client.createPolicy({
    organizationId: params.subOrgId,
    policyName: params.policyName,
    effect: "EFFECT_ALLOW",
    // Allow signing only with the designated wallet. Covers raw payload
    // (UserOps) and chain-aware transaction signing.
    condition: [
      `activity.type in ['ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2', 'ACTIVITY_TYPE_SIGN_RAW_PAYLOADS', 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2', 'ACTIVITY_TYPE_ETH_SEND_TRANSACTION']`,
      `&& wallet.id == '${params.walletId}'`,
    ].join(" "),
    // Root user self-approves; single-member sub-org has no other approvers.
    consensus: "approvers.count() >= 1",
    notes:
      "Comadre agent default: allow signing with the designated wallet only. " +
      "Raw payload is permitted for UserOp (ERC-4337) hash signing. " +
      "KYC tier caps are enforced off-chain in monadSessionSigner.ts and " +
      "on-chain via Kernel session permissions — Turnkey is a defence-in-depth layer.",
  });

  const policyId: string = result.policyId;

  if (!policyId) {
    throw new Error(
      `[wallet-infra/turnkey] createAgentPolicy: no policyId returned for sub-org ${params.subOrgId}`,
    );
  }

  return { policyId };
}

// ---------------------------------------------------------------------------
// KYC tier policy stub
// ---------------------------------------------------------------------------

export type KycTier = "t0_demo" | "t1_lite" | "t2_standard" | "t3_pro";

export interface UpdateKycPolicyParams {
  /** Sub-organization ID that owns the wallet. */
  subOrgId: string;
  /** Wallet ID associated with the user. */
  walletId: string;
  /** New KYC tier for the user. */
  newTier: KycTier;
}

/**
 * Stub for updating Turnkey policy when KYC tier changes.
 *
 * Phase 1 note: Turnkey policies cannot easily decode USDC calldata to enforce
 * per-transfer amount caps (the ABI would need to be uploaded and policy
 * conditions written against eth.tx.contract_call_args). The actual per-tier
 * spending caps are enforced:
 *   - Off-chain: in the Comadre API layer / monadSessionSigner.ts before
 *     submitting UserOps.
 *   - On-chain: via ZeroDev Kernel session key permissions (call policies on
 *     the validator contract).
 *
 * Turnkey is a defence-in-depth signing layer — if both off-chain and on-chain
 * enforcement are bypassed (extremely unlikely), a Turnkey DENY policy with ABI
 * matching would be the final backstop. That is Phase 2 work.
 *
 * This function is safe to call today; it logs the intended tier change and
 * returns without mutating anything in Turnkey.
 */
export async function updateKycPolicyForUser(params: UpdateKycPolicyParams): Promise<void> {
  // Phase 1: intentional no-op. See function docstring for rationale.
  console.log(
    `[wallet-infra/turnkey] updateKycPolicyForUser: tier change noted ` +
      `(subOrgId=${params.subOrgId}, walletId=${params.walletId}, newTier=${params.newTier}). ` +
      `Turnkey policy-level amount enforcement is deferred to Phase 2.`,
  );
}
