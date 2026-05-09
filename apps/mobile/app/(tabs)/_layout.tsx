/**
 * Tabs layout — minimal placeholder for PR 2 (real tabs come in PR 3).
 *
 * Single-tab scaffold so the auth gate can redirect to /(tabs)
 * after successful authentication. PR 3 adds Home + Profile tabs.
 */

import { Tabs } from "expo-router";
import { View } from "react-native";

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Inicio",
          tabBarIcon: () => <View className="w-6 h-6" />,
        }}
      />
    </Tabs>
  );
}
