import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";

import {
  openWaEnvelope,
  openWaMessageData,
  verifyOpenWaSignature,
} from "../lib/openwaInbound.js";

// ---------------------------------------------------------------------------
// verifyOpenWaSignature — real crypto (no NODE_ENV bypass in this helper)
// ---------------------------------------------------------------------------

const SECRET = "a".repeat(32); // 32-char secret (meets OPENWA_WEBHOOK_SECRET min)

function makeSignature(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyOpenWaSignature", () => {
  test("returns true for valid HMAC over raw body", () => {
    const body = JSON.stringify({ event: "message.received", data: { id: "1", from: "5491112345678@c.us" } });
    expect(
      verifyOpenWaSignature({ secret: SECRET, signature: makeSignature(body), rawBody: body }),
    ).toBe(true);
  });

  test("returns false for tampered body", () => {
    const body = JSON.stringify({ event: "message.received", data: { id: "1", from: "5491112345678@c.us" } });
    const tamperedBody = body + " ";
    expect(
      verifyOpenWaSignature({ secret: SECRET, signature: makeSignature(body), rawBody: tamperedBody }),
    ).toBe(false);
  });

  test("returns false for empty secret (misconfig)", () => {
    const body = "{}";
    expect(
      verifyOpenWaSignature({ secret: "", signature: makeSignature(body, SECRET), rawBody: body }),
    ).toBe(false);
  });

  test("returns false for empty signature", () => {
    const body = "{}";
    expect(
      verifyOpenWaSignature({ secret: SECRET, signature: "", rawBody: body }),
    ).toBe(false);
  });

  test("returns false for plain-hex signature without sha256= prefix", () => {
    const body = "{}";
    const plainHex = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(
      verifyOpenWaSignature({ secret: SECRET, signature: plainHex, rawBody: body }),
    ).toBe(false);
  });

  test("returns false for wrong secret", () => {
    const body = JSON.stringify({ data: { id: "x", from: "549@c.us" } });
    const sig = makeSignature(body, "b".repeat(32));
    expect(
      verifyOpenWaSignature({ secret: SECRET, signature: sig, rawBody: body }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// openWaEnvelope schema — tolerance for unknown / optional fields
// ---------------------------------------------------------------------------

const VALID_DATA = {
  id: "true_5491112345678@c.us_3EB0abc123",
  from: "5491112345678@c.us",
  body: "hola",
  type: "chat",
  fromMe: false,
  isGroup: false,
};

describe("openWaEnvelope", () => {
  test("valid message.received payload parses successfully", () => {
    const payload = {
      event: "message.received",
      sessionId: "comadre",
      data: VALID_DATA,
    };
    const result = openWaEnvelope.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data.id).toBe(VALID_DATA.id);
      expect(result.data.data.body).toBe("hola");
    }
  });

  test("unknown fields pass through (passthrough mode)", () => {
    const payload = {
      event: "message.received",
      data: { ...VALID_DATA, media: { url: "https://example.com/photo.jpg" }, quotedMessage: null },
      deliveryAttempt: 1,
    };
    const result = openWaEnvelope.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      // Extra top-level field retained
      expect((result.data as Record<string, unknown>)["deliveryAttempt"]).toBe(1);
      // Extra data field retained
      expect((result.data.data as Record<string, unknown>)["media"]).toBeDefined();
    }
  });

  test("data.body defaults to empty string when absent", () => {
    const payload = {
      data: { id: "abc", from: "5491@c.us" },
    };
    const result = openWaEnvelope.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data.body).toBe("");
    }
  });

  test("data.fromMe defaults to false when absent", () => {
    const payload = { data: { id: "x", from: "549@c.us" } };
    const result = openWaEnvelope.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data.fromMe).toBe(false);
    }
  });

  test("data.isGroup defaults to false when absent", () => {
    const payload = { data: { id: "x", from: "549@c.us" } };
    const result = openWaEnvelope.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data.isGroup).toBe(false);
    }
  });

  test("fails when data is missing", () => {
    const result = openWaEnvelope.safeParse({ event: "message.received" });
    expect(result.success).toBe(false);
  });

  test("fails when data.id is missing", () => {
    const result = openWaEnvelope.safeParse({
      data: { from: "5491112345678@c.us", body: "hola" },
    });
    expect(result.success).toBe(false);
  });

  test("fails when data.from is missing", () => {
    const result = openWaEnvelope.safeParse({
      data: { id: "abc123", body: "hola" },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// openWaMessageData schema
// ---------------------------------------------------------------------------

describe("openWaMessageData", () => {
  test("valid data parses", () => {
    const result = openWaMessageData.safeParse(VALID_DATA);
    expect(result.success).toBe(true);
  });

  test("id must be non-empty string", () => {
    const result = openWaMessageData.safeParse({ ...VALID_DATA, id: "" });
    expect(result.success).toBe(false);
  });

  test("from must be non-empty string", () => {
    const result = openWaMessageData.safeParse({ ...VALID_DATA, from: "" });
    expect(result.success).toBe(false);
  });
});
