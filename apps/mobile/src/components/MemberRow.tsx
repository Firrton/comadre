/**
 * Comadre Mobile — MemberRow component.
 *
 * Displays a single member row in the tanda detail screen:
 *  - Truncated wallet address
 *  - Turn number
 *  - Contribution status indicator (✅ / ⬜)
 *  - "Vos" label for the current user
 *
 * Highlights the current user's row with a subtle purple background.
 */

import React from "react";

import { View, Text } from "react-native";
import type { MemberData } from "../hooks/useTandas";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MemberRowProps {
  member: MemberData;
  /** Whether this row represents the currently authenticated user */
  isCurrentUser: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate a wallet address to first 6 and last 4 characters (e.g. "7yLR...64bS") */
function truncateWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MemberRow({ member, isCurrentUser }: MemberRowProps) {
  const contributionStatus =
    member.contributions_made > 0 && member.contributions_made >= member.turn_number
      ? "✅"
      : member.contributions_made > 0
        ? "⏳"
        : "⬜";

  return (
    <View
      className={`flex-row items-center px-4 py-3 border-b border-gray-100 ${
        isCurrentUser ? "bg-purple-50" : "bg-white"
      }`}
    >
      {/* Wallet + Vos label */}
      <View className="flex-1">
        <Text className="text-sm font-medium text-gray-900">
          {truncateWallet(member.wallet)}
          {isCurrentUser && (
            <Text className="text-xs font-semibold text-purple-600">  Vos</Text>
          )}
        </Text>
      </View>

      {/* Turn number */}
      <View className="w-16 items-center">
        <Text className="text-xs text-gray-500">Turno</Text>
        <Text className="text-sm font-semibold text-gray-900">
          {member.turn_number}
        </Text>
      </View>

      {/* Contribution status */}
      <View className="w-12 items-center">
        <Text className="text-lg">{contributionStatus}</Text>
      </View>
    </View>
  );
}
