import { z } from "zod";

// -----------------------------------------------------------------------
// Solana
// -----------------------------------------------------------------------
const solanaSchema = z.object({
  SOLANA_CLUSTER: z.enum(["devnet", "mainnet-beta", "testnet", "localnet"]),
  SOLANA_RPC_URL: z.string().url(),
  SOLANA_WS_URL: z.string().url(),
  COMADRE_PROGRAM_ID: z.string().min(1),
  USDC_MINT: z.string().min(1),
});

// -----------------------------------------------------------------------
// Wallets — base58 secret keys
// -----------------------------------------------------------------------
const walletsSchema = z.object({
  FEE_PAYER_SK: z.string().min(1),
  CRANK_AUTHORITY_SK: z.string().min(1),
  KYC_ORACLE_SK: z.string().min(1),
  ADMIN_SK: z.string().min(1),
});

// -----------------------------------------------------------------------
// Privy
// -----------------------------------------------------------------------
const privySchema = z.object({
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),
  PRIVY_VERIFICATION_KEY: z.string().min(1),
});

// -----------------------------------------------------------------------
// Sumsub — KYC
// -----------------------------------------------------------------------
const sumsubSchema = z.object({
  SUMSUB_APP_TOKEN: z.string().min(1),
  SUMSUB_SECRET_KEY: z.string().min(1),
  SUMSUB_WEBHOOK_SECRET: z.string().min(1),
});

// -----------------------------------------------------------------------
// Meta WhatsApp Cloud API
// -----------------------------------------------------------------------
const metaSchema = z.object({
  META_APP_SECRET: z.string().min(1),
  META_PHONE_NUMBER_ID: z.string().min(1),
  META_ACCESS_TOKEN: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(1),
  META_WABA_ID: z.string().min(1),
});

// -----------------------------------------------------------------------
// Anthropic
// -----------------------------------------------------------------------
const anthropicSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1),
});

// -----------------------------------------------------------------------
// ElevenLabs — Phase 2 (optional)
// -----------------------------------------------------------------------
const elevenLabsSchema = z.object({
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_AGENT_ID: z.string().min(1).optional(),
});

// -----------------------------------------------------------------------
// Helius
// -----------------------------------------------------------------------
const heliusSchema = z.object({
  HELIUS_API_KEY: z.string().min(1),
  HELIUS_WEBHOOK_SECRET: z.string().min(1),
});

// -----------------------------------------------------------------------
// Postgres
// -----------------------------------------------------------------------
const postgresSchema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
});

// -----------------------------------------------------------------------
// Upstash Redis
// -----------------------------------------------------------------------
const upstashSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
});

// -----------------------------------------------------------------------
// Internal auth
// -----------------------------------------------------------------------
const internalAuthSchema = z.object({
  INTERNAL_HMAC_SECRET: z.string().min(1),
});

// -----------------------------------------------------------------------
// Service URLs — internal
// -----------------------------------------------------------------------
const serviceUrlsSchema = z.object({
  API_URL: z.string().url(),
  WA_URL: z.string().url(),
  AGENT_URL: z.string().url(),
  INDEXER_URL: z.string().url(),
});

// -----------------------------------------------------------------------
// Observability — optional in dev (Sentry/BetterStack may not be configured)
// -----------------------------------------------------------------------
const observabilitySchema = z.object({
  SENTRY_DSN: z.string().url().optional(),
  BETTER_STACK_TOKEN: z.string().min(1).optional(),
});

// -----------------------------------------------------------------------
// App
// -----------------------------------------------------------------------
const appSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

// -----------------------------------------------------------------------
// Combined schema — all domains merged
// -----------------------------------------------------------------------
export const envSchema = solanaSchema
  .merge(walletsSchema)
  .merge(privySchema)
  .merge(sumsubSchema)
  .merge(metaSchema)
  .merge(anthropicSchema)
  .merge(elevenLabsSchema)
  .merge(heliusSchema)
  .merge(postgresSchema)
  .merge(upstashSchema)
  .merge(internalAuthSchema)
  .merge(serviceUrlsSchema)
  .merge(observabilitySchema)
  .merge(appSchema);

export type Env = z.infer<typeof envSchema>;
