// useProfile tests — covers username, password, avatar pick/delete, watch-history.
// useProfile 测试 — 覆盖 username、password、avatar 拾取/删除、观看历史.

import { act, renderHook } from "@testing-library/react-native";

import type { AuthAPI } from "@/api/auth";
import type { User } from "@/api/types";
import { _resetForTests } from "@/storage/mmkv";

import { useProfile } from "./useProfile";

function makeAuth(over: Partial<AuthAPI> = {}): AuthAPI {
  return {
    login: jest.fn(),
    logout: jest.fn(async () => {}),
    me: jest.fn(),
    updateProfile: jest.fn(async (u: string) => ({ id: 1, username: u, role: "user" as const })),
    changePassword: jest.fn(async () => {}),
    uploadAvatar: jest.fn(async () => ({ id: 1, username: "u", role: "user" as const, avatar: "/a" })),
    deleteAvatar: jest.fn(async () => ({ id: 1, username: "u", role: "user" as const })),
    ...over,
  };
}

const user: User = { id: 1, username: "u", role: "user" };

beforeEach(() => {
  _resetForTests();
  // Reset shared mocks between tests so call-history doesn't leak across cases.
  // 跨用例重置共享 mock, 防止调用记录串扰.
  const ImagePicker = require("expo-image-picker");
  const ImageManipulator = require("expo-image-manipulator");
  ImagePicker.requestMediaLibraryPermissionsAsync.mockReset();
  ImagePicker.launchImageLibraryAsync.mockReset();
  ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ status: "granted", granted: true });
  ImagePicker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///mock-image.jpg", width: 100, height: 100, mimeType: "image/jpeg" }],
  });
  ImageManipulator.manipulateAsync.mockReset();
  ImageManipulator.manipulateAsync.mockImplementation(async (uri: string) => ({
    uri: `${uri}.jpg`, width: 256, height: 256,
  }));
});

