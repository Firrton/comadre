/**
 * Comadre Mobile — Create Tanda form.
 *
 * Collects tanda parameters from the user, validates with Zod, and
 * submits via `POST /api/v1/tandas`. On success navigates back to
 * home with a success toast. Displays inline errors on validation
 * or API failure and a loading state on the submit button.
 */

import React, { useCallback, useState } from "react";

import {
  View,
  ScrollView,
  Text,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from "react-native";
import { router } from "expo-router";
import { z } from "zod";

import { useCreateTanda } from "../../src/hooks/useTandas";
import { Input } from "../../src/components/ui/Input";
import { Button } from "../../src/components/ui/Button";
import { Card } from "../../src/components/ui/Card";
import { Toast, type ToastData } from "../../src/components/ui/Toast";

// ---------------------------------------------------------------------------
// Validation schema (mobile-specific — simpler than backend CreateTandaInput)
// ---------------------------------------------------------------------------

const FREQUENCY_OPTIONS = [
  { label: "Semanal", value: 7 },
  { label: "Quincenal", value: 15 },
  { label: "Mensual", value: 30 },
] as const;

const PAYOUT_OPTIONS = [
  { label: "Orden de entrada", value: "join_order" },
  { label: "Elige el creador", value: "creator_set" },
] as const;

const CreateTandaFormSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre es obligatorio")
    .max(32, "Máximo 32 caracteres"),
  member_target: z
    .number({ invalid_type_error: "Ingresá un número" })
    .int("Debe ser un número entero")
    .min(3, "Mínimo 3 miembros")
    .max(20, "Máximo 20 miembros"),
  contribution_amount: z
    .number({ invalid_type_error: "Ingresá un monto" })
    .positive("El monto debe ser mayor a 0")
    .max(1_000_000, "Monto máximo: $1,000,000 USD"),
  frequency_days: z.number().refine((v) => [7, 15, 30].includes(v), {
    message: "Seleccioná una frecuencia",
  }),
  payout_order_mode: z.enum(["join_order", "creator_set"]),
});

interface FormErrors {
  name?: string;
  member_target?: string;
  contribution_amount?: string;
  frequency_days?: string;
  payout_order_mode?: string;
}

/** Convert frequency_days to frequency_seconds for the API */
function daysToSeconds(days: number): number {
  return days * 86400;
}

