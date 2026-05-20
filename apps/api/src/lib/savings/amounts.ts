import { env } from "@comadre/config";
import { microToUsdc } from "../monadUsdcTransfer.js";

const MICRO_USDC = 1_000_000n;

export function usdcNumberToMicro(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Invalid USDC number: ${value}`);
  }
  return BigInt(Math.floor(value * 1_000_000));
}

export function guardaditoReserveMicro(): bigint {
  return usdcNumberToMicro(env.GUARDADITO_MIN_LIQUID_USDC);
}

export function guardaditoMinSuggestMicro(): bigint {
  return usdcNumberToMicro(env.GUARDADITO_MIN_SUGGEST_USDC);
}

export function formatMicroUsdc(microUsdc: bigint): { usdc: string; microUsdc: string } {
  return { usdc: microToUsdc(microUsdc), microUsdc: microUsdc.toString() };
}

export function calculateGuardaditoSuggestion(params: {
  availableMicroUsdc: bigint;
  savedMicroUsdc: bigint;
}): {
  shouldSuggest: boolean;
  suggestedMicroUsdc: bigint;
  liquidReserveMicroUsdc: bigint;
  reason: string;
} {
  const reserve = guardaditoReserveMicro();
  const minSuggest = guardaditoMinSuggestMicro();
  const aboveReserve = params.availableMicroUsdc > reserve
    ? params.availableMicroUsdc - reserve
    : 0n;

  if (params.availableMicroUsdc < minSuggest || aboveReserve <= 0n) {
    return {
      shouldSuggest: false,
      suggestedMicroUsdc: 0n,
      liquidReserveMicroUsdc: reserve,
      reason: "No hay suficiente USDC disponible para sugerir Guardadito sin tocar la reserva líquida.",
    };
  }

  const roundedDownToWholeUsdc = (aboveReserve / MICRO_USDC) * MICRO_USDC;
  const suggested = roundedDownToWholeUsdc > 0n ? roundedDownToWholeUsdc : aboveReserve;

  return {
    shouldSuggest: suggested > 0n,
    suggestedMicroUsdc: suggested,
    liquidReserveMicroUsdc: reserve,
    reason: "Hay USDC disponible por encima de la reserva líquida.",
  };
}
