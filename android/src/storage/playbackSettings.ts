// MMKV-backed playback settings per (serverURL, title), mirroring iOS PlaybackSettings.
// 按 (serverURL, title) 隔离的 MMKV 播放设置, 镜像 iOS PlaybackSettings.

import { getNamespacedStorage, readJSON, writeJSON } from "./mmkv";

const KEY = "kmtv:playbackSettings";

/**
 * Persisted shape — skip intro/outro in seconds, playback rate as a number.
 * 持久化形状 — 跳过片头片尾 (秒) 与播放倍速 (数值).
 */
export interface PlaybackSettings {
  skipIntroSeconds: number;
  skipOutroSeconds: number;
  playbackRate: number;
}

/**
 * Defaults: no skip, normal rate. Used by both the in-memory hook seed and the storage fallback.
 * 默认值: 不跳过, 1x 播放. 同时用于 hook 初始 state 与存储缺失时的兜底.
 */
export function defaultPlaybackSettings(): PlaybackSettings {
  return { skipIntroSeconds: 0, skipOutroSeconds: 0, playbackRate: 1 };
}

interface ServerMap { [title: string]: PlaybackSettings }

function readMap(serverURL: string): ServerMap {
  return readJSON<ServerMap>(getNamespacedStorage(serverURL), KEY, {});
}

function writeMap(serverURL: string, map: ServerMap): void {
  writeJSON(getNamespacedStorage(serverURL), KEY, map);
}

/**
 * Load settings for (serverURL, title); defaults if absent.
 * 加载 (serverURL, title) 对应的设置, 缺失返回默认值.
 */
export function loadPlaybackSettings(serverURL: string, title: string): PlaybackSettings {
  const map = readMap(serverURL);
  return map[title] ?? defaultPlaybackSettings();
}

/**
 * Persist settings for (serverURL, title), overwriting any previous entry for the title.
 * 持久化 (serverURL, title) 对应的设置, 覆盖该 title 此前的任何记录.
 */
export function savePlaybackSettings(serverURL: string, title: string, value: PlaybackSettings): void {
  const map = readMap(serverURL);
  map[title] = value;
  writeMap(serverURL, map);
}
