/**
 * Home screen — placeholder for PR 2.
 *
 * Displays a loading indicator while PR 3 builds out
 * the TandaList with pull-to-refresh and infinite scroll.
 */

import { View, Text, ActivityIndicator } from "react-native";

export default function HomeScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white">
      <ActivityIndicator size="large" color="#7C3AED" />
      <Text className="mt-4 text-gray-500 text-base">
        Cargando tus tandas...
      </Text>
    </View>
  );
}
