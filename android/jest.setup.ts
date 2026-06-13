// English. 中文.
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
