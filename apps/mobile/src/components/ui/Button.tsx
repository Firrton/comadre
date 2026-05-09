/**
 * Comadre Mobile — Button component with variants.
 *
 * Variants:
 *   - primary: solid purple (main CTA)
 *   - secondary: outlined purple
 *   - outline: white with gray border (subtle actions)
 *
 * States: default, loading (spinner + disabled), disabled (dimmed)
 *
 * Uses NativeWind (Tailwind) for all styling.
 */

import React from "react";
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  type TouchableOpacityProps,
} from "react-native";

type ButtonVariant = "primary" | "secondary" | "outline";

interface ButtonProps extends TouchableOpacityProps {
  /** Visual variant */
  variant?: ButtonVariant;
  /** Show spinner and disable interaction */
  loading?: boolean;
  /** Button label text */
  children: React.ReactNode;
}

export function Button({
  variant = "primary",
  loading = false,
  disabled = false,
  children,
  className,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const baseClasses =
    "px-6 py-3.5 rounded-xl items-center justify-center flex-row min-h-[48px]";

  const variantClasses: Record<ButtonVariant, string> = {
    primary: "bg-purple-600 active:bg-purple-700",
    secondary: "bg-transparent border-2 border-purple-600 active:bg-purple-50",
    outline: "bg-white border border-gray-300 active:bg-gray-50",
  };

  const textClasses: Record<ButtonVariant, string> = {
    primary: "text-white font-semibold",
    secondary: "text-purple-600 font-semibold",
    outline: "text-gray-700 font-medium",
  };

  const disabledClasses = "opacity-50";

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={isDisabled}
      className={`${baseClasses} ${variantClasses[variant]} ${
        isDisabled ? disabledClasses : ""
      } ${className ?? ""}`}
      {...props}
    >
      {loading && (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? "#ffffff" : "#7C3AED"}
          className="mr-2"
        />
      )}
      {typeof children === "string" ? (
        <Text className={`text-base ${textClasses[variant]}`}>{children}</Text>
      ) : (
        children
      )}
    </TouchableOpacity>
  );
}