/** Convert a USD decimal string to micro-USDC (multiply by 1,000,000) */
function usdToMicroUsdc(usdAmount: number): string {
  return String(Math.round(usdAmount * 1_000_000));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CreateTandaScreen() {
  // Form state
  const [name, setName] = useState("");
  const [memberTarget, setMemberTarget] = useState(5);
  const [contributionText, setContributionText] = useState("");
  const [frequencyDays, setFrequencyDays] = useState<number>(7);
  const [payoutMode, setPayoutMode] = useState<"join_order" | "creator_set">(
    "join_order",
  );

  // Derived numeric contribution amount
  const contributionAmount = contributionText
    ? parseFloat(contributionText)
    : 0;

  // Validation errors
  const [errors, setErrors] = useState<FormErrors>({});

  // Toast
  const [toast, setToast] = useState<ToastData | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  // Mutation
  const createTanda = useCreateTanda();

  // ---------------------------------------------------------------------------
  // Validate and submit
  // ---------------------------------------------------------------------------

  const handleSubmit = useCallback(() => {
    setApiError(null);
    setErrors({});

    // Build the data object
    const data = {
      name: name.trim(),
      member_target: memberTarget,
      contribution_amount: contributionAmount,
      frequency_days: frequencyDays,
      payout_order_mode: payoutMode,
    };

    // Validate
    const result = CreateTandaFormSchema.safeParse(data);
    if (!result.success) {
      const fieldErrors: FormErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof FormErrors;
        if (!fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    // Build API payload (convert units)
    const payload = {
      name: data.name,
      member_target: data.member_target,
      contribution_amount: usdToMicroUsdc(data.contribution_amount),
      stake_amount: usdToMicroUsdc(data.contribution_amount), // same as contribution for MVP
      frequency_seconds: daysToSeconds(data.frequency_days),
      payout_order_mode: data.payout_order_mode,
      usdc_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC devnet mint
    };

    createTanda.mutate(payload, {
      onSuccess: () => {
        router.back();
      },
      onError: (err) => {
        setApiError(err.message);
      },
    });
  }, [
    name,
    memberTarget,
    contributionAmount,
    frequencyDays,
    payoutMode,
    createTanda,
  ]);

  const isLoading = createTanda.isPending;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-gray-50"
    >
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View className="px-4 pt-6 pb-4">
          <Text className="text-2xl font-bold text-gray-900">Crear tanda</Text>
          <Text className="text-sm text-gray-500 mt-1">
            Configurá tu tanda y empezá a ahorrar con tus comadres
          </Text>
        </View>

        {/* Form Card */}
        <Card className="mx-4 p-5">
          {/* --- Name --- */}
          <Input
            label="Nombre de la tanda"
            placeholder="Ej: Tanda del Viernes"
            value={name}
            onChangeText={setName}
            error={errors.name}
            maxLength={32}
            editable={!isLoading}
          />

          {/* --- Member target (stepper) --- */}
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Cantidad de miembros
            </Text>
            <View className="flex-row items-center justify-between bg-white border border-gray-300 rounded-xl px-4 py-3">
              <TouchableOpacity
                onPress={() =>
                  setMemberTarget((prev) => Math.max(3, prev - 1))
                }
                disabled={isLoading || memberTarget <= 3}
                className="w-10 h-10 items-center justify-center rounded-lg bg-gray-100"
                activeOpacity={0.7}
              >
                <Text className="text-xl font-semibold text-gray-700">−</Text>
              </TouchableOpacity>

              <Text className="text-xl font-bold text-purple-600">
                {memberTarget}
              </Text>

              <TouchableOpacity
                onPress={() =>
                  setMemberTarget((prev) => Math.min(20, prev + 1))
                }
                disabled={isLoading || memberTarget >= 20}
                className="w-10 h-10 items-center justify-center rounded-lg bg-purple-100"
                activeOpacity={0.7}
              >
                <Text className="text-xl font-semibold text-purple-600">+</Text>
              </TouchableOpacity>
            </View>
            {errors.member_target && (
              <Text className="text-sm text-red-500 mt-1">
                {errors.member_target}
              </Text>
            )}
          </View>

          {/* --- Contribution amount --- */}
          <Input
            label="Aporte por turno (USD)"
            placeholder="Ej: 50"
            value={contributionText}
            onChangeText={(text) => {
              // Allow only digits and one decimal point
              const cleaned = text.replace(/[^0-9.]/g, "");
              // Prevent multiple dots
              if ((cleaned.match(/\./g) || []).length > 1) return;
              setContributionText(cleaned);
            }}
            error={errors.contribution_amount}
            keyboardType="decimal-pad"
            editable={!isLoading}
          />

          {/* --- Frequency --- */}
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Frecuencia
            </Text>
            <View className="flex-row gap-2">
              {FREQUENCY_OPTIONS.map((opt) => {
                const selected = frequencyDays === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => setFrequencyDays(opt.value)}
                    disabled={isLoading}
                    activeOpacity={0.7}
                    className={`flex-1 py-3 rounded-xl border items-center ${
                      selected
                        ? "bg-purple-600 border-purple-600"
                        : "bg-white border-gray-300"
                    }`}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        selected ? "text-white" : "text-gray-700"
                      }`}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {errors.frequency_days && (
              <Text className="text-sm text-red-500 mt-1">
                {errors.frequency_days}
              </Text>
            )}
          </View>

          {/* --- Payout order mode --- */}
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Orden de pago
            </Text>
            <View className="flex-row gap-2">
              {PAYOUT_OPTIONS.map((opt) => {
                const selected = payoutMode === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() =>
                      setPayoutMode(opt.value as "join_order" | "creator_set")
                    }
                    disabled={isLoading}
                    activeOpacity={0.7}
                    className={`flex-1 py-3 rounded-xl border items-center ${
                      selected
                        ? "bg-purple-600 border-purple-600"
                        : "bg-white border-gray-300"
                    }`}
                  >
                    <Text
                      className={`text-xs font-medium text-center px-1 ${
                        selected ? "text-white" : "text-gray-700"
                      }`}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {errors.payout_order_mode && (
              <Text className="text-sm text-red-500 mt-1">
                {errors.payout_order_mode}
              </Text>
            )}
          </View>
        </Card>

        {/* API Error */}
        {apiError && (
          <View className="mx-4 mt-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
            <Text className="text-sm text-red-600">{apiError}</Text>
          </View>
        )}

        {/* Submit */}
        <View className="px-4 mt-6">
          <Button
            variant="primary"
            onPress={handleSubmit}
            loading={isLoading}
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? "Creando..." : "Crear"}
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
