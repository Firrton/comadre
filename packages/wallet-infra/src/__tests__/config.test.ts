// Tests the exported schema directly instead of loadWalletInfraEnv(),
// which caches its result in a module-level variable.
import { describe, it, expect } from "bun:test";

import { walletInfraEnvSchema } from "../config.js";

const VALID_ENV_WITHOUT_KMS: Record<string, string> = {
  MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
  MONAD_CHAIN_ID: "10143",
  PRIVY_APP_ID: "privy-app-test",
  PRIVY_APP_SECRET: "privy-secret-test",
  PIMLICO_API_KEY: "pim_test_key",
  PIMLICO_PAYMASTER_ENABLED: "true",
  ONBOARDING_BASE_URL: "https://example.com",
};

describe("walletInfraEnvSchema (post-KMS-removal)", () => {
  it("parses successfully without AWS_REGION and KMS_KEY_ARN", () => {
    const result = walletInfraEnvSchema.safeParse(VALID_ENV_WITHOUT_KMS);
    if (!result.success) {
      throw new Error(
        `Expected parse to succeed but got: ${result.error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")}`,
      );
    }
    expect(result.success).toBe(true);
  });

  it("fails when PIMLICO_API_KEY is missing", () => {
    const env = { ...VALID_ENV_WITHOUT_KMS };
    delete env["PIMLICO_API_KEY"];
    const result = walletInfraEnvSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.errors.map((e) => e.path.join("."));
      expect(paths).toContain("PIMLICO_API_KEY");
    }
  });

  it("fails when MONAD_RPC_URL is missing", () => {
    const env = { ...VALID_ENV_WITHOUT_KMS };
    delete env["MONAD_RPC_URL"];
    const result = walletInfraEnvSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.errors.map((e) => e.path.join("."));
      expect(paths).toContain("MONAD_RPC_URL");
    }
  });

  it("fails when PRIVY_APP_ID is missing", () => {
    const env = { ...VALID_ENV_WITHOUT_KMS };
    delete env["PRIVY_APP_ID"];
    const result = walletInfraEnvSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.errors.map((e) => e.path.join("."));
      expect(paths).toContain("PRIVY_APP_ID");
    }
  });
});
