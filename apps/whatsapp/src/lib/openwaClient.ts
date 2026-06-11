import { env } from "@comadre/config";

const SEND_TIMEOUT_MS = 10_000; // parity with OpenWA WEBHOOK_TIMEOUT default

// ---------------------------------------------------------------------------
// Error taxonomy for OpenWA outbound calls
// ---------------------------------------------------------------------------

export type OpenWaSendErrorKind =
  | "session_disconnected" // session not ready (status: disconnected/qr_ready/failed) — 409/422/503
  | "unauthorized"         // 401/403 — bad X-API-Key (dev mode key is 'dev-admin-key')
  | "server_error"         // 5xx
  | "timeout"              // AbortSignal fired after SEND_TIMEOUT_MS
  | "unexpected";          // anything else (network, parse, unknown status)

export class OpenWaSendError extends Error {
  constructor(
    readonly kind: OpenWaSendErrorKind,
    readonly status?: number,
    msg?: string,
  ) {
    super(msg ?? kind);
    this.name = "OpenWaSendError";
  }
}

// ---------------------------------------------------------------------------
// sendText — call POST /api/sessions/:sessionId/messages/send-text
//
// [VERIFIED FROM SOURCE — v3_send_shape]:
//   Request body: { chatId: string, text: string }
//   Response:     { messageId: string, timestamp: number }  (HTTP 201)
//   res.ok covers 2xx, so 201 is handled correctly.
//
// [VERIFIED FROM SOURCE — v1_auth_mode]:
//   Auth is X-API-Key header. Dev mode seeds key 'dev-admin-key' automatically.
//   Never log the key value.
// ---------------------------------------------------------------------------

/** Send a free-form text via OpenWA send-text. chatId = "<E164digits>@c.us". */
export async function sendText(
  chatId: string,
  text: string,
): Promise<{ messageId: string; timestamp: number }> {
  const base = env.OPENWA_API_URL.replace(/\/$/, "");
  const url = `${base}/api/sessions/${env.OPENWA_SESSION_ID}/messages/send-text`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-API-Key": env.OPENWA_API_KEY, // never logged
      },
      body: JSON.stringify({ chatId, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new OpenWaSendError("timeout");
    }
    throw new OpenWaSendError("unexpected", undefined, String(e));
  }

  if (res.status === 401 || res.status === 403) {
    throw new OpenWaSendError("unauthorized", res.status);
  }
  if (res.status === 409 || res.status === 422 || res.status === 503) {
    // Session not ready: disconnected, QR scan required, or service unavailable.
    throw new OpenWaSendError("session_disconnected", res.status);
  }
  if (res.status >= 500) {
    throw new OpenWaSendError("server_error", res.status);
  }
  if (!res.ok) {
    throw new OpenWaSendError("unexpected", res.status);
  }

  const json = (await res.json()) as { messageId?: string; timestamp?: number };
  return {
    messageId: json.messageId ?? "",
    timestamp: json.timestamp ?? Date.now() / 1000,
  };
}
