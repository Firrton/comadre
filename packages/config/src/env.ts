import { z } from "zod";

const optionalNonEmpty = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().min(1).optional(),
);

const optionalSecret = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().min(32).optional(),
);

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
// Privy — embedded wallets + auth
// -----------------------------------------------------------------------
const privySchema = z.object({
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),
  // Verification key downloaded from Privy dashboard. Optional for dev,
  // required for production JWT signature verification.
  PRIVY_VERIFICATION_KEY: z.string().min(1).optional(),
});

// -----------------------------------------------------------------------
// Sumsub — KYC (Phase 2; optional for the WhatsApp bot MVP)
// -----------------------------------------------------------------------
const sumsubSchema = z.object({
  SUMSUB_APP_TOKEN: z.string().min(1).optional(),
  SUMSUB_SECRET_KEY: z.string().min(1).optional(),
  SUMSUB_WEBHOOK_SECRET: z.string().min(1).optional(),
});

// -----------------------------------------------------------------------
// Twilio — WhatsApp Business API provider
// -----------------------------------------------------------------------
// We use Twilio (NOT Meta Cloud API) for WhatsApp. Sandbox during dev,
// approved sender for production. Auth model:
//   - TWILIO_AUTH_TOKEN: master token. Used ONLY for webhook signature
//     verification (X-Twilio-Signature HMAC). Treat as primary secret.
//   - TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET: scoped credentials for
//     outbound (Messages create). Rotatable without breaking the account.
//
// During the hackathon the sandbox sender `whatsapp:+14155238886` is used.
const twilioSchema = z.object({
  TWILIO_ACCOUNT_SID: z.string().regex(/^AC[0-9a-f]{32}$/i, "Must be an Account SID (AC...)"),
  TWILIO_AUTH_TOKEN: z.string().min(32, "Auth Token must be at least 32 chars"),
  TWILIO_API_KEY_SID: z.string().regex(/^SK[0-9a-f]{32}$/i, "Must be an API Key SID (SK...)"),
  TWILIO_API_KEY_SECRET: z.string().min(32, "API Key secret must be at least 32 chars"),
  /** WhatsApp sender, e.g. `whatsapp:+14155238886` (sandbox) or your approved number. */
  TWILIO_WHATSAPP_FROM: z.string().regex(/^whatsapp:\+\d{6,15}$/, "Must be `whatsapp:+E164`"),
});

// -----------------------------------------------------------------------
// LLM provider — Kimi K2 via Moonshot or Groq
// -----------------------------------------------------------------------
// Provider is selectable. At least ONE of MOONSHOT_API_KEY or GROQ_API_KEY
// must be set; the agent service reads LLM_PROVIDER to pick which to use.
//   - moonshot: direct API to Moonshot (cheaper, slower)
//   - groq:     same Kimi model on Groq's infra (faster, paid by tokens)
const llmSchema = z
  .object({
    LLM_PROVIDER: z.enum(["moonshot", "groq"]).default("moonshot"),
    MOONSHOT_API_KEY: z.string().min(1).optional(),
    GROQ_API_KEY: z.string().min(1).optional(),
    /** Kimi model name; e.g. `kimi-k2-0905-preview` (Moonshot) or `moonshotai/kimi-k2-instruct` (Groq). */
    KIMI_MODEL: z.string().min(1),
  })
  .refine(
    (v) => Boolean(v.MOONSHOT_API_KEY) || Boolean(v.GROQ_API_KEY),
    { message: "At least one of MOONSHOT_API_KEY or GROQ_API_KEY must be set" }
  )
  .refine(
    (v) => v.LLM_PROVIDER !== "moonshot" || Boolean(v.MOONSHOT_API_KEY),
    { message: "LLM_PROVIDER=moonshot requires MOONSHOT_API_KEY", path: ["MOONSHOT_API_KEY"] }
  )
  .refine(
    (v) => v.LLM_PROVIDER !== "groq" || Boolean(v.GROQ_API_KEY),
    { message: "LLM_PROVIDER=groq requires GROQ_API_KEY", path: ["GROQ_API_KEY"] }
  );

// -----------------------------------------------------------------------
// ElevenLabs — Phase 2 (optional)
// -----------------------------------------------------------------------
const elevenLabsSchema = z.object({
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_AGENT_ID: z.string().min(1).optional(),
});

// -----------------------------------------------------------------------
// Helius — Solana RPC + enhanced webhooks
// -----------------------------------------------------------------------
const heliusSchema = z.object({
  HELIUS_API_KEY: z.string().min(1),
  HELIUS_WEBHOOK_SECRET: z.string().min(1).optional(),
});

// -----------------------------------------------------------------------
// Postgres
// -----------------------------------------------------------------------
const postgresSchema = z.object({
  DATABASE_URL: z.string().url(),
  /** Direct connection (no pgbouncer) used by drizzle-kit migrations. */
  DIRECT_URL: z.string().url().optional(),
});

// -----------------------------------------------------------------------
// Upstash Redis (REST)
// -----------------------------------------------------------------------
const upstashSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
});

// -----------------------------------------------------------------------
// Internal auth — service-to-service HMAC
// -----------------------------------------------------------------------
const internalAuthSchema = z.object({
  INTERNAL_HMAC_SECRET: z.string().min(32, "Must be at least 32 chars (256-bit)"),
});

// -----------------------------------------------------------------------
// Guardadito — USDC savings strategy
// -----------------------------------------------------------------------
const guardaditoSchema = z.object({
  YIELD_STRATEGY_PROVIDER: z.enum(["mock", "kamino"]).default("mock"),
  GUARDADITO_MIN_LIQUID_USDC: z.coerce.number().min(0).default(20),
  GUARDADITO_MIN_SUGGEST_USDC: z.coerce.number().min(0).default(25),
  KAMINO_MARKET: optionalNonEmpty,
  KAMINO_USDC_RESERVE: optionalNonEmpty,
  KAMINO_USDC_MINT: optionalNonEmpty,
  CONTACT_ENCRYPTION_KEY: optionalSecret,
});

// -----------------------------------------------------------------------
// Service URLs — internal mesh
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
// Dev tooling — optional
// -----------------------------------------------------------------------
const devToolingSchema = z.object({
  /** ngrok auth token for exposing local webhooks during dev. */
  NGROK_AUTH_TOKEN: z.string().min(1).optional(),
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
//
// `llmSchema` carries `.refine()` checks, so it can't `.merge()` a plain
// object schema. We compose by intersecting: the base schema (everything
// else merged) AND the LLM schema's refined object. Zod handles the
// intersection cleanly and the inferred type is the union of fields.
const baseSchema = solanaSchema
  .merge(walletsSchema)
  .merge(privySchema)
  .merge(sumsubSchema)
  .merge(twilioSchema)
  .merge(elevenLabsSchema)
  .merge(heliusSchema)
  .merge(postgresSchema)
  .merge(upstashSchema)
  .merge(internalAuthSchema)
  .merge(guardaditoSchema)
  .merge(serviceUrlsSchema)
  .merge(observabilitySchema)
  .merge(devToolingSchema)
  .merge(appSchema);

export const envSchema = z.intersection(baseSchema, llmSchema);
export type Env = z.infer<typeof envSchema>;
