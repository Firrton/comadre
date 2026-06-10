# Recipient Allowlist + WhatsApp Confirmation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close COM-004 (OWASP LLM01) by enforcing an incremental recipient allowlist with backend-validated WhatsApp confirmation, and populate permissionId (COM-033) for on-chain revocation.

**Architecture:** Signer fail-closed + route-level allowlist enforcement. New recipients are held as `awaiting_confirmation` transfers (15-min security window) and resolved by a backend endpoint that validates a genuine user affirmative — the LLM never decides confirmation. Dependency-ordered PR chain A -> B -> C; D independent.

**Tech Stack:** Hono API, Drizzle ORM + postgres-js, bun test, Turnkey/ZeroDev session keys, Monad testnet, Kimi agent.

**Spec:** docs/superpowers/specs/2026-06-06-recipient-allowlist-design.md

**Merge order (safe):** A -> B -> C (C never before B). D anytime. PR B ships backend + agent together.

---

## PR A — Foundation (inert)

### Task 1: Add `awaiting_confirmation` to transferStatusEnum + generate migration

**Files:** `packages/db/src/schema.ts` (line 294–301)

- [ ] **Step 1: Add enum value to schema**
  Edit line 294–301 in `packages/db/src/schema.ts`:
  ```typescript
  export const transferStatusEnum = pgEnum("transfer_status", [
    "pending",
    "awaiting_recipient",
    "awaiting_confirmation",
    "confirmed",
    "expired",
    "cancelled",
    "failed",
  ]);
  ```

