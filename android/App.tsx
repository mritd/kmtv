// App root that wires QueryClient, ThemeProvider, NavigationContainer, and i18n init.
// 应用根组件, 装配 QueryClient、ThemeProvider、NavigationContainer 与 i18n 初始化.

import { NavigationContainer } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { initI18n } from "@/i18n";
import { RootNavigator } from "@/navigation/RootNavigator";
import { useI18nStore } from "@/store/i18nStore";
import { useThemeStore } from "@/store/themeStore";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/**
 * Root component registered as the Expo entry. Bootstraps stored theme + language, then renders.
 * 作为 Expo 入口注册的根组件. 引导持久化的主题与语言后再渲染.
 */
export default function App() {
  const [ready, setReady] = useState(false);
  const override = useThemeStore((s) => s.override);
  const lang = useI18nStore((s) => s.lang);

  useEffect(() => {
    useThemeStore.getState().hydrate();
    useI18nStore.getState().hydrate();
    const hydratedLang = useI18nStore.getState().lang;
    void initI18n(hydratedLang).then(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    void initI18n(lang);
  }, [lang, ready]);

  if (!ready) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider override={override}>
          <QueryClientProvider client={queryClient}>
            <NavigationContainer>
              <RootNavigator />
            </NavigationContainer>
          </QueryClientProvider>
        </ThemeProvider>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
