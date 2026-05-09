/**
 * Comadre Mobile — Input component with label, error, and phone mask.
 *
 * Features:
 *   - Floating label above the input
 *   - Error message display (red text below)
 *   - Phone mask: auto-formats E.164 numbers as user types (+XX XX XXXX XXXX)
 *   - Passes through all TextInput props
 *
 * Uses NativeWind (Tailwind) for all styling.
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  type TextInputProps,
} from "react-native";

interface InputProps extends TextInputProps {
  /** Label displayed above the input */
  label?: string;
  /** Error message displayed below the input (red) */
  error?: string;
  /** Enable E.164 phone number masking */
  phoneMask?: boolean;
  /** Container class name override */
  containerClassName?: string;
}

/**
 * Format a partial phone input as the user types.
 * Example: "+5218116346072" → "+52 18 1163 4607"
 */
function formatPhoneMask(value: string): string {
  // Strip everything except + and digits
  const digits = value.replace(/[^\d+]/g, "");
  if (!digits.startsWith("+")) return digits;

  const num = digits.slice(1); // digits after +
  if (num.length <= 2) return `+${num}`;
  if (num.length <= 4) return `+${num.slice(0, 2)} ${num.slice(2)}`;
  if (num.length <= 8)
    return `+${num.slice(0, 2)} ${num.slice(2, 4)} ${num.slice(4)}`;
  return `+${num.slice(0, 2)} ${num.slice(2, 4)} ${num.slice(4, 8)} ${num.slice(8, 12)}`;
}

export function Input({
  label,
  error,
  phoneMask = false,
  containerClassName,
  value,
  onChangeText,
  ...props
}: InputProps) {
  const [displayValue, setDisplayValue] = useState(
    phoneMask && typeof value === "string" ? formatPhoneMask(value) : value ?? "",
  );

  const handleChange = useCallback(
    (text: string) => {
      if (phoneMask) {
        // Store raw value but display formatted
        const raw = text.replace(/\s/g, "");
        setDisplayValue(formatPhoneMask(raw));
        onChangeText?.(raw);
      } else {
        setDisplayValue(text);
        onChangeText?.(text);
      }
    },
    [phoneMask, onChangeText],
  );

  // Sync external value changes
  React.useEffect(() => {
    if (phoneMask && typeof value === "string") {
      setDisplayValue(formatPhoneMask(value));
    } else if (value !== undefined) {
      setDisplayValue(value);
    }
  }, [value, phoneMask]);

  return (
    <View className={`mb-4 ${containerClassName ?? ""}`}>
      {label && (
        <Text className="text-sm font-medium text-gray-700 mb-1.5">
          {label}
        </Text>
      )}
      <TextInput
        value={displayValue.toString()}
        onChangeText={handleChange}
        placeholderTextColor="#9CA3AF"
        className={`bg-white border rounded-xl px-4 py-3.5 text-base text-gray-900 ${
          error ? "border-red-500" : "border-gray-300"
        } focus:border-purple-600`}
        {...props}
      />
      {error && (
        <Text className="text-sm text-red-500 mt-1">{error}</Text>
      )}
    </View>
  );
}