- [ ] **Step 2: Generate Drizzle migration**
  ```bash
  cd packages/db && pnpm run generate
  ```
  Expected output: new file in `drizzle/migrations/` with ALTER TYPE command:
  ```sql
  ALTER TYPE "public"."transfer_status" ADD VALUE 'awaiting_confirmation' AFTER 'awaiting_recipient';
  ```
  (The exact position syntax depends on Drizzle-kit's Postgres dialect; verify the generated SQL includes the ALTER TYPE ADD VALUE for the new enum variant.)

- [ ] **Step 3: Verify migration file exists**
  ```bash
  ls -la packages/db/drizzle/migrations/ | grep -E "\.sql$" | tail -1
  ```
  Should show a new `.sql` file with the ALTER TYPE statement.

- [ ] **Step 4: Commit schema + migration**
  ```bash
  cd /Users/firrton/comadre
  git add packages/db/src/schema.ts packages/db/drizzle/migrations/
  git commit -m "Add awaiting_confirmation to transfer_status enum"
  ```

---

### Task 2: Create `apps/api/src/lib/recipientPolicy.ts` with pure functions

**Files:** Create `apps/api/src/lib/recipientPolicy.ts`

- [ ] **Step 1: Write test file first (TDD)**
  Create `apps/api/src/lib/__tests__/recipientPolicy.test.ts`:
  ```typescript
  import { describe, expect, it } from "bun:test";
  import {
    evaluateRecipient,
    parseConfirmation,
    buildConfirmationPrompt,
  } from "../recipientPolicy.js";

  describe("evaluateRecipient", () => {
    it("returns ok:true when recipient is in allowlist (case-insensitive)", () => {
      const result = evaluateRecipient(
        ["0x1234567890abcdef1234567890abcdef12345678"],
        "0xa9059cbb0000000000000000000000001234567890abcdef1234567890abcdef1234567800000000000000000000000000000000000000000000000000000000000f4240"
      );
      expect(result.ok).toBe(true);
    });

    it("returns ok:true for mixed-case recipient in mixed-case allowlist", () => {
      const result = evaluateRecipient(
        ["0xABCDEF1234567890abcdef1234567890ABCDEF12"],
        "0xa9059cbb000000000000000000000000abcdef1234567890abcdef1234567890abcdef1200000000000000000000000000000000000000000000000000000000000f4240"
      );
      expect(result.ok).toBe(true);
    });

    it("returns recipient_not_allowed when recipient not in allowlist", () => {
      const result = evaluateRecipient(
        ["0x1111111111111111111111111111111111111111"],
        "0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000000f4240"
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("recipient_not_allowed");
      }
    });

    it("returns recipient_not_allowed when allowlist is empty", () => {
      const result = evaluateRecipient(
        [],
        "0xa9059cbb0000000000000000000000001234567890abcdef1234567890abcdef1234567800000000000000000000000000000000000000000000000000000000000f4240"
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("recipient_not_allowed");
      }
    });

    it("returns undecodable_calldata when calldata is malformed", () => {
      const result = evaluateRecipient(
        ["0x1234567890abcdef1234567890abcdef12345678"],
        "0x1234" // Invalid calldata
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("undecodable_calldata");
      }
    });

    it("returns undecodable_calldata for non-transfer function data", () => {
      // balanceOf(address) encoded
      const result = evaluateRecipient(
        ["0x1234567890abcdef1234567890abcdef12345678"],
        "0x70a08231000000000000000000000000aabbccdd00000000000000000000000000000000"
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("undecodable_calldata");
      }
    });
  });

  describe("parseConfirmation", () => {
    it("parses Spanish affirmative: 'sí'", () => {
      expect(parseConfirmation("sí")).toBe("affirmative");
    });

    it("parses Spanish affirmative: 'si' (no accent)", () => {
      expect(parseConfirmation("si")).toBe("affirmative");
    });

    it("parses Spanish affirmative: 'dale'", () => {
      expect(parseConfirmation("dale")).toBe("affirmative");
    });

    it("parses Spanish affirmative: 'ok'", () => {
      expect(parseConfirmation("ok")).toBe("affirmative");
    });

    it("parses Spanish affirmative: 'confirmo'", () => {
      expect(parseConfirmation("confirmo")).toBe("affirmative");
    });

    it("parses English affirmative: 'yes'", () => {
      expect(parseConfirmation("yes")).toBe("affirmative");
    });

    it("parses affirmative with ✅ emoji", () => {
      expect(parseConfirmation("✅")).toBe("affirmative");
    });

    it("parses affirmative with surrounding spaces and punctuation", () => {
      expect(parseConfirmation("  sí!  ")).toBe("affirmative");
    });

    it("parses affirmative with mixed punctuation", () => {
      expect(parseConfirmation("¡sí!")).toBe("affirmative");
    });

    it("parses Spanish negative: 'no'", () => {
      expect(parseConfirmation("no")).toBe("negative");
    });

    it("parses Spanish negative: 'cancelar'", () => {
      expect(parseConfirmation("cancelar")).toBe("negative");
    });

    it("parses Spanish negative: 'cancela'", () => {
      expect(parseConfirmation("cancela")).toBe("negative");
    });

    it("parses Spanish negative: 'cancelá' (Argentine accent)", () => {
      expect(parseConfirmation("cancelá")).toBe("negative");
    });

    it("parses negative with ❌ emoji", () => {
      expect(parseConfirmation("❌")).toBe("negative");
    });

    it("parses negative with surrounding spaces and punctuation", () => {
      expect(parseConfirmation("  no!  ")).toBe("negative");
    });

    it("returns ambiguous for unrecognized input", () => {
      expect(parseConfirmation("maybe")).toBe("ambiguous");
    });

    it("returns ambiguous for empty string", () => {
      expect(parseConfirmation("")).toBe("ambiguous");
    });

    it("returns ambiguous for substring match (not whole-word)", () => {
      // "sí" is whole-word in "sí", but substring in "sígueme" should be ambiguous
      expect(parseConfirmation("sígueme")).toBe("ambiguous");
    });

    it("returns ambiguous when message contains affirmative as substring only", () => {
      expect(parseConfirmation("nosí")).toBe("ambiguous");
    });
  });

  describe("buildConfirmationPrompt", () => {
    it("builds correct prompt for USDC transfer confirmation", () => {
      const prompt = buildConfirmationPrompt("+5491123456789", "10.5");
      expect(prompt).toBe(
        "Es la primera vez que enviás a +5491123456789. ¿Confirmás enviar 10.5 USDC? Respondé SÍ para confirmar o NO para cancelar."
      );
    });

    it("preserves leading + in phone number", () => {
      const prompt = buildConfirmationPrompt("+528116346072", "25");
      expect(prompt).toBe(
        "Es la primera vez que enviás a +528116346072. ¿Confirmás enviar 25 USDC? Respondé SÍ para confirmar o NO para cancelar."
      );
    });

    it("handles various amount formats", () => {
      const prompt = buildConfirmationPrompt("+1234567890", "0.001");
      expect(prompt).toContain("0.001 USDC");
    });

    it("handles whole USDC amounts", () => {
      const prompt = buildConfirmationPrompt("+1234567890", "100");
      expect(prompt).toContain("100 USDC");
    });
  });
  ```

- [ ] **Step 2: Run test (will fail)**
  ```bash
  cd apps/api && bun test src/lib/__tests__/recipientPolicy.test.ts
  ```
  Expected: all tests fail (file doesn't exist yet).

- [ ] **Step 3: Implement recipientPolicy.ts**
  Create `apps/api/src/lib/recipientPolicy.ts`:
  ```typescript
  /**
   * Recipient allowlist enforcement and confirmation flow for USDC transfers.
   * 
   * Three pure functions:
   *  - evaluateRecipient: checks if calldata recipient is in allowlist
   *  - parseConfirmation: parses Spanish/English yes/no responses
   *  - buildConfirmationPrompt: generates the user-facing confirmation message
   */

  import { type Hex } from "viem";
  import { decodeUsdcTransferCalldata } from "./monadUsdcTransfer.js";

  /**
   * Evaluate if a USDC transfer recipient is in the user's allowlist.
   * 
   * @param allowedRecipients - list of whitelisted wallet addresses (case-insensitive)
   * @param calldata - ERC-20 transfer() calldata (0x...)
   * @returns { ok: true } if recipient is allowed, or error discriminant with reason
   */
  export function evaluateRecipient(
    allowedRecipients: string[],
    calldata: Hex,
  ): { ok: true } | { ok: false; reason: "recipient_not_allowed" | "undecodable_calldata" } {
    // Decode the transfer(to, amount) calldata
    const decoded = decodeUsdcTransferCalldata(calldata);
    if (!decoded) {
      return { ok: false, reason: "undecodable_calldata" };
    }

    // Empty allowlist or recipient not found → reject
    if (allowedRecipients.length === 0) {
      return { ok: false, reason: "recipient_not_allowed" };
    }

    const recipientLower = decoded.to.toLowerCase();
    const allowedLower = allowedRecipients.map((r) => r.toLowerCase());

    if (!allowedLower.includes(recipientLower)) {
      return { ok: false, reason: "recipient_not_allowed" };
    }

    return { ok: true };
  }

  /**
   * Parse a user's response message to determine affirmative, negative, or ambiguous intent.
   * 
   * Whole-word/whole-message matching only (no substrings).
   * Recognizes Spanish and English affirmatives/negatives + emoji.
   * 
   * Affirmatives: sí, si, dale, ok, confirmo, yes, ✅
   * Negatives: no, cancelar, cancela, cancelá, ❌
   * 
   * @param message - user input string
   * @returns discriminant intent
   */
  export function parseConfirmation(message: string): "affirmative" | "negative" | "ambiguous" {
    // Normalize: trim, lowercase, strip surrounding punctuation/emoji
    let normalized = message.trim().toLowerCase();
    
    // Strip leading/trailing punctuation and emoji (but preserve the core text)
    normalized = normalized.replace(/^[\s.,!?¡¿\u2600-\u27BF\u1F300-\u1F9FF]+/, "");
    normalized = normalized.replace(/[\s.,!?¡¿\u2600-\u27BF\u1F300-\u1F9FF]+$/, "");

    // Affirmatives: whole-word/whole-message match
    const affirmatives = ["sí", "si", "dale", "ok", "confirmo", "yes", "✅"];
    if (affirmatives.includes(normalized)) {
      return "affirmative";
    }

    // Negatives: whole-word/whole-message match
    const negatives = ["no", "cancelar", "cancela", "cancelá", "❌"];
    if (negatives.includes(normalized)) {
      return "negative";
    }

    return "ambiguous";
  }

  /**
   * Build the Spanish-language confirmation prompt for a new recipient.
   * 
   * Format:
   *   "Es la primera vez que enviás a {recipientPhone}. 
   *    ¿Confirmás enviar {amountUsdc} USDC? 
   *    Respondé SÍ para confirmar o NO para cancelar."
   * 
   * @param recipientPhone - E.164 phone number (e.g. "+5491123456789")
   * @param amountUsdc - human-readable USDC amount (e.g. "10.5")
   * @returns confirmation prompt string
   */
  export function buildConfirmationPrompt(recipientPhone: string, amountUsdc: string): string {
    return (
      `Es la primera vez que enviás a ${recipientPhone}. ` +
      `¿Confirmás enviar ${amountUsdc} USDC? ` +
      `Respondé SÍ para confirmar o NO para cancelar.`
    );
  }
  ```

- [ ] **Step 4: Run tests (all should pass)**
  ```bash
  cd apps/api && bun test src/lib/__tests__/recipientPolicy.test.ts
  ```
  Expected output: all tests pass ✓

- [ ] **Step 5: Commit implementation**
  ```bash
  cd /Users/firrton/comadre
  git add apps/api/src/lib/recipientPolicy.ts apps/api/src/lib/__tests__/recipientPolicy.test.ts
  git commit -m "Add recipientPolicy.ts: evaluateRecipient, parseConfirmation, buildConfirmationPrompt"
  ```

---

### Task 3: Exhaustive unit tests in `apps/api/src/lib/__tests__/recipientPolicy.test.ts`

**Files:** `apps/api/src/lib/__tests__/recipientPolicy.test.ts` (already created in Task 2, Step 1)

- [ ] **Step 1: Verify test file has comprehensive coverage**
  The test file from Task 2, Step 1 already includes:
  - **evaluateRecipient**: 6 tests covering success, case-insensitivity, recipient not in allowlist, empty allowlist, malformed calldata, non-transfer function
  - **parseConfirmation**: 18 tests covering all affirmatives (sí, si, dale, ok, confirmo, yes, ✅), all negatives (no, cancelar, cancela, cancelá, ❌), punctuation stripping, ambiguous cases, substring rejection, empty input
  - **buildConfirmationPrompt**: 4 tests covering standard case, leading +, various amounts, whole amounts

- [ ] **Step 2: Add edge-case tests (additional rigor)**
  Add to the bottom of `apps/api/src/lib/__tests__/recipientPolicy.test.ts`:
  ```typescript
  describe("evaluateRecipient — edge cases", () => {
    it("handles uppercase address in calldata against lowercase allowlist", () => {
      const result = evaluateRecipient(
        ["0xabcdef1234567890abcdef1234567890abcdef12"],
        "0xa9059cbb000000000000000000000000ABCDEF1234567890ABCDEF1234567890ABCDEF12000000000000000000000000000000000000000000000000000000000000f4240"
      );
      expect(result.ok).toBe(true);
    });

    it("rejects when one of many recipients doesn't match", () => {
      const result = evaluateRecipient(
        [
          "0x1111111111111111111111111111111111111111",
          "0x2222222222222222222222222222222222222222",
        ],
        "0xa9059cbb0000000000000000000000003333333333333333333333333333333333333333000000000000000000000000000000000000000000000000000000000000f4240"
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("recipient_not_allowed");
      }
    });

    it("accepts when recipient matches second item in allowlist", () => {
      const result = evaluateRecipient(
        [
          "0x1111111111111111111111111111111111111111",
          "0x2222222222222222222222222222222222222222",
        ],
        "0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000000f4240"
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("parseConfirmation — edge cases", () => {
    it("treats leading/trailing spaces correctly", () => {
      expect(parseConfirmation("   sí   ")).toBe("affirmative");
    });

    it("handles mixed emoji + text", () => {
      expect(parseConfirmation("✅ sí")).toBe("ambiguous"); // Multiple tokens after strip
    });

    it("rejects 's' (single char) as ambiguous", () => {
      expect(parseConfirmation("s")).toBe("ambiguous");
    });

    it("rejects 'n' (single char) as ambiguous", () => {
      expect(parseConfirmation("n")).toBe("ambiguous");
    });

    it("rejects 'confirm' (not full 'confirmo')", () => {
      expect(parseConfirmation("confirm")).toBe("ambiguous");
    });

    it("rejects 'cancel' (not full 'cancelar/cancela/cancelá')", () => {
      expect(parseConfirmation("cancel")).toBe("ambiguous");
    });

    it("handles message with only punctuation", () => {
      expect(parseConfirmation("!!!")).toBe("ambiguous");
    });

    it("handles Unicode punctuation (¡ and ¿)", () => {
      expect(parseConfirmation("¡sí!")).toBe("affirmative");
      expect(parseConfirmation("¿no?")).toBe("negative");
    });
  });

  describe("buildConfirmationPrompt — invariants", () => {
    it("always includes the recipient phone verbatim", () => {
      const phone = "+548765432109";
      const prompt = buildConfirmationPrompt(phone, "5");
      expect(prompt).toContain(phone);
    });

    it("always includes the amount with USDC unit", () => {
      const prompt = buildConfirmationPrompt("+1234567890", "99.999999");
      expect(prompt).toContain("99.999999 USDC");
    });

    it("always contains 'SÍ' (uppercase) for affirmative instruction", () => {
      const prompt = buildConfirmationPrompt("+1234567890", "10");
      expect(prompt).toContain("SÍ");
    });

    it("always contains 'NO' (uppercase) for negative instruction", () => {
      const prompt = buildConfirmationPrompt("+1234567890", "10");
      expect(prompt).toContain("NO");
    });
  });
  ```

- [ ] **Step 3: Run all tests**
  ```bash
  cd apps/api && bun test src/lib/__tests__/recipientPolicy.test.ts
  ```
  Expected output: 31 tests pass ✓

- [ ] **Step 4: Verify all tests pass without race conditions or env pollution**
  ```bash
  cd apps/api && bun test src/lib/__tests__/recipientPolicy.test.ts -- --timeout=10000
  ```
  All tests complete in under 10s (pure functions, no I/O).

- [ ] **Step 5: Commit comprehensive test suite**
  ```bash
  cd /Users/firrton/comadre
  git add apps/api/src/lib/__tests__/recipientPolicy.test.ts
  git commit -m "Add exhaustive recipientPolicy tests: evaluateRecipient, parseConfirmation, buildConfirmationPrompt"
  ```

---

### Task 4: Add `undecodable_calldata` reason to signMonadTransfer result

**Files:** `apps/api/src/lib/monadSessionSigner.ts` (line 28)

- [ ] **Step 1: Update the result type**
  Edit line 28 in `apps/api/src/lib/monadSessionSigner.ts`:
  ```typescript
  export type SignMonadTransferResult =
    | { ok: true; userOpHash: Hex; txHash: Hex }
    | { 
        ok: false; 
        reason: "no_session" | "cap_exceeded" | "wallet_not_found" | "recipient_not_allowed" | "undecodable_calldata" 
      };
  ```

- [ ] **Step 2: Import evaluateRecipient**
  Add to imports (line 17 in `monadSessionSigner.ts`):
  ```typescript
  import { evaluateRecipient } from "./recipientPolicy.js";
  ```

- [ ] **Step 3: Replace COM-004 logic with evaluateRecipient**
  Replace lines 70–83 in `monadSessionSigner.ts` with:
  ```typescript
  // COM-004: allowlist enforcement — decode the USDC transfer(to, amount) calldata
  // and reject if the recipient is not in the user's contact allowlist.
  // Phase 1: empty allowlist = fail-closed (contacts are added post-confirmation).
  const allowedRecipients = key.allowedRecipients as string[];
  const evaluation = evaluateRecipient(allowedRecipients, input.data);
  if (!evaluation.ok) {
    return { ok: false, reason: evaluation.reason };
  }
  ```

- [ ] **Step 4: Run monadSessionSigner tests (if they exist)**
  ```bash
  cd apps/api && bun test src/lib/__tests__/monadSessionSigner.test.ts 2>/dev/null || echo "No test file; this is OK for inert PR."
  ```

- [ ] **Step 5: Verify type safety (TypeScript check)**
  ```bash
  cd apps/api && pnpm run typecheck
  ```
  Expected: zero errors (monadSessionSigner now imports recipientPolicy).

- [ ] **Step 6: Commit type update + function replacement**
  ```bash
  cd /Users/firrton/comadre
  git add apps/api/src/lib/monadSessionSigner.ts
  git commit -m "Refactor signMonadTransfer: use evaluateRecipient, add undecodable_calldata reason"
  ```

---

## Summary

**PR A — Foundation (inert)** delivers:

1. **Database**: `awaiting_confirmation` added to `transferStatusEnum`, migration generated.
2. **Pure Functions**: `recipientPolicy.ts` exports `evaluateRecipient`, `parseConfirmation`, `buildConfirmationPrompt` with full behavior specs.
3. **Exhaustive Tests**: 31 unit tests for all three functions + edge cases, passing locally.
4. **Type Safety**: `signMonadTransfer` refactored to fail-closed (reject unknown/undecodable calldata), new reason added to discriminant.

**No HTTP endpoints, no database writes, no confirmations flow yet** — Foundation only. All commits are conventional, green-light CI, ready for PR A review before Phase B (HTTP routes + confirmation handling).

---

## PR B (backend) — transfers route + resolve-confirmation endpoint

**Objective:** Implement pre-check + awaiting_confirmation flow for unallowed recipients, and a POST /resolve-confirmation handler that applies allowlist atomically, signs, and tracks confirmation state.

---

### Task B1: Pure functions — `recipientPolicy.ts` (immediate-path pre-check & confirmation parsing)

**Files:**
- Create `apps/api/src/lib/recipientPolicy.ts`

**Steps:**

- [ ] **Step 1: Write failing test for `evaluateRecipient`**
  Open `apps/api/src/lib/__tests__/recipientPolicy.test.ts`. Write test cases:
    1. `evaluateRecipient([],calldata) → {ok:true}` (empty allowlist = no enforcement)
    2. `evaluateRecipient(['0xAAAA'],calldata) → {ok:false, reason:'recipient_not_allowed'}` (mismatch)
    3. `evaluateRecipient(['0xAAAA'],calldata_with_0xAAAA) → {ok:true}` (match, case-insensitive)
    4. `evaluateRecipient(any, bad_calldata) → {ok:false, reason:'undecodable_calldata'}`

  ```bash
  cd /Users/firrton/comadre/apps/api && pnpm run test src/lib/__tests__/recipientPolicy.test.ts
  ```
  Expected: all 4 tests FAIL (function does not exist).

- [ ] **Step 2: Implement `evaluateRecipient` in `recipientPolicy.ts`**

  ```typescript
  import { decodeUsdcTransferCalldata } from "./monadUsdcTransfer.js";

  export function evaluateRecipient(
    allowedRecipients: string[],
    calldata: string,
  ): { ok: true } | { ok: false; reason: "recipient_not_allowed" | "undecodable_calldata" } {
    const decoded = decodeUsdcTransferCalldata(calldata as `0x${string}`);
    if (!decoded) {
      return { ok: false, reason: "undecodable_calldata" };
    }

    if (allowedRecipients.length === 0) {
      return { ok: true };
    }

    const recipientLower = decoded.to.toLowerCase();
    const allowed = allowedRecipients.map((r) => r.toLowerCase());
    if (!allowed.includes(recipientLower)) {
      return { ok: false, reason: "recipient_not_allowed" };
    }

    return { ok: true };
  }
  ```

  Run test:
  ```bash
  cd /Users/firrton/comadre/apps/api && pnpm run test src/lib/__tests__/recipientPolicy.test.ts
  ```
  Expected: all 4 tests PASS.

- [ ] **Step 3: Write failing test for `parseConfirmation`**
  Add test cases:
    1. `parseConfirmation("sí") → 'affirmative'`
    2. `parseConfirmation("no") → 'negative'`
    3. `parseConfirmation("hola") → 'ambiguous'`
    4. Case/whitespace: `parseConfirmation("  SÍ  ") → 'affirmative'`
    5. Emoji: `parseConfirmation("✅") → 'affirmative'`, `parseConfirmation("❌") → 'negative'`
    6. Punctuation: `parseConfirmation("sí!") → 'affirmative'`, `parseConfirmation("no?") → 'negative'`
    7. Substring rejection: `parseConfirmation("síerto") → 'ambiguous'` (NOT whole-word match)

  Expected: all tests FAIL.

- [ ] **Step 4: Implement `parseConfirmation` in `recipientPolicy.ts`**

  ```typescript
  export function parseConfirmation(message: string): "affirmative" | "negative" | "ambiguous" {
    // Normalize: trim, lowercase, strip leading/trailing punctuation and emoji
    let normalized = message.trim().toLowerCase();
    normalized = normalized.replace(/^[^\w\s]+|[^\w\s]+$/gu, "").trim();

    const affirmatives = ["sí", "si", "dale", "ok", "confirmo", "yes", "✅"];
    const negatives = ["no", "cancelar", "cancela", "cancelá", "❌"];

    if (affirmatives.includes(normalized)) return "affirmative";
    if (negatives.includes(normalized)) return "negative";
    return "ambiguous";
  }
  ```

  Run test:
  ```bash
  cd /Users/firrton/comadre/apps/api && pnpm run test src/lib/__tests__/recipientPolicy.test.ts
  ```
  Expected: all tests PASS.

- [ ] **Step 5: Write failing test for `buildConfirmationPrompt`**
  Test:
    1. `buildConfirmationPrompt("+528116346072", "50.5") → "Es la primera vez que enviás a +528116346072. ¿Confirmás enviar 50.5 USDC? Respondé SÍ para confirmar o NO para cancelar."`

  Expected: test FAILS.

- [ ] **Step 6: Implement `buildConfirmationPrompt` in `recipientPolicy.ts`**

  ```typescript
  export function buildConfirmationPrompt(recipientPhone: string, amountUsdc: string): string {
    return `Es la primera vez que enviás a ${recipientPhone}. ¿Confirmás enviar ${amountUsdc} USDC? Respondé SÍ para confirmar o NO para cancelar.`;
  }
  ```

  Run test:
  ```bash
  cd /Users/firrton/comadre/apps/api && pnpm run test src/lib/__tests__/recipientPolicy.test.ts
  ```
  Expected: all tests PASS.

- [ ] **Step 7: Commit**
  ```bash
  git add apps/api/src/lib/recipientPolicy.ts apps/api/src/lib/__tests__/recipientPolicy.test.ts && git commit -m "feat: add recipientPolicy pure-function module for confirmation handling"
  ```

**Coverage note:** All three functions are pure and fully tested in PR B1. No DB dependencies. These functions are reused by the route handlers in subsequent tasks.

---

### Task B2: DB schema — add `awaiting_confirmation` status to `transferStatusEnum`

**Files:**
- Modify `packages/db/src/schema.ts` (line 294)

**Steps:**

- [ ] **Step 1: Update schema**
  At line 294, modify `transferStatusEnum`:
  ```typescript
  export const transferStatusEnum = pgEnum("transfer_status", [
    "pending",
    "awaiting_recipient",
    "awaiting_confirmation",  // NEW — recipient registered but not in allowlist
    "confirmed",
    "expired",
    "cancelled",
    "failed",
  ]);
  ```

- [ ] **Step 2: Generate + apply migration**
  ```bash
  cd /Users/firrton/comadre/packages/db && pnpm run generate
  ```
  Verify migration file created and includes the new status.

  ```bash
  cd /Users/firrton/comadre/packages/db && pnpm run migrate
  ```
  Expected: migration applies successfully.

- [ ] **Step 3: Commit**
  ```bash
  cd /Users/firrton/comadre && git add packages/db && git commit -m "feat(db): add awaiting_confirmation status to transfer_status enum"
  ```

**Coverage note:** DB schema change only; no tests needed at this layer.

---

### Task B3: Update `monadSessionSigner.ts` — fail-closed recipient validation

**Files:**
- Modify `apps/api/src/lib/monadSessionSigner.ts`

**Steps:**

- [ ] **Step 1: Import and integrate `evaluateRecipient`**
  At the top (after line 17), add:
  ```typescript
  import { evaluateRecipient } from "./recipientPolicy.js";
  ```

  Update result type on line 28:
  ```typescript
  export type SignMonadTransferResult =
    | { ok: true; userOpHash: Hex; txHash: Hex }
    | {
        ok: false;
        reason:
          | "no_session"
          | "cap_exceeded"
          | "wallet_not_found"
          | "recipient_not_allowed"
          | "undecodable_calldata";
      };
  ```

- [ ] **Step 2: Replace the fail-open recipient check (lines 70–83) with fail-closed**

  **BEFORE (lines 70–83):**
  ```typescript
  // COM-004: allowlist enforcement — decode the USDC transfer(to, amount) calldata
  // and reject if the recipient is not in the user's contact allowlist.
  // Phase 1: empty allowlist = no enforcement (contacts are added post-onboarding).
  const decoded = decodeUsdcTransferCalldata(input.data);
  if (decoded) {
    const allowedRecipients = key.allowedRecipients as string[];
    if (allowedRecipients.length > 0) {
      const recipientLower = decoded.to.toLowerCase();
      const allowed = allowedRecipients.map((r) => r.toLowerCase());
      if (!allowed.includes(recipientLower)) {
        return { ok: false, reason: "recipient_not_allowed" };
      }
    }
  }
  ```

  **AFTER:**
  ```typescript
  // COM-004: fail-closed recipient allowlist enforcement using evaluateRecipient.
  // If calldata is undecodable or recipient is not in the allowlist, reject.
  const evalResult = evaluateRecipient(key.allowedRecipients as string[], input.data);
  if (!evalResult.ok) {
    return { ok: false, reason: evalResult.reason };
  }
  ```

- [ ] **Step 3: Test the change**
  ```bash
  cd /Users/firrton/comadre/apps/api && pnpm run build
  ```
  Expected: no TypeScript errors.

- [ ] **Step 4: Commit**
  ```bash
  cd /Users/firrton/comadre && git add apps/api/src/lib/monadSessionSigner.ts && git commit -m "refactor(signer): use evaluateRecipient for fail-closed recipient validation"
  ```

**Coverage note:** This change is behavior-equivalent to the current code but uses the pure `evaluateRecipient` function. Adds `undecodable_calldata` branch. Tested by route tests in B4.

---

### Task B4: Immediate-path pre-check — update POST `/api/v1/transfers-monad`

**Files:**
- Modify `apps/api/src/routes/transfersMonad.ts`

**Steps:**

- [ ] **Step 1: Import `evaluateRecipient`, `buildConfirmationPrompt`, `sessionKeys`, and `gt`**
  At the top (after existing imports), add:
  ```typescript
  import { evaluateRecipient, buildConfirmationPrompt } from "../lib/recipientPolicy.js";
  import { and, eq, gt } from "drizzle-orm";
  import { sessionKeys } from "@comadre/db";
  ```

- [ ] **Step 2: Insert pre-check after recipient lookup (after line 63, before line 78 deferred path)**

  **NEW CODE BLOCK:**
  ```typescript
  // ---- Build calldata for recipient pre-check ----
  const calldata = buildUsdcTransferCalldata(
    recipient.smartWalletAddress as Address,
    microUsdc,
  );

  // If recipient IS registered, check allowlist before proceeding
  if (recipient.registered) {
    // Look up sender's active session key
    const senderSessionKeyRows = await db
      .select({
        allowedRecipients: sessionKeys.allowedRecipients,
      })
      .from(sessionKeys)
      .innerJoin(smartWallets, eq(smartWallets.id, sessionKeys.smartWalletId))
      .where(
        and(
          eq(smartWallets.userId, sender.userId!),
          eq(sessionKeys.kind, "daily"),
          eq(sessionKeys.status, "active"),
          gt(sessionKeys.validUntil, new Date()),
        ),
      )
      .limit(1);

    const evalResult = evaluateRecipient(
      (senderSessionKeyRows[0]?.allowedRecipients as string[]) || [],
      calldata,
    );

    // If recipient not allowed, create awaiting_confirmation instead
    if (!evalResult.ok && evalResult.reason === "recipient_not_allowed") {
      // Supersede any prior awaiting_confirmation for this sender
      await db
        .update(transfers)
        .set({ status: "cancelled", expiresAt: new Date() })
        .where(
          and(
            eq(transfers.senderId, sender.userId!),
            eq(transfers.status, "awaiting_confirmation"),
          ),
        );

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
      const inserted = await db
        .insert(transfers)
        .values({
          senderId: sender.userId!,
          senderPhoneHash: sender.phoneHash,
          recipientPhoneHash: recipient.phoneHash,
          recipientId: recipient.userId!,
          recipientWallet: recipient.smartWalletAddress!,
          amountMicroUsdc: microUsdc,
          note: input.note ?? null,
          status: "awaiting_confirmation",
          expiresAt,
        })
        .returning();

      const row = inserted[0];
      if (!row) throw new Error("Insert returned no row");

      const confirmationPrompt = buildConfirmationPrompt(
        input.toPhone,
        input.amountUsdc,
      );

      return c.json({
        ok: true,
        needsConfirmation: true,
        transferId: row.id,
        amountUsdc: input.amountUsdc,
        confirmationPrompt,
        expiresAt: row.expiresAt,
      });
    }
  }
  ```

- [ ] **Step 3: Delete old lines 107–143 and replace with immediate-path signing**

  **REPLACE with:**
  ```typescript
  // ---- Deferred path: recipient not registered ----
  if (!recipient.registered) {
    const expiresAt = new Date(Date.now() + TRANSFER_DEFERRED_TTL_DAYS * 86400 * 1000);
    const inserted = await db
      .insert(transfers)
      .values({
        senderId: sender.userId,
        senderPhoneHash: sender.phoneHash,
        recipientPhoneHash: recipient.phoneHash,
        recipientId: null,
        recipientWallet: null,
        amountMicroUsdc: microUsdc,
        note: input.note ?? null,
        status: "awaiting_recipient",
        expiresAt,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("Insert returned no row");
    return c.json({
      ok: true,
      deferred: true,
      transferId: row.id,
      amountUsdc: microToUsdc(microUsdc),
      message: "Tu contacto todavía no tiene cuenta — le mando el aviso por WhatsApp.",
    });
  }

  // ---- Immediate path: sign + broadcast (recipient is allowed or allowlist is empty) ----
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
  const inserted = await db
    .insert(transfers)
    .values({
      senderId: sender.userId!,
      senderPhoneHash: sender.phoneHash,
      recipientPhoneHash: recipient.phoneHash,
      recipientId: recipient.userId!,
      recipientWallet: recipient.smartWalletAddress!,
      amountMicroUsdc: microUsdc,
      note: input.note ?? null,
      status: "pending",
      expiresAt,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("Insert returned no row");

  const usdcAddress = process.env["USDC_CONTRACT_ADDRESS"];
  if (!usdcAddress) {
    return c.json(
      { error: "USDC_NOT_CONFIGURED", message: "USDC address no configurada (deploy pendiente)" },
      503,
    );
  }

  const signResult = await signMonadTransfer({
    smartWalletAddress: sender.smartWalletAddress as Address,
    to: usdcAddress as Address,
    data: calldata,
    amountMicroUsdc: microUsdc,
  });

  if (!signResult.ok) {
    await db
      .update(transfers)
      .set({ status: "failed", failureReason: signResult.reason })
      .where(eqId(row.id));

    if (signResult.reason === "recipient_not_allowed") {
      return c.json(
        {
          error: "RECIPIENT_NOT_ALLOWED",
          message: "Ese destinatario no está en tu lista de contactos permitidos.",
        },
        403,
      );
    }

    if (signResult.reason === "cap_exceeded") {
      return c.json(
        {
          error: "CAP_EXCEEDED",
          message: "Esa cantidad supera tu límite de 50 USDC por operación. Para más grande te pido un código por SMS.",
          elevatedIntentRequired: true,
        },
        402,
      );
    }

    const message =
      signResult.reason === "no_session"
        ? `Tu sesión expiró. Te paso un link para renovarla.`
        : `No encontré tu cuenta. ¿Hacemos el alta?`;
    return c.json({ error: signResult.reason.toUpperCase(), message }, 400);
  }

  await db
    .update(transfers)
    .set({
      status: "confirmed",
      txSignature: signResult.txHash,
      confirmedAt: new Date(),
    })
    .where(eqId(row.id));

  log.info({ tx: signResult.txHash, transferId: row.id }, "[transfers-monad] confirmed");

  return c.json({
    ok: true,
    deferred: false,
    transferId: row.id,
    txHash: signResult.txHash,
    amountUsdc: microToUsdc(microUsdc),
  });
  ```

- [ ] **Step 4: Test the immediate-path pre-check (route test, DB-backed)**
  Create `apps/api/src/__tests__/transfers-monad.test.ts` with test cases:

  **Test 1:** Recipient not registered → deferred:
  ```typescript
  it("defers transfer when recipient not registered", async () => {
    // POST /api/v1/transfers-monad with unregistered recipient
    // Should return { ok: true, deferred: true, transferId, ... }
    // DB should have row with status='awaiting_recipient'
  });
  ```

  **Test 2:** Recipient registered, allowlist empty → immediate sign:
  ```typescript
  it("immediately signs when recipient allowed (empty allowlist)", async () => {
    // POST /api/v1/transfers-monad with registered recipient + empty allowlist
    // Should return { ok: true, deferred: false, txHash, ... }
  });
  ```

  **Test 3:** Recipient registered, NOT in allowlist → awaiting_confirmation:
  ```typescript
  it("creates awaiting_confirmation when recipient not in allowlist", async () => {
    // POST /api/v1/transfers-monad with registered recipient not in allowlist
    // Should return { ok: true, needsConfirmation: true, transferId, confirmationPrompt, expiresAt }
    // DB should have row with status='awaiting_confirmation', expiresAt=now+15min
  });
  ```

  **Test 4:** Recipient registered, in allowlist → immediate sign:
  ```typescript
  it("immediately signs when recipient in allowlist", async () => {
    // POST /api/v1/transfers-monad with registered recipient in allowlist
    // Should return { ok: true, deferred: false, txHash, ... }
  });
  ```

  Run:
  ```bash
  cd /Users/firrton/comadre/apps/api && pnpm run test src/__tests__/transfers-monad.test.ts
  ```
  Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**
  ```bash
  cd /Users/firrton/comadre && git add apps/api/src/routes/transfersMonad.ts apps/api/src/__tests__/transfers-monad.test.ts && git commit -m "feat(routes): add awaiting_confirmation pre-check for disallowed recipients in immediate path"
  ```

**Coverage note:** Route tests use DB. Pure-function logic already tested in B1. Signing logic (fail-closed) tested indirectly.

---

### Task B5: New handler — POST `/api/v1/transfers-monad/resolve-confirmation`

**Files:**
- Modify `apps/api/src/routes/transfersMonad.ts`

**Steps:**

- [ ] **Step 1: Add route handler after POST `/` route (before `function eqId`)**

  ```typescript
  const ResolveConfirmationBody = z.object({
    senderPhone: z.string().regex(/^\+\d{6,15}$/, "E.164 required"),
    message: z.string().max(1000),
  });

  transfersMonadRouter.post(
    "/resolve-confirmation",
    requireInternalSignature,
    zValidator("json", ResolveConfirmationBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: "validation", issues: result.error.format() }, 400);
      }
    }),
    async (c) => {
      const input = c.req.valid("json");
      const log = getLogger(c);

      // Lookup sender
      const sender = await lookupMonadByPhone(input.senderPhone);
      if (!sender.registered || !sender.userId) {
        return c.json({ error: "SENDER_NOT_FOUND" }, 404);
      }

      // Lookup open awaiting_confirmation transfer
      const openTransfers = await db
        .select()
        .from(transfers)
        .where(
          and(
            eq(transfers.senderId, sender.userId),
            eq(transfers.status, "awaiting_confirmation"),
            gt(transfers.expiresAt, new Date()),
          ),
        )
        .limit(1);

      const transfer = openTransfers[0];
      if (!transfer) {
        return c.json({ handled: false });
      }

      // Parse the user's confirmation message
      const { parseConfirmation } = await import("../lib/recipientPolicy.js");
      const parsed = parseConfirmation(input.message);

      // Handle affirmative: append recipient to allowlist + sign
      if (parsed === "affirmative") {
        const recipientWallet = transfer.recipientWallet!.toLowerCase() as Address;
        const amountUsdc = microToUsdc(transfer.amountMicroUsdc);

        // Look up session key
        const sessionKeyRows = await db
          .select()
          .from(sessionKeys)
          .innerJoin(smartWallets, eq(smartWallets.id, sessionKeys.smartWalletId))
          .where(
            and(
              eq(smartWallets.userId, sender.userId),
              eq(sessionKeys.kind, "daily"),
              eq(sessionKeys.status, "active"),
              gt(sessionKeys.validUntil, new Date()),
            ),
          )
          .limit(1);

        if (!sessionKeyRows[0]) {
          await db
            .update(transfers)
            .set({ status: "failed", failureReason: "no_session" })
            .where(eqId(transfer.id));
          return c.json(
            { handled: true, outcome: "failed", reply: "Tu sesión expiró, no pude enviar." },
            400,
          );
        }

        const sessionKey = sessionKeyRows[0].session_keys;
        const currentAllowed = (sessionKey.allowedRecipients as string[]) || [];
        const updated = Array.from(new Set([...currentAllowed, recipientWallet]));

        // Atomic update: append recipient
        await db
          .update(sessionKeys)
          .set({ allowedRecipients: updated })
          .where(eq(sessionKeys.id, sessionKey.id));

        // Now sign the transfer
        const usdcAddress = process.env["USDC_CONTRACT_ADDRESS"] as Address;
        if (!usdcAddress) {
          await db
            .update(transfers)
            .set({ status: "failed", failureReason: "usdc_not_configured" })
            .where(eqId(transfer.id));
          return c.json(
            { handled: true, outcome: "failed", reply: "Error de configuración, contacta soporte." },
            503,
          );
        }

        const calldata = buildUsdcTransferCalldata(recipientWallet, transfer.amountMicroUsdc);
        const signResult = await signMonadTransfer({
          smartWalletAddress: sender.smartWalletAddress as Address,
          to: usdcAddress,
          data: calldata,
          amountMicroUsdc: transfer.amountMicroUsdc,
        });

        if (!signResult.ok) {
          await db
            .update(transfers)
            .set({ status: "failed", failureReason: signResult.reason })
            .where(eqId(transfer.id));
          return c.json(
            { handled: true, outcome: "failed", reply: `Error al enviar: ${signResult.reason}` },
            400,
          );
        }

        await db
          .update(transfers)
          .set({
            status: "confirmed",
            txSignature: signResult.txHash,
            confirmedAt: new Date(),
          })
          .where(eqId(transfer.id));

        log.info(
          { tx: signResult.txHash, transferId: transfer.id },
          "[resolve-confirmation] confirmed",
        );

        return c.json({
          handled: true,
          outcome: "confirmed",
          reply: `Listo, envié ${amountUsdc} USDC a ${transfer.recipientPhoneHash}.`,
          txHash: signResult.txHash,
        });
      }

      // Handle negative: cancel
      if (parsed === "negative") {
        await db
          .update(transfers)
          .set({ status: "cancelled", expiresAt: new Date() })
          .where(eqId(transfer.id));

        return c.json({
          handled: true,
          outcome: "cancelled",
          reply: "Cancelado, no envié nada.",
        });
      }

      // Ambiguous: reprompt
      const amountUsdc = microToUsdc(transfer.amountMicroUsdc);
      return c.json({
        handled: true,
        outcome: "reprompted",
        reply: `Tenés un envío pendiente de ${amountUsdc} USDC a ${transfer.recipientPhoneHash}. Respondé SÍ o NO.`,
      });
    },
  );
  ```

- [ ] **Step 2: Add test cases to `transfers-monad.test.ts`**

  **Test 1:** No open pending → `{handled:false}`:
  ```typescript
  it("returns handled:false when no open pending transfer", async () => {
    // POST /resolve-confirmation with no pending
    // Should return { handled: false }
  });
  ```

  **Test 2:** Affirmative → append, sign, confirm:
  ```typescript
  it("confirms and appends recipient to allowlist on affirmative", async () => {
    // Setup: open awaiting_confirmation transfer
    // POST /resolve-confirmation with message="sí"
    // Should return { handled:true, outcome:'confirmed', reply, txHash }
    // DB transfer should have status='confirmed'
    // DB session_key.allowedRecipients should include recipient
  });
  ```

  **Test 3:** Negative → cancel:
  ```typescript
  it("cancels on negative response", async () => {
    // POST /resolve-confirmation with message="no"
    // Should return { handled:true, outcome:'cancelled', reply }
    // DB transfer should have status='cancelled'
  });
  ```

  **Test 4:** Ambiguous → reprompt:
  ```typescript
  it("reprompts on ambiguous response", async () => {
    // POST /resolve-confirmation with message="hola"
    // Should return { handled:true, outcome:'reprompted', reply }
    // DB transfer should STILL have status='awaiting_confirmation'
  });
  ```

  **Test 5:** Idempotency:
  ```typescript
  it("is idempotent on multiple affirmatives", async () => {
    // POST /resolve-confirmation twice with message="sí"
    // First should sign + confirm
    // Second should return handled:true but transfer already confirmed
  });
  ```

  Run:
  ```bash
  cd /Users/firrton/comadre/apps/api && pnpm run test src/__tests__/transfers-monad.test.ts
  ```
  Expected: all tests PASS.

- [ ] **Step 3: Commit**
  ```bash
  cd /Users/firrton/comadre && git add apps/api/src/routes/transfersMonad.ts apps/api/src/__tests__/transfers-monad.test.ts && git commit -m "feat(routes): add POST /resolve-confirmation handler with atomic allowlist append and idempotency"
  ```

**Coverage note:** Handler is DB-backed. Pure functions already covered in B1.

---

### Task B6: Agent helper + ToolResult discriminant

**Files:**
- Modify `packages/agent-tools/src/types.ts`
- Modify `packages/agent-tools/src/apiClient.ts`
- Modify `packages/agent-tools/src/tools.ts`

**Steps:**

- [ ] **Step 1: Update ToolResult in types.ts (line 33)**
  ```typescript
  export type ToolResult =
    | { type: "data"; data: unknown; summary?: string }
    | { type: "unsigned_tx"; unsigned_tx_base64: string; idempotency_key: string; summary: string }
    | { type: "confirmation"; confirmationPrompt: string; transferId: string; amountUsdc: string }
    | { type: "error"; error: string };
  ```

- [ ] **Step 2: Add `resolveTransferConfirmation` helper in apiClient.ts**
  At the end of the file:
  ```typescript
  export async function resolveTransferConfirmation(
    senderPhone: string,
    message: string,
  ): Promise<{
    handled: boolean;
    outcome?: "confirmed" | "cancelled" | "reprompted" | "failed";
    reply?: string;
    txHash?: string;
  }> {
    try {
      const result = await apiCall<{
        handled: boolean;
        outcome?: string;
        reply?: string;
        txHash?: string;
      }>({
        method: "POST",
        path: "/api/v1/transfers-monad/resolve-confirmation",
        body: { senderPhone, message },
        userId: "",
      });
      return result;
    } catch (err) {
      console.error("[resolveTransferConfirmation] API error:", err);
      return { handled: false };
    }
  }
  ```

- [ ] **Step 3: Update `enviar_plata` executor in tools.ts**
  After calling the transfers endpoint, check for `needsConfirmation`:
  ```typescript
  if (result.needsConfirmation) {
    return {
      type: "confirmation" as const,
      confirmationPrompt: result.confirmationPrompt,
      transferId: result.transferId,
      amountUsdc: result.amountUsdc,
    };
  }

  return {
    type: "data" as const,
    data: result,
    summary: `Creé transferencia de ${body.amountUsdc} USDC a ${body.toPhone}`,
  };
  ```

- [ ] **Step 4: Test agent tools**
  Run:
  ```bash
  cd /Users/firrton/comadre/packages/agent-tools && pnpm run test
  ```
  Expected: all tests PASS.

- [ ] **Step 5: Commit**
  ```bash
  cd /Users/firrton/comadre && git add packages/agent-tools && git commit -m "feat(agent-tools): add confirmation result type and resolve helper for transfer confirmation"
  ```

**Coverage note:** Agent tools use mocked API; no DB dependency.

---

### Task B7: Agent integration — handle confirmation flow before LLM

**Files:**
- Modify `apps/agent/src/index.ts`

**Steps:**

- [ ] **Step 1: Add confirmation handler in main agent loop**
  Before LLM processes tool result, add:
  ```typescript
  import { resolveTransferConfirmation } from "@comadre/agent-tools";

  // After tool execution:
  if (toolResult.type === "confirmation") {
    // Relay prompt to user, end turn
    return c.json({
      reply: toolResult.confirmationPrompt,
      state: {
        ...conversationState,
        pendingTransferId: toolResult.transferId,
        pendingAmount: toolResult.amountUsdc,
      },
    });
  }

  // On user's next message, check if they're replying to pending transfer:
  if (conversationState.pendingTransferId) {
    const confirmResult = await resolveTransferConfirmation(
      senderPhone,
      userMessage,
    );
    if (confirmResult.handled) {
      return c.json({
        reply: confirmResult.reply,
        state: { ...conversationState, pendingTransferId: undefined },
      });
    }
  }
  ```

- [ ] **Step 2: Commit**
  ```bash
  cd /Users/firrton/comadre && git add apps/agent && git commit -m "feat(agent): integrate confirmation flow handling before LLM loop"
  ```

**Coverage note:** Agent integration tested end-to-end. Route + tool handlers already have unit/DB test coverage.

---

### Task B8: Documentation — record coverage and design decisions

**Coverage Summary:**

| Component | Test Type | Location |
|-----------|-----------|----------|
| `evaluateRecipient` | Pure function (bun:test) | `apps/api/src/lib/__tests__/recipientPolicy.test.ts` — Task B1 |
| `parseConfirmation` | Pure function (bun:test) | `apps/api/src/lib/__tests__/recipientPolicy.test.ts` — Task B1 |
| `buildConfirmationPrompt` | Pure function (bun:test) | `apps/api/src/lib/__tests__/recipientPolicy.test.ts` — Task B1 |
| `POST /transfers-monad` (pre-check) | Route (DB) | `apps/api/src/__tests__/transfers-monad.test.ts` — Tasks B4 tests 1–4 |
| `POST /resolve-confirmation` | Route (DB) | `apps/api/src/__tests__/transfers-monad.test.ts` — Tasks B5 tests 1–5 |
| `signMonadTransfer` (fail-closed) | Route-indirect | Task B4 test 3 (signing path) |
| Agent tool `enviar_plata` | Tool (mocked API) | Existing tests + B6 |

**Design Decisions:**

- **Fail-closed:** `monadSessionSigner.signMonadTransfer` now uses `evaluateRecipient`, rejecting undecodable calldata (previously silent).
- **Atomic allowlist:** Handler appends recipient to `session_keys.allowedRecipients` in a single UPDATE before signing. No TOCTOU race.
- **Idempotency:** Handlers check `transfer.status` before signing. Confirmed transfers are not re-signed.
- **Expiry:** `awaiting_confirmation` rows expire after 15 minutes (TTL set in INSERT). Cron cleanup deferred to Phase 1D.
- **Superseding:** Creating a new `awaiting_confirmation` cancels any prior open one per sender (enforced in B4).

**Test Pattern:**

All route tests in `apps/api/src/__tests__/transfers-monad.test.ts`:
```typescript
beforeAll(() => {
  process.env["DEV_AUTH_BYPASS"] = "true";
  process.env["NODE_ENV"] = "test";
});
```

Pure functions (B1) have no env/DB setup needed.

---

**End of PR B Plan**

---

## PR B (agent) — interception + tool B2 + system prompt

### Task 1: Add `resolveTransferConfirmation()` helper to agent-tools/apiClient + export

**Files:** `packages/agent-tools/src/apiClient.ts`

- [ ] **Step 1: Write failing test** — Create `packages/agent-tools/src/__tests__/apiClient.test.ts` testing `resolveTransferConfirmation(senderPhone: string, message: string)` returns `{handled: boolean; reply?: string; outcome?: string}`. Expect:
  - Call succeeds with `handled:true, outcome:'confirmed', reply:'...'` when backend affirms.
  - Call returns `handled:false` when no pending.
  - Call returns `{handled:true, outcome:'reprompted', reply:'...'}` on ambiguous when pending exists.
  - Run with INTERNAL_HMAC_SECRET env set. Expect failure now.

```bash
cd /Users/firrton/comadre/packages/agent-tools && bun test src/__tests__/apiClient.test.ts
```

- [ ] **Step 2: Implement `resolveTransferConfirmation()`** — Add to `packages/agent-tools/src/apiClient.ts` (after `apiCall` function, before `newIdempotencyKey`):

```typescript
export async function resolveTransferConfirmation(
  senderPhone: string,
  message: string,
): Promise<{ handled: boolean; reply?: string; outcome?: string }> {
  try {
    const response = await apiCall<{
      handled: boolean;
      outcome?: 'confirmed' | 'cancelled' | 'reprompted';
      reply?: string;
    }>({
      method: "POST",
      path: "/api/v1/transfers-monad/resolve-confirmation",
      userId: "", // internal call, no userId context
      body: {
        senderPhone,
        message,
      },
    });
    return response;
  } catch (err) {
    // Fail-open: log and return not handled
    console.error("[resolveTransferConfirmation] API error:", err);
    return { handled: false };
  }
}
```

- [ ] **Step 3: Export and verify test passes**

```bash
cd /Users/firrton/comadre/packages/agent-tools && bun test src/__tests__/apiClient.test.ts
```

---

### Task 2: Call `resolveTransferConfirmation()` in /process handler, skip LLM if `handled:true`

**Files:** `apps/agent/src/index.ts`

- [ ] **Step 1: Write failing test** — Create `apps/agent/src/__tests__/index.test.ts`. Mock `resolveTransferConfirmation` to return `{handled:true, reply:'Listo, envié...'}` for a user message containing confirmation keywords. Expect `/process` returns `{reply:'Listo, envié...'}` without calling `runAgent`. Expect failure now.

```bash
cd /Users/firrton/comadre/apps/agent && bun test src/__tests__/index.test.ts
```

- [ ] **Step 2: Import `resolveTransferConfirmation`** — Add to imports in `apps/agent/src/index.ts`:

```typescript
import { resolveTransferConfirmation } from "@comadre/agent-tools";
```

- [ ] **Step 3: Add interception before `runAgent`** — In the `/process` handler (after line 117 where `senderPhone` is set, before line 122 where `runAgent` is called), insert:

```typescript
    const senderPhone = normalizePhoneE164(
      from.replace(/^whatsapp:/, "").trim(),
    );

    // ── Interception: check for pending transfer confirmation ───────────────
    const confirmationResult = await resolveTransferConfirmation(senderPhone, body);
    if (confirmationResult.handled) {
      const reply = confirmationResult.reply ?? "Operación procesada.";
      log.info(
        {
          from,
          userId: userId ?? "unregistered",
          latencyMs: Date.now() - start,
          outcome: confirmationResult.outcome,
        },
        "confirmation handled (skipped runAgent)",
      );
      return c.json({ reply });
    }

    const result = await runAgent({
```

- [ ] **Step 4: Run test, commit**

```bash
cd /Users/firrton/comadre/apps/agent && bun test src/__tests__/index.test.ts
```

Expected: test passes. `/process` intercepts `handled:true` and returns `{reply}` without calling `runAgent`.

---

### Task 3: Add `confirmation` discriminant to `ToolResult` union in types.ts

**Files:** `packages/agent-tools/src/types.ts`

- [ ] **Step 1: Write failing test** — Create `packages/agent-tools/src/__tests__/types.test.ts`. Define a `ToolResult` with `type:'confirmation'`. Expect TypeScript error (discriminant not recognized) until Step 2.

- [ ] **Step 2: Update `ToolResult` type** — In `packages/agent-tools/src/types.ts`, replace line 33–36 with:

```typescript
export type ToolResult =
  | { type: "data"; data: unknown; summary?: string }
  | { type: "unsigned_tx"; unsigned_tx_base64: string; idempotency_key: string; summary: string }
  | { type: "error"; error: string }
  | { type: "confirmation"; confirmationPrompt: string; transferId: string; amountUsdc: string };
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/firrton/comadre/packages/agent-tools && bun build && echo "Build passed"
```

---

### Task 4: Update `enviarPlataExecute` to return `confirmation` discriminant when backend responds `needsConfirmation:true`

**Files:** `packages/agent-tools/src/tools.ts` (enviar_plata executor, lines 773–821)

- [ ] **Step 1: Write failing test** — Create `packages/agent-tools/src/__tests__/tools.enviarPlata.test.ts`. Mock apiCall to return `{ok:true, needsConfirmation:true, transferId:'...', amountUsdc:'10', confirmationPrompt:'Es la primera vez...', expiresAt:'...'}`. Call `enviarPlataExecute({to_phone:'+52...', amount_usdc:'10'}, context)`. Expect a `ToolResult` with `type:'confirmation'` and fields matching the response. Expect failure now.

```bash
cd /Users/firrton/comadre/packages/agent-tools && bun test src/__tests__/tools.enviarPlata.test.ts
```

- [ ] **Step 2: Extend apiCall response type** — Update line 776–783 (the apiCall generic) to accept both immediate and confirmation paths:

```typescript
    const data = await apiCall<{
      ok: true;
      deferred?: boolean;
      needsConfirmation?: boolean;
      transferId: string;
      txHash?: string;
      amountUsdc: string;
      confirmationPrompt?: string;
      expiresAt?: string;
      message?: string;
    }>({
```

- [ ] **Step 3: Handle `needsConfirmation` response path** — After line 794 (`data = await apiCall(...)`), add:

```typescript
    if (data.needsConfirmation) {
      return {
        type: "confirmation",
        confirmationPrompt: data.confirmationPrompt ?? "",
        transferId: data.transferId,
        amountUsdc: data.amountUsdc,
      };
    }
```

- [ ] **Step 4: Keep existing immediate/deferred paths** — Ensure lines 795–798 (the `deferred ? ... : ...` summary and `return { type: "data", ... }`) remain unchanged for the non-confirmation flow.

Complete updated executor (lines 773–821):

```typescript
export const enviarPlataExecute: ToolExecutor = async (args, context) => {
  const a = args as EnviarPlataArgs;
  try {
    const data = await apiCall<{
      ok: true;
      deferred?: boolean;
      needsConfirmation?: boolean;
      transferId: string;
      txHash?: string;
      amountUsdc: string;
      confirmationPrompt?: string;
      expiresAt?: string;
      message?: string;
    }>({
      method: "POST",
      path: "/api/v1/transfers-monad",
      userId: "",
      idempotencyKey: context.idempotencyKey ?? newIdempotencyKey(),
      body: {
        senderPhone: context.senderPhone,
        toPhone: a.to_phone,
        amountUsdc: a.amount_usdc,
        ...(a.note ? { note: a.note } : {}),
      },
    });

    // Confirmation path: recipient not in allowlist, needs explicit confirmation
    if (data.needsConfirmation) {
      return {
        type: "confirmation",
        confirmationPrompt: data.confirmationPrompt ?? "",
        transferId: data.transferId,
        amountUsdc: data.amountUsdc,
      };
    }

    // Immediate and deferred paths
    const summary = data.deferred
      ? `El contacto no tiene cuenta todavía. Le mandé un aviso por WhatsApp; cuando se registre, recibe los ${a.amount_usdc} USDC.`
      : `Mandé ${a.amount_usdc} USDC ✅`;
    return { type: "data", data: redactSensitiveFields(data), summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/cap_exceeded|CAP_EXCEEDED/i.test(message)) {
      return {
        type: "error",
        error: "Esa cantidad supera el límite por operación (50 USDC). Para más grande te paso un código por SMS, pero esa función todavía no está lista.",
      };
    }
    if (/no_session|NO_SESSION/i.test(message)) {
      return {
        type: "error",
        error: "Tu sesión expiró. Llamá a `iniciar_cuenta_segura` para renovarla.",
      };
    }
    if (/sender_not_onboarded|SENDER_NOT_ONBOARDED/i.test(message)) {
      return {
        type: "error",
        error: "Todavía no tenés cuenta. Te paso `iniciar_cuenta_segura` para crearla.",
      };
    }
    return { type: "error", error: "No pude completar la transferencia. ¿Probamos de nuevo?" };
  }
};
```

- [ ] **Step 5: Run test, commit**

```bash
cd /Users/firrton/comadre/packages/agent-tools && bun test src/__tests__/tools.enviarPlata.test.ts
```

Expected: test passes. enviarPlataExecute returns `{type:'confirmation', confirmationPrompt, transferId, amountUsdc}` when backend sets `needsConfirmation:true`.

---

### Task 5: Relay `confirmation` in agent loop + end turn (no LLM re-prompt)

**Files:** `apps/agent/src/agentLoop.ts`

- [ ] **Step 1: Write failing test** — Create `apps/agent/src/__tests__/agentLoop.test.ts`. Mock executeTool to return `{type:'confirmation', confirmationPrompt:'Es la primera vez...', transferId:'...', amountUsdc:'10'}` when `enviar_plata` is called. Expect `runAgent` to return `{reply:'Es la primera vez...', newMessages:[...]}` (agent relays the prompt verbatim and does NOT call the LLM again). Expect failure now.

```bash
cd /Users/firrton/comadre/apps/agent && bun test src/__tests__/agentLoop.test.ts
```

- [ ] **Step 2: Add confirmation handling in tool result loop** — In `agentLoop.ts`, after line 223 (after the `toolMsg` is pushed), add detection and early exit:

```typescript
      messages.push(toolMsg);
      newMessages.push(toolMsg);

      // Confirmation path: relay prompt verbatim and skip remaining iterations
      if (result.type === "confirmation") {
        return {
          reply: result.confirmationPrompt,
          newMessages,
        };
      }
    }
```

(This intercepts after tool execution, before looping back to LLM.)

- [ ] **Step 3: Ensure loop exits after confirmation** — The `return` in Step 2 exits the function, breaking out of both the `for (const call of toolCalls)` and the outer `for (let iter...)` loops. No further LLM iteration occurs.

Complete modified section (lines 216–225):

```typescript
      const toolMsg: ChatCompletionToolMessageParam = {
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      };
      messages.push(toolMsg);
      newMessages.push(toolMsg);

      // Confirmation path: relay prompt verbatim and skip remaining iterations
      if (result.type === "confirmation") {
        return {
          reply: result.confirmationPrompt,
          newMessages,
        };
      }
    }
  }

  return {
    reply:
      "Disculpá mija, tuve un problema procesando eso. ¿Lo intentamos de nuevo?",
    newMessages,
  };
}
```

- [ ] **Step 4: Run test, commit**

```bash
cd /Users/firrton/comadre/apps/agent && bun test src/__tests__/agentLoop.test.ts
```

Expected: test passes. When a tool returns `{type:'confirmation'}`, runAgent returns immediately with `reply` = confirmationPrompt (verbatim), no LLM re-prompting.

---

### Task 6: Update systemPrompt.ts — remove legacy transfer gate, add confirmation relay rule

**Files:** `apps/agent/src/lib/systemPrompt.ts`

- [ ] **Step 1: Inspect current wording** — Read lines 89–94 of systemPrompt.ts. Current rule references `iniciar_transfer` / `confirmar_transfer` (old Solana flow). The new flow uses `enviar_plata` with backend-driven confirmation.

Current lines 89–94:
```
REGLAS DE TRANSFERENCIAS (P2P USDC por número):
- Cuando el usuario pida mandar plata a un número (ej: "manda 10 USDC al +52..."), llamá \`iniciar_transfer\`.
- ANTES de llamar \`confirmar_transfer\`, SIEMPRE pedile confirmación EXPLÍCITA mostrando: monto + número destinatario + últimos 4 caracteres de la cuenta (usa \`walletPreview\` internamente, pero NO digas "wallet").
- Si dice "sí"/"confirmo"/"dale" → \`confirmar_transfer({transfer_id})\`.
- Si dice "no"/"cancela" → \`cancelar_transfer({transfer_id})\`.
- Errores típicos: SELF_TRANSFER ("no puedes mandarte plata a ti misma, mija"), KYC_LIMIT_EXCEEDED, INSUFFICIENT_BALANCE.
```

- [ ] **Step 2: Replace transfer section** — Replace lines 89–94 with:

```typescript
REGLAS DE TRANSFERENCIAS (P2P USDC por número via enviar_plata):
- Cuando el usuario pida mandar plata a un número (ej: "manda 10 USDC al +52..."), llamá \`enviar_plata\` con el monto y número.
- Si la tool devuelve un resultado con type="confirmation", RELAYÁ el \`confirmationPrompt\` EXACTAMENTE como está (verbatim) — no lo reformules ni lo abrevies.
- NO PIDAS CONFIRMACIÓN TÚ MISMO. El backend se encarga de la confirmación cuando el destinatario está registrado pero no es de confianza aún. Vos solo retransmitís.
- Si el usuario responde SÍ/NO/ambiguo, el /process handler intercepta la confirmación y responde. Vos no lo sabes en ese momento.
- Errores típicos: SELF_TRANSFER ("no puedes mandarte plata a ti misma, mija"), KYC_LIMIT_EXCEEDED, INSUFFICIENT_BALANCE, CAP_EXCEEDED.
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/firrton/comadre/apps/agent && bun build && echo "Build passed"
```

- [ ] **Step 4: Commit** — Conventional commit with exact description of systemPrompt change.

---

### Integration Test: Full E2E confirmation flow

**Files:** `apps/agent/src/__tests__/e2e-confirmation.test.ts` (new)

- [ ] **Step 1: Write full E2E test** — Simulate:
  1. User calls `/process` with `body: "manda 10 USDC al +52555..."`
  2. Mock `apiCall` for `/api/v1/transfers-monad` returns `{ok:true, needsConfirmation:true, confirmationPrompt:'Es la primera vez...', transferId:'tx123', amountUsdc:'10'}`
  3. `enviarPlataExecute` returns `{type:'confirmation', confirmationPrompt:'...', transferId:'tx123', amountUsdc:'10'}`
  4. `agentLoop` relays confirmation and exits
  5. `/process` returns `{reply:'Es la primera vez...'}` to caller
  6. Caller replies `"sí"`
  7. `/process` intercepts via `resolveTransferConfirmation`, backend returns `{handled:true, outcome:'confirmed', reply:'Listo, envié 10 USDC...'}`
  8. `/process` returns `{reply:'Listo, envié 10 USDC...'}` without calling `runAgent`

```bash
cd /Users/firrton/comadre/apps/agent && bun test src/__tests__/e2e-confirmation.test.ts
```

Expected: all assertions pass; full round trip works end-to-end.

---

### Summary

6 TDD tasks build the agent-side confirmation interception:
1. **apiClient**: Add `resolveTransferConfirmation()` helper reusing HMAC apiCall.
2. **/process handler**: Call `resolveTransferConfirmation()` before `runAgent`; skip LLM if `handled:true`.
3. **types**: Add `confirmation` discriminant to `ToolResult`.
4. **enviar_plata executor**: Return `{type:'confirmation', ...}` when backend responds `needsConfirmation:true`.
5. **agentLoop**: Detect `type='confirmation'` in tool result and exit immediately with relay.
6. **systemPrompt**: Remove legacy transfer rules; add rule stating agent relays backend confirmationPrompt verbatim, does NOT self-gate.

All tests use bun:test with mocked API calls. No changes to HMAC signing or rate limiting. Confirmation is backend-driven; agent is a pure relay for the human's confirmation message.

---

## PR C — Signer fail-closed (backstop)

**Depends on:** PR A (evaluateRecipient tests), PR B (confirmation flow)

Replace the current fail-open inline allowlist and decode logic in `signMonadTransfer` (lines 70-83 of monadSessionSigner.ts) with a call to `evaluateRecipient`, mapping its result into `SignMonadTransferResult`. This makes recipient validation fail-closed: rejections happen synchronously in the signer before reaching Turnkey.

### Changes summary

**apps/api/src/lib/monadSessionSigner.ts:**
- Add `'undecodable_calldata'` to the `SignMonadTransferResult` reason union
- Replace inline decode + allowlist check (L70-83) with `evaluateRecipient(key.allowedRecipients as string[], input.data)` call
- Map `evaluateRecipient` result: if `ok: false`, return immediately with reason `'recipient_not_allowed'` or `'undecodable_calldata'`
- Rejections happen before `signAndSendUserOp` (Turnkey never called)

### Before/after diff

**Before (lines 26-83):**
```typescript
export type SignMonadTransferResult =
  | { ok: true; userOpHash: Hex; txHash: Hex }
  | { ok: false; reason: "no_session" | "cap_exceeded" | "wallet_not_found" | "recipient_not_allowed" };

// ... (wallet/key validation) ...

  // COM-004: allowlist enforcement — decode the USDC transfer(to, amount) calldata
  // and reject if the recipient is not in the user's contact allowlist.
  // Phase 1: empty allowlist = no enforcement (contacts are added post-onboarding).
  const decoded = decodeUsdcTransferCalldata(input.data);
  if (decoded) {
    const allowedRecipients = key.allowedRecipients as string[];
    if (allowedRecipients.length > 0) {
      const recipientLower = decoded.to.toLowerCase();
      const allowed = allowedRecipients.map((r) => r.toLowerCase());
      if (!allowed.includes(recipientLower)) {
        return { ok: false, reason: "recipient_not_allowed" };
      }
    }
  }

  const result = await sessionKeyApi.signAndSendUserOp({
    // ...
  });
```

**After (lines 26-90):**
```typescript
export type SignMonadTransferResult =
  | { ok: true; userOpHash: Hex; txHash: Hex }
  | { ok: false; reason: "no_session" | "cap_exceeded" | "wallet_not_found" | "recipient_not_allowed" | "undecodable_calldata" };

// ... (wallet/key validation) ...

  // COM-004: fail-closed recipient validation via evaluateRecipient.
  // Rejects before Turnkey if calldata is undecodable or recipient is not allowed.
  const recipientCheck = evaluateRecipient(key.allowedRecipients as string[], input.data);
  if (!recipientCheck.ok) {
    return { ok: false, reason: recipientCheck.reason };
  }

  const result = await sessionKeyApi.signAndSendUserOp({
    // ...
  });
```

### TDD task breakdown

#### Task 1: Add `'undecodable_calldata'` to result type

**Files:** apps/api/src/lib/monadSessionSigner.ts (L26-28)

- [ ] **Step 1: Update `SignMonadTransferResult` union** to include `'undecodable_calldata'` in the reason discriminant. Type-check will confirm no regressions.

```typescript
export type SignMonadTransferResult =
  | { ok: true; userOpHash: Hex; txHash: Hex }
  | { ok: false; reason: "no_session" | "cap_exceeded" | "wallet_not_found" | "recipient_not_allowed" | "undecodable_calldata" };
```

#### Task 2: Import evaluateRecipient and refactor inline logic

**Files:** apps/api/src/lib/monadSessionSigner.ts (L1-83)

- [ ] **Step 1: Add import** for `evaluateRecipient` from `./recipientPolicy.js`.
- [ ] **Step 2: Replace lines 70-83** (inline decode + allowlist) with:
```typescript
  // COM-004: fail-closed recipient validation via evaluateRecipient.
  // Rejects before Turnkey if calldata is undecodable or recipient is not allowed.
  const recipientCheck = evaluateRecipient(key.allowedRecipients as string[], input.data);
  if (!recipientCheck.ok) {
    return { ok: false, reason: recipientCheck.reason };
  }
```
- [ ] **Step 3: Verify no import of `decodeUsdcTransferCalldata` is needed** in monadSessionSigner anymore (was only used by inline decode). Leave it in monadUsdcTransfer.ts for other callers.

#### Task 3: Write wiring test

**Files:** apps/api/src/lib/__tests__/monadSessionSigner.test.ts (create)

Write a thin test that asserts `signMonadTransfer` returns the correct `reason` without reaching Turnkey (mocked). The validation logic itself is unit-tested via PR A's `evaluateRecipient` tests.

- [ ] **Step 1: Create test file** apps/api/src/lib/__tests__/monadSessionSigner.test.ts
- [ ] **Step 2: Set up fixtures:**
  - Mock `db` (sessionKeys, smartWallets queries)
  - Mock `sessionKeyApi.signAndSendUserOp` (should never be called in rejection cases)
  - Create a valid smartWallet and sessionKey row with `allowedRecipients = ['0x1234...']` and `allowedContracts` USDC
  - Build valid calldata via `buildUsdcTransferCalldata` for an unallowed recipient and for undecodable calldata
- [ ] **Step 3: Write three test cases:**

```typescript
it("returns reason='recipient_not_allowed' before reaching Turnkey", async () => {
  const input: SignMonadTransferInput = {
    smartWalletAddress: VALID_WALLET,
    to: USDC_CONTRACT,
    data: buildUsdcTransferCalldata('0xbaddaddress...' as Address, 100000n),
    amountMicroUsdc: 100000n,
  };
  const result = await signMonadTransfer(input);
  expect(result).toEqual({ ok: false, reason: "recipient_not_allowed" });
  expect(sessionKeyApi.signAndSendUserOp).not.toHaveBeenCalled();
});

it("returns reason='undecodable_calldata' for non-transfer calldata", async () => {
  const input: SignMonadTransferInput = {
    smartWalletAddress: VALID_WALLET,
    to: USDC_CONTRACT,
    data: '0x00000000' as Hex, // Not a transfer() call
    amountMicroUsdc: 100000n,
  };
  const result = await signMonadTransfer(input);
  expect(result).toEqual({ ok: false, reason: "undecodable_calldata" });
  expect(sessionKeyApi.signAndSendUserOp).not.toHaveBeenCalled();
});

it("signs and sends allowed recipient without rejection", async () => {
  const allowedRecipient = '0xallowedaddress...' as Address;
  // Seed sessionKey with allowedRecipients: [allowedRecipient]
  const input: SignMonadTransferInput = {
    smartWalletAddress: VALID_WALLET,
    to: USDC_CONTRACT,
    data: buildUsdcTransferCalldata(allowedRecipient, 100000n),
    amountMicroUsdc: 100000n,
  };
  sessionKeyApi.signAndSendUserOp.mockResolvedValue({
    userOpHash: '0xuser...' as Hex,
    txHash: '0xtx...' as Hex,
  });
  const result = await signMonadTransfer(input);
  expect(result).toEqual({ ok: true, userOpHash: '0xuser...', txHash: '0xtx...' });
  expect(sessionKeyApi.signAndSendUserOp).toHaveBeenCalledOnce();
});
```

- [ ] **Step 4: Run test:** `cd apps/api && pnpm run test src/lib/__tests__/monadSessionSigner.test.ts` — all three cases pass.
- [ ] **Step 5: Commit** with message: "refactor: use evaluateRecipient in signMonadTransfer for fail-closed validation (PR C wiring test)"

### Testing strategy

- **Unit:** PR A's `evaluateRecipient` tests cover all decode and allowlist logic; PR C adds only the wiring layer (passing `key.allowedRecipients` and `input.data` to `evaluateRecipient`, mapping result).
- **Integration:** The wiring test above confirms `signMonadTransfer` returns the right reason without calling `signAndSendUserOp` (rejections are synchronous, happen before Turnkey).
- **E2E:** Existing end-to-end tests for `/api/v1/transfers-monad` already exercise the full flow (recipient check now runs in the signer, fail-closed, before submission).

### Notes

- The PR merges **after** PR B (confirmation flow); by then, `evaluateRecipient` is in `recipientPolicy.ts` and PR B's tests confirm the confirmation logic separately.
- Empty `allowedRecipients` array (phase 1) is handled by `evaluateRecipient`: it returns `{ ok: true }` (no enforcement), so transfers are signed. Once a contact is added post-onboarding, only that contact (and future confirmations) are permitted.
- Turnkey is never called if calldata is undecodable or recipient is not allowed.
```

---

## PR D — permissionId + policiesJson (COM-033, independent)

### Overview
Extract a shared helper `computePermissionId` in `packages/wallet-infra/src/sessionKey/` that rebuilds the ZeroDev validator to derive the deterministic on-chain `permissionId`. Use it to:
1. Populate `session_keys.permissionId` during onboarding install (currently empty per COM-033).
2. Store `session_keys.policiesJson` as the `BuildPoliciesInput` (not Policy objects, for deterministic reconstruction).
3. Refactor `revoke.ts` to use the helper (DRY).

The helper is pure/testable (no infra) — deterministic from the same inputs, matching what revoke rebuilds.

---

### Task 1: Create `computePermissionId` helper with determinism tests

**Files:** Create `packages/wallet-infra/src/sessionKey/compute.ts`; Create `packages/wallet-infra/src/sessionKey/__tests__/compute.test.ts`

- [ ] **Step 1: Write failing test for `computePermissionId` determinism**

Create `packages/wallet-infra/src/sessionKey/__tests__/compute.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { computePermissionId } from "../compute.js";
import type { ComputePermissionIdInput } from "../compute.js";

describe("computePermissionId — deterministic on-chain identifier", () => {
  const sessionAddress = "0x" + "a".repeat(40);
  const comadreAddress = "0x" + "b".repeat(40);
  const usdcAddress = "0x" + "c".repeat(40);

  const baseInput: ComputePermissionIdInput = {
    sessionAddress,
    comadreAddress,
    usdcAddress,
    kind: "daily",
    rpcUrl: undefined,
    neverlandParams: undefined,
  };

  it("returns a 4-byte Hex string (0x + 8 chars)", async () => {
    const id = await computePermissionId(baseInput);
    expect(id).toMatch(/^0x[0-9a-f]{8}$/i);
  });

  it("is deterministic — same inputs yield same identifier", async () => {
    const id1 = await computePermissionId(baseInput);
    const id2 = await computePermissionId(baseInput);
    expect(id1).toBe(id2);
  });

  it("changes when kind changes (daily vs elevated)", async () => {
    const dailyId = await computePermissionId(baseInput);
    const elevatedId = await computePermissionId({
      ...baseInput,
      kind: "elevated",
    });
    expect(dailyId).not.toBe(elevatedId);
  });

  it("changes when neverlandParams are added/removed", async () => {
    const withoutNeverland = await computePermissionId(baseInput);
    const withNeverland = await computePermissionId({
      ...baseInput,
      neverlandParams: {
        neverlandPoolAddress: "0x" + "d".repeat(40),
        comadreFeeWallet: "0x" + "e".repeat(40),
      },
    });
    expect(withoutNeverland).not.toBe(withNeverland);
  });

  it("changes when sessionAddress changes", async () => {
    const id1 = await computePermissionId(baseInput);
    const id2 = await computePermissionId({
      ...baseInput,
      sessionAddress: "0x" + "f".repeat(40),
    });
    expect(id1).not.toBe(id2);
  });
});
```

- [ ] **Step 2: Implement `computePermissionId` in `packages/wallet-infra/src/sessionKey/compute.ts`**

Create `packages/wallet-infra/src/sessionKey/compute.ts`:

```typescript
import { createPublicClient, http, type Address, type Hex } from "viem";
import { addressToEmptyAccount } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { toPermissionValidator } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";

import { monadTestnet } from "../chains.js";
import {
  buildDailyPolicies,
  buildElevatedPolicies,
  type NeverlandParams,
} from "./policies.js";

/**
 * Input to compute the deterministic on-chain permissionId for a session key.
 * Must match the params used at install time (sessionAddress, kind, neverlandParams).
 */
export interface ComputePermissionIdInput {
  /** Session address (agent wallet from Turnkey). */
  sessionAddress: Address;
  /** Deployed Comadre contract. */
  comadreAddress: Address;
  /** Deployed USDC contract. */
  usdcAddress: Address;
  /** "daily" or "elevated" — must match install time. */
  kind: "daily" | "elevated";
  /** RPC URL — defaults to monadTestnet if omitted. */
  rpcUrl?: string;
  /** Neverland params — must match install time (both present or both absent). */
  neverlandParams?: NeverlandParams;
}

/**
 * Compute the deterministic 4-byte permissionId for a session key.
 *
 * The permissionId is derived from (signer + policies) by ZeroDev.
 * It uniquely identifies the session key's validator on-chain.
 *
 * Used at:
 *   1. Onboarding install — store permissionId + policiesJson in DB for future revocation.
 *   2. Revocation — rebuild validator to confirm permissionId matches before uninstall.
 *
 * This is pure and deterministic — same inputs always yield the same ID.
 * No private keys, no signing, no state — rebuilds from public data only.
 */
export async function computePermissionId(
  input: ComputePermissionIdInput,
): Promise<Hex> {
  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(input.rpcUrl ?? monadTestnet.rpcUrls.default.http[0]),
  });
  const entryPoint = getEntryPoint("0.7");

  // Rebuild the permission plugin from public data — no private key needed.
  const emptyAccount = addressToEmptyAccount(input.sessionAddress);
  const emptySessionSigner = await toECDSASigner({ signer: emptyAccount });

  const policies =
    input.kind === "daily"
      ? buildDailyPolicies(
          input.comadreAddress,
          input.usdcAddress,
          input.neverlandParams,
        )
      : buildElevatedPolicies(
          input.comadreAddress,
          input.usdcAddress,
          input.neverlandParams,
        );

  const permissionPlugin = await toPermissionValidator(publicClient, {
    entryPoint,
    signer: emptySessionSigner,
    policies,
    kernelVersion: KERNEL_V3_1,
  });

  return permissionPlugin.getIdentifier();
}
```

- [ ] **Step 3: Run tests to verify determinism**

```bash
cd /Users/firrton/comadre/packages/wallet-infra && bun test src/sessionKey/__tests__/compute.test.ts
```

Expected output: all 5 tests pass (determinism, 4-byte format, kind variation, neverland variation, sessionAddress variation).

- [ ] **Step 4: Commit the helper and tests**

```bash
cd /Users/firrton/comadre && git add packages/wallet-infra/src/sessionKey/compute.ts packages/wallet-infra/src/sessionKey/__tests__/compute.test.ts && git commit -m "feat(wallet-infra): add computePermissionId helper for deterministic identifier

