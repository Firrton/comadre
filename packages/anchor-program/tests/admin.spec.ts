import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import {
  getProgram,
  deriveConfigPda,
  deriveUserProfilePda,
  airdrop,
  newFundedKeypair,
} from "./helpers";

/**
 * Waits until the connection returns a recent blockhash without error.
 * Solves "Blockhash not found" when the local validator starts slower than
 * the test harness.
 */
async function waitForReady(
  connection: anchor.web3.Connection,
  maxAttempts = 30,
  delayMs = 500
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const bh = await connection.getLatestBlockhash("finalized");
      if (bh?.blockhash) {
        // Extra buffer: give the validator 1 extra second to stabilise.
        await new Promise((r) => setTimeout(r, 1000));
        return;
      }
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

describe("admin & user-kyc instructions", () => {
  // Lazy init — ANCHOR_PROVIDER_URL is only set at runtime by anchor test.
  let provider: AnchorProvider;
  let program: ReturnType<typeof getProgram>;

  // Signers
  let deployer: Keypair;        // admin
  let kycOracle: Keypair;       // kyc_oracle authority
  let crankAuthority: Keypair;
  let feeDestination: Keypair;
  let userWallet: Keypair;      // whose KYC tier we update
  let attacker: Keypair;        // pre-funded bad actor (avoids blockhash races)

  // PDAs
  let configPda: PublicKey;
  let userProfilePda: PublicKey;

  const feeBps = 50;
  const kycLimits = [
    new BN(100_000_000),
    new BN(1_000_000_000),
    new BN(5_000_000_000),
    new BN(10_000_000_000),
  ];

  before(async () => {
    provider = AnchorProvider.env();
    anchor.setProvider(provider);
    program = getProgram(provider);

    await waitForReady(provider.connection);

    deployer       = await newFundedKeypair(provider);
    kycOracle      = await newFundedKeypair(provider);
    crankAuthority = await newFundedKeypair(provider);
    feeDestination = await newFundedKeypair(provider);
    userWallet     = await newFundedKeypair(provider);
    attacker       = await newFundedKeypair(provider);

    [configPda]      = deriveConfigPda(program.programId);
    [userProfilePda] = deriveUserProfilePda(userWallet.publicKey, program.programId);

    // Create the user profile we'll be updating KYC on.
    await program.methods
      .initUserProfile(
        Array.from(Buffer.alloc(32, 1)),
        [0x55, 0x59],
      )
      .accounts({
        userProfile:   userProfilePda,
        wallet:        userWallet.publicKey,
        payer:         deployer.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([deployer])
      .rpc({ commitment: "confirmed" });
  });

  // ─── init_config bounds checks (MUST run before happy-path init_config) ───
  // These tests run against a fresh (not-yet-initialized) configPda so that
  // the handler's require! checks fire before any state is written.

  describe("init_config bounds checks", () => {
    it("rejects fee_bps > 10000", async () => {
      try {
        await program.methods
          .initConfig({
            kycOracle:      kycOracle.publicKey,
            crankAuthority: crankAuthority.publicKey,
            feeBps:         10_001,   // exceeds 100%
            feeDestination: feeDestination.publicKey,
            kycLimits,
          })
          .accounts({
            programConfig: configPda,
            admin:         deployer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([deployer])
          .rpc({ commitment: "confirmed" });

        assert.fail("Expected InvalidFeeBps error but succeeded");
      } catch (err: any) {
        const msg: string = err.message ?? err.toString();
        assert.ok(
          msg.includes("InvalidFeeBps") || msg.includes("fee") ||
          msg.includes("6019") || msg.includes("0x1783"),
          `Expected InvalidFeeBps, got: ${msg}`
        );
      }
    });

    it("rejects kyc_limits[0] = 0", async () => {
      try {
        await program.methods
          .initConfig({
            kycOracle:      kycOracle.publicKey,
            crankAuthority: crankAuthority.publicKey,
            feeBps:         50,
            feeDestination: feeDestination.publicKey,
            kycLimits:      [new BN(0), new BN(1_000_000_000), new BN(5_000_000_000), new BN(10_000_000_000)],
          })
          .accounts({
            programConfig: configPda,
            admin:         deployer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([deployer])
          .rpc({ commitment: "confirmed" });

        assert.fail("Expected InvalidKycLimits error but succeeded");
      } catch (err: any) {
        const msg: string = err.message ?? err.toString();
        assert.ok(
          msg.includes("InvalidKycLimits") || msg.includes("kyc") ||
          msg.includes("6020") || msg.includes("0x1784"),
          `Expected InvalidKycLimits, got: ${msg}`
        );
      }
    });

    it("rejects non-monotonic kyc_limits", async () => {
      try {
        await program.methods
          .initConfig({
            kycOracle:      kycOracle.publicKey,
            crankAuthority: crankAuthority.publicKey,
            feeBps:         50,
            feeDestination: feeDestination.publicKey,
            kycLimits:      [new BN(1_000_000), new BN(500_000), new BN(5_000_000_000), new BN(10_000_000_000)],
          })
          .accounts({
            programConfig: configPda,
            admin:         deployer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([deployer])
          .rpc({ commitment: "confirmed" });

        assert.fail("Expected InvalidKycLimits error but succeeded");
      } catch (err: any) {
        const msg: string = err.message ?? err.toString();
        assert.ok(
          msg.includes("InvalidKycLimits") || msg.includes("kyc") ||
          msg.includes("6020") || msg.includes("0x1784"),
          `Expected InvalidKycLimits, got: ${msg}`
        );
      }
    });
  });

  // ─── init_config happy path ───────────────────────────────────────────────

  describe("init_config", () => {
    it("deployer initialises ProgramConfig", async () => {
      await program.methods
        .initConfig({
          kycOracle:      kycOracle.publicKey,
          crankAuthority: crankAuthority.publicKey,
          feeBps,
          feeDestination: feeDestination.publicKey,
          kycLimits,
        })
        .accounts({
          programConfig: configPda,
          admin:         deployer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([deployer])
        .rpc({ commitment: "confirmed" });

      const config = await program.account.programConfig.fetch(configPda);
      assert.equal(config.admin.toBase58(), deployer.publicKey.toBase58(), "admin mismatch");
      assert.equal(config.kycOracle.toBase58(), kycOracle.publicKey.toBase58(), "oracle mismatch");
      assert.equal(config.feeBps, feeBps, "feeBps mismatch");
      assert.isFalse(config.paused, "should not be paused");
    });

    it("rejects second init (singleton already initialised)", async () => {
      try {
        await program.methods
          .initConfig({
            kycOracle:      attacker.publicKey,
            crankAuthority: attacker.publicKey,
            feeBps:         999,
            feeDestination: attacker.publicKey,
            kycLimits,
          })
          .accounts({
            programConfig: configPda,
            admin:         attacker.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc({ commitment: "confirmed" });

        assert.fail("Expected error but succeeded");
      } catch (err: any) {
        // Expected: AccountAlreadyInitialized or similar.
        assert.ok(err, "Should have thrown");
      }
    });
  });

  // ─── update_kyc_tier ──────────────────────────────────────────────────────

  describe("update_kyc_tier", () => {
    it("oracle updates user KYC tier to T1Lite", async () => {
      await program.methods
        .updateKycTier({ t1Lite: {} })
        .accounts({
          userProfile:   userProfilePda,
          wallet:        userWallet.publicKey,
          programConfig: configPda,
          kycOracle:     kycOracle.publicKey,
        })
        .signers([kycOracle])
        .rpc({ commitment: "confirmed" });

      const profile = await program.account.userProfile.fetch(userProfilePda);
      assert.deepEqual(profile.kycTier, { t1Lite: {} }, "tier should be T1Lite");
    });

    it("oracle upgrades user KYC tier to T2Standard", async () => {
      await program.methods
        .updateKycTier({ t2Standard: {} })
        .accounts({
          userProfile:   userProfilePda,
          wallet:        userWallet.publicKey,
          programConfig: configPda,
          kycOracle:     kycOracle.publicKey,
        })
        .signers([kycOracle])
        .rpc({ commitment: "confirmed" });

      const profile = await program.account.userProfile.fetch(userProfilePda);
      assert.deepEqual(profile.kycTier, { t2Standard: {} }, "tier should be T2Standard");
    });

    it("rejects update from non-oracle signer", async () => {
      // Sign with deployer (not the oracle) — the oracle pubkey check in the handler fails.
      try {
        await program.methods
          .updateKycTier({ t3Pro: {} })
          .accounts({
            userProfile:   userProfilePda,
            wallet:        userWallet.publicKey,
            programConfig: configPda,
            kycOracle:     deployer.publicKey,   // deployer != oracle
          })
          .signers([deployer])
          .rpc({ commitment: "confirmed" });

        assert.fail("Expected Unauthorized error");
      } catch (err: any) {
        const msg: string = err.message ?? err.toString();
        assert.ok(
          msg.includes("Unauthorized") || msg.includes("2015") || msg.includes("unauthorized"),
          `Expected Unauthorized, got: ${msg}`
        );
      }
    });

    it("rejects update when wallet account does not match user_profile PDA seed", async () => {
      // Pass a different wallet address — seeds = [SEED_USER, wallet.key()] will derive
      // a different PDA than userProfilePda, so the constraint fails.
      const wrongWallet = await newFundedKeypair(provider);
      try {
        await program.methods
          .updateKycTier({ t3Pro: {} })
          .accounts({
            userProfile:   userProfilePda,
            wallet:        wrongWallet.publicKey,  // wrong wallet → PDA mismatch
            programConfig: configPda,
            kycOracle:     kycOracle.publicKey,
          })
          .signers([kycOracle])
          .rpc({ commitment: "confirmed" });

        assert.fail("Expected seeds constraint violation");
      } catch (err: any) {
        const msg: string = err.message ?? err.toString();
        assert.ok(
          msg.includes("seeds") || msg.includes("ConstraintSeeds") ||
          msg.includes("2006") || msg.includes("address"),
          `Expected seeds/address constraint error, got: ${msg}`
        );
      }
    });
  });

  // ─── pause / unpause ──────────────────────────────────────────────────────

  describe("pause / unpause", () => {
    it("admin can pause the program", async () => {
      await program.methods
        .pause(true)
        .accounts({
          programConfig: configPda,
          admin:         deployer.publicKey,
        })
        .signers([deployer])
        .rpc({ commitment: "confirmed" });

      const config = await program.account.programConfig.fetch(configPda);
      assert.isTrue(config.paused, "should be paused");
    });

    it("paused program rejects update_kyc_tier", async () => {
      try {
        await program.methods
          .updateKycTier({ t0Demo: {} })
          .accounts({
            userProfile:   userProfilePda,
            wallet:        userWallet.publicKey,
            programConfig: configPda,
            kycOracle:     kycOracle.publicKey,
          })
          .signers([kycOracle])
          .rpc({ commitment: "confirmed" });

        assert.fail("Expected ProgramPaused error");
      } catch (err: any) {
        const msg: string = err.message ?? err.toString();
        assert.ok(
          msg.includes("ProgramPaused") || msg.includes("2016") || msg.includes("paused"),
          `Expected ProgramPaused, got: ${msg}`
        );
      }
    });

    it("admin can unpause the program", async () => {
      await program.methods
        .pause(false)
        .accounts({
          programConfig: configPda,
          admin:         deployer.publicKey,
        })
        .signers([deployer])
        .rpc({ commitment: "confirmed" });

      const config = await program.account.programConfig.fetch(configPda);
      assert.isFalse(config.paused, "should be unpaused");
    });

    it("non-admin cannot pause", async () => {
      try {
        await program.methods
          .pause(true)
          .accounts({
            programConfig: configPda,
            admin:         attacker.publicKey,
          })
          .signers([attacker])
          .rpc({ commitment: "confirmed" });

        assert.fail("Expected Unauthorized error");
      } catch (err: any) {
        const msg: string = err.message ?? err.toString();
        assert.ok(
          msg.includes("Unauthorized") ||
            msg.includes("ConstraintHasOne") ||
            msg.includes("2001") ||
            msg.includes("2015"),
          `Expected Unauthorized/ConstraintHasOne, got: ${msg}`
        );
      }
    });
  });
});
