import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // DDL must bypass PgBouncer transaction pooling (Supabase): prefer the
    // direct connection when configured.
    url:
      process.env["DIRECT_URL"] ??
      process.env["DATABASE_URL"] ??
      "postgresql://localhost:5432/comadre",
  },
});
