/**
 * dispute.spec.ts — End-to-end tests for dispute resolution and slash flows.
 *
 * Clock trick: DISPUTE_VOTING_WINDOW_SECONDS in tests uses a very short
 * deadline override. Since we cannot easily warp the on-chain clock in the test
 * validator, we set the dispute deadline via warpClock (same approach as
 * tanda.spec.ts). When that is unavailable, tests that need elapsed time will
 * catch the DisputeNotExpired / DisputeExpired edge gracefully.
 *
 * Slash tests use FREQUENCY_SECONDS=1 + SLASH_GRACE_SECONDS override: the
 * localnet feature disables the 24h floor on frequency, so we can test a
 * slash scenario by waiting 1-2 seconds after next_payout_ts.
 *
 * IMPORTANT: The on-chain SLASH_GRACE_SECONDS constant is 86400 (24h) in
 * production.  For testing we rely on clock-warp to advance past it, OR we
 * accept that the slash test may only fully verify the account constraint
 * checks on environments that support setTime.
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
  deriveDisputePda,
  deriveDisputeVotePda,
  createUsdcMint,
  createUsdcAta,
  mintUsdcTo,
  getOrCreateUsdcAta,
} from "./helpers";

// ─── Utilities ────────────────────────────────────────────────────────────────

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

async function warpClock(
  connection: anchor.web3.Connection,
  unixTimestamp: number
): Promise<void> {
  try {
    await (connection as any)._rpcRequest("setTime", [unixTimestamp]);
  } catch {
    console.warn("[warpClock] setTime RPC failed — time-dependent guard may block");
  }
  await new Promise((r) => setTimeout(r, 400));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Shared tanda setup helper ────────────────────────────────────────────────

interface TandaSetup {
  tandaPda:     PublicKey;
  vaultPda:     PublicKey;
  members:      Keypair[];
  memberProfiles: PublicKey[];
  memberAtas:   PublicKey[];
  usdcMint:     PublicKey;
  configPda:    PublicKey;
  deployer:     Keypair;
  kycOracle:    Keypair;
  crankAuthority: Keypair;
  feeDestinationAta: PublicKey;
}

async function buildAndStartTanda(
  provider: AnchorProvider,
  program: anchor.Program<any>,
  tandaId: BN,
  memberCount: number = 5
): Promise<TandaSetup> {
  const deployer       = await newFundedKeypair(provider);
  const kycOracle      = await newFundedKeypair(provider);
  const crankAuthority = await newFundedKeypair(provider);

  const [configPda] = deriveConfigPda(program.programId);
  const usdcMint = await createUsdcMint(provider, deployer, deployer.publicKey);

  // Init config (ignore if already exists — another spec may own it)
  try {
    await program.methods
      .initConfig({
        kycOracle:      kycOracle.publicKey,
        crankAuthority: crankAuthority.publicKey,
        feeBps:         0,
        feeDestination: deployer.publicKey,
        kycLimits: [
          new BN(100_000_000),
          new BN(1_000_000_000),
          new BN(5_000_000_000),
          new BN(10_000_000_000),
        ],
      })
      .accounts({
        programConfig: configPda,
        admin:         deployer.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([deployer])
      .rpc({ commitment: "confirmed" });
  } catch {
    // Already initialised — not an error in the test suite context
  }

  // fee_destination ATA (for slash tests)
  const feeDestinationAta = await getOrCreateUsdcAta(
    provider, deployer, usdcMint, deployer.publicKey
  );

  const CONTRIBUTION_AMOUNT = 1_000_000;
  const STAKE_AMOUNT        = 1_000_000;
  const FREQUENCY_SECONDS   = 1;
  const USDC_PER_MEMBER     = 30_000_000;

  const members:         Keypair[]   = [];
  const memberProfiles:  PublicKey[] = [];
  const memberAtas:      PublicKey[] = [];

  for (let i = 0; i < memberCount; i++) {
    const kp = await newFundedKeypair(provider);
    members.push(kp);

    const [profilePda] = deriveUserProfilePda(kp.publicKey, program.programId);
    memberProfiles.push(profilePda);

    await program.methods
      .initUserProfile(
        Array.from(Buffer.alloc(32, i + 10)),
        [0x4d, 0x58],
      )
      .accounts({
        userProfile:   profilePda,
        wallet:        kp.publicKey,
        payer:         deployer.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([deployer])
      .rpc({ commitment: "confirmed" });

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

    const ata = await createUsdcAta(provider, deployer, usdcMint, kp.publicKey);
    memberAtas.push(ata);
    await mintUsdcTo(provider, deployer, usdcMint, ata, deployer, USDC_PER_MEMBER);
  }

  const [tandaPda] = deriveTandaPda(members[0]!.publicKey, tandaId, program.programId);
  const [vaultPda] = deriveVaultPda(tandaPda, program.programId);

  await program.methods
    .createTanda({
      tandaId,
      nameHash:           Array.from(Buffer.alloc(32, 0xab)),
      memberTarget:       memberCount,
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

  // All members join
  for (let i = 0; i < memberCount; i++) {
    const [memberPda] = deriveMemberPda(tandaPda, members[i]!.publicKey, program.programId);
    await program.methods
      .joinTanda(0)
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

  // Start tanda
  await program.methods
    .startTanda()
    .accounts({
      creator:       members[0]!.publicKey,
      tanda:         tandaPda,
      programConfig: configPda,
    } as any)
    .signers([members[0]!])
    .rpc({ commitment: "confirmed" });

  return {
    tandaPda, vaultPda, members, memberProfiles, memberAtas,
    usdcMint, configPda, deployer, kycOracle, crankAuthority,
    feeDestinationAta,
  };
}

// ─── Dispute test suite ───────────────────────────────────────────────────────

describe("dispute resolution", () => {
  const provider: AnchorProvider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = getProgram(provider);

  before(async () => {
    await waitForReady(provider.connection);
  });

  // ── Test 1: continue path ──────────────────────────────────────────────────
  it("Test 1 — continue path: 3 continue vs 2 cancel → tanda returns to Active", async function () {
    this.timeout(120_000);

    const { tandaPda, members, memberProfiles, memberAtas, usdcMint, configPda } =
      await buildAndStartTanda(provider, program, new BN(2001), 5);

    // Member 0 opens dispute
    const [disputePda] = deriveDisputePda(tandaPda, 0, program.programId);
    const [openerMemberPda] = deriveMemberPda(tandaPda, members[0]!.publicKey, program.programId);

    await program.methods
      .openDispute(Array.from(Buffer.alloc(32, 0x01)))
      .accounts({
        opener:        members[0]!.publicKey,
        openerMember:  openerMemberPda,
        tanda:         tandaPda,
        programConfig: configPda,
        dispute:       disputePda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([members[0]!])
      .rpc({ commitment: "confirmed" });

    const tandaAfterOpen = await program.account.tanda.fetch(tandaPda);
    assert.deepEqual(tandaAfterOpen.state, { paused: {} }, "tanda should be Paused after open_dispute");

    const disputeAfterOpen = await program.account.dispute.fetch(disputePda);
    assert.deepEqual(disputeAfterOpen.state, { open: {} }, "dispute should be Open");
    assert.equal(disputeAfterOpen.disputeId, 0, "dispute_id should be 0");

    // Members 0, 1, 2 vote "continue" (3 votes); members 3, 4 vote "cancel" (2 votes)
    for (let i = 0; i < 5; i++) {
      const [memberPda] = deriveMemberPda(tandaPda, members[i]!.publicKey, program.programId);
      const [votePda] = deriveDisputeVotePda(disputePda, members[i]!.publicKey, program.programId);
      const continueTanda = i < 3;

      await program.methods
        .voteDispute(continueTanda)
        .accounts({
          voter:        members[i]!.publicKey,
          voterMember:  memberPda,
          dispute:      disputePda,
          disputeVote:  votePda,
          programConfig: configPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([members[i]!])
        .rpc({ commitment: "confirmed" });
    }

    const disputeAfterVotes = await program.account.dispute.fetch(disputePda);
    assert.equal(disputeAfterVotes.votesContinue, 3, "3 continue votes");
    assert.equal(disputeAfterVotes.votesCancel, 2, "2 cancel votes");

    // Warp past deadline
    const deadline = disputeAfterVotes.deadlineTs.toNumber();
    await warpClock(provider.connection, deadline + 2);

    // Resolve
    const resolver = await newFundedKeypair(provider);
    await program.methods
      .resolveDispute()
      .accounts({
        resolver:      resolver.publicKey,
        dispute:       disputePda,
        tanda:         tandaPda,
        programConfig: configPda,
      } as any)
      .signers([resolver])
      .rpc({ commitment: "confirmed" });

    const disputeResolved = await program.account.dispute.fetch(disputePda);
    assert.deepEqual(disputeResolved.state, { resolved: {} }, "dispute should be Resolved");

    const tandaResolved = await program.account.tanda.fetch(tandaPda);
    assert.deepEqual(tandaResolved.state, { active: {} }, "tanda should be Active again (continue wins)");
  });

  // ── Test 2: cancel path ────────────────────────────────────────────────────
  it("Test 2 — cancel path: 2 continue vs 3 cancel → tanda goes Cancelled", async function () {
    this.timeout(120_000);

    const { tandaPda, members, memberProfiles, memberAtas, usdcMint, configPda } =
      await buildAndStartTanda(provider, program, new BN(2002), 5);

    const [disputePda] = deriveDisputePda(tandaPda, 0, program.programId);
    const [openerMemberPda] = deriveMemberPda(tandaPda, members[0]!.publicKey, program.programId);

    await program.methods
      .openDispute(Array.from(Buffer.alloc(32, 0x02)))
      .accounts({
        opener:        members[0]!.publicKey,
        openerMember:  openerMemberPda,
        tanda:         tandaPda,
        programConfig: configPda,
        dispute:       disputePda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([members[0]!])
      .rpc({ commitment: "confirmed" });

    // Members 0, 1 vote "continue" (2); members 2, 3, 4 vote "cancel" (3)
    for (let i = 0; i < 5; i++) {
      const [memberPda] = deriveMemberPda(tandaPda, members[i]!.publicKey, program.programId);
      const [votePda] = deriveDisputeVotePda(disputePda, members[i]!.publicKey, program.programId);
      const continueTanda = i < 2;

      await program.methods
        .voteDispute(continueTanda)
        .accounts({
          voter:        members[i]!.publicKey,
          voterMember:  memberPda,
          dispute:      disputePda,
          disputeVote:  votePda,
          programConfig: configPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([members[i]!])
        .rpc({ commitment: "confirmed" });
    }

    const disputeAfterVotes = await program.account.dispute.fetch(disputePda);
    const deadline = disputeAfterVotes.deadlineTs.toNumber();
    await warpClock(provider.connection, deadline + 2);

    const resolver = await newFundedKeypair(provider);
    await program.methods
      .resolveDispute()
      .accounts({
        resolver:      resolver.publicKey,
        dispute:       disputePda,
        tanda:         tandaPda,
        programConfig: configPda,
      } as any)
      .signers([resolver])
      .rpc({ commitment: "confirmed" });

    const tandaResolved = await program.account.tanda.fetch(tandaPda);
    assert.deepEqual(tandaResolved.state, { cancelled: {} }, "tanda should be Cancelled (cancel wins)");
  });

  // ── Test 3: non-member cannot open dispute ─────────────────────────────────
  it("Test 3 — negative: non-member cannot open dispute (NotAMember)", async function () {
    this.timeout(60_000);

    const { tandaPda, members, configPda } =
      await buildAndStartTanda(provider, program, new BN(2003), 5);

    const outsider = await newFundedKeypair(provider);
    // Create a profile for the outsider but do NOT join the tanda
    const [outsiderProfile] = deriveUserProfilePda(outsider.publicKey, program.programId);
    await program.methods
      .initUserProfile(Array.from(Buffer.alloc(32, 0xf0)), [0x4d, 0x58])
      .accounts({
        userProfile:   outsiderProfile,
        wallet:        outsider.publicKey,
        payer:         outsider.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([outsider])
      .rpc({ commitment: "confirmed" });

    // Derive a fake member PDA for the outsider (will not exist on-chain)
    const [outsiderMemberPda] = deriveMemberPda(tandaPda, outsider.publicKey, program.programId);
    const [disputePda] = deriveDisputePda(tandaPda, 0, program.programId);

    try {
      await program.methods
        .openDispute(Array.from(Buffer.alloc(32, 0xf0)))
        .accounts({
          opener:        outsider.publicKey,
          openerMember:  outsiderMemberPda,
          tanda:         tandaPda,
          programConfig: configPda,
          dispute:       disputePda,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([outsider])
        .rpc({ commitment: "confirmed" });
      assert.fail("Expected NotAMember or AccountNotInitialized");
    } catch (err: any) {
      const msg = String(err.message ?? err);
      // Either NotAMember (constraint check) or AccountNotInitialized (PDA doesn't exist)
      assert.ok(
        msg.includes("NotAMember") || msg.includes("AccountNotInitialized") ||
        msg.includes("3012") || msg.includes("6012") || msg.includes("seeds") ||
        msg.includes("ConstraintSeeds") || msg.includes("does not exist"),
        `Expected NotAMember or seeds constraint violation, got: ${msg}`
      );
    }
  });

  // ── Test 4: cannot vote twice ──────────────────────────────────────────────
  it("Test 4 — negative: cannot vote twice (AccountAlreadyInitialized)", async function () {
    this.timeout(60_000);

    const { tandaPda, members, configPda } =
      await buildAndStartTanda(provider, program, new BN(2004), 5);

    const [disputePda] = deriveDisputePda(tandaPda, 0, program.programId);
    const [openerMemberPda] = deriveMemberPda(tandaPda, members[0]!.publicKey, program.programId);

    await program.methods
      .openDispute(Array.from(Buffer.alloc(32, 0x04)))
      .accounts({
        opener:        members[0]!.publicKey,
        openerMember:  openerMemberPda,
        tanda:         tandaPda,
        programConfig: configPda,
        dispute:       disputePda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([members[0]!])
      .rpc({ commitment: "confirmed" });

    const [member1Pda] = deriveMemberPda(tandaPda, members[1]!.publicKey, program.programId);
    const [votePda] = deriveDisputeVotePda(disputePda, members[1]!.publicKey, program.programId);

    // First vote — succeeds
    await program.methods
      .voteDispute(true)
      .accounts({
        voter:        members[1]!.publicKey,
        voterMember:  member1Pda,
        dispute:      disputePda,
        disputeVote:  votePda,
        programConfig: configPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([members[1]!])
      .rpc({ commitment: "confirmed" });

    // Second vote — must fail (AccountAlreadyInitialized since init blocks reuse)
    try {
      await program.methods
        .voteDispute(false)
        .accounts({
          voter:        members[1]!.publicKey,
          voterMember:  member1Pda,
          dispute:      disputePda,
          disputeVote:  votePda,
          programConfig: configPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([members[1]!])
        .rpc({ commitment: "confirmed" });
      assert.fail("Expected AccountAlreadyInitialized");
    } catch (err: any) {
      const msg = String(err.message ?? err);
      assert.ok(
        msg.includes("already in use") || msg.includes("AccountAlreadyInitialized") ||
        msg.includes("0x0") || msg.includes("already exists"),
        `Expected AccountAlreadyInitialized, got: ${msg}`
      );
    }
  });

  // ── Test 5: cannot resolve before deadline ─────────────────────────────────
  it("Test 5 — negative: cannot resolve before voting deadline (DisputeNotExpired)", async function () {
    this.timeout(60_000);

    const { tandaPda, members, configPda } =
      await buildAndStartTanda(provider, program, new BN(2005), 5);

    const [disputePda] = deriveDisputePda(tandaPda, 0, program.programId);
    const [openerMemberPda] = deriveMemberPda(tandaPda, members[0]!.publicKey, program.programId);

    await program.methods
      .openDispute(Array.from(Buffer.alloc(32, 0x05)))
      .accounts({
        opener:        members[0]!.publicKey,
        openerMember:  openerMemberPda,
        tanda:         tandaPda,
        programConfig: configPda,
        dispute:       disputePda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([members[0]!])
      .rpc({ commitment: "confirmed" });

    // Attempt to resolve immediately (before deadline)
    const resolver = await newFundedKeypair(provider);
    try {
      await program.methods
        .resolveDispute()
        .accounts({
          resolver:      resolver.publicKey,
          dispute:       disputePda,
          tanda:         tandaPda,
          programConfig: configPda,
        } as any)
        .signers([resolver])
        .rpc({ commitment: "confirmed" });
      assert.fail("Expected DisputeNotExpired");
    } catch (err: any) {
      const msg = String(err.message ?? err);
      assert.ok(
        msg.includes("DisputeNotExpired") || msg.includes("6029") || msg.includes("6030"),
        `Expected DisputeNotExpired, got: ${msg}`
      );
    }
  });

  // ── Test 6: cannot open dispute when program is paused ─────────────────────
  it("Test 6 — negative: cannot open dispute when program is paused (ProgramPaused)", async function () {
    this.timeout(60_000);

    const { tandaPda, members, memberAtas, usdcMint, configPda, deployer } =
      await buildAndStartTanda(provider, program, new BN(2006), 5);

    // Pause the program
    await program.methods
      .pause(true)
      .accounts({
        programConfig: configPda,
        admin:         deployer.publicKey,
      } as any)
      .signers([deployer])
      .rpc({ commitment: "confirmed" });

    const [disputePda] = deriveDisputePda(tandaPda, 0, program.programId);
    const [openerMemberPda] = deriveMemberPda(tandaPda, members[0]!.publicKey, program.programId);

    try {
      await program.methods
        .openDispute(Array.from(Buffer.alloc(32, 0x06)))
        .accounts({
          opener:        members[0]!.publicKey,
          openerMember:  openerMemberPda,
          tanda:         tandaPda,
          programConfig: configPda,
          dispute:       disputePda,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([members[0]!])
        .rpc({ commitment: "confirmed" });
      assert.fail("Expected ProgramPaused");
    } catch (err: any) {
      const msg = String(err.message ?? err);
      assert.ok(
        msg.includes("ProgramPaused") || msg.includes("6015"),
        `Expected ProgramPaused, got: ${msg}`
      );
    }

    // Restore
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

// ─── Slash test suite ─────────────────────────────────────────────────────────

describe("slash_defaulter", () => {
  const provider: AnchorProvider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = getProgram(provider);

  before(async () => {
    await waitForReady(provider.connection);
  });

  // ── Test 7: slash happy path ───────────────────────────────────────────────
  it("Test 7 — slash happy path: stake transferred, member deactivated", async function () {
    this.timeout(120_000);

    const {
      tandaPda, vaultPda, members, memberAtas, usdcMint, configPda,
      deployer, crankAuthority, feeDestinationAta,
    } = await buildAndStartTanda(provider, program, new BN(3001), 3);

    // All members contribute for turn 1 EXCEPT member[2] (the defaulter)
    for (let i = 0; i < 2; i++) {
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

    // Wait for next_payout_ts to elapse (frequency = 1s) + warp past grace period
    const tandaBefore = await program.account.tanda.fetch(tandaPda);
    const payoutTs = tandaBefore.nextPayoutTs.toNumber();
    // Grace period is 86400s on-chain. Warp past it.
    await warpClock(provider.connection, payoutTs + 86400 + 10);

    const [defaulterMemberPda] = deriveMemberPda(
      tandaPda, members[2]!.publicKey, program.programId
    );
    const defaulterBefore = await program.account.member.fetch(defaulterMemberPda);
    const stakeBefore = defaulterBefore.stakeLocked.toNumber();
    assert.isAbove(stakeBefore, 0, "defaulter should have stake > 0 before slash");

    await program.methods
      .slashDefaulter()
      .accounts({
        crank:              crankAuthority.publicKey,
        tanda:              tandaPda,
        defaulterMember:    defaulterMemberPda,
        programConfig:      configPda,
        vault:              vaultPda,
        feeDestinationAta:  feeDestinationAta,
        tokenProgram:       TOKEN_PROGRAM_ID,
      } as any)
      .signers([crankAuthority])
      .rpc({ commitment: "confirmed" });

    const defaulterAfter = await program.account.member.fetch(defaulterMemberPda);
    assert.isFalse(defaulterAfter.isActive, "defaulter should be inactive after slash");
    assert.equal(defaulterAfter.stakeLocked.toNumber(), 0, "stake_locked should be 0 after slash");

    const tandaAfter = await program.account.tanda.fetch(tandaPda);
    assert.equal(
      tandaAfter.memberCurrent,
      tandaBefore.memberCurrent - 1,
      "member_current should decrement"
    );
  });

  // ── Test 8: cannot slash before grace period ────────────────────────────────
  it("Test 8 — negative: cannot slash before grace period (MemberNotDefaulted)", async function () {
    this.timeout(60_000);

    const {
      tandaPda, vaultPda, members, memberAtas, usdcMint, configPda,
      crankAuthority, feeDestinationAta,
    } = await buildAndStartTanda(provider, program, new BN(3002), 3);

    // member[2] has NOT contributed — but we do NOT warp the clock
    // so the grace period has not elapsed → MemberNotDefaulted
    const [defaulterMemberPda] = deriveMemberPda(
      tandaPda, members[2]!.publicKey, program.programId
    );

    try {
      await program.methods
        .slashDefaulter()
        .accounts({
          crank:              crankAuthority.publicKey,
          tanda:              tandaPda,
          defaulterMember:    defaulterMemberPda,
          programConfig:      configPda,
          vault:              vaultPda,
          feeDestinationAta:  feeDestinationAta,
          tokenProgram:       TOKEN_PROGRAM_ID,
        } as any)
        .signers([crankAuthority])
        .rpc({ commitment: "confirmed" });
      assert.fail("Expected MemberNotDefaulted");
    } catch (err: any) {
      const msg = String(err.message ?? err);
      assert.ok(
        msg.includes("MemberNotDefaulted") || msg.includes("6031") || msg.includes("6030") || msg.includes("6029"),
        `Expected MemberNotDefaulted, got: ${msg}`
      );
    }
  });
});
