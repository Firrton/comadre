import { Turnkey } from "@turnkey/sdk-server";
import { env } from "@comadre/config";

// ---------------------------------------------------------------------------
// Singleton client
// ---------------------------------------------------------------------------

let turnkeyClient: Turnkey | null = null;

/**
 * Returns the lazily-initialized Turnkey SDK client.
 * Reads credentials from the validated env singleton — fails loudly at boot
 * (via loadEnv()) rather than silently at first use if vars are missing.
 */
export function getTurnkeyClient(): Turnkey {
  if (turnkeyClient === null) {
    // Turnkey vars are optional in the env schema so they may be undefined
    // in non-Monad environments. Fail fast here with a clear error rather
    // than passing undefined to the SDK and getting a cryptic HTTP 401.
    const apiPublicKey = env.TURNKEY_API_PUBLIC_KEY;
    const apiPrivateKey = env.TURNKEY_API_PRIVATE_KEY;
    const organizationId = env.TURNKEY_ORGANIZATION_ID;

    if (!apiPublicKey || !apiPrivateKey || !organizationId) {
      throw new Error(
        "[wallet-infra/turnkey] TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY, " +
          "and TURNKEY_ORGANIZATION_ID are all required but one or more are missing. " +
          "Set them in your environment before calling Turnkey-backed helpers.",
      );
    }

    turnkeyClient = new Turnkey({
      apiBaseUrl: "https://api.turnkey.com",
      apiPublicKey,
      apiPrivateKey,
      defaultOrganizationId: organizationId,
    });
  }

  return turnkeyClient;
}

// ---------------------------------------------------------------------------
// Agent provisioning
// ---------------------------------------------------------------------------

export interface ProvisionUserAgentParams {
  /** User identifier — wallet address or phone hash. Used as part of the sub-org name. */
  userExternalId: string;
  /** Human-readable label for the sub-org, e.g. "comadre-agent-<hash>". */
  displayName: string;
}

export interface ProvisionUserAgentResult {
  /** Turnkey sub-organization ID (UUID). */
  subOrgId: string;
  /** Wallet ID within the sub-org. */
  walletId: string;
  /** Derived EVM address (0x...). */
  agentAddress: string;
}

/**
 * Creates a Turnkey sub-organization for a user, plus an Ethereum wallet inside it.
 *
 * The sub-org uses the parent org's API key pair as its root authenticator so we
 * can act on its behalf without generating per-user credentials at provisioning
 * time. Per-user credentials (session keys, passkeys) can be added later.
 *
 * Follows managing-wallets rule: does NOT call createWallet without checking for
 * existing wallets first (the sub-org is brand-new so we skip the check — there
 * can be no existing wallet in a just-created org).
 */
export async function provisionUserAgent(
  params: ProvisionUserAgentParams,
): Promise<ProvisionUserAgentResult> {
  const tk = getTurnkeyClient();
  const client = tk.apiClient();
  const parentOrgId = env.TURNKEY_ORGANIZATION_ID!;

  // The root user's public key must be the parent org's API public key so we
  // can immediately act on the sub-org without additional key registration.
  const rootApiPublicKey = env.TURNKEY_API_PUBLIC_KEY!;

  const subOrgResult = await client.createSubOrganization({
    organizationId: parentOrgId,
    subOrganizationName: params.displayName,
    rootUsers: [
      {
        userName: "comadre-root",
        userEmail: "",
        apiKeys: [
          {
            apiKeyName: "parent-org-key",
            publicKey: rootApiPublicKey,
            curveType: "API_KEY_CURVE_P256",
          },
        ],
        authenticators: [],
        oauthProviders: [],
      },
    ],
    rootQuorumThreshold: 1,
    wallet: {
      walletName: `${params.displayName}-wallet`,
      accounts: [
        {
          curve: "CURVE_SECP256K1",
          pathFormat: "PATH_FORMAT_BIP32",
          path: "m/44'/60'/0'/0/0",
          addressFormat: "ADDRESS_FORMAT_ETHEREUM",
        },
      ],
      mnemonicLength: 12,
    },
  });

  const subOrgId: string = subOrgResult.subOrganizationId;

  // wallet is optional in the SDK response type even though we always pass one.
  // Guard here and fail fast rather than hitting a null deref later.
  const walletResult = subOrgResult.wallet;
  if (!walletResult) {
    throw new Error(
      `[wallet-infra/turnkey] provisionUserAgent: wallet not returned for sub-org ${subOrgId}. ` +
        "Turnkey may have accepted the sub-org but rejected the inline wallet creation.",
    );
  }

  const walletId: string = walletResult.walletId;

  // The SDK returns addresses in the same order as the accounts array.
  const agentAddress = walletResult.addresses[0];

  if (!agentAddress) {
    throw new Error(
      `[wallet-infra/turnkey] provisionUserAgent: no address returned for sub-org ${subOrgId}`,
    );
  }

  return { subOrgId, walletId, agentAddress };
}

