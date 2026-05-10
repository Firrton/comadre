/**
 * Comadre Mobile — EmptyState component.
 *
 * Centered placeholder screen shown when a list has no items.
 * Displays a title, subtitle, and optional CTA button.
 *
 * Props:
 *  - title:      Main heading (e.g. "No tenés tandas todavía")
 *  - subtitle:   Supporting text
 *  - actionLabel: Optional CTA button label
 *  - onAction:   Optional CTA button handler
 */

import React from "react";

import { View, Text } from "react-native";
import { Button } from "./ui/Button";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  subtitle,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-8 py-16">
      {/* Illustration placeholder (icon) */}
      <View className="w-20 h-20 rounded-full bg-purple-100 items-center justify-center mb-6">
        <Text className="text-3xl">📋</Text>
      </View>

      <Text className="text-lg font-semibold text-gray-900 text-center mb-2">
        {title}
      </Text>
      <Text className="text-sm text-gray-500 text-center mb-6 leading-5">
        {subtitle}
      </Text>

      {actionLabel && onAction && (
        <Button variant="primary" onPress={onAction}>
          {actionLabel}
        </Button>
      )}
    </View>
  );
}
