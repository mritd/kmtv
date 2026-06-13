// HomeStack — HomeRoot + Search. SearchScreen is reachable via tab-stack navigation, mirroring iOS.
// HomeStack — HomeRoot + Search. SearchScreen 通过 Tab 内 stack 导航到达, 与 iOS 一致.

import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { HomeScreen } from "@/features/Home/HomeScreen";
import { DetailScreen } from "@/features/Playback/DetailScreen";
import { PlayerScreen } from "@/features/Playback/PlayerScreen";
import { SearchScreen } from "@/features/Search/SearchScreen";

import type { HomeStackParamList } from "./types";

const Stack = createNativeStackNavigator<HomeStackParamList>();

/**
 * Native-stack navigator hosted under HomeTab.
 * HomeTab 内承载的 native-stack 导航器.
 */
export function HomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeRoot" component={HomeScreen} />
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="Detail" component={DetailScreen} />
      <Stack.Screen name="Player" component={PlayerScreen} />
    </Stack.Navigator>
  );
}