// ---------------------------------------------------------------------------
// Raw payload signing (UserOp / arbitrary digest)
// ---------------------------------------------------------------------------

export interface SignEvmPayloadParams {
  /** Sub-organization ID that owns the wallet. */
  subOrgId: string;
  /** Wallet address (0x...) or walletId to sign with. */
  signWith: string;
  /**
   * Hex-encoded 32-byte digest to sign.
   * We use PAYLOAD_ENCODING_HEXADECIMAL + HASH_FUNCTION_NO_OP because callers
   * pre-hash their payloads (UserOps, EIP-191, EIP-712).
   */
  payload: string;
}

/**
 * Signs a raw 32-byte EVM payload (UserOp, EIP-191 personal_sign hash, EIP-712
 * structHash) using a Turnkey-managed wallet.
 *
 * Returns the compact hex-encoded ECDSA signature (r || s || v, 65 bytes, 130 hex chars).
 */
export async function signEvmPayload(params: SignEvmPayloadParams): Promise<string> {
  const tk = getTurnkeyClient();
  const client = tk.apiClient();

  const result = await client.signRawPayload({
    organizationId: params.subOrgId,
    signWith: params.signWith,
    payload: params.payload,
    encoding: "PAYLOAD_ENCODING_HEXADECIMAL",
    hashFunction: "HASH_FUNCTION_NO_OP",
  });

  // The SDK returns the signature components as { r, s, v }. Concatenate for
  // compatibility with EVM tools (viem, ethers, 4337 bundlers).
  const { r, s, v } = result;

  if (!r || !s || v === undefined || v === null) {
    throw new Error(
      `[wallet-infra/turnkey] signEvmPayload: incomplete signature returned for org ${params.subOrgId}`,
    );
  }

  // Normalize v to a single byte (0x1b / 0x1c) when the SDK gives "0"/"1".
  const vStr = String(v);
  const vNormalized = vStr === "0" || vStr === "00" ? "1b" : "1c";

  return `0x${r}${s}${vNormalized}`;
}

// ---------------------------------------------------------------------------
// Serialized EVM transaction signing
// ---------------------------------------------------------------------------

export interface SignEvmTransactionParams {
  /** Sub-organization ID that owns the wallet. */
  subOrgId: string;
  /** Wallet address (0x...) or walletId to sign with. */
  signWith: string;
  /** RLP-encoded unsigned EVM transaction (hex string, with or without 0x prefix). */
  unsignedTransaction: string;
}

/**
 * Signs a serialized EVM transaction using a Turnkey-managed wallet.
 *
 * For UserOps we use {@link signEvmPayload} instead — `signEvmPayload` signs
 * the pre-computed UserOp hash, which is what the EntryPoint verifies.
 * Use this function for standard EOA transactions.
 *
 * Returns the hex-encoded signed transaction.
 */
export async function signEvmTransaction(params: SignEvmTransactionParams): Promise<string> {
  const tk = getTurnkeyClient();
  const client = tk.apiClient();

  const result = await client.signTransaction({
    organizationId: params.subOrgId,
    signWith: params.signWith,
    unsignedTransaction: params.unsignedTransaction.startsWith("0x")
      ? params.unsignedTransaction.slice(2)
      : params.unsignedTransaction,
    type: "TRANSACTION_TYPE_ETHEREUM",
  });

  const signedTx: string = result.signedTransaction;

  if (!signedTx) {
    throw new Error(
      `[wallet-infra/turnkey] signEvmTransaction: no signedTransaction returned for org ${params.subOrgId}`,
    );
  }

  return signedTx.startsWith("0x") ? signedTx : `0x${signedTx}`;
}
