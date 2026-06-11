import { describe, it, expect } from "bun:test";
import { envSchema } from "../env.js";

/** Minimal valid env: every required field with a legitimate value. */
const VALID_BASE = {
  // Privy
  PRIVY_APP_ID: "privy-app-id",
  PRIVY_APP_SECRET: "privy-app-secret",
  // OpenWA
  OPENWA_API_URL: "http://localhost:3005",
  OPENWA_API_KEY: "test_key",
  OPENWA_SESSION_ID: "test",
  OPENWA_WEBHOOK_SECRET: "a".repeat(32),
  // LLM
  LLM_PROVIDER: "moonshot",
  MOONSHOT_API_KEY: "sk-test",
  KIMI_MODEL: "kimi-k2.6",
  // DB
  DATABASE_URL: "postgresql://user:pass@localhost:5432/comadre",
  // Redis
  UPSTASH_REDIS_REST_URL: "https://redis.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token",
  // Internal auth
  INTERNAL_HMAC_SECRET: "s".repeat(32),
  // Service URLs
  API_URL: "http://localhost:3001",
  WA_URL: "http://localhost:3002",
  AGENT_URL: "http://localhost:3003",
};

describe("envSchema", () => {
  it("accepts a minimal valid env with OPENWA_* vars (no Twilio vars)", () => {
    const result = envSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
  });

  it("rejects when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _omit, ...rest } = VALID_BASE;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(Object.keys(fields)).toContain("DATABASE_URL");
    }
  });

  it("rejects when INTERNAL_HMAC_SECRET is too short", () => {
    const result = envSchema.safeParse({
      ...VALID_BASE,
      INTERNAL_HMAC_SECRET: "tooshort",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(Object.keys(fields)).toContain("INTERNAL_HMAC_SECRET");
    }
  });

  it("rejects when no LLM key is provided", () => {
    const { MOONSHOT_API_KEY: _omit, ...rest } = VALID_BASE;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("does NOT require SOLANA_CLUSTER", () => {
    const result = envSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    // Verify the removed field is not present in the parsed output type
    if (result.success) {
      expect("SOLANA_CLUSTER" in result.data).toBe(false);
    }
  });

  it("does NOT require FEE_PAYER_SK or other wallet secret keys", () => {
    const result = envSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("FEE_PAYER_SK" in result.data).toBe(false);
      expect("CRANK_AUTHORITY_SK" in result.data).toBe(false);
      expect("KYC_ORACLE_SK" in result.data).toBe(false);
      expect("ADMIN_SK" in result.data).toBe(false);
    }
  });

  it("does NOT require HELIUS_API_KEY", () => {
    const result = envSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("HELIUS_API_KEY" in result.data).toBe(false);
    }
  });

  it("does NOT require INDEXER_URL", () => {
    const result = envSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("INDEXER_URL" in result.data).toBe(false);
    }
  });

  it("rejects when OPENWA_API_URL is missing", () => {
    const { OPENWA_API_URL: _omit, ...rest } = VALID_BASE;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(Object.keys(fields)).toContain("OPENWA_API_URL");
    }
  });

  it("rejects when OPENWA_WEBHOOK_SECRET is too short", () => {
    const result = envSchema.safeParse({
      ...VALID_BASE,
      OPENWA_WEBHOOK_SECRET: "tooshort",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(Object.keys(fields)).toContain("OPENWA_WEBHOOK_SECRET");
    }
  });

  it("does NOT accept TWILIO_* vars in a valid parse", () => {
    const result = envSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("TWILIO_ACCOUNT_SID" in result.data).toBe(false);
      expect("TWILIO_AUTH_TOKEN" in result.data).toBe(false);
    }
  });
});
