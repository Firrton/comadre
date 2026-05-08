/**
 * @comadre/db — Drizzle + postgres-js connection pool singleton.
 *
 * Lazy-initialized on first import; safe to import in serverless contexts
 * (Railway, Fly.io) because the pool is only created when actually needed.
 *
 * Pool settings:
 * - max: 10       — enough for most API pods; tune per instance count
 * - idle_timeout: 30s — release idle connections quickly on Supabase free tier
 * - prepare: false   — REQUIRED for PgBouncer (Supabase uses transaction-mode
 *                       pooling; prepared statements are not supported)
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@comadre/config";
import * as schema from "./schema.js";

type DbInstance = ReturnType<typeof drizzle<typeof schema>>;

let _sql: ReturnType<typeof postgres> | null = null;
let _db: DbInstance | null = null;

function getSql(): ReturnType<typeof postgres> {
  if (_sql === null) {
    _sql = postgres(env.DATABASE_URL, {
      max: 10,
      idle_timeout: 30,
      // PgBouncer transaction-mode pooling requires prepare:false
      prepare: false,
    });
  }
  return _sql;
}

/**
 * Lazily-initialized Drizzle instance.
 *
 * @example
 * import { db } from "@comadre/db";
 * const rows = await db.select().from(users).where(eq(users.wallet, wallet));
 */
export function getDb(): DbInstance {
  if (_db === null) {
    _db = drizzle(getSql(), { schema });
  }
  return _db;
}

/**
 * Convenience re-export — the singleton db instance.
 * Using a getter ensures initialization is deferred until first access.
 */
// We export a Proxy so consumers can write `db.select(...)` directly
// without calling getDb() manually, while still being lazy.
export const db = new Proxy({} as DbInstance, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
}) as DbInstance;

/**
 * Gracefully close all connections in the pool.
 * Call this in process shutdown handlers (SIGTERM, SIGINT).
 *
 * @example
 * process.on("SIGTERM", async () => {
 *   await closeDb();
 *   process.exit(0);
 * });
 */
export async function closeDb(): Promise<void> {
  if (_sql !== null) {
    await _sql.end({ timeout: 5 });
    _sql = null;
    _db = null;
  }
}
