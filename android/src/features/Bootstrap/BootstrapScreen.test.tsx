// BootstrapScreen renders a spinner and triggers authStore.bootstrap on mount.
// BootstrapScreen 显示加载指示并在挂载时触发 authStore.bootstrap.

import { render, screen, waitFor } from "@testing-library/react-native";

import { useAuthStore } from "@/store/authStore";
import { BootstrapScreen } from "./BootstrapScreen";

describe("BootstrapScreen", () => {
  it("invokes authStore.bootstrap exactly once on mount", async () => {
    const bootstrap = jest.fn(async () => {
      useAuthStore.setState({ status: "serverSetup" });
    });
    useAuthStore.setState({ bootstrap });
    render(<BootstrapScreen />);
    expect(screen.getByTestId("bootstrapScreen")).toBeTruthy();
    await waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(1));
  });
});
