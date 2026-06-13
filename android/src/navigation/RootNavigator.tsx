// English. 中文.
// RootNavigator selects Bootstrap / ServerSetup / MainTabs based on authStore.status.
// RootNavigator 依据 authStore.status 选择 Bootstrap / ServerSetup / MainTabs.

import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { BootstrapScreen } from "@/features/Bootstrap/BootstrapScreen";
import { ServerSetupScreen } from "@/features/Bootstrap/ServerSetupScreen";
import { useAuthStore } from "@/store/authStore";
import { TabNavigator } from "./TabNavigator";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Root stack navigator driven by authStore.status.
 * 由 authStore.status 驱动的根 stack 导航器.
 */
export function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {status === "loading" || status === "incompatibleServer" ? (
        <Stack.Screen name="Bootstrap" component={BootstrapScreen} />
      ) : status === "serverSetup" ? (
        <Stack.Screen name="ServerSetup" component={ServerSetupScreen} />
      ) : (
        <Stack.Screen name="MainTabs" component={TabNavigator} />
      )}
    </Stack.Navigator>
  );
}
