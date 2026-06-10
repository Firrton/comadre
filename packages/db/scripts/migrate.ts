/**
 * Run all pending Drizzle migrations.
 *
 * Connection: prefers DIRECT_URL (Supabase direct connection — DDL must
 * bypass PgBouncer transaction pooling), falls back to DATABASE_URL.
 *
 * Reads process.env directly instead of @comadre/config on purpose: the
 * deploy pipeline runs migrations in a context that has no business
 * holding the full application env (Twilio, Privy, etc.).
 *
 * Usage:
 *   DIRECT_URL=postgresql://... bun run scripts/migrate.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];

if (!url) {
  console.error("migrate: set DIRECT_URL (preferred) or DATABASE_URL");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });
const db = drizzle(sql);

console.log("Running migrations…");

await migrate(db, { migrationsFolder: "./drizzle/migrations" });

console.log("Migrations complete.");

await sql.end();
