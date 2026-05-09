import { describe, it, expect } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { buildUsdcTransferIxs, usdcToMicro, microToUsdc } from "../usdcTransfer";

const USDC_MINT_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

describe("usdcToMicro / microToUsdc", () => {
  it("converts whole USDC", () => {
    expect(usdcToMicro("10")).toBe(10_000_000n);
    expect(microToUsdc(10_000_000n)).toBe("10");
  });

  it("converts decimal amounts", () => {
    expect(usdcToMicro("10.5")).toBe(10_500_000n);
    expect(usdcToMicro("0.000001")).toBe(1n);
    expect(microToUsdc(10_500_000n)).toBe("10.5");
    expect(microToUsdc(1n)).toBe("0.000001");
  });

  it("rejects > 6 decimals", () => {
    expect(() => usdcToMicro("10.1234567")).toThrow(RangeError);
  });

  it("rejects negative or zero", () => {
    expect(() => usdcToMicro("0")).toThrow();
    expect(() => usdcToMicro("-5")).toThrow(RangeError);
  });

  it("trims trailing zeros in microToUsdc", () => {
    expect(microToUsdc(10_500_000n)).toBe("10.5");
    expect(microToUsdc(10_000_001n)).toBe("10.000001");
    expect(microToUsdc(0n)).toBe("0");
  });
});

describe("buildUsdcTransferIxs", () => {
  const sender = Keypair.generate().publicKey;
  const recipient = Keypair.generate().publicKey;
  const payer = Keypair.generate().publicKey;

  it("rejects zero or negative amount", async () => {
    await expect(
      buildUsdcTransferIxs({
        from: sender,
        to: recipient,
        amountMicroUsdc: 0n,
        mint: USDC_MINT_DEVNET,
        payer,
      })
    ).rejects.toThrow(/positive/);
  });

  it("emits 1 transfer instruction without connection probe (assumes ATA exists)", async () => {
    const result = await buildUsdcTransferIxs({
      from: sender,
      to: recipient,
      amountMicroUsdc: 1_000_000n,
      mint: USDC_MINT_DEVNET,
      payer,
      // no connection — skip probe
    });
    expect(result.instructions).toHaveLength(1);
    expect(result.createdRecipientAta).toBe(false);
    expect(result.senderAta).toBeInstanceOf(PublicKey);
    expect(result.recipientAta).toBeInstanceOf(PublicKey);
    expect(result.senderAta.equals(result.recipientAta)).toBe(false);
  });

  it("creates recipient ATA when probe returns null", async () => {
    let calls = 0;
    const fakeConnection = {
      async getAccountInfo(): Promise<null | unknown> {
        calls++;
        if (calls === 1) return null; // recipient ATA missing
        return { lamports: 2039280 }; // sender ATA exists
      },
    };
    const result = await buildUsdcTransferIxs({
      from: sender,
      to: recipient,
      amountMicroUsdc: 5_000_000n,
      mint: USDC_MINT_DEVNET,
      payer,
      connection: fakeConnection as unknown as import("@solana/web3.js").Connection,
    });
    expect(result.instructions).toHaveLength(2);
    expect(result.createdRecipientAta).toBe(true);
  });

  it("throws when sender ATA is missing", async () => {
    let calls = 0;
    const fakeConnection = {
      async getAccountInfo(): Promise<null | unknown> {
        calls++;
        if (calls === 1) return { lamports: 1 }; // recipient OK
        return null; // sender ATA missing
      },
    };
    await expect(
      buildUsdcTransferIxs({
        from: sender,
        to: recipient,
        amountMicroUsdc: 5_000_000n,
        mint: USDC_MINT_DEVNET,
        payer,
        connection: fakeConnection as unknown as import("@solana/web3.js").Connection,
      })
    ).rejects.toThrow(/Sender ATA/);
  });
});
