/**
 * /api/v1/onramp + /api/v1/offramp — mock ramp quotes (hackathon)
 *
 * POST /api/v1/onramp/quote  — fiat → USDC quote
 * POST /api/v1/offramp/quote — USDC → fiat quote
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

export const rampsRouter = new Hono();

const QuoteInput = z.object({
  fiat_currency: z.string().regex(/^[A-Z]{3}$/, "ISO 4217 currency code"),
  fiat_amount_cents: z.number().int().positive(),
  user_wallet: z.string().min(32).max(44),
});

// Mock exchange rate: 1 USD = 1 USDC, fiat_amount_cents / 100 → USDC
// For non-USD currencies, we use a flat mock rate (1 ARS = 0.001 USDC, etc.)
const MOCK_RATES: Record<string, number> = {
  USD: 1.0,
  ARS: 0.001,
  MXN: 0.055,
  COP: 0.00024,
  BRL: 0.18,
  CLP: 0.001,
  PEN: 0.27,
};

function getFiatToUsdc(currency: string, fiatCents: number): bigint {
  const rate = MOCK_RATES[currency] ?? 1.0;
  // fiatCents / 100 * rate → USDC → * 1_000_000 micro-USDC
  const usdcAmount = Math.ceil((fiatCents / 100) * rate * 1_000_000);
  return BigInt(usdcAmount);
}

// ---------------------------------------------------------------------------
// POST /api/v1/onramp/quote
// ---------------------------------------------------------------------------
rampsRouter.post(
  "/onramp/quote",
  zValidator("json", QuoteInput, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const { fiat_currency, fiat_amount_cents } = c.req.valid("json");
    const usdcAmount = getFiatToUsdc(fiat_currency, fiat_amount_cents);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

    return c.json(
      {
        fiat_currency,
        fiat_amount_cents,
        usdc_amount: usdcAmount.toString(),
        provider: "mock",
        direction: "onramp",
        expires_at: expiresAt.toISOString(),
        rate_note: "Mock rate — not for production use",
      },
      200
    );
  }
);

// ---------------------------------------------------------------------------
// POST /api/v1/offramp/quote
// ---------------------------------------------------------------------------
rampsRouter.post(
  "/offramp/quote",
  zValidator("json", QuoteInput, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const { fiat_currency, fiat_amount_cents } = c.req.valid("json");
    const usdcAmount = getFiatToUsdc(fiat_currency, fiat_amount_cents);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    return c.json(
      {
        fiat_currency,
        fiat_amount_cents,
        usdc_amount: usdcAmount.toString(),
        provider: "mock",
        direction: "offramp",
        expires_at: expiresAt.toISOString(),
        rate_note: "Mock rate — not for production use",
      },
      200
    );
  }
);
