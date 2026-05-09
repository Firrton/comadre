/**
 * Comadre Mobile — useProfile & useKycSession React Query hooks.
 *
 * Fetches authenticated user profile from `GET /api/v1/users/me`
 * and provides a mutation for KYC session creation.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { get, post, mockRegistry } from "../api/client";
import { USE_MOCK } from "../lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** KYC tier levels returned by the API */
export type KycTier = "t0_demo" | "t1_lite" | "t2_standard" | "t3_pro";

/** User profile shape from GET /api/v1/users/me */
export interface UserProfile {
  wallet: string;
  kycTier: KycTier;
  reputationScore: number;
  tandasCompleted: number;
  tandasCreated: number;
  tandasDefaulted: number;
}

/** KYC session response from POST /api/v1/kyc/session */
interface KycSessionResponse {
  sessionToken: string;
  sessionId: string;
  stub?: boolean;
}

// ---------------------------------------------------------------------------
// Keyc tier display labels
// ---------------------------------------------------------------------------

export const KYC_TIER_LABELS: Record<KycTier, string> = {
  t0_demo: "Demo",
  t1_lite: "Lite",
  t2_standard: "Standard",
  t3_pro: "Pro",
};

// ---------------------------------------------------------------------------
// Mock data (automatically registered)
// ---------------------------------------------------------------------------

const MOCK_PROFILE: UserProfile = {
  wallet: "7yLR...64bS",
  kycTier: "t1_lite",
  reputationScore: 85,
  tandasCompleted: 3,
  tandasCreated: 1,
  tandasDefaulted: 0,
};

if (USE_MOCK) {
  mockRegistry.set("GET:/api/v1/users/me", async () => {
    await new Promise((r) => setTimeout(r, 300));
    return MOCK_PROFILE;
  });

  mockRegistry.set("POST:/api/v1/kyc/session", async () => {
    await new Promise((r) => setTimeout(r, 200));
    return {
      sessionToken: "mock-kyc-token",
      sessionId: "mock-session-id",
      stub: true,
    } satisfies KycSessionResponse;
  });
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Fetch the authenticated user's profile.
 *
 * Returns `{ profile, isLoading, error }`.
 * In mock mode, returns `MOCK_PROFILE`.
 */
export function useProfile() {
  const query = useQuery<UserProfile>({
    queryKey: ["profile"],
    queryFn: () => get<UserProfile>("/api/v1/users/me"),
  });

  return {
    profile: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Mutation to create a KYC verification session.
 *
 * Calls `POST /api/v1/kyc/session` and returns the session token + ID.
 * In mock mode, returns a stub session.
 */
export function useKycSession() {
  return useMutation<KycSessionResponse>({
    mutationFn: () => post<KycSessionResponse>("/api/v1/kyc/session"),
  });
}
