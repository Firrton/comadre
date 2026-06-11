import pino from "pino";

import { env } from "@comadre/config";

// ---------------------------------------------------------------------------
// OpenWA bootstrap — idempotent session + webhook registration
//
// Runs once at startup (guarded by NODE_ENV !== "test" in index.ts).
// Never crashes the service — all failures are logged and swallowed.
//
// Session status values (verified from source — v4_session_status_enum):
//   'created'        — session object exists but has never been started
//   'initializing'   — start command issued, QR not yet generated
//   'qr_ready'       — QR code available; operator must scan
//   'authenticating' — QR scanned, handshake in progress
//   'ready'          — fully authenticated and operational
//   'disconnected'   — was authenticated, now offline
//   'failed'         — unrecoverable error; needs recreate
//
// Auth header (verified from source — v1_auth_mode):
//   X-API-Key: <OPENWA_API_KEY>
//   Dev mode seeds key 'dev-admin-key' automatically. Never log the key.
// ---------------------------------------------------------------------------

const log = pino({ name: "whatsapp:bootstrap" });

// Retry configuration (R8.S6)
const MAX_RETRIES = 5;
const RETRY_INTERVAL_MS = 5_000;

/**
 * The webhook URL OpenWA will POST inbound messages to.
 * Overridable via OPENWA_WEBHOOK_URL env var (useful in CI / non-macOS dev).
 * Default is the macOS Docker Desktop host-gateway address.
 * Note: This is the URL from the CONTAINER's perspective (host.docker.internal),
 *       not the host's own address.
 */
const webhookUrl =
  process.env["OPENWA_WEBHOOK_URL"] ??
  "http://host.docker.internal:3002/webhooks/whatsapp";

/** Base URL, trailing slash removed. */
function base(): string {
  return env.OPENWA_API_URL.replace(/\/$/, "");
}

/** Standard auth headers for all OpenWA REST calls. */
function authHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "X-API-Key": env.OPENWA_API_KEY, // value never logged
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** GET {OPENWA_API_URL}/api/health — confirm the container is reachable. */
async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${base()}/api/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface SessionInfo {
  status: string;
  name?: string;
}

/** GET /api/sessions/:id — returns null on 404 or network error. */
async function getSession(): Promise<SessionInfo | null> {
  try {
    const res = await fetch(
      `${base()}/api/sessions/${env.OPENWA_SESSION_ID}`,
      { headers: authHeaders(), signal: AbortSignal.timeout(10_000) },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      log.warn({ status: res.status }, "getSession non-2xx");
      return null;
    }
    return (await res.json()) as SessionInfo;
  } catch (e) {
    log.warn({ err: e }, "getSession failed");
    return null;
  }
}

