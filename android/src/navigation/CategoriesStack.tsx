// CategoriesStack — CategoriesRoot + Search. Same pattern as HomeStack.
// CategoriesStack — CategoriesRoot + Search. 与 HomeStack 同样的模式.

import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { CategoriesScreen } from "@/features/Categories/CategoriesScreen";
import { DetailScreen } from "@/features/Playback/DetailScreen";
import { PlayerScreen } from "@/features/Playback/PlayerScreen";
import { SearchScreen } from "@/features/Search/SearchScreen";

import type { CategoriesStackParamList } from "./types";

const Stack = createNativeStackNavigator<CategoriesStackParamList>();

/**
 * Native-stack navigator hosted under CategoriesTab.
 * CategoriesTab 内承载的 native-stack 导航器.
 */
export function CategoriesStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CategoriesRoot" component={CategoriesScreen} />
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="Detail" component={DetailScreen} />
      <Stack.Screen name="Player" component={PlayerScreen} />
    </Stack.Navigator>
  );
}
