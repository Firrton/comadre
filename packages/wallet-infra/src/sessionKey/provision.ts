/**
 * Session-key agent provisioning — Turnkey-backed (Phase 1A).
 *
 * Wraps `turnkey.provisionUserAgent` with session-key naming conventions.
 * Creates a Turnkey sub-org + wallet for a user so the agent can sign UserOps
 * on their behalf without ever holding a plaintext private key.
 */

import {
  provisionUserAgent,
  type ProvisionUserAgentParams,
  type ProvisionUserAgentResult,
} from "../turnkey/client.js";

export interface ProvisionSessionKeyAgentParams {
  /** Unique identifier for the user — typically the phoneHash. */
  userExternalId: string;
  /** Human-readable label, e.g. "comadre-agent-<hash-prefix>". */
  displayName: string;
}

export interface ProvisionSessionKeyAgentResult {
  /** Turnkey sub-organization ID (UUID). */
  subOrgId: string;
  /** Wallet ID within the sub-org. */
  walletId: string;
  /** Derived EVM agent address (0x...). */
  agentAddress: string;
}

/**
 * Provision a Turnkey-managed agent wallet for a user.
 *
 * Returns the (subOrgId, walletId, agentAddress) tuple that must be stored in
 * the `session_keys` table and used when calling `signAndSendUserOp`.
 */
export async function provisionSessionKeyAgent(
  params: ProvisionSessionKeyAgentParams,
): Promise<ProvisionSessionKeyAgentResult> {
  const result: ProvisionUserAgentResult = await provisionUserAgent({
    userExternalId: params.userExternalId,
    displayName: params.displayName,
  });

  return {
    subOrgId: result.subOrgId,
    walletId: result.walletId,
    agentAddress: result.agentAddress,
  };
}
