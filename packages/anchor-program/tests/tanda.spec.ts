/**
 * tanda.spec.ts — E2E lifecycle tests for the Comadre tanda flow.
 *
 * ISOLATION NOTE: This spec initialises its own ProgramConfig in the `before`
 * block with `try/catch`.  If another spec (e.g. admin.spec.ts) has already
 * initialised the singleton config on the same validator, `initConfig` will
 * throw "already in use".  In that case payout tests require controlling the
 * crank_authority keypair — if the config was init'd externally, those tests
 * will be skipped.
 *
 * To run in full isolation:
 *   cd packages/anchor-program && anchor test --skip-build -- --grep "tanda"
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";

import {
  getProvider,
  getProgram,
  airdrop,
  newFundedKeypair,
  deriveConfigPda,
  deriveUserProfilePda,
  deriveTandaPda,
  deriveMemberPda,
  deriveVaultPda,
  createUsdcMint,
  createUsdcAta,
  mintUsdcTo,
} from "./helpers";

// ─── Helper: wait for localnet to stabilise ────────────────────────────────────
async function waitForReady(
  connection: anchor.web3.Connection,
  maxAttempts = 30,
  delayMs = 500
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const bh = await connection.getLatestBlockhash("finalized");
      if (bh?.blockhash) {
        await new Promise((r) => setTimeout(r, 1000));
        return;
      }
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

// ─── Helper: warp localnet clock ──────────────────────────────────────────────
/**
 * Advances the localnet test-validator clock to `unixTimestamp`.
 * Uses the undocumented `setTime` admin JSON-RPC method that solana-test-validator
 * exposes. Silently skips if the validator doesn't support it.
 */
async function warpClock(
  connection: anchor.web3.Connection,
  unixTimestamp: number
): Promise<void> {
  try {
    // _rpcRequest is an internal helper on the Connection object
    await (connection as any)._rpcRequest("setTime", [unixTimestamp]);
  } catch {
    console.warn(`[warpClock] setTime RPC failed — PayoutNotReady guard may block payout`);
  }
  await new Promise((r) => setTimeout(r, 400));
}

// ─── Tanda test suite ─────────────────────────────────────────────────────────

