// useProfile — owns the ProfileScreen state machine. Pure callbacks; no global side effects.
// useProfile — 承载 ProfileScreen 的状态机. 纯回调, 无全局副作用.

import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";

import type { AuthAPI } from "@/api/auth";
import type { User } from "@/api/types";
import { clearWatchHistory, loadWatchHistory } from "@/storage/watchHistory";

/**
 * Args passed in by ProfileScreen.
 * 由 ProfileScreen 注入的依赖.
 */
export interface UseProfileArgs {
  auth: AuthAPI;
  user: User | null;
  serverURL: string;
  onUserChanged: (user: User) => void;
  initialWatchCount?: number;
}

/**
 * State + actions exposed to ProfileScreen.
 * 暴露给 ProfileScreen 的状态与动作.
 */
export interface UseProfileResult {
  isEditingUsername: boolean;
  editUsername: string;
  passwordCurrent: string;
  passwordNext: string;
  passwordConfirm: string;
  watchHistoryCount: number;
  errorMessage: string;
  successMessage: string;

  startEditUsername: () => void;
  cancelEditUsername: () => void;
  setEditUsername: (v: string) => void;
  submitUsername: () => Promise<void>;

  setPasswordCurrent: (v: string) => void;
  setPasswordNext: (v: string) => void;
  setPasswordConfirm: (v: string) => void;
  submitPassword: () => Promise<void>;

  /**
   * Launch the platform photo picker, compress to JPEG (≤ 256 px on the longer edge), upload.
   * 调起系统相册, 压缩为 JPEG (长边 ≤ 256 px) 后上传.
   */
  pickAndUploadAvatar: () => Promise<void>;
  deleteAvatar: () => Promise<void>;

  refreshWatchCount: () => void;
  clearWatchHistory: () => void;

  dismissError: () => void;
  dismissSuccess: () => void;
}

/**
 * useProfile — composes the four ProfileScreen sub-actions into one hook.
 * useProfile — 把 ProfileScreen 的四类子操作组合成单一 hook.
 */
export function useProfile({ auth, user, serverURL, onUserChanged, initialWatchCount = 0 }: UseProfileArgs): UseProfileResult {
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [editUsername, setEditUsername] = useState(user?.username ?? "");
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [passwordNext, setPasswordNext] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [watchHistoryCount, setWatchHistoryCount] = useState(initialWatchCount);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const reportError = useCallback((e: unknown) => {
    setErrorMessage(e instanceof Error ? e.message : String(e ?? "error"));
  }, []);

  const startEditUsername = useCallback(() => {
    setEditUsername(user?.username ?? "");
    setIsEditingUsername(true);
  }, [user?.username]);

  const cancelEditUsername = useCallback(() => setIsEditingUsername(false), []);

  const submitUsername = useCallback(async () => {
    const trimmed = editUsername.trim();
    if (trimmed.length === 0) return;
    try {
      const next = await auth.updateProfile(trimmed);
      onUserChanged(next);
      setIsEditingUsername(false);
      setSuccessMessage("profile.username.updated");
    } catch (e) { reportError(e); }
  }, [auth, editUsername, onUserChanged, reportError]);

  const submitPassword = useCallback(async () => {
    if (passwordNext !== passwordConfirm) {
      setErrorMessage("profile.password.mismatch");
      return;
    }
    if (passwordNext.length === 0) {
      setErrorMessage("profile.password.empty");
      return;
    }
    try {
      await auth.changePassword(passwordCurrent, passwordNext);
      setPasswordCurrent("");
      setPasswordNext("");
      setPasswordConfirm("");
      setSuccessMessage("profile.password.changed");
    } catch (e) { reportError(e); }
  }, [auth, passwordConfirm, passwordCurrent, passwordNext, reportError]);

  const pickAndUploadAvatar = useCallback(async () => {
    try {
      // Pre-flight: ensure photo permission. Android 14 partial-grant still returns granted=true.
      // 预先确认相册权限. Android 14 部分授权也会返回 granted=true.
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setErrorMessage("profile.avatar.permissionDenied");
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      // Resize so the LONGEST edge is at most 256 px (server cap is 256 KB; clamping only width
      // would let portrait images blow past it). Pick the resize axis based on the picker's
      // reported dimensions; fall back to width when ambiguous.
      // 按长边 ≤ 256 px 缩放 (server 上限 256 KB; 仅按 width 限制会让竖图溢出).
      // 根据 picker 返回的宽高决定缩放轴, 缺值时回退到 width.
      const asset = picked.assets[0];
      const resizeAction =
        asset.height != null && asset.width != null && asset.height > asset.width
          ? { resize: { height: 256 } as const }
          : { resize: { width: 256 } as const };
      const compressed = await ImageManipulator.manipulateAsync(
        asset.uri,
        [resizeAction],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      );
      const next = await auth.uploadAvatar(compressed.uri, "image/jpeg");
      onUserChanged(next);
      setSuccessMessage("profile.avatar.updated");
    } catch (e) { reportError(e); }
  }, [auth, onUserChanged, reportError]);

  const deleteAvatar = useCallback(async () => {
    try {
      const next = await auth.deleteAvatar();
      onUserChanged(next);
      setSuccessMessage("profile.avatar.removed");
    } catch (e) { reportError(e); }
  }, [auth, onUserChanged, reportError]);

  const refreshWatchCount = useCallback(() => {
    setWatchHistoryCount(loadWatchHistory(serverURL, 1000).length);
  }, [serverURL]);

  const clearAllWatch = useCallback(() => {
    clearWatchHistory(serverURL);
    setWatchHistoryCount(0);
    setSuccessMessage("profile.danger.historyCleared");
  }, [serverURL]);

  return {
    isEditingUsername, editUsername, passwordCurrent, passwordNext, passwordConfirm,
    watchHistoryCount, errorMessage, successMessage,
    startEditUsername, cancelEditUsername, setEditUsername, submitUsername,
    setPasswordCurrent, setPasswordNext, setPasswordConfirm, submitPassword,
    pickAndUploadAvatar, deleteAvatar,
    refreshWatchCount, clearWatchHistory: clearAllWatch,
    dismissError: () => setErrorMessage(""),
    dismissSuccess: () => setSuccessMessage(""),
  };
}
