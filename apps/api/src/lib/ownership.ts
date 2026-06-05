/**
 * Resource-ownership helpers.
 *
 * Case-insensitive EVM address equality. Addresses are stored lowercase in the
 * DB (schema contract) but an authenticated wallet may arrive in mixed case
 * (see audit F-5), so all comparisons normalize to lowercase. Missing/empty
 * inputs return false (fail closed).
 */
export function isSameAddress(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}
