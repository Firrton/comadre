# @comadre/monad-contracts

Solidity contracts powering Comadre on Monad. Foundry workspace.

## Layout

```
src/
├── Comadre.sol                          ← main contract: tandas, disputes, KYC, fees, slash, payout
├── libraries/
│   ├── ComadreTypes.sol                 ← enums, structs, packed storage layout, constants
│   └── ComadreErrors.sol                ← custom errors used across the contract
└── mocks/
    └── MockUSDC.sol                     ← owner-gated, mainnet-blocked test ERC-20 (audit COM-018)

test/
├── TestBase.t.sol                       ← shared fixtures
├── Tanda.t.sol Admin.t.sol User.t.sol Slash.t.sol ClaimStake.t.sol Dispute.t.sol
└── fuzz/ComadreFuzz.t.sol               ← property-based tests

script/
└── Deploy.s.sol                          ← TODO — referenced by `deploy:testnet` but not yet present.
                                            See audit COM-035.

lib/
└── forge-std/                            ← vendored Foundry stdlib (do NOT edit; vendored copy)
```

## Quick start

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation).

```sh
forge build              # compile
forge test               # run all tests (unit + fuzz)
forge test --gas-report  # with gas tracking
forge coverage           # coverage report
```

## Constants worth knowing (see `ComadreTypes.sol`)

| Constant | Value | Notes |
|---|---|---|
| `MAX_MEMBERS` | 20 | Hard cap per tanda |
| `MIN_MEMBERS` | 3 | Below this `createTanda` reverts |
| `MAX_DISPUTES_PER_TANDA` | 5 | Per tanda |
| `DISPUTE_VOTING_WINDOW` | 7 days | Voting window for an open dispute |
| `SLASH_GRACE` | 24 h | Grace after `nextPayoutTs` before slash is allowed |
| `MIN_FREQUENCY` | 24 h | Minimum between turns. Override locally for short-cycle tests by lowering this constant. |
| **`MAX_FEE_BPS`** | **1 000 (10 %)** | **Capped after audit COM-016**; admin cannot rotate the fee above 10 % |

## Deploy to Monad testnet (chain 10143)

> ⚠ `script/Deploy.s.sol` is **not yet present**. Until that lands, treat the
> `pnpm deploy:testnet` script as a placeholder. See audit COM-035 for the
> deploy-script TODO.

Once `Deploy.s.sol` exists, the flow is:

```sh
# 1. Import deployer key into the encrypted keystore (NEVER pass it as a hex env var)
cast wallet import comadre-deployer --interactive

# 2. Set runtime constructor inputs in .env (local — do NOT commit)
cp .env.example .env
# Fill: KYC_ORACLE, CRANK_AUTHORITY, FEE_DESTINATION, USDC_ADDRESS, FEE_BPS

# 3. Dry-run
forge script script/Deploy.s.sol --rpc-url monad_testnet --account comadre-deployer

# 4. Broadcast + verify
forge script script/Deploy.s.sol --rpc-url monad_testnet --account comadre-deployer --broadcast --verify

# 5. Record the deployed Comadre address in apps/api/.env.local as COMADRE_CONTRACT_ADDRESS
```

For testnet without canonical USDC: deploy `MockUSDC` first, set its address as
both `USDC_ADDRESS` for Comadre and `USDC_CONTRACT_ADDRESS` for `apps/api`.

`MockUSDC` deployment is **blocked on Monad mainnet (chain id 143)** at the
constructor level (audit COM-018). The mint function is owner-gated to the
deployer.

## Audit follow-ups for this package

See `docs/audits/00-master-findings.md` for the full list. Items that still
touch this package:

| ID | Title | Status |
|---|---|---|
| COM-001 | Sybil voting across tandas — voteDispute/resolveDispute don't bind disputeKey to tandaKey | **Pending** — requires struct change + tests |
| COM-002 | Slashed members DoS payout (stuck tanda) | **Pending** — requires `activeMembers` refactor + tests |
| COM-003 | Payout can pay slashed member | **Fixed** — `if (!beneficiaryMember.isActive) revert MemberInactive()` |
| COM-016 | `MAX_FEE_BPS = 10_000` (100 %) | **Fixed** — lowered to `1_000` (10 %) |
| COM-018 | `MockUSDC.mint` permissionless + no chain guard | **Fixed** — `onlyOwner` + `notMainnet` modifiers |
| COM-045 | Dispute opener can vote on own dispute | **Fixed** — `if (msg.sender == dispute.opener) revert Unauthorized()` |
| COM-047 | KYC limit only checked at join, not at contribute | **Pending** |
| COM-076 | No emergency-withdrawal escape for COM-002 funds | **Pending** |

## Conventions

- Solidity 0.8.28, no upgradeability (immutable deploy).
- All state-changing fns emit events; off-chain indexer relies on this.
- Custom errors only (`revert E.Unauthorized()`), no `require` strings.
- Storage is packed per slot in `ComadreTypes.sol`. Do not reorder struct fields without re-running gas tests.

## Tests

```sh
forge test -vv                  # verbose
forge test --match-test test_Payout_*   # filter
forge test --match-contract DisputeTest # by file
```

Fuzz suites in `test/fuzz/` should be run with higher iterations before any deploy:

```sh
FOUNDRY_FUZZ_RUNS=10000 forge test --match-contract ComadreFuzzTest
```
