/**
 * Baseline an existing database into Drizzle's migration journal.
 *
 * Use when a database already carries the schema — e.g. it was synced with
 * `drizzle-kit push` during development — but `drizzle.__drizzle_migrations`
 * has no record of it. In that state `migrate` tries to re-create existing
 * objects and fails with "type ... already exists" (42710).
 *
 * This records ONLY the first journal entry (the baseline-reset migration) as
 * applied, WITHOUT running its SQL. Later migrations stay pending, so a normal
 * `migrate` run afterwards applies them as real deltas.
 *
 * Idempotent: re-running does nothing once the baseline is recorded.
 *
 * Connection: DIRECT_URL (preferred) ?? DATABASE_URL.
 *
 * Usage:
 *   DIRECT_URL=postgresql://... bun run scripts/baseline.ts
 *   DIRECT_URL=postgresql://... bun run scripts/migrate.ts
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];

if (!url) {
  console.error("baseline: set DIRECT_URL (preferred) or DATABASE_URL");
  process.exit(1);
}

const migrationsDir = join(import.meta.dir, "..", "drizzle", "migrations");

const journal = JSON.parse(
  readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"),
) as { entries: Array<{ idx: number; when: number; tag: string }> };

const baseline = journal.entries[0];
if (!baseline) {
  console.error("baseline: no migrations found in journal");
  process.exit(1);
}

// Drizzle stores sha256 of the raw migration file content.
const sqlText = readFileSync(join(migrationsDir, `${baseline.tag}.sql`), "utf8");
const hash = createHash("sha256").update(sqlText).digest("hex");

const sql = postgres(url, { max: 1, prepare: false });

await sql`create schema if not exists drizzle`;
await sql`create table if not exists drizzle."__drizzle_migrations" (id serial primary key, hash text not null, created_at bigint)`;

const existing = await sql`
  select 1 from drizzle."__drizzle_migrations" where created_at = ${baseline.when} limit 1
`;

if (existing.length > 0) {
  console.log(`baseline: ${baseline.tag} already recorded — nothing to do`);
} else {
  await sql`
    insert into drizzle."__drizzle_migrations" ("hash", "created_at")
    values (${hash}, ${baseline.when})
  `;
  console.log(`baseline: marked ${baseline.tag} as applied (schema assumed pre-existing)`);
}

await sql.end();
