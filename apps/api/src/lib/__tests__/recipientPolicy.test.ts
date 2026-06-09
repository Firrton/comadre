import { describe, expect, it } from "bun:test";
import { encodeFunctionData, parseAbi } from "viem";
import {
  buildConfirmationPrompt,
  evaluateRecipient,
  parseConfirmation,
} from "../recipientPolicy.js";
import { buildUsdcTransferCalldata } from "../monadUsdcTransfer.js";

const recipient = "0x" + "a1".repeat(20);
const otherRecipient = "0x" + "b2".repeat(20);

const approveAbi = parseAbi(["function approve(address spender, uint256 value) returns (bool)"]);

function transferCalldata(to: `0x${string}` = recipient as `0x${string}`) {
  return buildUsdcTransferCalldata(to, 1_000_000n);
}

describe("evaluateRecipient", () => {
  it("rejects an empty allowlist", () => {
    expect(evaluateRecipient([], transferCalldata())).toEqual({
      ok: false,
      reason: "recipient_not_allowed",
    });
  });

  it("accepts a present recipient", () => {
    expect(evaluateRecipient([recipient], transferCalldata())).toEqual({ ok: true });
  });

  it("rejects an absent recipient", () => {
    expect(evaluateRecipient([otherRecipient], transferCalldata())).toEqual({
      ok: false,
      reason: "recipient_not_allowed",
    });
  });

  it("matches recipients case-insensitively", () => {
    expect(evaluateRecipient([recipient.toUpperCase()], transferCalldata())).toEqual({ ok: true });
  });

  it("rejects malformed calldata as undecodable", () => {
    expect(evaluateRecipient([recipient], "0x1234")).toEqual({
      ok: false,
      reason: "undecodable_calldata",
    });
  });

  it("rejects non-transfer calldata as undecodable", () => {
    const calldata = encodeFunctionData({
      abi: approveAbi,
      functionName: "approve",
      args: [recipient as `0x${string}`, 1_000_000n],
    });

    expect(evaluateRecipient([recipient], calldata)).toEqual({
      ok: false,
      reason: "undecodable_calldata",
    });
  });
});

describe("parseConfirmation", () => {
  it.each(["sí", "si", "dale", "ok", "confirmo", "yes", "✅"])(
    "parses %p as affirmative",
    (message) => {
      expect(parseConfirmation(message)).toBe("affirmative");
    },
  );

  it.each(["no", "cancelar", "cancela", "cancelá", "❌"])(
    "parses %p as negative",
    (message) => {
      expect(parseConfirmation(message)).toBe("negative");
    },
  );

  it("ignores trim and punctuation around a single confirmation token", () => {
    expect(parseConfirmation("  sí! ")).toBe("affirmative");
    expect(parseConfirmation(" ¿cancelá? ")).toBe("negative");
  });

  it("keeps substring matches ambiguous", () => {
    expect(parseConfirmation("sígueme")).toBe("ambiguous");
    expect(parseConfirmation("nosí")).toBe("ambiguous");
  });

  it("keeps empty or unknown messages ambiguous", () => {
    expect(parseConfirmation("")).toBe("ambiguous");
    expect(parseConfirmation("maybe")).toBe("ambiguous");
  });

  it("keeps mixed confirmation tokens ambiguous", () => {
    expect(parseConfirmation("sí ❌")).toBe("ambiguous");
    expect(parseConfirmation("❌ sí")).toBe("ambiguous");
    expect(parseConfirmation("no ✅")).toBe("ambiguous");
  });
});

describe("buildConfirmationPrompt", () => {
  it("builds the canonical verbatim prompt", () => {
    const prompt = buildConfirmationPrompt("+59171234567", "12.50");

    expect(prompt).toBe(
      "Es la primera vez que enviás a +59171234567. ¿Confirmás enviar 12.50 USDC? Respondé SÍ para confirmar o NO para cancelar.",
    );
  });
});
