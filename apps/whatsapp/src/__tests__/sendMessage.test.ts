import { describe, expect, test, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// sendMessage unit tests
//
// Tests:
//   (a) toChatId address conversion
//   (b) sendWhatsAppMessage delegates to sendText and returns {messageId,timestamp}
//   (c) OpenWaSendError propagates with correct kind when sendText rejects
//
// openwaClient is mocked before app import so the mock is hoisted by Bun.
// ---------------------------------------------------------------------------

const mockSendText = mock(async (_chatId: string, _text: string) => ({
  messageId: "msg001",
  timestamp: 1700000000,
}));

mock.module("../lib/openwaClient.js", () => ({
  sendText: mockSendText,
  // Re-export the real error classes so callers can use instanceof
  OpenWaSendError: class OpenWaSendError extends Error {
    constructor(
      public kind: string,
      public status?: number,
      msg?: string,
    ) {
      super(msg ?? kind);
      this.name = "OpenWaSendError";
    }
  },
}));

import { toChatId, sendWhatsAppMessage } from "../lib/sendMessage.js";
import { OpenWaSendError } from "../lib/openwaClient.js";

describe("toChatId", () => {
  test("converts whatsapp:+E164 to digits@c.us", () => {
    expect(toChatId("whatsapp:+5491112345678")).toBe("5491112345678@c.us");
  });

  test("strips whatsapp: prefix (case-insensitive) and leading plus", () => {
    expect(toChatId("WhatsApp:+5218116346072")).toBe("5218116346072@c.us");
  });

  test("handles number without leading plus after stripping prefix", () => {
    expect(toChatId("whatsapp:5491112345678")).toBe("5491112345678@c.us");
  });

  test("handles raw digits (no prefix)", () => {
    expect(toChatId("+5491112345678")).toBe("5491112345678@c.us");
  });
});

describe("sendWhatsAppMessage", () => {
  beforeEach(() => {
    mockSendText.mockClear();
    mockSendText.mockImplementation(async (_chatId: string, _text: string) => ({
      messageId: "msg001",
      timestamp: 1700000000,
    }));
  });

  test("calls sendText with chatId derived from whatsapp:+E164 address", async () => {
    await sendWhatsAppMessage("whatsapp:+5491112345678", "hola");
    expect(mockSendText).toHaveBeenCalledWith("5491112345678@c.us", "hola");
  });

  test("returns {messageId, timestamp} from sendText on success", async () => {
    const result = await sendWhatsAppMessage("whatsapp:+5491112345678", "test");
    expect(result).toEqual({ messageId: "msg001", timestamp: 1700000000 });
  });

  test("propagates OpenWaSendError(timeout) from sendText", async () => {
    mockSendText.mockImplementation(async () => {
      throw new OpenWaSendError("timeout");
    });
    await expect(
      sendWhatsAppMessage("whatsapp:+5491112345678", "hi"),
    ).rejects.toMatchObject({ name: "OpenWaSendError", kind: "timeout" });
  });

  test("propagates OpenWaSendError(unauthorized) with status", async () => {
    mockSendText.mockImplementation(async () => {
      throw new OpenWaSendError("unauthorized", 401);
    });
    await expect(
      sendWhatsAppMessage("whatsapp:+5491112345678", "hi"),
    ).rejects.toMatchObject({ kind: "unauthorized", status: 401 });
  });

  test("propagates OpenWaSendError(session_disconnected) with status 409", async () => {
    mockSendText.mockImplementation(async () => {
      throw new OpenWaSendError("session_disconnected", 409);
    });
    await expect(
      sendWhatsAppMessage("whatsapp:+5491112345678", "hi"),
    ).rejects.toMatchObject({ kind: "session_disconnected", status: 409 });
  });

  test("propagates OpenWaSendError(server_error) with status 500", async () => {
    mockSendText.mockImplementation(async () => {
      throw new OpenWaSendError("server_error", 500);
    });
    await expect(
      sendWhatsAppMessage("whatsapp:+5491112345678", "hi"),
    ).rejects.toMatchObject({ kind: "server_error", status: 500 });
  });

  test("propagates OpenWaSendError(unexpected) for unknown errors", async () => {
    mockSendText.mockImplementation(async () => {
      throw new OpenWaSendError("unexpected");
    });
    await expect(
      sendWhatsAppMessage("whatsapp:+5491112345678", "hi"),
    ).rejects.toMatchObject({ kind: "unexpected" });
  });
});
