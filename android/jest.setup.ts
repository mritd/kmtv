// Global jest setup: mocks for native modules unavailable in node.
// 全局 jest 启动配置: mock 在 node 环境无法运行的原生模块.

import "@testing-library/jest-native/extend-expect";

// react-native-mmkv: in-memory Map per instance, mirroring the createMMKV() v4 API.
// react-native-mmkv: 每个实例使用内存 Map, 复刻 createMMKV() v4 API.
jest.mock(
  "react-native-mmkv",
  () => {
    function makeMockMMKV() {
      const store = new Map<string, string | number | boolean>();
      return {
        set(key: string, value: string | number | boolean) { store.set(key, value); },
        getString(key: string): string | undefined {
          const v = store.get(key);
          return typeof v === "string" ? v : undefined;
        },
        getNumber(key: string): number | undefined {
          const v = store.get(key);
          return typeof v === "number" ? v : undefined;
        },
        getBoolean(key: string): boolean | undefined {
          const v = store.get(key);
          return typeof v === "boolean" ? v : undefined;
        },
        remove(key: string): boolean { return store.delete(key); },
        clearAll() { store.clear(); },
        getAllKeys(): string[] { return Array.from(store.keys()); },
        contains(key: string) { return store.has(key); },
      };
    }
    return {
      createMMKV: jest.fn(() => makeMockMMKV()),
      existsMMKV: jest.fn(() => false),
      deleteMMKV: jest.fn(),
    };
  },
);

// expo-secure-store: in-memory Map.
// expo-secure-store: 内存 Map.
jest.mock(
  "expo-secure-store",
  () => {
    const store = new Map<string, string>();
    return {
      setItemAsync: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
      getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
      deleteItemAsync: jest.fn(async (k: string) => { store.delete(k); }),
    };
  },
);

// expo-localization: deterministic en locale by default.
// expo-localization: 默认返回 en, 避免依赖宿主语言.
jest.mock(
  "expo-localization",
  () => ({
    getLocales: () => [{ languageTag: "en-US", languageCode: "en" }],
  }),
);

// react-native-reanimated: 4.4.0 ships a broken official mock (`mock.js` → missing `./src/mock`).
// Hand-rolled stub covers the Skeleton + HeroCarousel use cases (shared values + brightness loop).
// react-native-reanimated: 4.4.0 的官方 mock 入口缺失依赖路径, 这里用手写 stub 覆盖
// Skeleton + HeroCarousel 使用到的共享值与亮度循环 API.
jest.mock(
  "react-native-reanimated",
  () => {
    const React = require("react") as typeof import("react");
    const RN = jest.requireActual("react-native") as typeof import("react-native");
    const View = React.forwardRef((props: Record<string, unknown>, ref) =>
      React.createElement(RN.View, { ...(props as object), ref } as never),
    );
    const useSharedValue = <T>(initial: T) => ({ value: initial });
    const useAnimatedStyle = (worklet: () => Record<string, unknown>) => worklet();
    const passthrough = <T>(v: T) => v;
    const Easing = {
      ease: passthrough,
      linear: passthrough,
      inOut: (fn: unknown) => fn,
      in: (fn: unknown) => fn,
      out: (fn: unknown) => fn,
    };
    return {
      __esModule: true,
      default: { View, createAnimatedComponent: passthrough },
      View,
      useSharedValue,
      useAnimatedStyle,
      withTiming: passthrough,
      withRepeat: passthrough,
      withSpring: passthrough,
      withSequence: passthrough,
      cancelAnimation: () => undefined,
      runOnJS: <F extends (...args: unknown[]) => unknown>(fn: F) => fn,
      runOnUI: <F extends (...args: unknown[]) => unknown>(fn: F) => fn,
      Easing,
    };
  },
);

// expo-image: render a plain RN <Image> so jest can introspect props.
// expo-image: 在测试中退化为普通 <Image>, 方便断言 props.
jest.mock(
  "expo-image",
  () => {
    const React = require("react") as typeof import("react");
    const RN = jest.requireActual("react-native") as typeof import("react-native");
    return {
      Image: (props: Record<string, unknown>) =>
        React.createElement(RN.Image, {
          testID: (props.testID as string) ?? "expo-image",
          source: typeof props.source === "string" ? { uri: props.source } : props.source,
          style: props.style,
        } as never),
      ImageBackground: RN.View,
    };
  },
);

// react-native-sse: manual driver. Tests get an EventSource constructor that records the
// instance and exposes dispatch() / triggerError() / triggerClose() so each test simulates
// the SSE frames it needs. The latest instance is kept on the global so tests can grab it.
// react-native-sse: 手动驱动. 测试拿到的 EventSource 构造函数会记录实例并暴露 dispatch()
// triggerError() / triggerClose(), 让用例按需模拟 SSE 帧, 最新实例挂到全局供测试读取.
jest.mock(
  "react-native-sse",
  () => {
    class MockEventSource {
      url: string;
      options: { headers?: Record<string, string> };
      listeners: Map<string, Set<(evt: { type: string; data?: string; message?: string }) => void>> = new Map();
      closed = false;
      constructor(url: string, options: { headers?: Record<string, string> } = {}) {
        this.url = url;
        this.options = options;
        (globalThis as { __lastMockEventSource?: MockEventSource }).__lastMockEventSource = this;
      }
      addEventListener(type: string, listener: (evt: { type: string; data?: string; message?: string }) => void): void {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(listener);
      }
      removeEventListener(type: string, listener: (evt: { type: string; data?: string; message?: string }) => void): void {
        this.listeners.get(type)?.delete(listener);
      }
      close(): void { this.closed = true; }
      dispatch(type: string, data: unknown): void {
        const payload = typeof data === "string" ? data : JSON.stringify(data);
        for (const fn of this.listeners.get(type) ?? []) fn({ type, data: payload });
      }
      triggerError(message = "stream error"): void {
        for (const fn of this.listeners.get("error") ?? []) fn({ type: "error", message });
      }
      triggerClose(): void {
        for (const fn of this.listeners.get("close") ?? []) fn({ type: "close" });
      }
    }
    return { __esModule: true, default: MockEventSource };
  },
);

