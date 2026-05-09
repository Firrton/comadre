/**
 * Comadre Mobile — singleton API client.
 *
 * Thin fetch wrapper that:
 *  - Injects Authorization: Bearer <token> from expo-secure-store
 *  - Intercepts 401 → clears token + redirects to onboarding
 *  - Supports EXPO_PUBLIC_USE_MOCK flag for demo fallback
 *  - Exposes type-safe generic get<T> and post<T> methods
 *
 * Does NOT depend on React or any UI framework — pure TypeScript.
 */

import * as SecureStore from "expo-secure-store";
import {
  API_BASE_URL,
  USE_MOCK,
  SECURE_STORE_TOKEN_KEY,
} from "../lib/constants";
import { AppError, mapHttpError } from "../lib/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Strongly-typed options for fetch requests */
interface RequestOptions {
  /** Query parameters appended as ?key=value */
  params?: Record<string, string>;
  /** AbortSignal for request cancellation */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Mock data (extensible by child modules)
// ---------------------------------------------------------------------------

/**
 * Mock response map — keyed by `${method}:${path}`.
 * Child modules (hooks, screens) register their mock responses here
 * so the centralized client can serve them when USE_MOCK is true.
 *
 * Example:
 *   mockRegistry["GET:/api/v1/tandas"] = () => ({ tandas: [] });
 */
type MockHandler = (body?: unknown, params?: Record<string, string>) => unknown;

export const mockRegistry = new Map<string, MockHandler>();

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

/** Read the current JWT from secure storage */
async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECURE_STORE_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Clear auth token (called on 401) */
async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SECURE_STORE_TOKEN_KEY);
  } catch {
    // secure-store unavailable (web/dev) — non-fatal
  }
}

// ---------------------------------------------------------------------------
// 401 redirect callback (set by AuthProvider)
// ---------------------------------------------------------------------------

let onUnauthorized: (() => void) | null = null;

/**
 * Register a callback invoked when the API returns 401.
 * AuthProvider calls this at mount time so the client can trigger
 * a redirect to onboarding without a React import.
 */
export function setOnUnauthorized(cb: (() => void) | null): void {
  onUnauthorized = cb;
}

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

/**
 * Internal fetch wrapper that adds Authorization header and handles errors.
 * Consumers use the typed `get<T>` and `post<T>` methods instead.
 */
async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  // --- Mock mode ---
  if (USE_MOCK) {
    const mockKey = `${method}:${path}`;
    const handler = mockRegistry.get(mockKey);
    if (handler) {
      // Simulate network latency (200-600ms) for realistic demo UX
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 400));
      return handler(body, options?.params) as T;
    }
    throw new AppError("MOCK_NOT_IMPLEMENTED", `Mock no definido para ${mockKey}`);
  }

  // --- Real mode ---
  const token = await getToken();
  const url = buildUrl(path, options?.params);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: options?.signal,
    });
  } catch (err) {
    // Network error (offline, DNS failure, timeout)
    throw new AppError("NETWORK_ERROR");
  }

  // --- 401: clear token + redirect ---
  if (response.status === 401) {
    await clearToken();
    if (onUnauthorized) {
      onUnauthorized();
    }
    throw new AppError("UNAUTHORIZED");
  }

  // --- Parse response ---
  if (!response.ok) {
    let errorBody: { error?: string; message?: string } | undefined;
    try {
      errorBody = await response.json();
    } catch {
      // Non-JSON error body — use status code only
    }
    throw mapHttpError(response.status, errorBody);
  }

  // --- Success ---
  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * GET request with optional query params.
 *
 * @example
 *   const tanda = await api.get<TandaResponse>("/tandas/abc123");
 *   const list = await api.get<TandaResponse[]>("/tandas", { params: { offset: "20" } });
 */
export async function get<T>(
  path: string,
  options?: RequestOptions,
): Promise<T> {
  return request<T>("GET", path, undefined, options);
}

/**
 * POST request with JSON body.
 *
 * @example
 *   const result = await api.post<TandaResponse>("/tandas", { name: "Mi tanda" });
 */
export async function post<T>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>("POST", path, body, options);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a full URL from a relative path and optional query params.
 * Path should NOT include /api/v1 prefix — the base URL handles that.
 */
function buildUrl(path: string, params?: Record<string, string>): string {
  const base = API_BASE_URL.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  let url = `${base}${cleanPath}`;

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      searchParams.append(key, value);
    }
    url += `?${searchParams.toString()}`;
  }

  return url;
}
