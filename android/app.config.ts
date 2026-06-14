// Expo configuration for the KMTV Android client.
// KMTV Android 客户端的 Expo 配置.

import type { ExpoConfig } from "@expo/config-types";

const config: ExpoConfig = {
  name: "KMTV",
  slug: "kmtv-android",
  version: "0.2.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "kmtv",
  userInterfaceStyle: "automatic",
  assetBundlePatterns: ["**/*"],
  platforms: ["android", "web"],
  web: { bundler: "metro" },
  android: {
    package: "com.mritd.kmtv",
    versionCode: 1,
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
        imageWidth: 360,
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
