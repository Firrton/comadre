import { describe, it, expect } from "bun:test";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { buildUnsignedTx } from "../txBuilder";

const feePayer = Keypair.fromSecretKey(bs58.decode(process.env.FEE_PAYER_SK ?? ""));

class FakeConnection {
  rpcEndpoint = "http://localhost:0";
  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 };
  }
}

describe("buildUnsignedTx", () => {
  it("returns a base64 VersionedTransaction signed by the fee payer", async () => {
    const transferIx = SystemProgram.transfer({
      fromPubkey: feePayer.publicKey,
      toPubkey: PublicKey.unique(),
      lamports: 1,
    });

    const result = await buildUnsignedTx({
      instructions: [transferIx],
      connection: new FakeConnection() as unknown as Connection,
    });

    expect(result.unsignedTxBase64).toBeString();
    expect(result.recentBlockhash).toBe("11111111111111111111111111111111");
    expect(result.estimatedFeeLamports).toBeGreaterThan(0);

    // Roundtrip: deserialize and assert the fee payer is the first static account
    const tx = VersionedTransaction.deserialize(Buffer.from(result.unsignedTxBase64, "base64"));
    const payer = tx.message.staticAccountKeys[0];
    expect(payer?.toBase58()).toBe(feePayer.publicKey.toBase58());
  });

  it("prepends compute budget instructions and preserves user instruction order", async () => {
    const ix1 = new TransactionInstruction({
      keys: [],
      programId: PublicKey.unique(),
      data: Buffer.from([1, 2, 3]),
    });
    const ix2 = new TransactionInstruction({
      keys: [],
      programId: PublicKey.unique(),
      data: Buffer.from([4, 5, 6]),
    });

    const result = await buildUnsignedTx({
      instructions: [ix1, ix2],
      connection: new FakeConnection() as unknown as Connection,
    });

    const tx = VersionedTransaction.deserialize(Buffer.from(result.unsignedTxBase64, "base64"));
    // 2 compute-budget ixs + ix1 + ix2 = 4 total
    expect(tx.message.compiledInstructions.length).toBe(4);
  });
});
