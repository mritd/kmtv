// Expo configuration for the KMTV Android client.
// KMTV Android 客户端的 Expo 配置.

import type { ExpoConfig } from "@expo/config-types";

const config: ExpoConfig = {
  name: "KMTV",
  slug: "kmtv-android",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "kmtv",
  userInterfaceStyle: "automatic",
  assetBundlePatterns: ["**/*"],
  platforms: ["android"],
  android: {
    package: "com.mritd.kmtv",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#4A8AF5",
    },
    permissions: ["INTERNET"],
  },
  plugins: [
    "expo-secure-store",
    "expo-localization",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#4A8AF5",
        image: "./assets/splash.png",
        resizeMode: "contain",
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Allow KMTV to access your photos to set a profile picture.",
        cameraPermission: false,
      },
    ],
  ],
  experiments: { typedRoutes: false },
};

export default config;
