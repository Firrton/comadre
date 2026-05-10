/**
 * Comadre Mobile — Profile screen.
 *
 * Displays the authenticated user's profile:
 *  - Wallet address (truncated)
 *  - KYC tier badge
 *  - Reputation score with progress bar
 *  - Tanda stats grid
 *  - KYC upgrade CTA (hidden at t3_pro)
 *
 * Handles mock mode gracefully: uses profile data from the API hook
 * (which has its own mock data) rather than depending on Privy's user object.
 */

import React, { useCallback } from "react";

import {
  View,
  ScrollView,
  Text,
  ActivityIndicator,
} from "react-native";

import { useProfile, useKycSession, KYC_TIER_LABELS } from "../../src/hooks/useProfile";
import { Button } from "../../src/components/ui/Button";
import { Card } from "../../src/components/ui/Card";
import { AppError } from "../../src/lib/errors";
import type { KycTier, UserProfile } from "../../src/hooks/useProfile";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate wallet address: first 4 + "..." + last 4 */
function truncateWallet(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/** KYC tier badge background + text color classes */
const KYC_BADGE_BG: Record<KycTier, string> = {
  t0_demo: "bg-gray-100",
  t1_lite: "bg-blue-100",
  t2_standard: "bg-green-100",
  t3_pro: "bg-purple-100",
};
const KYC_BADGE_TEXT: Record<KycTier, string> = {
  t0_demo: "text-gray-600",
  t1_lite: "text-blue-800",
  t2_standard: "text-green-800",
  t3_pro: "text-purple-800",
};

// ---------------------------------------------------------------------------
// Stat item sub-component
// ---------------------------------------------------------------------------

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <View className="items-center flex-1">
      <Text className="text-2xl font-bold text-gray-900">{value}</Text>
      <Text className="text-xs text-gray-500 mt-1 text-center leading-4">
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ProfileSkeleton() {
  return (
    <View className="flex-1 items-center justify-center bg-gray-50">
      <ActivityIndicator size="large" color="#7C3AED" />
      <Text className="mt-4 text-gray-400">Cargando perfil...</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function ProfileError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View className="flex-1 items-center justify-center px-8 bg-gray-50">
      <Text className="text-lg font-semibold text-gray-900 mb-2 text-center">
        No pudimos cargar tu perfil
      </Text>
      <Text className="text-sm text-gray-500 mb-6 text-center">{message}</Text>
      <Button variant="primary" onPress={onRetry}>
        Reintentar
      </Button>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main profile screen — renders with data
// ---------------------------------------------------------------------------

function ProfileContent({ profile }: { profile: UserProfile }) {
  const kyc = useKycSession();

  const handleKycUpgrade = useCallback(() => {
    kyc.mutate(undefined, {
      onSuccess: (data) => {
        if (data.stub) {
          // KYC stub mode — display coming soon message
          // In production, this would navigate to the Sumsub SDK flow
          alert("KYC — próximamente disponible");
        }
      },
    });
  }, [kyc]);

  const kycBg = KYC_BADGE_BG[profile.kycTier] ?? KYC_BADGE_BG.t0_demo;
  const kycText = KYC_BADGE_TEXT[profile.kycTier] ?? KYC_BADGE_TEXT.t0_demo;
  const reputationPct = Math.min(100, Math.max(0, (profile.reputationScore / 1000) * 100));

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ paddingBottom: 32 }}>
      {/* Wallet address */}
      <Card className="mx-4 mt-4">
        <Text className="text-xs text-gray-400 font-medium mb-1">Wallet</Text>
        <Text className="text-base font-mono text-gray-900">
          {truncateWallet(profile.wallet)}
        </Text>
      </Card>

      {/* KYC tier + Reputation */}
      <View className="flex-row mx-4 mt-3">
        {/* KYC tier */}
        <Card className="flex-1">
          <Text className="text-xs text-gray-400 font-medium mb-1">Nivel KYC</Text>
          <View className={`self-start px-3 py-1 rounded-full ${kycBg}`}>
            <Text className={`text-sm font-semibold ${kycText}`}>
              {KYC_TIER_LABELS[profile.kycTier]}
            </Text>
          </View>
        </Card>

        {/* Reputation */}
        <Card className="flex-1 ml-3">
          <Text className="text-xs text-gray-400 font-medium mb-1">Reputación</Text>
          <Text className="text-2xl font-bold text-gray-900">
            {profile.reputationScore}
          </Text>
          <View className="w-full h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
            <View
              className="h-full bg-purple-500 rounded-full"
              style={{ width: `${reputationPct}%` }}
            />
          </View>
        </Card>
      </View>

      {/* Stats grid */}
      <Card className="mx-4 mt-3">
        <Text className="text-xs text-gray-400 font-medium mb-3">Estadísticas</Text>
        <View className="flex-row">
          <StatItem label="Tandas\ncompletadas" value={profile.tandasCompleted} />
          <View className="w-px bg-gray-100 mx-2" />
          <StatItem label="Tandas\ncreadas" value={profile.tandasCreated} />
          <View className="w-px bg-gray-100 mx-2" />
          <StatItem label="Defaults" value={profile.tandasDefaulted} />
        </View>
      </Card>

      {/* KYC upgrade button (hidden at max tier) */}
      {profile.kycTier !== "t3_pro" && (
        <View className="mx-4 mt-6">
          <Button
            variant="secondary"
            onPress={handleKycUpgrade}
            loading={kyc.isPending}
          >
            Mejorar verificación
          </Button>
        </View>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Profile not found — prompt to complete setup
// ---------------------------------------------------------------------------

function ProfileSetupPrompt({ onRetry }: { onRetry: () => void }) {
  return (
    <View className="flex-1 items-center justify-center px-8 bg-gray-50">
      <View className="w-20 h-20 rounded-full bg-purple-100 items-center justify-center mb-4">
        <Text className="text-3xl">👤</Text>
      </View>
      <Text className="text-lg font-semibold text-gray-900 text-center mb-2">
        Completá tu perfil
      </Text>
      <Text className="text-sm text-gray-500 text-center mb-6">
        Tu cuenta necesita información adicional para empezar a usar Comadre.
      </Text>
      <Button variant="primary" onPress={onRetry}>
        Completar configuración
      </Button>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Top-level profile screen (loading / error / 404 / data)
// ---------------------------------------------------------------------------

export default function ProfileScreen() {
  const { profile, isLoading, error, refetch } = useProfile();

  // --- Loading ---
  if (isLoading) {
    return <ProfileSkeleton />;
  }

  // --- Error ---
  if (error) {
    // 404 / NOT_FOUND → prompt setup rather than generic error
    const isNotFound =
      error instanceof AppError && error.code === "NOT_FOUND";

    if (isNotFound || !profile) {
      return <ProfileSetupPrompt onRetry={() => refetch()} />;
    }

    return (
      <ProfileError
        message={error instanceof Error ? error.message : "Error desconocido"}
        onRetry={() => refetch()}
      />
    );
  }

  // --- Missing data (no error but no profile — edge case) ---
  if (!profile) {
    return <ProfileSetupPrompt onRetry={() => refetch()} />;
  }

  // --- Data ---
  return <ProfileContent profile={profile} />;
}
