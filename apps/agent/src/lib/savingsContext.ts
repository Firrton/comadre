import { apiCall } from "@comadre/agent-tools";

export async function loadSavingsContext(userWallet: string): Promise<string | null> {
  try {
    const summary = await apiCall<{
      available: { usdc: string };
      saved: { usdc: string };
      suggested: {
        shouldSuggest: boolean;
        amountUsdc: string;
        liquidReserveUsdc: string;
      };
    }>({
      method: "GET",
      path: "/api/v1/savings/summary",
      userWallet,
    });

    return [
      "Contexto Guardadito:",
      `Disponible: ${summary.available.usdc} USDC.`,
      `Guardado: ${summary.saved.usdc} USDC.`,
      summary.suggested.shouldSuggest
        ? `Podés sugerir guardar ${summary.suggested.amountUsdc} USDC dejando ${summary.suggested.liquidReserveUsdc} USDC disponibles.`
        : "No sugieras Guardadito proactivamente salvo que el usuario pregunte.",
    ].join(" ");
  } catch {
    return null;
  }
}
