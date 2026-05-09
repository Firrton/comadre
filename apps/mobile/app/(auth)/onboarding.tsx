/**
 * Onboarding screen — phone input + OTP verification.
 *
 * Two-step flow:
 *   1. Phone step: E.164 phone entry → login (send OTP via Privy)
 *   2. OTP step: 6-digit code entry → verify → init backend → home
 *
 * Mock mode (EXPO_PUBLIC_USE_MOCK=true):
 *   - Skips real Privy SDK calls
 *   - Accepts any 6-digit code
 *   - Uses mock /api/v1/onboarding/init response
 *   - Shows "MODO PRUEBA" banner
 *
 * After successful authentication, calls POST /api/v1/onboarding/init
 * to ensure the user exists in the backend DB, stores the wallet address,
 * and navigates to the home screen.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { z } from "zod";

import { useAuth } from "../../src/hooks/useAuth";
import { Button } from "../../src/components/ui/Button";
import { Input } from "../../src/components/ui/Input";
import { post, mockRegistry } from "../../src/api/client";
import {
  USE_MOCK,
  SECURE_STORE_WALLET_KEY,
} from "../../src/lib/constants";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** E.164 phone validation: +, country code 1-9, then 6-14 digits */
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

const phoneSchema = z
  .string()
  .regex(E164_REGEX, "Número inválido");

/** Expected response shape from POST /api/v1/onboarding/init */
interface OnboardingInitResponse {
  walletAddress: string;
  walletId: string;
  alreadyExisted: boolean;
}

// ---------------------------------------------------------------------------
// Mock handler registration (module scope — runs once on first import)
// ---------------------------------------------------------------------------

