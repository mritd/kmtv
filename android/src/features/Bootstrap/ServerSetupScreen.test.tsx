// English. 中文.
// ServerSetupScreen test exercises URL validation and connect callback wiring.
// ServerSetupScreen 测试覆盖 URL 校验与 connect 回调装配.

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { initI18n } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import { ServerSetupScreen } from "./ServerSetupScreen";

beforeAll(async () => {
  await initI18n("en");
});

describe("ServerSetupScreen", () => {
  beforeEach(() => {
    useAuthStore.setState({ connectServer: jest.fn(async () => undefined) });
  });

  it("renders title and Connect button disabled when URL is empty", () => {
    render(<ServerSetupScreen />);
    expect(screen.getByTestId("serverSetupScreen")).toBeTruthy();
    const button = screen.getByTestId("connectButton");
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });

  it("shows invalid URL message when input is non-empty and not http(s)", () => {
    render(<ServerSetupScreen />);
    fireEvent.changeText(screen.getByTestId("serverURLField"), "not-a-url");
    expect(screen.getByText(/Invalid URL format/)).toBeTruthy();
  });

  it("calls connectServer with trimmed credentials when Connect tapped", async () => {
    const connect = jest.fn(async () => undefined);
    useAuthStore.setState({ connectServer: connect });
    render(<ServerSetupScreen />);
    fireEvent.changeText(screen.getByTestId("serverURLField"), "  https://k.example.com  ");
    fireEvent.changeText(screen.getByTestId("usernameField"), "  u  ");
    fireEvent.changeText(screen.getByTestId("passwordField"), "p");
    fireEvent.press(screen.getByTestId("connectButton"));
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    expect(connect.mock.calls[0]?.slice(0, 3)).toEqual([
      "https://k.example.com",
      "u",
      "p",
    ]);
  });

  it("surfaces server error message on connect failure", async () => {
    const connect = jest.fn(async () => { throw { kind: "server", message: "boom" }; });
    useAuthStore.setState({ connectServer: connect });
    render(<ServerSetupScreen />);
    fireEvent.changeText(screen.getByTestId("serverURLField"), "https://k.example.com");
    fireEvent.press(screen.getByTestId("connectButton"));
    await waitFor(() => expect(screen.getByTestId("errorMessage")).toBeTruthy());
    expect(screen.getByTestId("errorMessage").props.children).toBe("boom");
  });
});