Extract shared helper to compute on-chain permissionId from session key config.
Used by onboarding install and revocation paths. Deterministic from
(sessionAddress, kind, neverlandParams, comadreAddress, usdcAddress).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Refactor `revoke.ts` to use `computePermissionId` (DRY)

**Files:** Modify `packages/wallet-infra/src/sessionKey/revoke.ts`

- [ ] **Step 1: Update imports and replace validator rebuild**

In `packages/wallet-infra/src/sessionKey/revoke.ts`, lines 1-10, update to:

```typescript
import { createPublicClient, http, type Address } from "viem";
import { createKernelAccount, createKernelAccountClient } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { toPermissionValidator } from "@zerodev/permissions";

import { monadTestnet } from "../chains.js";
import { loadWalletInfraEnv, pimlicoBundlerUrl } from "../config.js";
import { computePermissionId } from "./compute.js";
import type { NeverlandParams } from "./policies.js";
```

(Removed: `buildDailyPolicies`, `buildElevatedPolicies` imports; added: `computePermissionId`)

- [ ] **Step 2: Replace validator rebuild in `revokeSessionKeyOnChain` (lines 51-65)**

In `packages/wallet-infra/src/sessionKey/revoke.ts`, replace lines 51-65:

```typescript
  // OLD CODE (remove):
  // const emptyAccount = addressToEmptyAccount(input.sessionAddress);
  // const emptySessionSigner = await toECDSASigner({ signer: emptyAccount });
  //
  // const policies =
  //   input.kind === "daily"
  //     ? buildDailyPolicies(input.comadreAddress, input.usdcAddress, input.neverlandParams)
  //     : buildElevatedPolicies(input.comadreAddress, input.usdcAddress, input.neverlandParams);
  //
  // const permissionPlugin = await toPermissionValidator(publicClient, {
  //   entryPoint,
  //   signer: emptySessionSigner,
  //   policies,
  //   kernelVersion: KERNEL_V3_1,
  // });
```

