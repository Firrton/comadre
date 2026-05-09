/**
 * Auth gate — the first screen the user sees.
 *
 * Checks auth state from AuthProvider and redirects:
 *   - loading → splash / loading screen
 *   - unauthenticated → /(auth)/onboarding
 *   - authenticated → /(tabs)/
 *
 * Uses expo-router's `Redirect` for declarative routing. The gate runs on
 * every mount; the AuthProvider's loading state ensures the redirect only
 * happens once the Privy SDK is ready.
 */

import { Redirect } from "expo-router";
import { View, Text, ActivityIndicator } from "react-native";

import { useAuth } from "../src/hooks/useAuth";

export default function AuthGate() {
  const { gateState } = useAuth();

  if (gateState === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#7C3AED" />
        <Text className="mt-4 text-gray-500 text-base">
          Cargando...
        </Text>
      </View>
    );
  }

  if (gateState === "unauthenticated") {
    return <Redirect href="/(auth)/onboarding" />;
  }

  // authenticated
  return <Redirect href="/(tabs)" />;
}
