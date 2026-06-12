import { z } from "zod";

const hexAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 20-byte hex address");

export const walletInfraEnvSchema = z.object({
  // --- Chain ---
  MONAD_CHAIN_ID: z.coerce.number().int().positive().default(10143),
  MONAD_RPC_URL: z.string().url(),

  // --- Privy ---
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),

  // --- Pimlico (bundler + paymaster) ---
  PIMLICO_API_KEY: z.string().min(1),
  // Set true v1; we sponsor all gas via Pimlico paymaster.
  PIMLICO_PAYMASTER_ENABLED: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("true"),

  // --- On-chain contracts (filled once Comadre.sol is deployed) ---
  COMADRE_CONTRACT_ADDRESS: hexAddress.optional(),
  USDC_CONTRACT_ADDRESS: hexAddress.optional(),

  // --- Onboarding magic-link UI base URL ---
  ONBOARDING_BASE_URL: z.string().url(),
});

export type WalletInfraEnv = z.infer<typeof walletInfraEnvSchema>;

let cached: WalletInfraEnv | null = null;

/**
 * Lazy, idempotent env loader. We do NOT call this at module top-level
 * because individual subpaths (e.g. test fixtures) may not need every var.
 */
export function loadWalletInfraEnv(): WalletInfraEnv {
  if (cached !== null) return cached;
  const result = walletInfraEnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.errors.map((e) => `  - ${e.path.join(".")}: ${e.message}`).join("\n");
    throw new Error(`[wallet-infra] environment validation failed:\n${issues}`);
  }
  cached = result.data;
  return cached;
}

/**
 * Pimlico bundler URL for a given chain ID, with the API key embedded.
 *
 * Used as the `bundlerTransport` argument to `createKernelAccountClient`.
 */
export function pimlicoBundlerUrl(chainId: number, apiKey: string): string {
  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${apiKey}`;
}