// react-native-video: testable <Video /> stand-in. Tests see a <View testID="video" /> with an
// imperative ref exposing seek/presentFullscreenPlayer/dismissFullscreenPlayer. Lifecycle callback
// props (onLoad/onProgress/onError/onBuffer/onEnd) are forwarded so tests can drive them via
// `fireEvent(video, "onLoad", { duration: 30 })`.
// react-native-video: 可测试的 <Video /> 占位. 测试拿到 <View testID="video" /> 与暴露
// seek / presentFullscreenPlayer / dismissFullscreenPlayer 的 imperative ref. 透传
// onLoad/onProgress/onError/onBuffer/onEnd 到 View props, 让测试通过
// `fireEvent(video, "onLoad", { duration: 30 })` 驱动真实回调连线.
jest.mock(
  "react-native-video",
  () => {
    const React = require("react") as typeof import("react");
    const RN = jest.requireActual("react-native") as typeof import("react-native");
    const Video = React.forwardRef((props: Record<string, unknown>, ref) => {
      React.useImperativeHandle(ref, () => ({
        seek: jest.fn(),
        presentFullscreenPlayer: jest.fn(),
        dismissFullscreenPlayer: jest.fn(),
      }), []);
      return React.createElement(RN.View, {
        testID: (props.testID as string) ?? "video",
        accessibilityLabel: "mock-video",
        onLoad: props.onLoad,
        onProgress: props.onProgress,
        onError: props.onError,
        onBuffer: props.onBuffer,
        onEnd: props.onEnd,
      } as never);
    });
    return { __esModule: true, default: Video };
  },
);

// BackHandler is intentionally NOT mocked here — a deep-path mock at
// `react-native/Libraries/Utilities/BackHandler` breaks `@react-navigation/native`'s
// `useBackButton` (it imports BackHandler from the top-level `react-native` which expects the
// default-export shape). PlayerScreen tests spy on `BackHandler.addEventListener` per-test instead.
// BackHandler 不在此全局 mock — 深路径 mock 会破坏 @react-navigation/native 的 useBackButton
// (它从顶层 react-native 取 BackHandler, 期望 default export 形状). PlayerScreen 测试改用
// 单测内 jest.spyOn(BackHandler, "addEventListener").

// expo-blur: degrade to a styled <View /> so layout tests can introspect props.
// expo-blur: 退化为带样式的 <View />, 让布局测试能够断言 props.
jest.mock(
  "expo-blur",
  () => {
    const React = require("react") as typeof import("react");
    const RN = jest.requireActual("react-native") as typeof import("react-native");
    return {
      __esModule: true,
      BlurView: (props: Record<string, unknown>) =>
        React.createElement(RN.View, {
          testID: (props.testID as string) ?? "expo-blur",
          style: props.style,
          children: props.children,
        } as never),
    };
  },
);

// expo-image-picker: returns a deterministic stub asset so tests don't need a native runtime.
// Use the SDK 17 `mediaTypes: ["images"]` shape; `MediaTypeOptions` is deprecated in 17.x.
// expo-image-picker: 返回确定性 stub asset, 测试无需原生运行时. SDK 17 使用 mediaTypes: ["images"],
// MediaTypeOptions 在 17.x 已废弃.
jest.mock(
  "expo-image-picker",
  () => ({
    requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
    launchImageLibraryAsync: jest.fn(async () => ({
      canceled: false,
      assets: [{ uri: "file:///mock-image.jpg", width: 100, height: 100, mimeType: "image/jpeg" }],
    })),
  }),
);

// expo-image-manipulator: deterministic stub that returns a synthetic compressed URI.
// expo-image-manipulator: 返回确定性的合成已压缩 URI.
jest.mock(
  "expo-image-manipulator",
  () => ({
    SaveFormat: { JPEG: "jpeg", PNG: "png" },
    manipulateAsync: jest.fn(async (uri: string) => ({
      uri: `${uri}.jpg`,
      width: 256,
      height: 256,
    })),
  }),
);

// react-native-gesture-handler: stub Swipeable and GestureHandlerRootView to plain RN views;
// surface renderRightActions inside a testID="swipeable-actions" wrapper for assertions.
// react-native-gesture-handler: 把 Swipeable 与 GestureHandlerRootView 退化为普通 RN view,
// 把 renderRightActions 暴露在 testID="swipeable-actions" 容器里供断言.
jest.mock(
  "react-native-gesture-handler",
  () => {
    const React = require("react") as typeof import("react");
    const RN = jest.requireActual("react-native") as typeof import("react-native");
    return {
      __esModule: true,
      GestureHandlerRootView: ({ children, style }: { children: React.ReactNode; style?: unknown }) =>
        React.createElement(RN.View, { style } as never, children),
      Swipeable: React.forwardRef(
        (
          {
            children,
            renderRightActions,
          }: {
            children: React.ReactNode;
            renderRightActions?: () => React.ReactNode;
          },
          _ref,
        ) =>
          React.createElement(
            RN.View,
            { testID: "swipeable" },
            children,
            renderRightActions ? React.createElement(RN.View, { testID: "swipeable-actions" }, renderRightActions()) : null,
          ),
      ),
    };
  },
);