describe("useProfile", () => {
  it("updateUsername sends trimmed value and updates state", async () => {
    const auth = makeAuth();
    const onUserChanged = jest.fn();
    const { result } = renderHook(() =>
      useProfile({ auth, user, serverURL: "http://localhost", onUserChanged }),
    );
    act(() => result.current.setEditUsername("  new  "));
    await act(async () => { await result.current.submitUsername(); });
    expect(auth.updateProfile).toHaveBeenCalledWith("new");
    expect(onUserChanged).toHaveBeenCalled();
    expect(result.current.isEditingUsername).toBe(false);
  });

  it("submitUsername with blank input is a noop", async () => {
    const auth = makeAuth();
    const { result } = renderHook(() =>
      useProfile({ auth, user, serverURL: "http://localhost", onUserChanged: jest.fn() }),
    );
    act(() => result.current.setEditUsername("   "));
    await act(async () => { await result.current.submitUsername(); });
    expect(auth.updateProfile).not.toHaveBeenCalled();
  });

  it("submitPassword rejects mismatched confirmation", async () => {
    const auth = makeAuth();
    const { result } = renderHook(() =>
      useProfile({ auth, user, serverURL: "http://localhost", onUserChanged: jest.fn() }),
    );
    act(() => result.current.setPasswordNext("a"));
    act(() => result.current.setPasswordConfirm("b"));
    await act(async () => { await result.current.submitPassword(); });
    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toBe("profile.password.mismatch");
  });

  it("submitPassword rejects empty password", async () => {
    const auth = makeAuth();
    const { result } = renderHook(() =>
      useProfile({ auth, user, serverURL: "http://localhost", onUserChanged: jest.fn() }),
    );
    await act(async () => { await result.current.submitPassword(); });
    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toBe("profile.password.empty");
  });

  it("submitPassword calls changePassword on success and clears the form", async () => {
    const auth = makeAuth();
    const { result } = renderHook(() =>
      useProfile({ auth, user, serverURL: "http://localhost", onUserChanged: jest.fn() }),
    );
    act(() => result.current.setPasswordCurrent("x"));
    act(() => result.current.setPasswordNext("y"));
    act(() => result.current.setPasswordConfirm("y"));
    await act(async () => { await result.current.submitPassword(); });
    expect(auth.changePassword).toHaveBeenCalledWith("x", "y");
    expect(result.current.passwordCurrent).toBe("");
    expect(result.current.passwordNext).toBe("");
    expect(result.current.passwordConfirm).toBe("");
  });

  it("pickAndUploadAvatar requests permission, picks, compresses to JPEG, then uploads", async () => {
    const auth = makeAuth();
    const onUserChanged = jest.fn();
    const ImagePicker = require("expo-image-picker");
    const ImageManipulator = require("expo-image-manipulator");
    const { result } = renderHook(() =>
      useProfile({ auth, user, serverURL: "http://localhost", onUserChanged }),
    );
    await act(async () => { await result.current.pickAndUploadAvatar(); });
    expect(ImagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalled();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.8,
    }));
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      "file:///mock-image.jpg",
      expect.arrayContaining([expect.objectContaining({ resize: expect.any(Object) })]),
      expect.objectContaining({ compress: expect.any(Number), format: "jpeg" }),
    );
    const call = ImageManipulator.manipulateAsync.mock.calls[0];
    const resize = call[1][0].resize;
    expect(resize.width === 256 || resize.height === 256).toBe(true);
    expect(auth.uploadAvatar).toHaveBeenCalledWith("file:///mock-image.jpg.jpg", "image/jpeg");
    expect(onUserChanged).toHaveBeenCalled();
  });

  it("pickAndUploadAvatar resizes by HEIGHT when the asset is portrait", async () => {
    const ImagePicker = require("expo-image-picker");
    ImagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///tall.jpg", width: 100, height: 400, mimeType: "image/jpeg" }],
    });
    const ImageManipulator = require("expo-image-manipulator");
    const auth = makeAuth();
    const { result } = renderHook(() =>
      useProfile({ auth, user, serverURL: "http://localhost", onUserChanged: jest.fn() }),
    );
    await act(async () => { await result.current.pickAndUploadAvatar(); });
    const call = ImageManipulator.manipulateAsync.mock.calls.at(-1)!;
    expect(call[1][0].resize).toEqual({ height: 256 });
  });

  it("pickAndUploadAvatar surfaces a permission error when denied", async () => {
    const ImagePicker = require("expo-image-picker");
    ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ status: "denied", granted: false });
    const auth = makeAuth();
    const { result } = renderHook(() =>
      useProfile({ auth, user, serverURL: "http://localhost", onUserChanged: jest.fn() }),
    );
    await act(async () => { await result.current.pickAndUploadAvatar(); });
    expect(auth.uploadAvatar).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toBe("profile.avatar.permissionDenied");
  });

  it("pickAndUploadAvatar is a noop when user cancels", async () => {
    const ImagePicker = require("expo-image-picker");
    ImagePicker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true });
    const auth = makeAuth();
    const { result } = renderHook(() =>
      useProfile({ auth, user, serverURL: "http://localhost", onUserChanged: jest.fn() }),
    );
    await act(async () => { await result.current.pickAndUploadAvatar(); });
    expect(auth.uploadAvatar).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toBe("");
  });

  it("deleteAvatar invokes API and propagates the refreshed user", async () => {
    const auth = makeAuth();
    const onUserChanged = jest.fn();
    const { result } = renderHook(() =>
      useProfile({ auth, user, serverURL: "http://localhost", onUserChanged }),
    );
    await act(async () => { await result.current.deleteAvatar(); });
    expect(auth.deleteAvatar).toHaveBeenCalled();
    expect(onUserChanged).toHaveBeenCalled();
  });

  it("clearWatchHistory wipes the store and resets the counter", async () => {
    const { recordPlayProgress } = require("@/storage/watchHistory");
    recordPlayProgress("http://localhost", {
      id: "x", sourceKey: "s", videoId: "v", title: "T", cover: "",
      episode: "", episodeIndex: 0, progress: 1, duration: 10,
    });
    const auth = makeAuth();
    const { result } = renderHook(() =>
      useProfile({ auth, user, serverURL: "http://localhost", onUserChanged: jest.fn() }),
    );
    act(() => result.current.refreshWatchCount());
    expect(result.current.watchHistoryCount).toBeGreaterThan(0);
    act(() => result.current.clearWatchHistory());
    expect(result.current.watchHistoryCount).toBe(0);
  });

  it("error / success message dismissers reset the strings", async () => {
    const auth = makeAuth({
      changePassword: jest.fn(async () => { throw new Error("network"); }),
    });
    const { result } = renderHook(() =>
      useProfile({ auth, user, serverURL: "http://localhost", onUserChanged: jest.fn() }),
    );
    act(() => result.current.setPasswordNext("y"));
    act(() => result.current.setPasswordConfirm("y"));
    await act(async () => { await result.current.submitPassword(); });
    expect(result.current.errorMessage).toBe("network");
    act(() => result.current.dismissError());
    expect(result.current.errorMessage).toBe("");
  });

  it("startEditUsername hydrates from the current username", () => {
    const auth = makeAuth();
    const { result } = renderHook(() =>
      useProfile({
        auth,
        user: { id: 1, username: "alice", role: "user" },
        serverURL: "http://localhost",
        onUserChanged: jest.fn(),
      }),
    );
    act(() => result.current.startEditUsername());
    expect(result.current.isEditingUsername).toBe(true);
    expect(result.current.editUsername).toBe("alice");
    act(() => result.current.cancelEditUsername());
    expect(result.current.isEditingUsername).toBe(false);
  });
});
