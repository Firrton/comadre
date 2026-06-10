export type ConfirmationParseResult = "affirmative" | "negative" | "ambiguous";

const AFFIRMATIVE_WORDS = new Set(["sí", "si", "dale", "ok", "confirmo", "yes"]);
const NEGATIVE_WORDS = new Set(["no", "cancelar", "cancela", "cancelá"]);

export function parseConfirmation(message: string): ConfirmationParseResult {
  const trimmed = message.trim().toLowerCase();
  if (!trimmed) return "ambiguous";

  const tokens = trimmed.match(/[\p{L}\p{M}]+|✅|❌/gu) ?? [];
  if (tokens.length !== 1) return "ambiguous";

  const [token] = tokens;
  if (token === "✅" || (token && AFFIRMATIVE_WORDS.has(token))) return "affirmative";
  if (token === "❌" || (token && NEGATIVE_WORDS.has(token))) return "negative";

  return "ambiguous";
}

export function isConfirmationShaped(message: string): boolean {
  return parseConfirmation(message) !== "ambiguous";
}
