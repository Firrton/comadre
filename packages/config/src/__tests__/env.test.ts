import { describe, it, expect } from "bun:test";
import { envSchema } from "../env.js";

/** Minimal valid env: every required field with a legitimate value. */
const VALID_BASE = {
  // Privy
  PRIVY_APP_ID: "privy-app-id",
  PRIVY_APP_SECRET: "privy-app-secret",
  // Twilio
  TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
  TWILIO_AUTH_TOKEN: "a".repeat(32),
  TWILIO_API_KEY_SID: "SK" + "b".repeat(32),
  TWILIO_API_KEY_SECRET: "b".repeat(32),
  TWILIO_WHATSAPP_FROM: "whatsapp:+14155238886",
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
  it("accepts a minimal valid env (no Solana/wallet/Helius vars needed)", () => {
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
});
