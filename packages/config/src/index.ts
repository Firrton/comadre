export { envSchema, type Env } from "./env.js";
export { loadEnv } from "./loadEnv.js";

import { loadEnv } from "./loadEnv.js";

/**
 * Pre-loaded env singleton.
 *
 * Importing this module triggers validation immediately.
 * If any required variable is missing or malformed the process exits with code 1.
 *
 * For lazy/deferred validation, import and call `loadEnv()` directly.
 *
 * @example
 * import { env } from "@comadre/config";
 * console.log(env.DATABASE_URL); // fully typed, validated at boot
 */
export const env = loadEnv();
