// Bottom tabs: Home, Categories, Favorites, Me. Tabs host their own stacks from M2+.
// 底部 Tab: Home, Categories, Favorites, Me. 从 M2 起每个 Tab 拥有独立 stack.

import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/designSystem/useTheme";
import { CategoriesScreen } from "@/features/Categories/CategoriesScreen";
import { FavoritesScreen } from "@/features/Favorites/FavoritesScreen";
import { HomeScreen } from "@/features/Home/HomeScreen";
import { ProfileScreen } from "@/features/Profile/ProfileScreen";
import type { TabParamList } from "./types";

const Tab = createBottomTabNavigator<TabParamList>();

/**
 * Bottom-tab navigator for the authenticated MainTabs scope.
 * 已认证后 MainTabs 范围使用的底部 Tab 导航器.
 */
export function TabNavigator() {
  const { colors } = useTheme();
  const { t } = useTranslation(["nav"]);
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.bgSecondary },
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{
          tabBarLabel: t("nav:links.home"),
          tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="CategoriesTab"
        component={CategoriesScreen}
        options={{
          tabBarLabel: t("nav:links.categories"),
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="FavoritesTab"
        component={FavoritesScreen}
        options={{
          tabBarLabel: t("nav:links.favorites"),
          tabBarIcon: ({ color, size }) => <Ionicons name="star" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="MeTab"
        component={ProfileScreen}
        options={{
          tabBarLabel: t("nav:links.me"),
          tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}
