// English. 中文.
// ThemeProvider tests cover the system / light / dark override paths.
// ThemeProvider 测试覆盖 system / light / dark 覆盖路径.

import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// @ts-expect-error subpath import has no type declarations; used only to mock useColorScheme.
import useColorScheme from "react-native/Libraries/Utilities/useColorScheme";

import { ThemeProvider } from "./ThemeProvider";
import { darkColors, lightColors } from "./theme";
import { useTheme } from "./useTheme";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

function Probe() {
  const { colors, mode } = useTheme();
  return <Text testID="probe">{`${mode}:${colors.accent}`}</Text>;
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    (useColorScheme as jest.Mock).mockReturnValue(null);
  });

  it("provides the light palette when override='light'", () => {
    render(
      <ThemeProvider override="light">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("probe").props.children).toBe(`light:${lightColors.accent}`);
  });

  it("provides the dark palette when override='dark'", () => {
    render(
      <ThemeProvider override="dark">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("probe").props.children).toBe(`dark:${darkColors.accent}`);
  });

  it("falls back to system colour scheme when override='system'", () => {
    (useColorScheme as jest.Mock).mockReturnValue(null);
    render(
      <ThemeProvider override="system">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("probe").props.children).toBe(`light:${lightColors.accent}`);
  });

  it("renders dark palette under override='system' when system reports dark", () => {
    (useColorScheme as jest.Mock).mockReturnValue("dark");
    render(
      <ThemeProvider override="system">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("probe").props.children).toBe(`dark:${darkColors.accent}`);
  });

  it("useTheme outside a provider returns the light defaults", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").props.children).toBe(`light:${lightColors.accent}`);
  });
});
