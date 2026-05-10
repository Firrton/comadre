/**
 * Comadre Mobile — Tanda Detail screen.
 *
 * Fetches full tanda detail including members and displays:
 *  - Header: name + state badge
 *  - Members section with MemberRow components
 *  - Info cards: contribution, frequency, turn progress
 *  - Conditional action buttons (start, join, contribute)
 *
 * Handles loading (skeleton), error (404 → "Tanda no encontrada"),
 * and provides mutation feedback via toast.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  ScrollView,
  Text,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";

import {
  useTanda,
  useStartTanda,
  useJoinTanda,
  useContribute,
  type TandaDetail,
} from "../../src/hooks/useTandas";
import { useAuth } from "../../src/hooks/useAuth";
import { MemberRow } from "../../src/components/MemberRow";
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

/** Convert frequency_seconds to human-readable label */
function frequencyLabel(seconds: number): string {
  const days = seconds / 86400;
  if (days === 7) return "Semanal";
  if (days === 15) return "Quincenal";
  if (days === 30) return "Mensual";
  return `Cada ${days} días`;
}

/** Truncate wallet for display */
function truncateWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function DetailSkeleton() {
  return (
    <View className="flex-1 bg-gray-50">
      {/* Header skeleton */}
      <View className="px-4 pt-6 pb-4">
        <View className="h-7 w-3/4 bg-gray-200 rounded-lg mb-2" />
        <View className="h-5 w-1/4 bg-gray-200 rounded-lg" />
      </View>

      {/* Info cards skeleton */}
      <View className="flex-row px-4 gap-3 mb-4">
        <View className="flex-1 h-20 bg-gray-200 rounded-2xl" />
        <View className="flex-1 h-20 bg-gray-200 rounded-2xl" />
        <View className="flex-1 h-20 bg-gray-200 rounded-2xl" />
      </View>

      {/* Members skeleton */}
      <Card className="mx-4 p-5">
        <View className="h-5 w-24 bg-gray-200 rounded-lg mb-4" />
        {[1, 2, 3, 4].map((i) => (
          <View
            key={i}
            className="flex-row items-center py-3 border-b border-gray-100"
          >
            <View className="flex-1 h-4 w-32 bg-gray-200 rounded" />
            <View className="w-16 h-4 bg-gray-200 rounded" />
            <View className="w-8 h-5 bg-gray-200 rounded" />
          </View>
        ))}
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Error State
// ---------------------------------------------------------------------------

function NotFoundState() {
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
// Tanda Detail Content
// ---------------------------------------------------------------------------

interface TandaDetailContentProps {
  tanda: TandaDetail;
  currentWallet: string | null;
  toast: ToastData | null;
  setToast: (t: ToastData | null) => void;
}

function TandaDetailContent({
  tanda,
  currentWallet,
  toast,
  setToast,
}: TandaDetailContentProps) {
  const badgeClass = STATE_CLASSES[tanda.state];
  const badgeTextClass = STATE_TEXT_CLASSES[tanda.state];

  // Mutations
  const startTanda = useStartTanda();
  const joinTanda = useJoinTanda();
  const contribute = useContribute();

  // Determine current user's role
  const isCreator =
    currentWallet != null &&
    tanda.creator.toLowerCase() === currentWallet.toLowerCase();

  // Check if the mock wallet matches current user (for demo with truncated wallets)
  const isCreatorMock =
    tanda.creator === "wallet-1" &&
    currentWallet?.includes("7yLR") === true;

  const effectiveIsCreator = isCreator || isCreatorMock;

  const currentMember = useMemo(() => {
    if (!currentWallet) return null;
    // Try exact match first, then truncated match for mock data
    const exact = tanda.members.find(
      (m) => m.wallet.toLowerCase() === currentWallet.toLowerCase(),
    );
    if (exact) return exact;
    // Mock data uses truncated wallets
    return tanda.members.find((m) => currentWallet?.includes(m.wallet.slice(0, 4)) === true) ?? null;
  }, [tanda.members, currentWallet]);

  const isMember = currentMember != null;
  const isFull = tanda.member_current >= tanda.member_target;

  // Contribution status
  const hasContributedThisTurn =
    isMember && currentMember!.contributions_made >= tanda.current_turn;

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------

  const handleStart = useCallback(() => {
    startTanda.mutate(
      { tandaId: tanda.id },
      {
        onSuccess: () => {
          setToast({ message: "¡Tanda comenzada!", type: "success" });
        },
        onError: (err) => {
          setToast({ message: err.message, type: "error" });
        },
      },
    );
  }, [tanda.id, startTanda, setToast]);

  const handleJoin = useCallback(() => {
    joinTanda.mutate(
      { tandaId: tanda.id },
      {
        onSuccess: () => {
          setToast({ message: "¡Te uniste a la tanda!", type: "success" });
        },
        onError: (err) => {
          setToast({ message: err.message, type: "error" });
        },
      },
    );
  }, [tanda.id, joinTanda, setToast]);

  const handleContribute = useCallback(() => {
    contribute.mutate(
      { tandaId: tanda.id },
      {
        onSuccess: () => {
          setToast({ message: "¡Aporte realizado!", type: "success" });
        },
        onError: (err) => {
          setToast({ message: err.message, type: "error" });
        },
      },
    );
  }, [tanda.id, contribute, setToast]);

  const anyLoading =
    startTanda.isPending || joinTanda.isPending || contribute.isPending;

  return (
    <ScrollView className="flex-1 bg-gray-50">
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Header */}
      <View className="px-4 pt-6 pb-4">
        <View className="flex-row items-center gap-3 mb-2">
          <Text className="text-2xl font-bold text-gray-900 flex-1">
            {tanda.name}
          </Text>
          <View className={`px-3 py-1 rounded-full ${badgeClass}`}>
            <Text className={`text-sm font-medium ${badgeTextClass}`}>
              {STATE_LABEL[tanda.state]}
            </Text>
          </View>
        </View>
        <Text className="text-sm text-gray-500">
          Creada por {truncateWallet(tanda.creator)}
          {effectiveIsCreator ? " (vos)" : ""}
        </Text>
      </View>

      {/* Info Cards */}
      <View className="flex-row px-4 gap-3 mb-4">
        {/* Contribution */}
        <Card className="flex-1 p-3">
          <Text className="text-xs text-gray-500 mb-1">Aporte</Text>
          <Text className="text-base font-bold text-gray-900">
            {formatUsdc(tanda.contribution_amount)}
          </Text>
        </Card>

        {/* Turnos */}
        <Card className="flex-1 p-3">
          <Text className="text-xs text-gray-500 mb-1">Turnos</Text>
          <Text className="text-base font-bold text-gray-900">
            {tanda.current_turn > 0
              ? `${tanda.current_turn} de ${tanda.total_turns}`
              : `${tanda.total_turns} totales`}
          </Text>
        </Card>

        {/* Members */}
        <Card className="flex-1 p-3">
          <Text className="text-xs text-gray-500 mb-1">Miembros</Text>
          <Text className="text-base font-bold text-gray-900">
            {tanda.member_current}/{tanda.member_target}
          </Text>
        </Card>
      </View>

      {/* Members Section */}
      <Card className="mx-4 p-5 mb-4">
        <Text className="text-base font-semibold text-gray-900 mb-3">
          Miembros
        </Text>

        {tanda.members.length === 0 ? (
          <Text className="text-sm text-gray-500 text-center py-4">
            No hay miembros todavía
          </Text>
        ) : (
          tanda.members.map((member, idx) => (
            <MemberRow
              key={member.wallet + idx}
              member={member}
              isCurrentUser={currentMember?.wallet === member.wallet}
            />
          ))
        )}
      </Card>

      {/* Actions */}
      <View className="px-4 pb-10">
        {/* Forming + creator → Start */}
        {tanda.state === "forming" && effectiveIsCreator && (
          <Button
            variant="primary"
            onPress={handleStart}
            loading={startTanda.isPending}
            disabled={anyLoading || tanda.member_current < 3}
            className="w-full"
          >
            Comenzar tanda
          </Button>
        )}

        {/* Forming + not creator + has room → Join */}
        {tanda.state === "forming" && !effectiveIsCreator && (
          <>
            {isFull ? (
              <Button
                variant="secondary"
                disabled
                className="w-full"
              >
                Tanda llena
              </Button>
            ) : isMember ? (
              <Button
                variant="secondary"
                disabled
                className="w-full"
              >
                Ya estás en esta tanda
              </Button>
            ) : (
              <Button
                variant="primary"
                onPress={handleJoin}
                loading={joinTanda.isPending}
                disabled={anyLoading}
                className="w-full"
              >
                Unirse
              </Button>
            )}
          </>
        )}

        {/* Active + member + not contributed → Contribute */}
        {tanda.state === "active" && isMember && (
          <>
            {hasContributedThisTurn ? (
              <Button
                variant="secondary"
                disabled
                className="w-full"
              >
                Ya aportaste este turno
              </Button>
            ) : (
              <Button
                variant="primary"
                onPress={handleContribute}
                loading={contribute.isPending}
                disabled={anyLoading}
                className="w-full"
              >
                Aportar este turno
              </Button>
            )}
          </>
        )}

        {/* Active + not member → message */}
        {tanda.state === "active" && !isMember && (
          <View className="py-4 items-center">
            <Text className="text-sm text-gray-500">
              No sos miembro de esta tanda
            </Text>
          </View>
        )}

        {/* Completed → closed message */}
        {tanda.state === "completed" && (
          <View className="py-4 items-center">
            <Text className="text-sm text-gray-500">
              Esta tanda ya finalizó
            </Text>
          </View>
        )}

        {/* Paused → info */}
        {tanda.state === "paused" && (
          <View className="py-4 items-center">
            <Text className="text-sm text-amber-600">
              Esta tanda está pausada temporalmente
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function TandaDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tanda, isLoading, error } = useTanda(id);
  const { user } = useAuth();
  const currentWallet = user?.walletAddress ?? null;
  const [toast, setToast] = useState<ToastData | null>(null);

  // --- Loading ---
  if (isLoading) {
    return <DetailSkeleton />;
  }

  // --- Error ---
  if (error) {
    const isNotFound =
      (error instanceof AppError &&
        (error.code === "NOT_FOUND" || error.code === "MOCK_NOT_IMPLEMENTED"));
    if (isNotFound) {
      return <NotFoundState />;
    }
    return (
      <View className="flex-1 items-center justify-center px-8 bg-gray-50">
        <View className="w-20 h-20 rounded-full bg-red-100 items-center justify-center mb-6">
          <Text className="text-3xl">⚠️</Text>
        </View>
        <Text className="text-lg font-semibold text-gray-900 text-center mb-2">
          Algo salió mal
        </Text>
        <Text className="text-sm text-gray-500 text-center mb-6">
          {error.message}
        </Text>
      </View>
    );
  }

  // --- No data (null, should not happen with enabled guard) ---
  if (!tanda) {
    return <NotFoundState />;
  }

  // --- Data ---
  return (
    <TandaDetailContent
      tanda={tanda}
      currentWallet={currentWallet}
      toast={toast}
      setToast={setToast}
    />
  );
}
