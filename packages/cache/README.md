# @comadre/cache

Upstash Redis helpers for idempotency, rate limiting, and WhatsApp 24-hour window state.

**Safe to import in test environments** — the Redis client is initialized lazily on the first actual Redis call, not at import time. No env vars are required just to load the module.

---

## Usage

### Redis client

```ts
import { getRedis } from "@comadre/cache";

const redis = getRedis();
await redis.set("foo", "bar");
```

### Idempotency cache

```ts
import { withIdempotency, getIdempotent, setIdempotent } from "@comadre/cache";

// Wrap a handler — result auto-wrapped as { status: 200, body: T } internally;
// only T is returned to the caller. On retry the cached body is returned directly.
const result = await withIdempotency(
  `${userId}:${req.headers["x-idempotency-key"]}`,
  () => buildUnsignedTransaction(input)
);

// Low-level access — callers MUST use the full { status, body } envelope:
const cached = await getIdempotent(myKey);          // CachedResponse | null → { status, body }
await setIdempotent(myKey, { status: 200, body });  // 24h TTL default
```

> `withIdempotency<T>` auto-wraps the handler result as `{ status: 200, body: T }` and returns only the body `T`. Direct callers of `getIdempotent`/`setIdempotent` must read and write the full `CachedResponse` envelope.

> Race-condition note: `withIdempotency` is best-effort. Two true-concurrent requests with the same key may both run the handler. The Anchor smart contract provides the final idempotency guarantee. See `src/idempotency.ts` for full caveats.

### Rate limiting

```ts
import { checkRateLimit, apiUserRateLimit, createRateLimiter } from "@comadre/cache";

const { allowed, remaining, resetAt } = await checkRateLimit(apiUserRateLimit, userId);
if (!allowed) return c.json({ error: "Too many requests" }, 429);

// Custom limiter:
const myLimiter = createRateLimiter("custom:prefix", { requests: 10, window: "30 s" });
```

Pre-configured limiters: `apiUserRateLimit` (100/min), `agentToolRateLimit` (30/h), `webhookRateLimit` (60/min).

### WhatsApp 24-hour window

```ts
import { hashPhone, recordInbound, isWithinWindow, getWindowExpiry } from "@comadre/cache";

// hashPhone validates E.164 format (^\+[1-9]\d{6,14}$), trims whitespace,
// then returns a 64-char SHA-256 hex. Throws on invalid format.
const phoneHash = await hashPhone("+5491112345678");

await recordInbound(phoneHash);                       // on each inbound message
const open = await isWithinWindow(phoneHash);         // true → free-form OK
const expiry = await getWindowExpiry(phoneHash);      // Date | null
```

Raw phone numbers are never stored — only the SHA-256 hash.
