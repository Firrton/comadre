import { describe, expect, it } from "bun:test";
import { calculateGuardaditoSuggestion, formatMicroUsdc } from "../savings/amounts.js";

describe("Guardadito suggestion", () => {
  it("suggests only the amount above the liquid reserve", () => {
    process.env["GUARDADITO_MIN_LIQUID_USDC"] = "20";
    process.env["GUARDADITO_MIN_SUGGEST_USDC"] = "25";

    const result = calculateGuardaditoSuggestion({
      availableMicroUsdc: 50_000_000n,
      savedMicroUsdc: 0n,
    });

    expect(result.shouldSuggest).toBe(true);
    expect(result.suggestedMicroUsdc).toBe(30_000_000n);
  });

  it("does not suggest when available USDC is below minimum", () => {
    process.env["GUARDADITO_MIN_LIQUID_USDC"] = "20";
    process.env["GUARDADITO_MIN_SUGGEST_USDC"] = "25";

    const result = calculateGuardaditoSuggestion({
      availableMicroUsdc: 24_000_000n,
      savedMicroUsdc: 0n,
    });

    expect(result.shouldSuggest).toBe(false);
    expect(result.suggestedMicroUsdc).toBe(0n);
  });

  it("formats micro-USDC as user-safe decimal strings", () => {
    expect(formatMicroUsdc(12_500_000n)).toEqual({
      usdc: "12.5",
      microUsdc: "12500000",
    });
  });
});
