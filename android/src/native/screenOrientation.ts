// Android screen orientation bridge — used by the player full-screen flow.
//
// Android 屏幕方向桥接 — 供播放器全屏流程使用.

import { NativeModules } from "react-native";

export type AndroidOrientationMode = "portrait" | "fullSensor";

interface KmtvOrientationModule {
  setOrientation?: (mode: AndroidOrientationMode) => void;
}

const kmtvOrientation = NativeModules.KmtvOrientation as KmtvOrientationModule | undefined;

/**
 * Requests an Android Activity orientation through the optional KmtvOrientation native bridge.
 * `portrait` locks the player to portrait, while `fullSensor` lets full-screen playback follow
 * any sensor orientation. The call is a no-op in tests or runtimes where the bridge is unavailable.
 *
 * 通过可选的 KmtvOrientation native bridge 请求 Android Activity 屏幕方向.
 * portrait 将播放器锁定为竖屏, fullSensor 允许全屏播放跟随任意传感器方向.
 * 测试环境或 bridge 不可用的运行环境中, 此调用不执行任何操作.
 */
export function setAndroidOrientation(mode: AndroidOrientationMode): void {
  kmtvOrientation?.setOrientation?.(mode);
}
