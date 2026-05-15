/**
 * USDC transfer helpers for Monad EVM.
 *
 * Builds ERC-20 `transfer(to, amount)` calldata that the wallet-infra
 * `signAndSendContractCall` helper signs and submits as a UserOperation
 * through the user's Kernel smart wallet.
 */

import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

const USDC_DECIMALS = 6;
const USDC_MICRO_FACTOR = 10n ** BigInt(USDC_DECIMALS);

export const usdcAbi = parseAbi([
  "function transfer(address to, uint256 value) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
]);

/** Convert a human-friendly USDC amount (e.g. "10.5") to atomic micro-USDC. */
export function usdcToMicro(amount: string | number): bigint {
  const s = typeof amount === "number" ? amount.toString() : amount;
  if (!/^\d+(\.\d{1,6})?$/.test(s)) {
    throw new Error(`Invalid USDC amount: ${s} (expected up to 6 decimals)`);
  }
  const [whole, frac = ""] = s.split(".");
  const fracPadded = frac.padEnd(USDC_DECIMALS, "0");
  return BigInt(whole!) * USDC_MICRO_FACTOR + BigInt(fracPadded);
}

/** Format atomic micro-USDC back to a human-readable string (e.g. 10500000 → "10.5"). */
export function microToUsdc(micro: bigint): string {
  const whole = micro / USDC_MICRO_FACTOR;
  const frac = micro % USDC_MICRO_FACTOR;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/** Build calldata for ERC-20 `transfer(to, amount)`. */
export function buildUsdcTransferCalldata(to: Address, amountMicro: bigint): Hex {
  return encodeFunctionData({
    abi: usdcAbi,
    functionName: "transfer",
    args: [to, amountMicro],
  });
}