/** POST /api/sessions — create session. Tolerates 409 (already exists). */
async function createSession(): Promise<boolean> {
  try {
    const res = await fetch(`${base()}/api/sessions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: env.OPENWA_SESSION_ID }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 409) {
      log.info("session already exists (409 on create); continuing");
      return true;
    }
    if (!res.ok) {
      log.warn({ status: res.status }, "createSession failed");
      return false;
    }
    log.info("session created");
    return true;
  } catch (e) {
    log.warn({ err: e }, "createSession error");
    return false;
  }
}

/** POST /api/sessions/:id/start — start session. Tolerates 409 (already started). */
async function startSession(): Promise<boolean> {
  try {
    const res = await fetch(
      `${base()}/api/sessions/${env.OPENWA_SESSION_ID}/start`,
      {
        method: "POST",
        headers: authHeaders(),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.status === 409) {
      log.info("session already started (409 on start); continuing");
      return true;
    }
    if (!res.ok) {
      log.warn({ status: res.status }, "startSession failed");
      return false;
    }
    log.info("session start command sent");
    return true;
  } catch (e) {
    log.warn({ err: e }, "startSession error");
    return false;
  }
}

/** GET /api/sessions/:id/qr — log the data-URL for operator to scan. */
async function logQrCode(): Promise<void> {
  try {
    const res = await fetch(
      `${base()}/api/sessions/${env.OPENWA_SESSION_ID}/qr`,
      { headers: authHeaders(), signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) {
      log.warn({ status: res.status }, "QR fetch failed");
      return;
    }
    const body = (await res.json()) as { qrCode?: string };
    if (body.qrCode) {
      // Log the data-URL so the operator can open it in a browser to scan.
      // The data-URL is not a secret — it is a QR that expires on scan.
      log.info({ qrCodeDataUrl: body.qrCode }, "WhatsApp QR ready — open URL in browser and scan");
    } else {
      log.warn("QR endpoint returned no qrCode field");
    }
  } catch (e) {
    log.warn({ err: e }, "logQrCode error");
  }
}

interface WebhookEntry {
  url: string;
  events: string[];
}

/** GET /api/sessions/:id/webhooks — returns array or null on error. */
async function listWebhooks(): Promise<WebhookEntry[] | null> {
  try {
    const res = await fetch(
      `${base()}/api/sessions/${env.OPENWA_SESSION_ID}/webhooks`,
      { headers: authHeaders(), signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) {
      log.warn({ status: res.status }, "listWebhooks non-2xx");
      return null;
    }
    return (await res.json()) as WebhookEntry[];
  } catch (e) {
    log.warn({ err: e }, "listWebhooks error");
    return null;
  }
}

/** POST /api/sessions/:id/webhooks — register inbound webhook. Tolerates 409. */
async function registerWebhook(): Promise<void> {
  try {
    const res = await fetch(
      `${base()}/api/sessions/${env.OPENWA_SESSION_ID}/webhooks`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          url: webhookUrl,
          events: ["message.received"],
          secret: env.OPENWA_WEBHOOK_SECRET, // signed with HMAC-SHA256 by OpenWA
          retryCount: 3,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.status === 409) {
      log.info("webhook already registered (409); idempotent");
      return;
    }
    if (!res.ok) {
      log.warn({ status: res.status }, "registerWebhook failed");
      return;
    }
    log.info({ url: webhookUrl }, "webhook registered for message.received");
  } catch (e) {
    log.warn({ err: e }, "registerWebhook error");
  }
}

// ---------------------------------------------------------------------------
// Main bootstrap procedure
// ---------------------------------------------------------------------------

async function runBootstrap(): Promise<void> {
  // Step 1 — health check
  const healthy = await checkHealth();
  if (!healthy) {
    log.warn(
      { apiUrl: env.OPENWA_API_URL },
      "OpenWA health check failed — container unreachable; bootstrap skipped",
    );
    return;
  }
  log.info("OpenWA container reachable");

  // Step 2 — ensure session exists and is started
  let session = await getSession();

  if (session === null) {
    // Session doesn't exist — create then start
    log.info("session not found — creating");
    const created = await createSession();
    if (!created) {
      log.error("failed to create OpenWA session; bootstrap aborted");
      return;
    }
    const started = await startSession();
    if (!started) {
      log.warn("session created but start failed; continuing to status check");
    }
    // Re-fetch after create+start
    session = await getSession();
  } else {
    // Session exists — start only if not in a terminal-ready state
    const status = session.status;
    if (status !== "ready" && status !== "authenticating") {
      log.info({ status }, "session not ready — issuing start");
      await startSession();
      session = await getSession();
    }
  }

  // Step 3 — handle session status
  const status = session?.status ?? "unknown";
  switch (status) {
    case "qr_ready":
      log.info("session status: qr_ready — fetching QR for operator scan");
      await logQrCode();
      break;
    case "ready":
      log.info("session status: ready — WhatsApp authenticated and operational");
      break;
    case "initializing":
      log.info("session status: initializing — QR will appear shortly");
      break;
    case "authenticating":
      log.info("session status: authenticating — QR scanned, completing handshake");
      break;
    case "disconnected":
      log.warn("session status: disconnected — session lost; will need re-scan after reconnect");
      break;
    case "created":
      log.info("session status: created — start command may still be propagating");
      break;
    case "failed":
      log.error("session status: failed — unrecoverable; delete and recreate the session manually");
      break;
    default:
      // Defensive: unknown status must NOT throw (design §6.2 step 3).
      log.warn({ status }, "unknown OpenWA session status; continuing without action");
  }

  // Step 4 — idempotent webhook registration
  const webhooks = await listWebhooks();
  if (webhooks !== null) {
    const alreadyRegistered = webhooks.some(
      (w) => w.url === webhookUrl && w.events.includes("message.received"),
    );
    if (alreadyRegistered) {
      log.info({ url: webhookUrl }, "webhook already registered — skipping (idempotent)");
      return;
    }
  }

  await registerWebhook();
}

// ---------------------------------------------------------------------------
// Exported bootstrap entry point with retry loop (R8.S6)
// ---------------------------------------------------------------------------

/**
 * Idempotent OpenWA session + webhook bootstrap.
 *
 * Called once at `apps/whatsapp` startup, guarded by `NODE_ENV !== "test"`.
 * Retries up to MAX_RETRIES times with a RETRY_INTERVAL_MS delay.
 * NEVER throws — all failures are logged and swallowed.
 */
export async function bootstrapOpenWa(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await runBootstrap();
      return; // success — exit retry loop
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        log.warn(
          { attempt, maxRetries: MAX_RETRIES, err: e },
          `bootstrap attempt ${attempt} failed; retrying in ${RETRY_INTERVAL_MS / 1000}s`,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
      } else {
        log.error(
          { attempt, err: e },
          "bootstrap failed after all retries; service will continue without OpenWA session",
        );
      }
    }
  }
}
