/**
 * Jest configuration for the Android RN client.
 * Android RN 客户端的 Jest 配置.
 */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-mmkv))",
  ],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.test.{ts,tsx}",
    "!src/**/__mocks__/**",
    "!src/navigation/**",
  ],
  coverageThreshold: {
    global: {
      lines: 85,
      branches: 75,
      functions: 80,
      statements: 85,
    },
  },
};
