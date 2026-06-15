// Android screen orientation bridge — used by the player full-screen flow.
// Android 屏幕方向桥接 — 供播放器全屏流程使用.

import { NativeModules } from "react-native";

export type AndroidOrientationMode = "portrait" | "sensorLandscape";

interface KmtvOrientationModule {
  setOrientation?: (mode: AndroidOrientationMode) => void;
}

const kmtvOrientation = NativeModules.KmtvOrientation as KmtvOrientationModule | undefined;

/**
 * Requests an Android Activity orientation. It is a no-op in test or non-Android runtimes
 * where the native module is unavailable.
 */
export function setAndroidOrientation(mode: AndroidOrientationMode): void {
  kmtvOrientation?.setOrientation?.(mode);
}
