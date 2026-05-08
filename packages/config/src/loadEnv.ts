import pc from "picocolors";
import { envSchema, type Env } from "./env.js";

let cached: Env | null = null;

/**
 * Parse and validate process.env against the Comadre env schema.
 *
 * - Idempotent: subsequent calls return the cached result.
 * - Fail-fast: exits with code 1 on the first run if validation fails,
 *   printing every missing/malformed variable with a clear, colorized message.
 * - Does NOT read .env files — relies on the runtime (Bun dev, Railway, Fly.io)
 *   to inject environment variables before the process starts.
 */
export function loadEnv(): Env {
  if (cached !== null) return cached;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const flat = result.error.flatten();

    console.error(
      pc.bold(pc.red("\n[comadre/config] Environment validation FAILED\n"))
    );

    const fieldErrors = flat.fieldErrors as Record<string, string[] | undefined>;

    for (const [field, messages] of Object.entries(fieldErrors)) {
      const reasons = (messages ?? ["invalid value"]).join(", ");
      console.error(
        `  ${pc.red("✗")} ${pc.bold(pc.yellow(field))}: ${pc.dim(reasons)}`
      );
    }

    if (flat.formErrors.length > 0) {
      console.error(
        `\n  ${pc.red("Form-level errors:")} ${flat.formErrors.join(", ")}`
      );
    }

    console.error(
      pc.dim(
        "\nFix the above variables and restart the service. " +
          "Copy .env.example → .env.local and fill in the values.\n"
      )
    );

    process.exit(1);
  }

  cached = result.data;
  return cached;
}
