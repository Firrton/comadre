/**
 * Comadre Mobile — AuthProvider (Privy + token management).
 *
 * Wraps the app with @privy-io/expo's PrivyProvider and provides a React
 * Context with auth state, login/verifyOtp/logout methods, and user info.
 *
 * Auth flow (from design):
 *   idle → sending_otp → otp_sent → verifying → authenticated → error
 *
 * The auth gate (app/index.tsx) uses three high-level states:
 *   - loading: SDK initializing or token being restored
 *   - authenticated: user is logged in and token is stored
 *   - unauthenticated: no active session
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { PrivyProvider, usePrivy, useLoginWithSMS } from "./PrivyShim";
import * as SecureStore from "expo-secure-store";

import {
  PRIVY_APP_ID,
  SECURE_STORE_TOKEN_KEY,
  SECURE_STORE_WALLET_KEY,
  USE_MOCK,
} from "../lib/constants";
import { setOnUnauthorized } from "../api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Exposed user shape consumed by screens and hooks */
export interface AuthUser {
  /** Privy user ID (e.g. "user_abc123") */
  privyUserId: string;
  /**
   * Solana wallet address from the embedded wallet.
   * Available after onboarding/init succeeds.
   */
  walletAddress: string | null;
}

/** Fine-grained auth state for the onboarding flow */
export type AuthState =
  | "idle"
  | "sending_otp"
  | "otp_sent"
  | "verifying"
  | "authenticated"
  | "error";

/** High-level state for the auth gate */
export type AuthGateState = "loading" | "authenticated" | "unauthenticated";

