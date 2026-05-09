/**
 * Root layout — wraps the entire app with providers.
 *
 * Provider order (outermost first):
 *   1. QueryProvider — React Query client (must be above AuthProvider so
 *      auth hooks can use React Query if needed)
 *   2. AuthProvider — Privy OTP + auth state + token management
 *
 * Stack screen options: all screens start with headerShown=false since
 * we render our own headers or the screen is full-bleed (onboarding).
 */

import { Stack } from "expo-router";

import { QueryProvider } from "../src/providers/QueryProvider";
import { AuthProvider } from "../src/providers/AuthProvider";

export default function RootLayout() {
  return (
    <QueryProvider>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </QueryProvider>
  );
}
