/**
 * Comadre Mobile — ErrorBoundary component.
 *
 * React error boundary that catches render errors in the component tree
 * and displays a friendly error screen with a "Reiniciar" (restart) button.
 *
 * Usage: wrap a screen or section that may throw unhandled errors.
 */

import React, { Component, type ErrorInfo } from "react";

import { View, Text } from "react-native";
import { Button } from "./ui/Button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  /** Content wrapped by the boundary */
  children: React.ReactNode;
  /** Optional fallback UI — overrides the default error screen */
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Component (must be a class — React error boundaries require
// componentDidCatch)
// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to console for debugging; in production this would go to a
    // crash-reporting service (Sentry, Firebase Crashlytics, etc.)
    console.error("[ErrorBoundary] Render error caught:", error, info.componentStack);
  }

  handleRestart = (): void => {
    // Reset the error boundary state so children re-mount
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      // Custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error screen
      return (
        <View className="flex-1 items-center justify-center px-8 bg-gray-50">
          <View className="w-20 h-20 rounded-full bg-red-100 items-center justify-center mb-6">
            <Text className="text-3xl">⚠️</Text>
          </View>

          <Text className="text-lg font-semibold text-gray-900 text-center mb-2">
            Algo salió mal
          </Text>

          <Text className="text-sm text-gray-500 text-center mb-6">
            Ocurrió un error inesperado. Podés intentar reiniciar la pantalla.
          </Text>

          <Button variant="primary" onPress={this.handleRestart}>
            Reiniciar
          </Button>
        </View>
      );
    }

    return this.props.children;
  }
}