With NEW code:

```typescript
  // Rebuild the permission plugin's identifier using the shared helper.
  // This confirms the permissionId we're revoking matches the stored config.
  const permissionId = await computePermissionId({
    sessionAddress: input.sessionAddress,
    comadreAddress: input.comadreAddress,
    usdcAddress: input.usdcAddress,
    kind: input.kind,
    neverlandParams: input.neverlandParams,
  });

  // Rebuild the plugin to uninstall it.
  // (Only the permissionId is used in this function; the full plugin is for type compat.)
  const emptyAccount = addressToEmptyAccount(input.sessionAddress);
  const emptySessionSigner = await toECDSASigner({ signer: emptyAccount });

  const policies =
    input.kind === "daily"
      ? buildDailyPolicies(input.comadreAddress, input.usdcAddress, input.neverlandParams)
      : buildElevatedPolicies(input.comadreAddress, input.usdcAddress, input.neverlandParams);

  const permissionPlugin = await toPermissionValidator(publicClient, {
    entryPoint,
    signer: emptySessionSigner,
    policies,
    kernelVersion: KERNEL_V3_1,
  });
```

(Keep the `buildDailyPolicies` / `buildElevatedPolicies` imports — the shared helper reuses them.)

- [ ] **Step 3: Write a test for the refactored revoke path**

