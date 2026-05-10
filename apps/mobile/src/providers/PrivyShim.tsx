/**
 * Privy SDK Shim — stub implementations for mock/dev mode.
 *
 * Replaces @privy-io/expo imports with no-op/mock versions so Metro
 * doesn't need to resolve jose → crypto/util/zlib Node.js polyfills.
 *
 * When running with real Privy backend, replace this file with actual
 * @privy-io/expo imports in AuthProvider.tsx.
 */
import React, { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types (match @privy-io/expo shapes minimally)
// ---------------------------------------------------------------------------

interface PrivyUser {
  id: string;
  linked_accounts?: Array<Record<string, unknown>>;
}

interface UsePrivyReturn {
  user: PrivyUser | null | undefined;
  getAccessToken: () => Promise<string | null>;
  logout: () => Promise<void>;
}

interface UseLoginWithSmsReturn {
  sendCode: (params: { phone: string }) => Promise<void>;
  loginWithCode: (params: { code: string }) => Promise<void>;
  state: string;
}

// ---------------------------------------------------------------------------
// Stub hooks
// ---------------------------------------------------------------------------

let _mockUser: PrivyUser | null = null;
let _mockToken: string | null = null;

export function usePrivy(): UsePrivyReturn {
  // user=undefined means loading, null means unauthenticated, object means authenticated
  const [user] = useState<PrivyUser | null>(_mockUser);

  const getAccessToken = useCallback(async () => _mockToken, []);
  const logout = useCallback(async () => {
    _mockUser = null;
    _mockToken = null;
  }, []);

  return { user: user ?? undefined, getAccessToken, logout };
}

export function useLoginWithSMS(): UseLoginWithSmsReturn {
  const [state] = useState<string>("idle");

  const sendCode = useCallback(async (_params: { phone: string }) => {
    // Mock: code is always sent
  }, []);

  const loginWithCode = useCallback(async (_params: { code: string }) => {
    // Mock: any 6-digit code works
    _mockUser = {
      id: "mock-privy-user",
      linked_accounts: [
        {
          type: "wallet",
          chainType: "solana",
          walletClientType: "privy",
          address: "7yLRNcZkbjQfu4xsyvewpVAcgFd4fD8pBLKahRFT64bS",
          id: "mock-wallet-id",
        },
      ],
    };
    _mockToken = "mock-privy-jwt";
  }, []);

  return { sendCode, loginWithCode, state };
}

// ---------------------------------------------------------------------------
// Stub provider
// ---------------------------------------------------------------------------

export function PrivyProvider({
  children,
}: {
  appId: string;
  children: React.ReactNode;
}) {
  return React.createElement(React.Fragment, null, children);
}
