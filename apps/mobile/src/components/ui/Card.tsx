/**
 * Comadre Mobile — Card container component.
 *
 * Basic card with shadow, rounded corners, and white background.
 * Used as a building block for TandaCard, profile sections, etc.
 *
 * Uses NativeWind (Tailwind) for all styling.
 */

import React from "react";
import { View, type ViewProps } from "react-native";

interface CardProps extends ViewProps {
  /** Card content */
  children: React.ReactNode;
  /** Whether the card is pressable (adds active state) */
  pressable?: boolean;
}

export function Card({
  children,
  pressable = false,
  className,
  ...props
}: CardProps) {
  return (
    <View
      className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-4 ${
        pressable ? "active:bg-gray-50" : ""
      } ${className ?? ""}`}
      {...props}
    >
      {children}
    </View>
  );
}
