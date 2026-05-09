import { describe, expect, it } from "bun:test";
import { extractIncomingUsdc } from "../lib/heliusSavings.js";

describe("extractIncomingUsdc", () => {
  it("extracts incoming USDC transfers and ignores other mints", () => {
    process.env["USDC_MINT"] = "USDC111111111111111111111111111111111111111";

    const result = extractIncomingUsdc([
      {
        type: "TRANSFER",
        txType: "TRANSFER",
        signature: "sig1",
        slot: 1,
        timestamp: 1,
        fee: 5000,
        feePayer: "payer",
        tokenTransfers: [
          {
            toUserAccount: "wallet1",
            toTokenAccount: "ata1",
            tokenAmount: 12.5,
            mint: "USDC111111111111111111111111111111111111111",
          },
          {
            toUserAccount: "wallet2",
            toTokenAccount: "ata2",
            tokenAmount: 99,
            mint: "OTHER",
          },
        ],
      },
    ]);

    expect(result).toEqual([
      {
        wallet: "wallet1",
        sourceRef: "sig1:ata1",
        amountMicroUsdc: 12_500_000n,
      },
    ]);
  });
});