if (USE_MOCK) {
  mockRegistry.set(
    "POST:/onboarding/init",
    (): OnboardingInitResponse => ({
      walletAddress: "7yLR...64bS",
      walletId: "mock-wallet-id",
      alreadyExisted: false,
    }),
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Step = "phone" | "otp";

export default function OnboardingScreen() {
  // Auth context
  const { authState, errorMessage, login, verifyOtp } = useAuth();

  // Screen state
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");

  // Error / loading
  const [phoneError, setPhoneError] = useState("");
  const [otpError, setOtpError] = useState("");
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // Refs
  const hiddenOtpRef = useRef<TextInput>(null);
  const initDone = useRef(false);

  // -----------------------------------------------------------------------
  // Auth state watchers
  // -----------------------------------------------------------------------

  // Transition to OTP step when code is sent
  useEffect(() => {
    if (step === "phone" && authState === "otp_sent") {
      setStep("otp");
      setIsSendingCode(false);
      setOtpCode("");
      setOtpError("");
    }
  }, [authState, step]);

  // Handle auth errors from the provider
  useEffect(() => {
    if (authState === "error" && errorMessage) {
      if (step === "phone") {
        setPhoneError(errorMessage);
        setIsSendingCode(false);
      }
      if (step === "otp") {
        setOtpError(errorMessage);
        setIsVerifying(false);
      }
    }
  }, [authState, errorMessage, step]);

  // -----------------------------------------------------------------------
  // Phone handlers
  // -----------------------------------------------------------------------

  const handlePhoneSubmit = useCallback(async () => {
    // Clear previous errors
    setPhoneError("");

    // Validate with Zod
    const result = phoneSchema.safeParse(phone);
    if (!result.success) {
      const msg =
        result.error.issues[0]?.message ?? "Número inválido";
      setPhoneError(msg);
      return;
    }

    setIsSendingCode(true);
    await login(phone);
    // login sets authState → "otp_sent" on success or "error" on failure
    // The useEffect above will handle the transition
    setIsSendingCode(false);
  }, [phone, login]);

  // -----------------------------------------------------------------------
  // OTP handlers
  // -----------------------------------------------------------------------

  const handleOtpChange = useCallback(
    (text: string) => {
      // Only digits
      const digits = text.replace(/\D/g, "");
      setOtpCode(digits.slice(0, 6));
      setOtpError("");
    },
    [],
  );

  const handleOtpSubmit = useCallback(async () => {
    if (otpCode.length !== 6) {
      setOtpError("Código incorrecto");
      return;
    }
    setOtpError("");
    setIsVerifying(true);
    await verifyOtp(otpCode);
    // verifyOtp sets authState → "authenticated" on success or "otp_sent" on error
    // The useEffect above handles both cases
    setIsVerifying(false);
  }, [otpCode, verifyOtp]);

  const handleResend = useCallback(async () => {
    setOtpCode("");
    setOtpError("");
    setIsSendingCode(true);
    await login(phone);
    setIsSendingCode(false);
  }, [phone, login]);

  // -----------------------------------------------------------------------
  // Backend initialization (after Privy auth succeeds)
  // -----------------------------------------------------------------------

  const handleOnboardingInit = useCallback(async () => {
    try {
      const response = await post<OnboardingInitResponse>(
        "/onboarding/init",
        { phone },
      );

      // Store wallet address for display
      if (response?.walletAddress) {
        try {
          await SecureStore.setItemAsync(
            SECURE_STORE_WALLET_KEY,
            response.walletAddress,
          );
        } catch {
          // secure-store unavailable — non-fatal
        }
      }
    } catch (err) {
      // Show network / server error
      const msg =
        err instanceof Error ? err.message : "Error de conexión";
      setOtpError(msg);
      initDone.current = false; // allow retry
      return;
    }

    // Navigate to home — the auth gate will see "authenticated" on next mount
    router.replace("/(tabs)");
  }, [phone]);

  // After successful OTP verification → initialize backend
  useEffect(() => {
    if (
      step === "otp" &&
      authState === "authenticated" &&
      !initDone.current
    ) {
      initDone.current = true;
      handleOnboardingInit();
    }
  }, [authState, step, handleOnboardingInit]);

  // -----------------------------------------------------------------------
  // Focus hidden OTP input on tap
  // -----------------------------------------------------------------------

  const focusOtpInput = useCallback(() => {
    hiddenOtpRef.current?.focus();
  }, []);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <View className="flex-1 bg-white px-6">
      {/* Mock mode banner */}
      {USE_MOCK && (
        <View className="mt-14 mb-2 bg-amber-100 border border-amber-300 rounded-lg px-3 py-2">
          <Text className="text-amber-800 text-center text-sm font-semibold">
            MODO PRUEBA
          </Text>
        </View>
      )}

      {/* ----- Phone step ----- */}
      {step === "phone" && (
        <View className="flex-1 justify-center">
          <Text className="text-2xl font-bold text-gray-900 mb-2">
            Tu telefono
          </Text>
          <Text className="text-base text-gray-500 mb-8">
            Ingresa tu numero para empezar
          </Text>

          <Input
            label="Telefono"
            placeholder="+52 18 1163 4607"
            value={phone}
            onChangeText={setPhone}
            error={phoneError}
            phoneMask
            keyboardType="phone-pad"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handlePhoneSubmit}
            containerClassName="mb-6"
          />

          <Button
            variant="primary"
            loading={isSendingCode}
            disabled={isSendingCode}
            onPress={handlePhoneSubmit}
          >
            Continuar
          </Button>
        </View>
      )}

      {/* ----- OTP step ----- */}
      {step === "otp" && (
        <View className="flex-1 justify-center">
          <Text className="text-2xl font-bold text-gray-900 mb-2">
            Codigo de verificacion
          </Text>
          <Text className="text-base text-gray-500 mb-8">
            Te enviamos un codigo de 6 digitos
          </Text>

          {/* Visual OTP boxes (tap to focus hidden input) */}
          <TouchableOpacity
            activeOpacity={1}
            onPress={focusOtpInput}
            className="flex-row justify-between mb-4"
          >
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <View
                key={i}
                className={`w-12 h-14 border-2 rounded-xl items-center justify-center ${
                  otpError
                    ? "border-red-500"
                    : otpCode.length === i
                      ? "border-purple-600"
                      : otpCode[i]
                        ? "border-purple-400"
                        : "border-gray-300"
                }`}
              >
                {otpCode[i] ? (
                  <Text className="text-2xl font-bold text-gray-900">
                    {otpCode[i]}
                  </Text>
                ) : (
                  otpCode.length === i && (
                    <View className="w-0.5 h-6 bg-purple-600" />
                  )
                )}
              </View>
            ))}
          </TouchableOpacity>

          {otpError && (
            <Text className="text-sm text-red-500 mb-4 text-center">
              {otpError}
            </Text>
          )}

          {/* Hidden input that captures all keyboard input */}
          <TextInput
            ref={hiddenOtpRef}
            value={otpCode}
            onChangeText={handleOtpChange}
            maxLength={6}
            keyboardType="number-pad"
            autoFocus
            className="absolute opacity-0 h-0 w-0"
          />

          {/* Verify button */}
          <Button
            variant="primary"
            loading={isVerifying}
            disabled={isVerifying || otpCode.length !== 6}
            onPress={handleOtpSubmit}
            className="mb-4"
          >
            Verificar
          </Button>

          {/* Resend link */}
          <TouchableOpacity
            onPress={handleResend}
            disabled={isSendingCode}
            className="items-center py-2"
          >
            {isSendingCode ? (
              <ActivityIndicator
                size="small"
                color="#7C3AED"
              />
            ) : (
              <Text className="text-purple-600 text-base font-medium">
                No llego? Reenviar
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
