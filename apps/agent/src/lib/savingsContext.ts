import { apiCall } from "@comadre/agent-tools";

export async function loadSavingsContext(userId: string): Promise<string | null> {
  try {
    const summary = await apiCall<{
      available: { usdc: string };
      saved: { usdc: string };
      apy_percent: number;
      apy_disclaimer: string;
      suggested: {
        shouldSuggest: boolean;
        amountUsdc: string;
        liquidReserveUsdc: string;
      };
    }>({
      method: "GET",
      path: "/api/v1/savings/summary",
      userId,
    });

    return [
      "Contexto Guardadito:",
      `Disponible: ${summary.available.usdc} USDC.`,
      `Guardado: ${summary.saved.usdc} USDC.`,
      `Tasa anual actual del chanchito: ${summary.apy_percent}% (variable, no garantizado).`,
      summary.suggested.shouldSuggest
        ? `Podés sugerir guardar ${summary.suggested.amountUsdc} USDC dejando ${summary.suggested.liquidReserveUsdc} USDC disponibles.`
        : "No sugieras Guardadito proactivamente salvo que el usuario pregunte.",
    ].join(" ");
  } catch {
    return null;
  }
}
