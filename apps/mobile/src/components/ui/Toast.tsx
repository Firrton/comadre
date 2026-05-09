/**
 * Comadre Mobile — Toast notification component.
 *
 * Displays a brief auto-dismissing message at the top of the screen.
 * Types: success (green), error (red), info (blue).
 *
 * Usage:
 *   const [toast, setToast] = useState<ToastData | null>(null);
 *   <Toast toast={toast} onDismiss={() => setToast(null)} />
 *
 * Uses NativeWind (Tailwind) for all styling.
 */

import React, { useEffect, useRef } from "react";
import { Animated, Text, TouchableOpacity } from "react-native";

export type ToastType = "success" | "error" | "info";

export interface ToastData {
  message: string;
  type: ToastType;
}

interface ToastProps {
  toast: ToastData | null;
  onDismiss: () => void;
  /** Duration in ms before auto-dismiss (default: 3000) */
  duration?: number;
}

const TOAST_COLORS: Record<ToastType, string> = {
  success: "bg-green-600",
  error: "bg-red-600",
  info: "bg-blue-600",
};

export function Toast({ toast, onDismiss, duration = 3000 }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-50)).current;

  useEffect(() => {
    if (toast) {
      // Animate in
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-dismiss
      const timer = setTimeout(() => {
        dismiss();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [toast]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: -50,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  };

  if (!toast) return null;

  return (
    <Animated.View
      style={{ opacity, transform: [{ translateY }] }}
      className="absolute top-12 left-4 right-4 z-50"
    >
      <TouchableOpacity
        onPress={dismiss}
        activeOpacity={0.9}
        className={`${TOAST_COLORS[toast.type]} rounded-xl px-4 py-3.5 shadow-lg`}
      >
        <Text className="text-white text-sm font-medium text-center">
          {toast.message}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}
