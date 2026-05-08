/**
 * Run all pending Drizzle migrations against DATABASE_URL.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... bun run scripts/migrate.ts
 *
 * Railway / CI: DATABASE_URL is injected by the platform.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "@comadre/config";

const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });
const db = drizzle(sql);

console.log("Running migrations…");

await migrate(db, { migrationsFolder: "./drizzle/migrations" });

console.log("Migrations complete.");

await sql.end();