describe("tanda lifecycle", () => {
  const provider: AnchorProvider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = getProgram(provider);

  // ── Signers / actors ────────────────────────────────────────────────────────
  let deployer: Keypair;
  let kycOracle: Keypair;
  let crankAuthority: Keypair;

  // 5 members: index 0 is the creator, indices 1-4 are joiners
  const MEMBER_TARGET = 5;
  let members: Keypair[]      = [];
  let memberProfiles: PublicKey[] = [];
  let memberAtas: PublicKey[]  = [];

  // Tanda parameters
  const CONTRIBUTION_AMOUNT = 1_000_000;  // 1 USDC (6 decimals)
  const STAKE_AMOUNT        = 1_000_000;  // 1 USDC
  // Use a 1-second interval on localnet so payout tests don't need clock manipulation.
  // The create_tanda handler skips the 86400-second floor when feature = "localnet".
  const FREQUENCY_SECONDS   = 1;
  const TANDA_ID            = new BN(1);
  // Each member needs: stake(1) + 5 contributions(5) + buffer(10) = 16 USDC
  const USDC_PER_MEMBER     = 20_000_000; // 20 USDC

  // PDAs
  let configPda: PublicKey;
  let usdcMint: PublicKey;
  let tandaPda: PublicKey;
  let vaultPda: PublicKey;

  // Whether this spec successfully initialised the config (i.e., controls crankAuthority)
  let ownedConfig = false;

  // ── before: provision everything ────────────────────────────────────────────
  before(async () => {
    await waitForReady(provider.connection);

    deployer       = await newFundedKeypair(provider);
    kycOracle      = await newFundedKeypair(provider);
    crankAuthority = await newFundedKeypair(provider);

    [configPda] = deriveConfigPda(program.programId);

    // Real SPL USDC mint (mint authority = deployer)
    usdcMint = await createUsdcMint(provider, deployer, deployer.publicKey);

    // Attempt to initialise singleton ProgramConfig.
    // Another spec (admin.spec.ts) may have already done so.
    try {
      await program.methods
        .initConfig({
          kycOracle:      kycOracle.publicKey,
          crankAuthority: crankAuthority.publicKey,
          feeBps:         0,
          feeDestination: deployer.publicKey,
          kycLimits: [
            new BN(100_000_000),    // T0Demo: 100 USDC
            new BN(1_000_000_000),  // T1Lite: 1 000 USDC
            new BN(5_000_000_000),  // T2Standard: 5 000 USDC
            new BN(10_000_000_000), // T3Pro: 10 000 USDC
          ],
        })
        .accounts({
          programConfig: configPda,
          admin:         deployer.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([deployer])
        .rpc({ commitment: "confirmed" });
      ownedConfig = true;
    } catch {
      console.warn("[tanda.spec] initConfig skipped — already init by another spec. " +
                   "payout/complete/paused tests will be skipped.");
    }

    // Create 5 member keypairs, profiles, and fund their USDC ATAs
    for (let i = 0; i < MEMBER_TARGET; i++) {
      const kp = await newFundedKeypair(provider);
      members.push(kp);

      const [profilePda] = deriveUserProfilePda(kp.publicKey, program.programId);
      memberProfiles.push(profilePda);

      // Init profile (payer = deployer to avoid each member needing SOL for rent)
      await program.methods
        .initUserProfile(
          Array.from(Buffer.alloc(32, i + 1)),
          [0x4d, 0x58], // "MX"
        )
        .accounts({
          userProfile:   profilePda,
          wallet:        kp.publicKey,
          payer:         deployer.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        // wallet must co-sign to prevent impersonation (CRIT-1 fix)
        .signers([deployer, kp])
        .rpc({ commitment: "confirmed" });

      // Upgrade to T1Lite so they can create/join tandas (only if we own the config)
      if (ownedConfig) {
        await program.methods
          .updateKycTier({ t1Lite: {} })
          .accounts({
            userProfile:   profilePda,
            wallet:        kp.publicKey,
            programConfig: configPda,
            kycOracle:     kycOracle.publicKey,
          } as any)
          .signers([kycOracle])
          .rpc({ commitment: "confirmed" });
      }

      // Create USDC ATA and fund with test USDC
      const ata = await createUsdcAta(provider, deployer, usdcMint, kp.publicKey);
      memberAtas.push(ata);
      await mintUsdcTo(provider, deployer, usdcMint, ata, deployer, USDC_PER_MEMBER);
    }

    // Derive tanda and vault PDAs (creator = members[0])
    [tandaPda] = deriveTandaPda(members[0]!.publicKey, TANDA_ID, program.programId);
    [vaultPda] = deriveVaultPda(tandaPda, program.programId);
  });

  // ── create_tanda ─────────────────────────────────────────────────────────────

  describe("create_tanda", () => {
    it("creator initialises a Tanda in Forming state", async function () {
      if (!ownedConfig) return this.skip();

      await program.methods
        .createTanda({
          tandaId:            TANDA_ID,
          nameHash:           Array.from(Buffer.alloc(32, 0xab)),
          memberTarget:       MEMBER_TARGET,
          contributionAmount: new BN(CONTRIBUTION_AMOUNT),
          stakeAmount:        new BN(STAKE_AMOUNT),
          frequencySeconds:   FREQUENCY_SECONDS,
          payoutOrderMode:    { joinOrder: {} },
        })
        .accounts({
          creator:         members[0]!.publicKey,
          creatorProfile:  memberProfiles[0]!,
          programConfig:   configPda,
          tanda:           tandaPda,
          vault:           vaultPda,
          usdcMint,
          tokenProgram:    TOKEN_PROGRAM_ID,
          systemProgram:   SystemProgram.programId,
          rent:            SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      const tanda = await program.account.tanda.fetch(tandaPda);
      assert.deepEqual(tanda.state, { forming: {} }, "state should be Forming");
      assert.equal(tanda.memberCurrent, 0, "no members yet");
      assert.equal(tanda.memberTarget, MEMBER_TARGET);
      assert.equal(tanda.contributionAmount.toNumber(), CONTRIBUTION_AMOUNT);
      assert.equal(tanda.stakeAmount.toNumber(), STAKE_AMOUNT);
    });

    it("rejects member_target < 3 with InvalidMemberCount", async function () {
      if (!ownedConfig) return this.skip();
      const badId = new BN(99);
      const [badTanda] = deriveTandaPda(members[0]!.publicKey, badId, program.programId);
      const [badVault] = deriveVaultPda(badTanda, program.programId);

      try {
        await program.methods
          .createTanda({
            tandaId:            badId,
            nameHash:           Array.from(Buffer.alloc(32, 1)),
            memberTarget:       2,
            contributionAmount: new BN(CONTRIBUTION_AMOUNT),
            stakeAmount:        new BN(STAKE_AMOUNT),
            frequencySeconds:   FREQUENCY_SECONDS,
            payoutOrderMode:    { joinOrder: {} },
          })
          .accounts({
            creator:         members[0]!.publicKey,
            creatorProfile:  memberProfiles[0]!,
            programConfig:   configPda,
            tanda:           badTanda,
            vault:           badVault,
            usdcMint,
            tokenProgram:    TOKEN_PROGRAM_ID,
            systemProgram:   SystemProgram.programId,
            rent:            SYSVAR_RENT_PUBKEY,
          } as any)
          .signers([members[0]!])
          .rpc({ commitment: "confirmed" });
        assert.fail("Expected InvalidMemberCount");
      } catch (err: any) {
        const msg = String(err.message ?? err);
        assert.ok(
          msg.includes("InvalidMemberCount") || msg.includes("6005"),
          `Expected InvalidMemberCount, got: ${msg}`
        );
      }
    });
  });

  // ── join_tanda ────────────────────────────────────────────────────────────────

  describe("join_tanda", () => {
    it("4 joiners + creator join (all 5 members, turns 1-5 via JoinOrder)", async function () {
      if (!ownedConfig) return this.skip();

      // Joiners 1-4 join first (turns 1-4 in JoinOrder)
      for (let i = 1; i < MEMBER_TARGET; i++) {
        const [memberPda] = deriveMemberPda(tandaPda, members[i]!.publicKey, program.programId);
        await program.methods
          .joinTanda(0) // JoinOrder auto-assigns turn
          .accounts({
            user:           members[i]!.publicKey,
            userProfile:    memberProfiles[i]!,
            programConfig:  configPda,
            tanda:          tandaPda,
            member:         memberPda,
            userUsdcAta:    memberAtas[i]!,
            vault:          vaultPda,
            usdcMint,
            tokenProgram:   TOKEN_PROGRAM_ID,
            systemProgram:  SystemProgram.programId,
          } as any)
          .signers([members[i]!])
          .rpc({ commitment: "confirmed" });
      }

      // Creator (members[0]) joins as 5th member (turn 5)
      const [creatorMember] = deriveMemberPda(tandaPda, members[0]!.publicKey, program.programId);
      await program.methods
        .joinTanda(0)
        .accounts({
          user:           members[0]!.publicKey,
          userProfile:    memberProfiles[0]!,
          programConfig:  configPda,
          tanda:          tandaPda,
          member:         creatorMember,
          userUsdcAta:    memberAtas[0]!,
          vault:          vaultPda,
          usdcMint,
          tokenProgram:   TOKEN_PROGRAM_ID,
          systemProgram:  SystemProgram.programId,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      const tanda = await program.account.tanda.fetch(tandaPda);
      assert.equal(tanda.memberCurrent, MEMBER_TARGET, "all 5 members joined");
    });

    it("rejects 6th member with TandaFull", async function () {
      if (!ownedConfig) return this.skip();

      const extra = await newFundedKeypair(provider);
      const [extraProfile] = deriveUserProfilePda(extra.publicKey, program.programId);

      await program.methods
        .initUserProfile(Array.from(Buffer.alloc(32, 0xfe)), [0x4d, 0x58])
        .accounts({
          userProfile:   extraProfile,
          wallet:        extra.publicKey,
          payer:         deployer.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([deployer])
        .rpc({ commitment: "confirmed" });

      await program.methods
        .updateKycTier({ t1Lite: {} })
        .accounts({
          userProfile:   extraProfile,
          wallet:        extra.publicKey,
          programConfig: configPda,
          kycOracle:     kycOracle.publicKey,
        } as any)
        .signers([kycOracle])
        .rpc({ commitment: "confirmed" });

      const extraAta = await createUsdcAta(provider, deployer, usdcMint, extra.publicKey);
      await mintUsdcTo(provider, deployer, usdcMint, extraAta, deployer, USDC_PER_MEMBER);
      const [extraMember] = deriveMemberPda(tandaPda, extra.publicKey, program.programId);

      try {
        await program.methods
          .joinTanda(0)
          .accounts({
            user:           extra.publicKey,
            userProfile:    extraProfile,
            programConfig:  configPda,
            tanda:          tandaPda,
            member:         extraMember,
            userUsdcAta:    extraAta,
            vault:          vaultPda,
            usdcMint,
            tokenProgram:   TOKEN_PROGRAM_ID,
            systemProgram:  SystemProgram.programId,
          } as any)
          .signers([extra])
          .rpc({ commitment: "confirmed" });
        assert.fail("Expected TandaFull");
      } catch (err: any) {
        const msg = String(err.message ?? err);
        assert.ok(
          msg.includes("TandaFull") || msg.includes("6004"),
          `Expected TandaFull, got: ${msg}`
        );
      }
    });
  });

  // ── start_tanda ───────────────────────────────────────────────────────────────

  describe("start_tanda", () => {
    it("creator starts the tanda (all 5 members already joined)", async function () {
      if (!ownedConfig) return this.skip();

      // All 5 members joined in the previous join_tanda test. Creator starts.
      const tandaBefore = await program.account.tanda.fetch(tandaPda);
      assert.equal(tandaBefore.memberCurrent, MEMBER_TARGET, "tanda must be full to start");

      await program.methods
        .startTanda()
        .accounts({
          creator:       members[0]!.publicKey,
          tanda:         tandaPda,
          programConfig: configPda,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      const tanda = await program.account.tanda.fetch(tandaPda);
      assert.deepEqual(tanda.state, { active: {} }, "state should be Active");
      assert.equal(tanda.currentTurn, 1, "current_turn starts at 1");
      assert.isAbove(tanda.nextPayoutTs.toNumber(), 0, "next_payout_ts set");
    });
  });

  // ── contribute ────────────────────────────────────────────────────────────────

  describe("contribute", () => {
    it("rejects contribution on a Forming tanda with TandaNotActive", async function () {
      if (!ownedConfig) return this.skip();

      // Create a second tanda (still Forming) for this negative test
      const formingId = new BN(998);
      const [formingTanda] = deriveTandaPda(members[0]!.publicKey, formingId, program.programId);
      const [formingVault] = deriveVaultPda(formingTanda, program.programId);

      await program.methods
        .createTanda({
          tandaId:            formingId,
          nameHash:           Array.from(Buffer.alloc(32, 2)),
          memberTarget:       MEMBER_TARGET,
          contributionAmount: new BN(CONTRIBUTION_AMOUNT),
          stakeAmount:        new BN(STAKE_AMOUNT),
          frequencySeconds:   FREQUENCY_SECONDS,
          payoutOrderMode:    { joinOrder: {} },
        })
        .accounts({
          creator:         members[0]!.publicKey,
          creatorProfile:  memberProfiles[0]!,
          programConfig:   configPda,
          tanda:           formingTanda,
          vault:           formingVault,
          usdcMint,
          tokenProgram:    TOKEN_PROGRAM_ID,
          systemProgram:   SystemProgram.programId,
          rent:            SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      // Creator joins the forming tanda to get a member PDA
      const [formingCreatorMember] = deriveMemberPda(formingTanda, members[0]!.publicKey, program.programId);
      await program.methods
        .joinTanda(0)
        .accounts({
          user:           members[0]!.publicKey,
          userProfile:    memberProfiles[0]!,
          programConfig:  configPda,
          tanda:          formingTanda,
          member:         formingCreatorMember,
          userUsdcAta:    memberAtas[0]!,
          vault:          formingVault,
          usdcMint,
          tokenProgram:   TOKEN_PROGRAM_ID,
          systemProgram:  SystemProgram.programId,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      try {
        await program.methods
          .contribute()
          .accounts({
            user:          members[0]!.publicKey,
            member:        formingCreatorMember,
            tanda:         formingTanda,
            programConfig: configPda,
            userUsdcAta:   memberAtas[0]!,
            vault:         formingVault,
            usdcMint,
            tokenProgram:  TOKEN_PROGRAM_ID,
          } as any)
          .signers([members[0]!])
          .rpc({ commitment: "confirmed" });
        assert.fail("Expected TandaNotActive");
      } catch (err: any) {
        const msg = String(err.message ?? err);
        assert.ok(
          msg.includes("TandaNotActive") || msg.includes("6002"),
          `Expected TandaNotActive, got: ${msg}`
        );
      }
    });

    it("all 5 members contribute for turn 1", async function () {
      if (!ownedConfig) return this.skip();

      for (let i = 0; i < MEMBER_TARGET; i++) {
        const [memberPda] = deriveMemberPda(tandaPda, members[i]!.publicKey, program.programId);
        await program.methods
          .contribute()
          .accounts({
            user:          members[i]!.publicKey,
            member:        memberPda,
            tanda:         tandaPda,
            programConfig: configPda,
            userUsdcAta:   memberAtas[i]!,
            vault:         vaultPda,
            usdcMint,
            tokenProgram:  TOKEN_PROGRAM_ID,
          } as any)
          .signers([members[i]!])
          .rpc({ commitment: "confirmed" });
      }

      // Vault holds: 5 stakes (from join) + 5 contributions (turn 1) = 10 USDC
      const vaultBalance = await provider.connection.getTokenAccountBalance(vaultPda);
      const expected = STAKE_AMOUNT * MEMBER_TARGET + CONTRIBUTION_AMOUNT * MEMBER_TARGET;
      assert.equal(
        Number(vaultBalance.value.amount),
        expected,
        "vault should hold stakes + turn-1 contributions"
      );
    });
  });

  // ── payout ────────────────────────────────────────────────────────────────────

  describe("payout", () => {
    it("rejects payout before next_payout_ts with PayoutNotReady", async function () {
      if (!ownedConfig) return this.skip();

      // Create a dedicated tanda with a LARGE frequency (9999s) so next_payout_ts
      // is always far in the future, making this test timing-independent.
      const notReadyId = new BN(9001);
      const [notReadyTanda] = deriveTandaPda(members[0]!.publicKey, notReadyId, program.programId);
      const [notReadyVault] = deriveVaultPda(notReadyTanda, program.programId);
      const LARGE_FREQUENCY = 9999;

      await program.methods
        .createTanda({
          tandaId:            notReadyId,
          nameHash:           Array.from(Buffer.alloc(32, 0x42)),
          memberTarget:       3,
          contributionAmount: new BN(CONTRIBUTION_AMOUNT),
          stakeAmount:        new BN(STAKE_AMOUNT),
          frequencySeconds:   LARGE_FREQUENCY,
          payoutOrderMode:    { joinOrder: {} },
        })
        .accounts({
          creator:         members[0]!.publicKey,
          creatorProfile:  memberProfiles[0]!,
          programConfig:   configPda,
          tanda:           notReadyTanda,
          vault:           notReadyVault,
          usdcMint,
          tokenProgram:    TOKEN_PROGRAM_ID,
          systemProgram:   SystemProgram.programId,
          rent:            SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      // 3 members join
      for (let i = 0; i < 3; i++) {
        const [mp] = deriveMemberPda(notReadyTanda, members[i]!.publicKey, program.programId);
        await program.methods.joinTanda(0)
          .accounts({
            user:           members[i]!.publicKey,
            userProfile:    memberProfiles[i]!,
            programConfig:  configPda,
            tanda:          notReadyTanda,
            member:         mp,
            userUsdcAta:    memberAtas[i]!,
            vault:          notReadyVault,
            usdcMint,
            tokenProgram:   TOKEN_PROGRAM_ID,
            systemProgram:  SystemProgram.programId,
          } as any)
          .signers([members[i]!])
          .rpc({ commitment: "confirmed" });
      }

      // Start the tanda — next_payout_ts = now + 9999s (far future)
      await program.methods.startTanda()
        .accounts({
          creator:       members[0]!.publicKey,
          tanda:         notReadyTanda,
          programConfig: configPda,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      // Find turn-1 beneficiary
      let beneficiaryIdx = 0;
      for (let i = 0; i < 3; i++) {
        const [mp] = deriveMemberPda(notReadyTanda, members[i]!.publicKey, program.programId);
        const m = await program.account.member.fetch(mp);
        if (m.turnNumber === 1) { beneficiaryIdx = i; break; }
      }
      const [benMemberPda] = deriveMemberPda(notReadyTanda, members[beneficiaryIdx]!.publicKey, program.programId);

      let threw = false;
      try {
        await program.methods
          .payout()
          .accounts({
            crank:              crankAuthority.publicKey,
            tanda:              notReadyTanda,
            programConfig:      configPda,
            beneficiaryMember:  benMemberPda,
            beneficiaryUsdcAta: memberAtas[beneficiaryIdx]!,
            vault:              notReadyVault,
            usdcMint,
            tokenProgram:       TOKEN_PROGRAM_ID,
          } as any)
          .signers([crankAuthority])
          .rpc({ commitment: "confirmed" });
      } catch (err: any) {
        threw = true;
        const msg = String(err.message ?? err);
        assert.ok(
          msg.includes("PayoutNotReady") || msg.includes("6008"),
          `Expected PayoutNotReady, got: ${msg}`
        );
      }
      assert.isTrue(threw, "Expected PayoutNotReady error but payout succeeded");
    });

    it("executes 5 turns of payout using clock warp (E2E happy path)", async function () {
      if (!ownedConfig) return this.skip();
      this.timeout(120_000); // allow time for 5 rounds

      for (let turn = 1; turn <= MEMBER_TARGET; turn++) {
        // Wait for next_payout_ts (frequency = 1s on localnet, so 1.5s is sufficient).
        // On mainnet frequency is 86400s and would require clock manipulation (VRF/warp).
        const tandaState = await program.account.tanda.fetch(tandaPda);
        const nextTs = tandaState.nextPayoutTs.toNumber();
        const nowTs  = Math.floor(Date.now() / 1000);
        const waitMs = Math.max(0, (nextTs - nowTs + 1) * 1000);
        if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

        // Find beneficiary for this turn
        let beneficiaryIdx = -1;
        for (let i = 0; i < MEMBER_TARGET; i++) {
          const [mp] = deriveMemberPda(tandaPda, members[i]!.publicKey, program.programId);
          const m = await program.account.member.fetch(mp);
          if (m.turnNumber === turn) { beneficiaryIdx = i; break; }
        }
        assert.isAbove(beneficiaryIdx, -1, `No member for turn ${turn}`);

        const [benMemberPda] = deriveMemberPda(
          tandaPda, members[beneficiaryIdx]!.publicKey, program.programId
        );

        // Contribute for turns 2+ (turn 1 was already contributed above)
        if (turn > 1) {
          for (let i = 0; i < MEMBER_TARGET; i++) {
            const [mp] = deriveMemberPda(tandaPda, members[i]!.publicKey, program.programId);
            await program.methods
              .contribute()
              .accounts({
                user:          members[i]!.publicKey,
                member:        mp,
                tanda:         tandaPda,
                programConfig: configPda,
                userUsdcAta:   memberAtas[i]!,
                vault:         vaultPda,
                usdcMint,
                tokenProgram:  TOKEN_PROGRAM_ID,
              } as any)
              .signers([members[i]!])
              .rpc({ commitment: "confirmed" });
          }
        }

        // Execute payout
        await program.methods
          .payout()
          .accounts({
            crank:              crankAuthority.publicKey,
            tanda:              tandaPda,
            programConfig:      configPda,
            beneficiaryMember:  benMemberPda,
            beneficiaryUsdcAta: memberAtas[beneficiaryIdx]!,
            vault:              vaultPda,
            usdcMint,
            tokenProgram:       TOKEN_PROGRAM_ID,
          } as any)
          .signers([crankAuthority])
          .rpc({ commitment: "confirmed" });

        const updatedMember = await program.account.member.fetch(benMemberPda);
        assert.isTrue(updatedMember.hasReceivedPayout, `turn ${turn} beneficiary should be marked paid`);

        const updatedTanda = await program.account.tanda.fetch(tandaPda);
        if (turn < MEMBER_TARGET) {
          assert.equal(updatedTanda.currentTurn, turn + 1, `current_turn should advance`);
          assert.deepEqual(updatedTanda.state, { active: {} }, "still Active mid-cycle");
        } else {
          assert.deepEqual(updatedTanda.state, { completed: {} }, "Completed after last payout");
        }
      }
    });
  });

  // ── complete_tanda ────────────────────────────────────────────────────────────

  describe("complete_tanda", () => {
    it("completes successfully (state already Completed after last payout)", async function () {
      if (!ownedConfig) return this.skip();

      const tanda = await program.account.tanda.fetch(tandaPda);
      assert.deepEqual(tanda.state, { completed: {} }, "tanda must be Completed already");
      assert.isAbove(tanda.currentTurn, tanda.totalTurns, "current_turn > total_turns");

      // complete_tanda is idempotent for Completed+exhausted state
      await program.methods
        .completeTanda()
        .accounts({
          crank:         crankAuthority.publicKey,
          tanda:         tandaPda,
          programConfig: configPda,
        } as any)
        .signers([crankAuthority])
        .rpc({ commitment: "confirmed" });

      const after = await program.account.tanda.fetch(tandaPda);
      assert.deepEqual(after.state, { completed: {} });
    });
  });

  // ── security / negative-path tests ───────────────────────────────────────────

  describe("security guards", () => {
    // ── start_tanda: rejects non-JoinOrder modes ────────────────────────────

    it("start_tanda rejects CreatorSet mode with NotImplemented", async function () {
      if (!ownedConfig) return this.skip();

      const csId = new BN(3001);
      const [csTanda] = deriveTandaPda(members[0]!.publicKey, csId, program.programId);
      const [csVault] = deriveVaultPda(csTanda, program.programId);

      // Create a tanda with CreatorSet mode
      await program.methods
        .createTanda({
          tandaId:            csId,
          nameHash:           Array.from(Buffer.alloc(32, 0x31)),
          memberTarget:       3,
          contributionAmount: new BN(CONTRIBUTION_AMOUNT),
          stakeAmount:        new BN(STAKE_AMOUNT),
          frequencySeconds:   FREQUENCY_SECONDS,
          payoutOrderMode:    { creatorSet: {} },
        })
        .accounts({
          creator:         members[0]!.publicKey,
          creatorProfile:  memberProfiles[0]!,
          programConfig:   configPda,
          tanda:           csTanda,
          vault:           csVault,
          usdcMint,
          tokenProgram:    TOKEN_PROGRAM_ID,
          systemProgram:   SystemProgram.programId,
          rent:            SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      // Fill to 3 members — turn_number is ignored in JoinOrder but required; pass 0
      for (let i = 0; i < 3; i++) {
        const [mp] = deriveMemberPda(csTanda, members[i]!.publicKey, program.programId);
        await program.methods.joinTanda(i + 1)
          .accounts({
            user:           members[i]!.publicKey,
            userProfile:    memberProfiles[i]!,
            programConfig:  configPda,
            tanda:          csTanda,
            member:         mp,
            userUsdcAta:    memberAtas[i]!,
            vault:          csVault,
            usdcMint,
            tokenProgram:   TOKEN_PROGRAM_ID,
            systemProgram:  SystemProgram.programId,
          } as any)
          .signers([members[i]!])
          .rpc({ commitment: "confirmed" });
      }

      try {
        await program.methods
          .startTanda()
          .accounts({
            creator:       members[0]!.publicKey,
            tanda:         csTanda,
            programConfig: configPda,
          } as any)
          .signers([members[0]!])
          .rpc({ commitment: "confirmed" });
        assert.fail("Expected NotImplemented");
      } catch (err: any) {
        const msg = String(err.message ?? err);
        assert.ok(
          msg.includes("NotImplemented") || msg.includes("6024"),
          `Expected NotImplemented, got: ${msg}`
        );
      }
    });

    it("start_tanda rejects Random mode with NotImplemented", async function () {
      if (!ownedConfig) return this.skip();

      const rndId = new BN(3002);
      const [rndTanda] = deriveTandaPda(members[0]!.publicKey, rndId, program.programId);
      const [rndVault] = deriveVaultPda(rndTanda, program.programId);

      await program.methods
        .createTanda({
          tandaId:            rndId,
          nameHash:           Array.from(Buffer.alloc(32, 0x32)),
          memberTarget:       3,
          contributionAmount: new BN(CONTRIBUTION_AMOUNT),
          stakeAmount:        new BN(STAKE_AMOUNT),
          frequencySeconds:   FREQUENCY_SECONDS,
          payoutOrderMode:    { random: {} },
        })
        .accounts({
          creator:         members[0]!.publicKey,
          creatorProfile:  memberProfiles[0]!,
          programConfig:   configPda,
          tanda:           rndTanda,
          vault:           rndVault,
          usdcMint,
          tokenProgram:    TOKEN_PROGRAM_ID,
          systemProgram:   SystemProgram.programId,
          rent:            SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      for (let i = 0; i < 3; i++) {
        const [mp] = deriveMemberPda(rndTanda, members[i]!.publicKey, program.programId);
        await program.methods.joinTanda(i + 1)
          .accounts({
            user:           members[i]!.publicKey,
            userProfile:    memberProfiles[i]!,
            programConfig:  configPda,
            tanda:          rndTanda,
            member:         mp,
            userUsdcAta:    memberAtas[i]!,
            vault:          rndVault,
            usdcMint,
            tokenProgram:   TOKEN_PROGRAM_ID,
            systemProgram:  SystemProgram.programId,
          } as any)
          .signers([members[i]!])
          .rpc({ commitment: "confirmed" });
      }

      try {
        await program.methods
          .startTanda()
          .accounts({
            creator:       members[0]!.publicKey,
            tanda:         rndTanda,
            programConfig: configPda,
          } as any)
          .signers([members[0]!])
          .rpc({ commitment: "confirmed" });
        assert.fail("Expected NotImplemented");
      } catch (err: any) {
        const msg = String(err.message ?? err);
        assert.ok(
          msg.includes("NotImplemented") || msg.includes("6024"),
          `Expected NotImplemented, got: ${msg}`
        );
      }
    });

    it("start_tanda rejects non-creator with NotCreator", async function () {
      if (!ownedConfig) return this.skip();

      // Create a fresh tanda so it is still in Forming state
      const ncId = new BN(3003);
      const [ncTanda] = deriveTandaPda(members[0]!.publicKey, ncId, program.programId);
      const [ncVault] = deriveVaultPda(ncTanda, program.programId);

      await program.methods
        .createTanda({
          tandaId:            ncId,
          nameHash:           Array.from(Buffer.alloc(32, 0x33)),
          memberTarget:       3,
          contributionAmount: new BN(CONTRIBUTION_AMOUNT),
          stakeAmount:        new BN(STAKE_AMOUNT),
          frequencySeconds:   FREQUENCY_SECONDS,
          payoutOrderMode:    { joinOrder: {} },
        })
        .accounts({
          creator:         members[0]!.publicKey,
          creatorProfile:  memberProfiles[0]!,
          programConfig:   configPda,
          tanda:           ncTanda,
          vault:           ncVault,
          usdcMint,
          tokenProgram:    TOKEN_PROGRAM_ID,
          systemProgram:   SystemProgram.programId,
          rent:            SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      for (let i = 0; i < 3; i++) {
        const [mp] = deriveMemberPda(ncTanda, members[i]!.publicKey, program.programId);
        await program.methods.joinTanda(0)
          .accounts({
            user:           members[i]!.publicKey,
            userProfile:    memberProfiles[i]!,
            programConfig:  configPda,
            tanda:          ncTanda,
            member:         mp,
            userUsdcAta:    memberAtas[i]!,
            vault:          ncVault,
            usdcMint,
            tokenProgram:   TOKEN_PROGRAM_ID,
            systemProgram:  SystemProgram.programId,
          } as any)
          .signers([members[i]!])
          .rpc({ commitment: "confirmed" });
      }

      // members[1] is NOT the creator — expect NotCreator
      try {
        await program.methods
          .startTanda()
          .accounts({
            creator:       members[1]!.publicKey,
            tanda:         ncTanda,
            programConfig: configPda,
          } as any)
          .signers([members[1]!])
          .rpc({ commitment: "confirmed" });
        assert.fail("Expected NotCreator");
      } catch (err: any) {
        const msg = String(err.message ?? err);
        assert.ok(
          msg.includes("NotCreator") || msg.includes("6013"),
          `Expected NotCreator, got: ${msg}`
        );
      }
    });

    // ── contribute: rejects double-contribute in same turn ──────────────────

    it("contribute rejects double-contribute in same turn with AlreadyContributed", async function () {
      if (!ownedConfig) return this.skip();

      // Use a fresh 3-member tanda so we don't interfere with the happy-path tanda
      const dcId = new BN(3004);
      const [dcTanda] = deriveTandaPda(members[0]!.publicKey, dcId, program.programId);
      const [dcVault] = deriveVaultPda(dcTanda, program.programId);

      await program.methods
        .createTanda({
          tandaId:            dcId,
          nameHash:           Array.from(Buffer.alloc(32, 0x34)),
          memberTarget:       3,
          contributionAmount: new BN(CONTRIBUTION_AMOUNT),
          stakeAmount:        new BN(STAKE_AMOUNT),
          frequencySeconds:   FREQUENCY_SECONDS,
          payoutOrderMode:    { joinOrder: {} },
        })
        .accounts({
          creator:         members[0]!.publicKey,
          creatorProfile:  memberProfiles[0]!,
          programConfig:   configPda,
          tanda:           dcTanda,
          vault:           dcVault,
          usdcMint,
          tokenProgram:    TOKEN_PROGRAM_ID,
          systemProgram:   SystemProgram.programId,
          rent:            SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      for (let i = 0; i < 3; i++) {
        const [mp] = deriveMemberPda(dcTanda, members[i]!.publicKey, program.programId);
        await program.methods.joinTanda(0)
          .accounts({
            user:           members[i]!.publicKey,
            userProfile:    memberProfiles[i]!,
            programConfig:  configPda,
            tanda:          dcTanda,
            member:         mp,
            userUsdcAta:    memberAtas[i]!,
            vault:          dcVault,
            usdcMint,
            tokenProgram:   TOKEN_PROGRAM_ID,
            systemProgram:  SystemProgram.programId,
          } as any)
          .signers([members[i]!])
          .rpc({ commitment: "confirmed" });
      }

      await program.methods.startTanda()
        .accounts({
          creator:       members[0]!.publicKey,
          tanda:         dcTanda,
          programConfig: configPda,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      const [creatorMemberPda] = deriveMemberPda(dcTanda, members[0]!.publicKey, program.programId);

      // First contribution — should succeed
      await program.methods
        .contribute()
        .accounts({
          user:          members[0]!.publicKey,
          member:        creatorMemberPda,
          tanda:         dcTanda,
          programConfig: configPda,
          userUsdcAta:   memberAtas[0]!,
          vault:         dcVault,
          usdcMint,
          tokenProgram:  TOKEN_PROGRAM_ID,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      // Second contribution — must fail with AlreadyContributed
      try {
        await program.methods
          .contribute()
          .accounts({
            user:          members[0]!.publicKey,
            member:        creatorMemberPda,
            tanda:         dcTanda,
            programConfig: configPda,
            userUsdcAta:   memberAtas[0]!,
            vault:         dcVault,
            usdcMint,
            tokenProgram:  TOKEN_PROGRAM_ID,
          } as any)
          .signers([members[0]!])
          .rpc({ commitment: "confirmed" });
        assert.fail("Expected AlreadyContributed");
      } catch (err: any) {
        const msg = String(err.message ?? err);
        assert.ok(
          msg.includes("AlreadyContributed") || msg.includes("6007"),
          `Expected AlreadyContributed, got: ${msg}`
        );
      }
    });

    // ── payout: rejects when not all members contributed ───────────────────

    it("payout rejects when not all members contributed (MissingContributions)", async function () {
      if (!ownedConfig) return this.skip();

      // Fresh 3-member tanda: only 2 out of 3 contribute, then payout must fail
      const mcId = new BN(3005);
      const [mcTanda] = deriveTandaPda(members[0]!.publicKey, mcId, program.programId);
      const [mcVault] = deriveVaultPda(mcTanda, program.programId);

      await program.methods
        .createTanda({
          tandaId:            mcId,
          nameHash:           Array.from(Buffer.alloc(32, 0x35)),
          memberTarget:       3,
          contributionAmount: new BN(CONTRIBUTION_AMOUNT),
          stakeAmount:        new BN(STAKE_AMOUNT),
          frequencySeconds:   FREQUENCY_SECONDS,
          payoutOrderMode:    { joinOrder: {} },
        })
        .accounts({
          creator:         members[0]!.publicKey,
          creatorProfile:  memberProfiles[0]!,
          programConfig:   configPda,
          tanda:           mcTanda,
          vault:           mcVault,
          usdcMint,
          tokenProgram:    TOKEN_PROGRAM_ID,
          systemProgram:   SystemProgram.programId,
          rent:            SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      for (let i = 0; i < 3; i++) {
        const [mp] = deriveMemberPda(mcTanda, members[i]!.publicKey, program.programId);
        await program.methods.joinTanda(0)
          .accounts({
            user:           members[i]!.publicKey,
            userProfile:    memberProfiles[i]!,
            programConfig:  configPda,
            tanda:          mcTanda,
            member:         mp,
            userUsdcAta:    memberAtas[i]!,
            vault:          mcVault,
            usdcMint,
            tokenProgram:   TOKEN_PROGRAM_ID,
            systemProgram:  SystemProgram.programId,
          } as any)
          .signers([members[i]!])
          .rpc({ commitment: "confirmed" });
      }

      await program.methods.startTanda()
        .accounts({
          creator:       members[0]!.publicKey,
          tanda:         mcTanda,
          programConfig: configPda,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      // Wait for payout window
      const tandaState = await program.account.tanda.fetch(mcTanda);
      const nextTs = tandaState.nextPayoutTs.toNumber();
      const nowTs  = Math.floor(Date.now() / 1000);
      const waitMs = Math.max(0, (nextTs - nowTs + 1) * 1000);
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

      // Only 2 out of 3 contribute
      for (let i = 0; i < 2; i++) {
        const [mp] = deriveMemberPda(mcTanda, members[i]!.publicKey, program.programId);
        await program.methods
          .contribute()
          .accounts({
            user:          members[i]!.publicKey,
            member:        mp,
            tanda:         mcTanda,
            programConfig: configPda,
            userUsdcAta:   memberAtas[i]!,
            vault:         mcVault,
            usdcMint,
            tokenProgram:  TOKEN_PROGRAM_ID,
          } as any)
          .signers([members[i]!])
          .rpc({ commitment: "confirmed" });
      }

      // Find turn-1 beneficiary
      let beneficiaryIdx = 0;
      for (let i = 0; i < 3; i++) {
        const [mp] = deriveMemberPda(mcTanda, members[i]!.publicKey, program.programId);
        const m = await program.account.member.fetch(mp);
        if (m.turnNumber === 1) { beneficiaryIdx = i; break; }
      }
      const [mcBenMember] = deriveMemberPda(mcTanda, members[beneficiaryIdx]!.publicKey, program.programId);

      try {
        await program.methods
          .payout()
          .accounts({
            crank:              crankAuthority.publicKey,
            tanda:              mcTanda,
            programConfig:      configPda,
            beneficiaryMember:  mcBenMember,
            beneficiaryUsdcAta: memberAtas[beneficiaryIdx]!,
            vault:              mcVault,
            usdcMint,
            tokenProgram:       TOKEN_PROGRAM_ID,
          } as any)
          .signers([crankAuthority])
          .rpc({ commitment: "confirmed" });
        assert.fail("Expected MissingContributions");
      } catch (err: any) {
        const msg = String(err.message ?? err);
        assert.ok(
          msg.includes("MissingContributions") || msg.includes("6009"),
          `Expected MissingContributions, got: ${msg}`
        );
      }
    });

    // ── payout: rejects non-crank ──────────────────────────────────────────

    it("payout rejects non-crank with Unauthorized", async function () {
      if (!ownedConfig) return this.skip();

      // Create and fully set up a 3-member tanda with all contributions done
      const unauthId = new BN(3006);
      const [unauthTanda] = deriveTandaPda(members[0]!.publicKey, unauthId, program.programId);
      const [unauthVault] = deriveVaultPda(unauthTanda, program.programId);

      await program.methods
        .createTanda({
          tandaId:            unauthId,
          nameHash:           Array.from(Buffer.alloc(32, 0x36)),
          memberTarget:       3,
          contributionAmount: new BN(CONTRIBUTION_AMOUNT),
          stakeAmount:        new BN(STAKE_AMOUNT),
          frequencySeconds:   FREQUENCY_SECONDS,
          payoutOrderMode:    { joinOrder: {} },
        })
        .accounts({
          creator:         members[0]!.publicKey,
          creatorProfile:  memberProfiles[0]!,
          programConfig:   configPda,
          tanda:           unauthTanda,
          vault:           unauthVault,
          usdcMint,
          tokenProgram:    TOKEN_PROGRAM_ID,
          systemProgram:   SystemProgram.programId,
          rent:            SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      for (let i = 0; i < 3; i++) {
        const [mp] = deriveMemberPda(unauthTanda, members[i]!.publicKey, program.programId);
        await program.methods.joinTanda(0)
          .accounts({
            user:           members[i]!.publicKey,
            userProfile:    memberProfiles[i]!,
            programConfig:  configPda,
            tanda:          unauthTanda,
            member:         mp,
            userUsdcAta:    memberAtas[i]!,
            vault:          unauthVault,
            usdcMint,
            tokenProgram:   TOKEN_PROGRAM_ID,
            systemProgram:  SystemProgram.programId,
          } as any)
          .signers([members[i]!])
          .rpc({ commitment: "confirmed" });
      }

      await program.methods.startTanda()
        .accounts({
          creator:       members[0]!.publicKey,
          tanda:         unauthTanda,
          programConfig: configPda,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      // Wait for payout window
      const tandaState = await program.account.tanda.fetch(unauthTanda);
      const nextTs = tandaState.nextPayoutTs.toNumber();
      const nowTs  = Math.floor(Date.now() / 1000);
      const waitMs = Math.max(0, (nextTs - nowTs + 1) * 1000);
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

      // All 3 members contribute
      for (let i = 0; i < 3; i++) {
        const [mp] = deriveMemberPda(unauthTanda, members[i]!.publicKey, program.programId);
        await program.methods
          .contribute()
          .accounts({
            user:          members[i]!.publicKey,
            member:        mp,
            tanda:         unauthTanda,
            programConfig: configPda,
            userUsdcAta:   memberAtas[i]!,
            vault:         unauthVault,
            usdcMint,
            tokenProgram:  TOKEN_PROGRAM_ID,
          } as any)
          .signers([members[i]!])
          .rpc({ commitment: "confirmed" });
      }

      // Find turn-1 beneficiary
      let beneficiaryIdx = 0;
      for (let i = 0; i < 3; i++) {
        const [mp] = deriveMemberPda(unauthTanda, members[i]!.publicKey, program.programId);
        const m = await program.account.member.fetch(mp);
        if (m.turnNumber === 1) { beneficiaryIdx = i; break; }
      }
      const [unauthBenMember] = deriveMemberPda(unauthTanda, members[beneficiaryIdx]!.publicKey, program.programId);

      // Use members[1] as a fake crank — not the real crankAuthority
      const fakeCrank = members[1]!;

      try {
        await program.methods
          .payout()
          .accounts({
            crank:              fakeCrank.publicKey,
            tanda:              unauthTanda,
            programConfig:      configPda,
            beneficiaryMember:  unauthBenMember,
            beneficiaryUsdcAta: memberAtas[beneficiaryIdx]!,
            vault:              unauthVault,
            usdcMint,
            tokenProgram:       TOKEN_PROGRAM_ID,
          } as any)
          .signers([fakeCrank])
          .rpc({ commitment: "confirmed" });
        assert.fail("Expected Unauthorized");
      } catch (err: any) {
        const msg = String(err.message ?? err);
        assert.ok(
          msg.includes("Unauthorized") || msg.includes("6014"),
          `Expected Unauthorized, got: ${msg}`
        );
      }
    });
  });

  // ── paused program ────────────────────────────────────────────────────────────

  describe("paused program", () => {
    it("join_tanda is rejected with ProgramPaused", async function () {
      if (!ownedConfig) return this.skip();

      // Create a fresh Forming tanda to attempt join on
      const pausedId = new BN(777);
      const [pausedTanda] = deriveTandaPda(members[0]!.publicKey, pausedId, program.programId);
      const [pausedVault] = deriveVaultPda(pausedTanda, program.programId);

      await program.methods
        .createTanda({
          tandaId:            pausedId,
          nameHash:           Array.from(Buffer.alloc(32, 0xcc)),
          memberTarget:       MEMBER_TARGET,
          contributionAmount: new BN(CONTRIBUTION_AMOUNT),
          stakeAmount:        new BN(STAKE_AMOUNT),
          frequencySeconds:   FREQUENCY_SECONDS,
          payoutOrderMode:    { joinOrder: {} },
        })
        .accounts({
          creator:         members[0]!.publicKey,
          creatorProfile:  memberProfiles[0]!,
          programConfig:   configPda,
          tanda:           pausedTanda,
          vault:           pausedVault,
          usdcMint,
          tokenProgram:    TOKEN_PROGRAM_ID,
          systemProgram:   SystemProgram.programId,
          rent:            SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });

      // Pause the program
      await program.methods
        .pause(true)
        .accounts({
          programConfig: configPda,
          admin:         deployer.publicKey,
        } as any)
        .signers([deployer])
        .rpc({ commitment: "confirmed" });

      // Attempt to join — should fail with ProgramPaused
      const attacker = await newFundedKeypair(provider);
      const [atkProfile] = deriveUserProfilePda(attacker.publicKey, program.programId);
      const atkAta = await createUsdcAta(provider, deployer, usdcMint, attacker.publicKey);
      const [atkMember] = deriveMemberPda(pausedTanda, attacker.publicKey, program.programId);

      // Init profile (program not paused yet — initUserProfile doesn't check pause)
      // Actually program is paused at this point. initUserProfile may or may not check pause.
      // If it does, we need to unpause first. Let's create the profile before pausing.
      // Re-order: we already paused. We need to make the profile before the join attempt.
      // Profile creation doesn't go through ProgramConfig pause check (init_profile.rs doesn't check).
      await program.methods
        .initUserProfile(Array.from(Buffer.alloc(32, 0xee)), [0x4d, 0x58])
        .accounts({
          userProfile:   atkProfile,
          wallet:        attacker.publicKey,
          payer:         deployer.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([deployer])
        .rpc({ commitment: "confirmed" });

      try {
        await program.methods
          .joinTanda(0)
          .accounts({
            user:           attacker.publicKey,
            userProfile:    atkProfile,
            programConfig:  configPda,
            tanda:          pausedTanda,
            member:         atkMember,
            userUsdcAta:    atkAta,
            vault:          pausedVault,
            usdcMint,
            tokenProgram:   TOKEN_PROGRAM_ID,
            systemProgram:  SystemProgram.programId,
          } as any)
          .signers([attacker])
          .rpc({ commitment: "confirmed" });
        assert.fail("Expected ProgramPaused");
      } catch (err: any) {
        const msg = String(err.message ?? err);
        assert.ok(
          msg.includes("ProgramPaused") || msg.includes("6015"),
          `Expected ProgramPaused, got: ${msg}`
        );
      }

      // Restore to unpaused
      await program.methods
        .pause(false)
        .accounts({
          programConfig: configPda,
          admin:         deployer.publicKey,
        } as any)
        .signers([deployer])
        .rpc({ commitment: "confirmed" });
    });
  });
});
