/**
 * Comadre Mobile — BalanceCard component.
 *
 * Compact card showing the user's USDC balance and reputation score.
 * USDC balance shows "----" until a real balance endpoint exists.
 * Reputation is shown as a progress bar (0–1000 scale).
 */

import React from "react";

import { View, Text } from "react-native";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BalanceCardProps {
  /** Reputation score (0–1000), or null if unavailable */
  reputation?: number | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BalanceCard({ reputation = null }: BalanceCardProps) {
  const score = reputation ?? 0;
  const pct = Math.min(100, Math.max(0, (score / 1000) * 100));

  return (
    <View className="mx-4 mt-4 p-4 rounded-2xl bg-white shadow-sm border border-gray-100">
      {/* USDC Balance row */}
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-sm text-gray-500 font-medium">Balance USDC</Text>
        <Text className="text-xl font-bold text-gray-900">----</Text>
      </View>

      {/* Divider */}
      <View className="h-px bg-gray-100 my-2" />

      {/* Reputation row */}
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-gray-500 font-medium">Reputación</Text>
        <View className="flex-row items-center">
          {/* Progress bar */}
          <View className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden mr-2">
            <View
              className="h-full bg-purple-500 rounded-full"
              style={{ width: `${pct}%` }}
            />
          </View>
          <Text className="text-sm font-semibold text-gray-900 w-10 text-right">
            {score}
          </Text>
        </View>
      </View>
    </View>
  );
}