/** Context shape exposed to consumers */
interface AuthContextValue {
  /** Fine-grained state for the onboarding flow */
  authState: AuthState;
  /** High-level state for the auth gate */
  gateState: AuthGateState;
  /** Authenticated user info (null when unauthenticated) */
  user: AuthUser | null;
  /** Error message when authState === "error" */
  errorMessage: string | null;
  /** Send OTP to the given phone number (E.164) */
  login: (phone: string) => Promise<void>;
  /** Verify OTP code and complete authentication */
  verifyOtp: (code: string) => Promise<void>;
  /** Log out: clear Privy session + stored token */
  logout: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuthContext must be used within <AuthProvider>");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// AuthStateProvider (child of PrivyProvider — can use Privy hooks)
// ---------------------------------------------------------------------------

function AuthStateProvider({ children }: { children: React.ReactNode }) {
  const { user: privyUser, getAccessToken, logout: privyLogout } = usePrivy();
  const { sendCode, loginWithCode, state: smsState } = useLoginWithSMS();

  const [authState, setAuthState] = useState<AuthState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [storedWallet, setStoredWallet] = useState<string | null>(null);

  // Restore stored wallet address on mount
  useEffect(() => {
    SecureStore.getItemAsync(SECURE_STORE_WALLET_KEY)
      .then((addr) => {
        if (addr) setStoredWallet(addr);
      })
      .catch(() => {});
  }, []);

  // Mock session restoration — check stored token on mount
  useEffect(() => {
    if (!USE_MOCK) return;
    SecureStore.getItemAsync(SECURE_STORE_TOKEN_KEY)
      .then((token) => {
        if (token) {
          setAuthState("authenticated");
        } else {
          setAuthState("idle");
        }
      })
      .catch(() => setAuthState("idle"));
  }, []);

  // Derive auth state from Privy SDK state (real mode only)
  useEffect(() => {
    if (USE_MOCK) return; // mock mode handles state separately
    // privyUser === undefined means SDK is still initializing
    if (privyUser === undefined) {
      return; // keep current state while loading
    }
    if (privyUser) {
      // Store JWT when user is authenticated
      getAccessToken()
        .then((token) => {
          if (token) {
            SecureStore.setItemAsync(SECURE_STORE_TOKEN_KEY, token);
          }
        })
        .catch(() => {});
      setAuthState("authenticated");
      return;
    }
    // privyUser is null — SDK ready but not authenticated
    setAuthState("idle");
  }, [privyUser, getAccessToken]);

  // Build user object from Privy user
  const user: AuthUser | null = useMemo(() => {
    if (!privyUser) return null;

    // Try to find the Solana wallet from linked accounts
    let walletAddress: string | null = storedWallet;
    if (!walletAddress && privyUser.linked_accounts) {
      for (const account of privyUser.linked_accounts) {
        const a = account as Record<string, unknown>;
        if (
          a["type"] === "wallet" &&
          a["chainType"] === "solana" &&
          a["walletClientType"] === "privy"
        ) {
          walletAddress = (a["address"] as string) ?? null;
          if (walletAddress) {
            SecureStore.setItemAsync(SECURE_STORE_WALLET_KEY, walletAddress);
            setStoredWallet(walletAddress);
          }
          break;
        }
      }
    }

    return {
      privyUserId: privyUser.id,
      walletAddress,
    };
  }, [privyUser, storedWallet]);

  // High-level gate state
  const gateState: AuthGateState = useMemo(() => {
    // Mock mode: skip Privy init check
    if (USE_MOCK) {
      if (authState === "authenticated") return "authenticated";
      return "unauthenticated";
    }
    // privyUser === undefined means SDK is initializing
    if (privyUser === undefined) return "loading";
    if (authState === "authenticated") return "authenticated";
    return "unauthenticated";
  }, [privyUser, authState]);

  // login(phone) — send OTP
  const login = useCallback(
    async (phone: string) => {
      setErrorMessage(null);

      // Mock mode: skip real Privy OTP send
      if (USE_MOCK) {
        setAuthState("otp_sent");
        return;
      }

      setAuthState("sending_otp");
      try {
        await sendCode({ phone });
        setAuthState("otp_sent");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error al enviar código";
        setErrorMessage(msg);
        setAuthState("error");
      }
    },
    [sendCode],
  );

  // verifyOtp(code) — verify OTP and complete login
  const verifyOtp = useCallback(
    async (code: string) => {
      setErrorMessage(null);

      // Mock mode: accept any 6-digit code, store mock token
      if (USE_MOCK) {
        if (code.length < 6) {
          setErrorMessage("Código incorrecto");
          setAuthState("otp_sent");
          return;
        }
        try {
          await SecureStore.setItemAsync(SECURE_STORE_TOKEN_KEY, "mock-jwt");
        } catch {
          // secure-store unavailable — non-fatal
        }
        setAuthState("authenticated");
        return;
      }

      setAuthState("verifying");
      try {
        await loginWithCode({ code });
        // On success, privyUser will update → authState becomes "authenticated"
        // The useEffect above will store the JWT
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Código incorrecto";
        setErrorMessage(msg);
        setAuthState("otp_sent"); // Back to OTP entry for retry
      }
    },
    [loginWithCode],
  );

  // logout() — clear Privy session + stored token
  const logout = useCallback(async () => {
    try {
      await privyLogout();
    } catch {
      // Privy logout may fail if session is already invalid
    }
    try {
      await SecureStore.deleteItemAsync(SECURE_STORE_TOKEN_KEY);
      await SecureStore.deleteItemAsync(SECURE_STORE_WALLET_KEY);
    } catch {
      // secure-store unavailable — non-fatal
    }
    setAuthState("idle");
    setErrorMessage(null);
    setStoredWallet(null);
  }, [privyLogout]);

  // Register the 401 callback so the API client can trigger logout
  useEffect(() => {
    setOnUnauthorized(() => {
      logout();
    });
    return () => setOnUnauthorized(null);
  }, [logout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      authState,
      gateState,
      user,
      errorMessage,
      login,
      verifyOtp,
      logout,
    }),
    [authState, gateState, user, errorMessage, login, verifyOtp, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// AuthProvider (public export — renders PrivyProvider > AuthStateProvider)
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider appId={PRIVY_APP_ID}>
      <AuthStateProvider>{children}</AuthStateProvider>
    </PrivyProvider>
  );
}
