import { describe, expect, test } from "bun:test";

import { isIndividualJid, jidToWhatsAppAddress } from "../lib/jid.js";

describe("isIndividualJid", () => {
  test("individual JID returns true", () => {
    expect(isIndividualJid("5491112345678@c.us")).toBe(true);
  });

  test("group JID returns false", () => {
    expect(isIndividualJid("120363000000000000@g.us")).toBe(false);
  });

  test("broadcast JID returns false", () => {
    expect(isIndividualJid("status@broadcast")).toBe(false);
  });

  test("missing @c.us suffix returns false", () => {
    expect(isIndividualJid("notajid")).toBe(false);
  });

  test("@c.us with empty number part returns false", () => {
    expect(isIndividualJid("@c.us")).toBe(false);
  });

  test("@c.us with too short number part returns false", () => {
    expect(isIndividualJid("abc@c.us")).toBe(false);
  });

  test("number part must be all digits — leading non-digit fails", () => {
    expect(isIndividualJid("05491112345678@c.us")).toBe(false);
  });
});

describe("jidToWhatsAppAddress", () => {
  test("valid individual JID converts correctly", () => {
    // Regression guard: + prefix MUST be present
    expect(jidToWhatsAppAddress("5491112345678@c.us")).toBe("whatsapp:+5491112345678");
  });

  test("result always has + prefix", () => {
    const result = jidToWhatsAppAddress("5491112345678@c.us");
    expect(result).not.toBeNull();
    expect(result!.startsWith("whatsapp:+")).toBe(true);
  });

  test("group JID returns null", () => {
    expect(jidToWhatsAppAddress("120363000000000000@g.us")).toBeNull();
  });

  test("broadcast JID returns null", () => {
    expect(jidToWhatsAppAddress("status@broadcast")).toBeNull();
  });

  test("bare string returns null", () => {
    expect(jidToWhatsAppAddress("notajid")).toBeNull();
  });

  test("@c.us with no number returns null", () => {
    expect(jidToWhatsAppAddress("@c.us")).toBeNull();
  });

  test("@c.us with letters in number returns null", () => {
    expect(jidToWhatsAppAddress("abc@c.us")).toBeNull();
  });

  test("leading-zero number part (non-E164) returns null", () => {
    // E.164 country codes never start with 0; treat as invalid
    expect(jidToWhatsAppAddress("05491112345678@c.us")).toBeNull();
  });
});
