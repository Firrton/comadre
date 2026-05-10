/**
 * Comadre Mobile — TandaCard component.
 *
 * Displays a tanda summary card in the home list:
 *  - Tanda name
 *  - Member count (X/Y)
 *  - State badge with color coding
 *  - Contribution amount in USD
 *  - Current turn indicator
 *
 * Pressing the card navigates to `/tandas/[id]`.
 */

import React from "react";

import { TouchableOpacity, View, Text } from "react-native";
import { router } from "expo-router";
import type { Tanda } from "../hooks/useTandas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a micro-USDC string to a human-readable USD value.
 * Micro-USDC has 6 decimal places. "50000000" → "$50.00 USDC"
 */
function formatUsdc(microAmount: string): string {
  const raw = Number(microAmount) / 1_000_000;
  if (raw >= 1000) {
    return `$${raw.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} USDC`;
  }
  return `$${raw.toFixed(2)} USDC`;
}

/** Map tanda state to user-facing Spanish label */
const STATE_LABEL: Record<Tanda["state"], string> = {
  forming: "Formando",
  active: "Activa",
  completed: "Completada",
  paused: "Pausada",
};

/** State badge background + text color classes */
const STATE_CLASSES: Record<Tanda["state"], string> = {
  forming: "bg-yellow-100",
  active: "bg-green-100",
  completed: "bg-gray-100",
  paused: "bg-red-100",
};

const STATE_TEXT_CLASSES: Record<Tanda["state"], string> = {
  forming: "text-yellow-800",
  active: "text-green-800",
  completed: "text-gray-600",
  paused: "text-red-800",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TandaCardProps {
  tanda: Tanda;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TandaCard({ tanda }: TandaCardProps) {
  const badgeClass = STATE_CLASSES[tanda.state];
  const badgeTextClass = STATE_TEXT_CLASSES[tanda.state];

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => router.push(`/tandas/${tanda.id}`)}
      className="mx-4 mb-3 rounded-2xl bg-white p-4 shadow-sm border border-gray-100"
    >
      {/* Row 1: name + state badge */}
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-base font-semibold text-gray-900 flex-1 mr-2" numberOfLines={1}>
          {tanda.name}
        </Text>
        <View className={`px-2.5 py-1 rounded-full ${badgeClass}`}>
          <Text className={`text-xs font-medium ${badgeTextClass}`}>
            {STATE_LABEL[tanda.state]}
          </Text>
        </View>
      </View>

      {/* Row 2: contribution + turn */}
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-sm text-gray-600">
          {formatUsdc(tanda.contribution_amount)}
        </Text>
        {tanda.state === "active" && (
          <Text className="text-sm text-purple-600 font-medium">
            Turno {tanda.current_turn} de {tanda.total_turns}
          </Text>
        )}
      </View>

      {/* Row 3: member count + total turns */}
      <View className="flex-row items-center">
        <Text className="text-xs text-gray-400">
          {tanda.member_current}/{tanda.member_target} miembros
          {tanda.total_turns > 0 && ` · ${tanda.total_turns} turnos`}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
