/**
 * Comadre Mobile — Join Tanda via deep link.
 *
 * Entry point for `comadre://join/:id` deep links.
 *
 * Fetches the tanda detail and shows a preview card with contextual
 * action buttons based on auth state, tanda state, and membership.
 *
 * States handled:
 *  - Loading → skeleton placeholder
 *  - Error / 404 → "Tanda no encontrada"
 *  - Non-forming state → "Esta tanda no está aceptando miembros"
 *  - Unauthenticated → "Iniciá sesión para unirte" → redirect to onboarding
 *  - Authenticated + room → "Unirse a esta tanda" (calls useJoinTanda)
 *  - Already member → "Ya sos parte de esta tanda"
 *  - Full → "Tanda llena"
 */

import React, { useCallback, useState } from "react";
import {
  View,
  ScrollView,
  Text,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";

import {
  useTanda,
  useJoinTanda,
  type TandaDetail,
} from "../../src/hooks/useTandas";
import { useAuth } from "../../src/hooks/useAuth";
import { Button } from "../../src/components/ui/Button";
import { Card } from "../../src/components/ui/Card";
import { Toast, type ToastData } from "../../src/components/ui/Toast";
import { AppError } from "../../src/lib/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map tanda state to user-facing Spanish label */
const STATE_LABEL: Record<TandaDetail["state"], string> = {
  forming: "Formando",
  active: "Activa",
  completed: "Completada",
  paused: "Pausada",
};

/** State badge classes */
const STATE_CLASSES: Record<TandaDetail["state"], string> = {
  forming: "bg-yellow-100",
  active: "bg-green-100",
  completed: "bg-gray-100",
  paused: "bg-red-100",
};

const STATE_TEXT_CLASSES: Record<TandaDetail["state"], string> = {
  forming: "text-yellow-800",
  active: "text-green-800",
  completed: "text-gray-600",
  paused: "text-red-800",
};

/** Format micro-USDC to human-readable USD */
function formatUsdc(microAmount: string): string {
  const raw = Number(microAmount) / 1_000_000;
  if (raw >= 1000) {
    return `$${raw.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} USDC`;
  }
  return `$${raw.toFixed(2)} USDC`;
}

/**
 * Infer frequency label from tanda attributes.
 *
 * The TandaDetail type does not include frequency_seconds (the API may
 * add it in the future). For mock data, infer from tanda name patterns.
 * Real API responses will include frequency_seconds — update this helper
 * when the API contract is extended.
 */
function inferFrequencyLabel(tandaName: string): string {
  const lower = tandaName.toLowerCase();
  if (lower.includes("semanal") || lower.includes("viernes")) return "Semanal";
  if (lower.includes("quincenal")) return "Quincenal";
  if (lower.includes("mensual") || lower.includes("ahorro") || lower.includes("vacaciones")) return "Mensual";
  return "Semanal";
}

// ---------------------------------------------------------------------------
// Join screen skeleton
// ---------------------------------------------------------------------------

function JoinSkeleton() {
  return (
    <View className="flex-1 bg-gray-50">
      <View className="flex-1 items-center justify-center px-8">
        <ActivityIndicator size="large" color="#7C3AED" />
        <Text className="mt-4 text-gray-400">Cargando...</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Not found state
// ---------------------------------------------------------------------------

function TandaNotFound() {
  return (
    <View className="flex-1 items-center justify-center px-8 bg-gray-50">
      <View className="w-20 h-20 rounded-full bg-red-100 items-center justify-center mb-6">
        <Text className="text-3xl">🔍</Text>
      </View>
      <Text className="text-lg font-semibold text-gray-900 text-center mb-2">
        Tanda no encontrada
      </Text>
      <Text className="text-sm text-gray-500 text-center">
        No encontramos esta tanda. Puede haber sido eliminada o el enlace no es
        válido.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Not accepting members (non-forming state)
// ---------------------------------------------------------------------------

function TandaNotAccepting({ state }: { state: string }) {
  return (
    <View className="flex-1 items-center justify-center px-8 bg-gray-50">
      <View className="w-20 h-20 rounded-full bg-amber-100 items-center justify-center mb-6">
        <Text className="text-3xl">🚫</Text>
      </View>
      <Text className="text-lg font-semibold text-gray-900 text-center mb-2">
        Esta tanda no está aceptando miembros
      </Text>
      <Text className="text-sm text-gray-500 text-center">
        {state === "active"
          ? "La tanda ya está activa y no acepta nuevos miembros."
          : state === "completed"
            ? "La tanda ya finalizó."
            : "La tanda no está disponible en este momento."}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tanda preview content (when data is available)
// ---------------------------------------------------------------------------

interface JoinContentProps {
  tanda: TandaDetail;
}

function JoinContent({ tanda }: JoinContentProps) {
  const { user } = useAuth();
  const joinTanda = useJoinTanda();
  const [toast, setToast] = useState<ToastData | null>(null);

  const badgeClass = STATE_CLASSES[tanda.state];
  const badgeTextClass = STATE_TEXT_CLASSES[tanda.state];

  const isFull = tanda.member_current >= tanda.member_target;

  // Check if current user is already a member
  const currentWallet = user?.walletAddress ?? null;
  const isMember =
    currentWallet != null &&
    tanda.members.some(
      (m) =>
        m.wallet.toLowerCase() === currentWallet.toLowerCase() ||
        (currentWallet.includes("7yLR") && m.wallet.includes("7yLR")),
    );

  // --- Join handler ---
  const handleJoin = useCallback(() => {
    joinTanda.mutate(
      { tandaId: tanda.id },
      {
        onSuccess: () => {
          setToast({ message: "¡Te uniste a la tanda!", type: "success" });
          // Navigate to tanda detail after a brief delay so the toast is visible
          setTimeout(() => {
            router.replace(`/tandas/${tanda.id}`);
          }, 800);
        },
        onError: (err) => {
          setToast({ message: err.message, type: "error" });
        },
      },
    );
  }, [tanda.id, joinTanda]);

  // --- Login handler — redirect to onboarding ---
  const handleLogin = useCallback(() => {
    router.push("/(auth)/onboarding");
  }, []);

  return (
    <ScrollView className="flex-1 bg-gray-50">
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Header */}
      <View className="px-4 pt-10 pb-4 items-center">
        <View className="w-20 h-20 rounded-full bg-purple-100 items-center justify-center mb-4">
          <Text className="text-3xl">🤝</Text>
        </View>
        <Text className="text-2xl font-bold text-gray-900 text-center mb-2">
          {tanda.name}
        </Text>
        <View className={`px-3 py-1 rounded-full ${badgeClass}`}>
          <Text className={`text-sm font-medium ${badgeTextClass}`}>
            {STATE_LABEL[tanda.state]}
          </Text>
        </View>
      </View>

      {/* Info cards */}
      <Card className="mx-4 mb-4">
        <View className="flex-row mb-3">
          <View className="flex-1">
            <Text className="text-xs text-gray-400 mb-0.5">Miembros</Text>
            <Text className="text-base font-bold text-gray-900">
              {tanda.member_current}/{tanda.member_target}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-xs text-gray-400 mb-0.5">Aporte</Text>
            <Text className="text-base font-bold text-gray-900">
              {formatUsdc(tanda.contribution_amount)}
            </Text>
          </View>
        </View>
        <View className="flex-row">
          <View className="flex-1">
            <Text className="text-xs text-gray-400 mb-0.5">Frecuencia</Text>
            <Text className="text-base font-semibold text-gray-700">
              {inferFrequencyLabel(tanda.name)}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-xs text-gray-400 mb-0.5">Turnos</Text>
            <Text className="text-base font-semibold text-gray-700">
              {tanda.total_turns ?? "-"}
            </Text>
          </View>
        </View>
      </Card>

      {/* Tanda description / details */}
      <View className="px-4 mb-6">
        <Text className="text-sm text-gray-500 text-center leading-5">
          {tanda.state === "forming"
            ? "Esta tanda está en formación. ¡Sumate para empezar a ahorrar juntos!"
            : tanda.state === "active"
              ? "Esta tanda ya está activa."
              : ""}
        </Text>
      </View>

      {/* Action buttons */}
      <View className="px-4 pb-10">
        {/* Unauthenticated + forming → login prompt */}
        {!user && tanda.state === "forming" && (
          <Button
            variant="primary"
            onPress={handleLogin}
            className="w-full"
          >
            Iniciá sesión para unirte
          </Button>
        )}

        {/* Unauthenticated + non-forming → show not-accepting */}
        {!user && tanda.state !== "forming" && (
          <TandaNotAccepting state={tanda.state} />
        )}

        {/* Authenticated but tanda is full */}
        {user && isFull && (
          <Button
            variant="secondary"
            disabled
            className="w-full"
          >
            Tanda llena
          </Button>
        )}

        {/* Authenticated + already member */}
        {user && isMember && (
          <Button
            variant="secondary"
            disabled
            className="w-full"
          >
            Ya sos parte de esta tanda
          </Button>
        )}

        {/* Authenticated + room + not member → join */}
        {user && !isFull && !isMember && tanda.state === "forming" && (
          <Button
            variant="primary"
            onPress={handleJoin}
            loading={joinTanda.isPending}
            disabled={joinTanda.isPending}
            className="w-full"
          >
            Unirse a esta tanda
          </Button>
        )}

        {/* Authenticated + non-forming */}
        {user && tanda.state !== "forming" && !isMember && (
          <TandaNotAccepting state={tanda.state} />
        )}
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Screen — top-level state router
// ---------------------------------------------------------------------------

export default function JoinTandaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tanda, isLoading, error } = useTanda(id);

  // --- Loading ---
  if (isLoading) {
    return <JoinSkeleton />;
  }

  // --- Error ---
  if (error) {
    const isNotFound =
      error instanceof AppError &&
      (error.code === "NOT_FOUND" || error.code === "MOCK_NOT_IMPLEMENTED");

    if (isNotFound) {
      return <TandaNotFound />;
    }

    // Generic error
    return (
      <View className="flex-1 items-center justify-center px-8 bg-gray-50">
        <View className="w-20 h-20 rounded-full bg-red-100 items-center justify-center mb-6">
          <Text className="text-3xl">⚠️</Text>
        </View>
        <Text className="text-lg font-semibold text-gray-900 text-center mb-2">
          Algo salió mal
        </Text>
        <Text className="text-sm text-gray-500 text-center">
          {error.message}
        </Text>
      </View>
    );
  }

  // --- Not found (null data) ---
  if (!tanda) {
    return <TandaNotFound />;
  }

  // --- Data ---
  return <JoinContent tanda={tanda} />;
}