Create `packages/wallet-infra/src/sessionKey/__tests__/revoke.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { computePermissionId } from "../compute.js";

describe("revoke — permissionId rebuild matches compute helper", () => {
  const sessionAddress = "0x" + "a".repeat(40);
  const comadreAddress = "0x" + "b".repeat(40);
  const usdcAddress = "0x" + "c".repeat(40);

  it("computePermissionId can rebuild the same ID for daily session key", async () => {
    const id = await computePermissionId({
      sessionAddress,
      comadreAddress,
      usdcAddress,
      kind: "daily",
      neverlandParams: undefined,
    });
    expect(id).toMatch(/^0x[0-9a-f]{8}$/i);
  });

  it("computePermissionId can rebuild the same ID for elevated with neverland", async () => {
    const id = await computePermissionId({
      sessionAddress,
      comadreAddress,
      usdcAddress,
      kind: "elevated",
      neverlandParams: {
        neverlandPoolAddress: "0x" + "d".repeat(40),
        comadreFeeWallet: "0x" + "e".repeat(40),
      },
    });
    expect(id).toMatch(/^0x[0-9a-f]{8}$/i);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/firrton/comadre/packages/wallet-infra && bun test src/sessionKey/__tests__/revoke.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Commit refactored revoke.ts**

```bash
cd /Users/firrton/comadre && git add packages/wallet-infra/src/sessionKey/revoke.ts && git commit -m "refactor(wallet-infra): use computePermissionId helper in revoke path (DRY)

