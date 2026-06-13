// English. 中文.
// App root that wires QueryClient, ThemeProvider, NavigationContainer, and i18n init.
// 应用根组件, 装配 QueryClient、ThemeProvider、NavigationContainer 与 i18n 初始化.

import { NavigationContainer } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { initI18n, type Lang } from "@/i18n";
import { RootNavigator } from "@/navigation/RootNavigator";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/**
 * Root component registered as the Expo entry. Bootstraps i18n then renders the navigation tree.
 * 作为 Expo 入口注册的根组件, 先初始化 i18n 再渲染导航树.
 */
export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const lang: Lang = "en";
    void initI18n(lang).then(() => setReady(true));
  }, []);

  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider override="system">
        <QueryClientProvider client={queryClient}>
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        </QueryClientProvider>
      </ThemeProvider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
