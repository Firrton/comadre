/**
 * Auth layout — Stack navigator for the unauthenticated flow.
 *
 * No tabs, no header — the onboarding screen is full-bleed.
 * All screens in this group are only reachable when the user
 * is not authenticated (redirected here by the auth gate).
 */

import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
      }}
    />
  );
}