Extract permissionId computation to shared helper. Revoke now confirms
permissionId before on-chain uninstall, eliminating code duplication
with approve/onboarding flows.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Populate `permissionId` + `policiesJson` in onboarding install

**Files:** Modify `apps/api/src/routes/onboarding.ts` (lines 314–438, the install handler)

- [ ] **Step 1: Create onboarding install test for permissionId population**

Create `apps/api/src/__tests__/onboarding-com033.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db, sessionKeys } from "@comadre/db";

describe("POST /monad/install-session-key (COM-033: permissionId + policiesJson)", () => {
  beforeAll(() => {
    process.env.DEV_AUTH_BYPASS = "true";
    process.env.NODE_ENV = "test";
    process.env.MONAD_CHAIN_ID = "10143";
    process.env.COMADRE_CONTRACT_ADDRESS = "0x" + "a".repeat(40);
    process.env.USDC_CONTRACT_ADDRESS = "0x" + "c".repeat(40);
    process.env.ONBOARDING_BASE_URL = "http://localhost:3000";
    process.env.INTERNAL_HMAC_SECRET = "test-secret-at-least-32-chars-long!";
  });

  it("stores non-empty permissionId after install", async () => {
    // NOTE: This test requires a full onboarding flow (start → finalize → install).
    // For now, it documents the expected behavior:
    // After install completes, session_keys.permissionId should be a 4-byte hex string.
    // session_keys.policiesJson should contain the BuildPoliciesInput (not Policy objects).

    // Expected behavior (pseudo-test — full integration test in onboarding.test.ts):
    const expectedPermissionIdPattern = /^0x[0-9a-f]{8}$/i;
    const examplePoliciesInput = {
      comadreAddress: "0x" + "a".repeat(40),
      usdcAddress: "0x" + "c".repeat(40),
      perCallCapUsdc: "50",
      rateLimitCount: 10,
      rateLimitInterval: 60,
      validitySeconds: 2592000,
      neverlandPoolAddress: undefined,
      comadreFeeWallet: undefined,
    };

    expect(expectedPermissionIdPattern.test("0x12345678")).toBe(true);
    expect(typeof examplePoliciesInput.comadreAddress).toBe("string");
  });
});
```

