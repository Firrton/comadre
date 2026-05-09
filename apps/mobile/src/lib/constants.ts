/**
 * Comadre Mobile — runtime configuration constants.
 *
 * All values come from EXPO_PUBLIC_* environment variables so they can be
 * set at build time via EAS secrets without embedding secrets in code.
 * Fallback values are provided for local development.
 */

/** Base URL for the Comadre API (e.g. http://localhost:3001/api/v1) */
export const API_BASE_URL =
  process.env["EXPO_PUBLIC_API_URL"] ?? "http://localhost:3001/api/v1";

/** Privy App ID — required for @privy-io/expo OTP auth */
export const PRIVY_APP_ID =
  process.env["EXPO_PUBLIC_PRIVY_APP_ID"] ?? "cm00000000000";

/**
 * When true, the API client returns mock data instead of making real HTTP
 * requests. Set in .env for hackathon demo if the backend is unavailable.
 */
export const USE_MOCK =
  process.env["EXPO_PUBLIC_USE_MOCK"] === "true";

/** Default query cache time in milliseconds (30 seconds) */
export const QUERY_STALE_TIME_MS = 30_000;

/** Auth token key in expo-secure-store */
export const SECURE_STORE_TOKEN_KEY = "comadre/auth-token";

/** Auth wallet address key in expo-secure-store */
export const SECURE_STORE_WALLET_KEY = "comadre/wallet-address";
