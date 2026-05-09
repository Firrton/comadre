import type { HeliusWebhookEvent } from "@comadre/types";

export interface IncomingUsdcEvent {
  wallet: string;
  sourceRef: string;
  amountMicroUsdc: bigint;
}

export function extractIncomingUsdc(events: HeliusWebhookEvent[]): IncomingUsdcEvent[] {
  const usdcMint = process.env["USDC_MINT"];
  if (!usdcMint) return [];

  const out: IncomingUsdcEvent[] = [];
  for (const event of events) {
    for (const transfer of event.tokenTransfers ?? []) {
      if (transfer.mint !== usdcMint) continue;
      if (!transfer.toUserAccount) continue;
      if (transfer.tokenAmount <= 0) continue;

      out.push({
        wallet: transfer.toUserAccount,
        sourceRef: `${event.signature}:${transfer.toTokenAccount ?? transfer.toUserAccount}`,
        amountMicroUsdc: BigInt(Math.round(transfer.tokenAmount * 1_000_000)),
      });
    }
  }
  return out;
}