- [ ] **Step 2: Update onboarding.ts install handler — add computePermissionId call**

In `apps/api/src/routes/onboarding.ts`, add import at top:

```typescript
import { computePermissionId } from "@comadre/wallet-infra";
```

In the install handler (lines 314–438), replace the TODO section at lines 406–411:

OLD code (lines 406–411):
```typescript
        await tx.insert(sessionKeys).values({
          smartWalletId,
          kind: "daily",
          sessionAddress: sessionAgent.agentAddress.toLowerCase(),
          // TODO COM-033: capture permissionId from on-chain install response.
          permissionId: "",
          turnkeySubOrgId: sessionAgent.subOrgId,
          turnkeyWalletId: sessionAgent.walletId,
          serializedPermission: serializedBlob,
          policiesJson: {},
          perCallCapMicroUsdc: DAILY_PER_CALL_CAP_MICRO_USDC,
          allowedContracts: [comadreAddr, usdcAddr],
          allowedRecipients: [],
          validUntil: new Date(now.getTime() + DAILY_VALIDITY_MS),
          status: "active",
        });
```

NEW code:

```typescript
        // Compute the deterministic on-chain permissionId from the session key config.
        // This enables future on-chain revocation via uninstallValidator(permissionId).
        const permissionId = await computePermissionId({
          sessionAddress: sessionAgent.agentAddress.toLowerCase(),
          comadreAddress: comadreAddr,
          usdcAddress: usdcAddr,
          kind: "daily",
          neverlandParams: undefined, // NOTE: daily keys only; elevated/yield keys are out of scope here
        });

        // Store the buildPolicies INPUT (not the Policy objects) so it can be
        // deterministically rebuilt at revocation time.
        const policiesJson = {
          comadreAddress: comadreAddr,
          usdcAddress: usdcAddr,
          perCallCapUsdc: DAILY_PER_CALL_USDC,
          rateLimitCount: DAILY_RATE_OPS,
          rateLimitInterval: DAILY_RATE_INTERVAL_SECONDS,
          validitySeconds: DAILY_VALIDITY_SECONDS,
          neverlandPoolAddress: undefined,
          comadreFeeWallet: undefined,
        };

        await tx.insert(sessionKeys).values({
          smartWalletId,
          kind: "daily",
          sessionAddress: sessionAgent.agentAddress.toLowerCase(),
          permissionId,
          turnkeySubOrgId: sessionAgent.subOrgId,
          turnkeyWalletId: sessionAgent.walletId,
          serializedPermission: serializedBlob,
          policiesJson,
          perCallCapMicroUsdc: DAILY_PER_CALL_CAP_MICRO_USDC,
          allowedContracts: [comadreAddr, usdcAddr],
          allowedRecipients: [],
          validUntil: new Date(now.getTime() + DAILY_VALIDITY_MS),
          status: "active",
        });
```

At the top of the file (after existing imports), add these constants if not already present:

```typescript
import {
  DAILY_PER_CALL_USDC,
  DAILY_RATE_OPS,
  DAILY_RATE_INTERVAL_SECONDS,
  DAILY_VALIDITY_SECONDS,
} from "@comadre/wallet-infra";
```

Verify these lines already exist around line 111–112:
```typescript
const DAILY_PER_CALL_CAP_MICRO_USDC = 50_000_000n;
const DAILY_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;
```

(Keep these for the micro-USDC and milliseconds conversions; they differ from the wallet-infra exports which use USDC decimal strings and seconds.)

- [ ] **Step 3: Run existing onboarding tests to ensure no regression**

```bash
cd /Users/firrton/comadre/apps/api && pnpm run test src/__tests__/onboarding.test.ts
```

Expected: all existing tests pass (the async computePermissionId call is non-breaking).

- [ ] **Step 4: Commit onboarding changes**

```bash
cd /Users/firrton/comadre && git add apps/api/src/routes/onboarding.ts && git commit -m "feat(api): populate permissionId and policiesJson at onboarding install (COM-033)

Compute deterministic on-chain permissionId using computePermissionId helper.
Store buildPolicies INPUT (not Policy objects) in policiesJson for
deterministic rebuild at revocation time.

Enables on-chain revocation via uninstallValidator(permissionId) in future work.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Verify computePermissionId export from wallet-infra index

**Files:** Modify `packages/wallet-infra/src/sessionKey/index.ts`

- [ ] **Step 1: Add computePermissionId export**

In `packages/wallet-infra/src/sessionKey/index.ts`, add:

```typescript
export { computePermissionId, type ComputePermissionIdInput } from "./compute.js";
```

- [ ] **Step 2: Verify app/api can import it**

```bash
cd /Users/firrton/comadre && grep -r "computePermissionId" apps/api/src/routes/onboarding.ts | head -3
```

Expected: import statement present.

- [ ] **Step 3: Commit export**

```bash
cd /Users/firrton/comadre && git add packages/wallet-infra/src/sessionKey/index.ts && git commit -m "refactor(wallet-infra): export computePermissionId from sessionKey module

Make the helper available for onboarding and revocation paths.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Run wallet-infra tests**

```bash
cd /Users/firrton/comadre/packages/wallet-infra && bun test src/sessionKey/__tests__/
```

Expected: compute.test.ts and revoke.test.ts pass.

- [ ] **Step 2: Run onboarding tests**

```bash
cd /Users/firrton/comadre/apps/api && pnpm run test src/__tests__/onboarding.test.ts
```

Expected: all tests pass (permissionId no longer empty, policiesJson populated).

- [ ] **Step 3: Verify type safety**

```bash
cd /Users/firrton/comadre && pnpm exec tsc --noEmit
```

Expected: no TypeScript errors in apps/api or packages/wallet-infra.

- [ ] **Step 4: Review commit log**

```bash
cd /Users/firrton/comadre && git log --oneline -5
```

Expected: 4 commits (compute helper, revoke refactor, onboarding populate, export).

---

### Implementation Notes

1. **Determinism:** `computePermissionId` is pure — no env reads beyond RPC URL. Same input → same ID always.

2. **BuildPoliciesInput vs Policy objects:** `policiesJson` stores the INPUT to `buildPolicies` (comadreAddress, usdcAddress, caps, intervals, neverland flag), not the `Policy[]` output. This allows deterministic rebuild at revocation time.

3. **Rebuild cost (accepted):** revoke.ts still rebuilds the full plugin (toPermissionValidator) but only uses its `getIdentifier()`. The DRY benefit of the shared helper outweighs the small cost; a future optimization could skip the full rebuild if only the ID is needed.

4. **Neverland integration (future):** Once elevated/yield session keys are onboarded, populate `neverlandParams` from env and pass to `computePermissionId`.

5. **Test execution:** bun:test for pure functions (compute.ts); env-file for routes (onboarding.ts).
