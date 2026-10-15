import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QrScanner } from "@/components/cashier/qr-scanner";

type ScanCallback = (
  result: { getText: () => string } | undefined,
  error: unknown,
  controls: { stop: () => void },
) => void;

const behaviour: { mode: "scan" | "denied" | "none"; stops: number; callback: ScanCallback | null } = {
  mode: "scan",
  stops: 0,
  callback: null,
};

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    async decodeFromConstraints(
      _constraints: unknown,
      _element: unknown,
      callback: ScanCallback,
    ) {
      if (behaviour.mode === "denied") {
        throw new DOMException("denied", "NotAllowedError");
      }
      if (behaviour.mode === "none") {
        throw new DOMException("none", "NotFoundError");
      }
      behaviour.callback = callback;
      return {
        stop: () => {
          behaviour.stops += 1;
        },
      };
    }
  },
}));

function secure(value: boolean) {
  Object.defineProperty(window, "isSecureContext", { value, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", {
    value: value ? { getUserMedia: vi.fn() } : undefined,
    configurable: true,
  });
}

describe("QrScanner", () => {
  beforeEach(() => {
    behaviour.mode = "scan";
    behaviour.stops = 0;
    behaviour.callback = null;
    secure(true);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not touch the camera until the user presses the button", () => {
    render(<QrScanner onScan={vi.fn()} />);
    expect(behaviour.callback).toBeNull();
    expect(screen.getByTestId("qr-scanner")).toHaveAttribute("data-state", "idle");
  });

  it("reports a scan once, stops the camera, and ignores repeats", async () => {
    const onScan = vi.fn();
    render(<QrScanner onScan={onScan} />);
    fireEvent.click(screen.getByTestId("start-scan"));
    await waitFor(() => expect(behaviour.callback).not.toBeNull());
    const result = { getText: () => "bbp1.token" };
    act(() => {
      behaviour.callback?.(result, undefined, { stop: () => (behaviour.stops += 1) });
      behaviour.callback?.(result, undefined, { stop: () => (behaviour.stops += 1) });
    });
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith("bbp1.token");
    expect(behaviour.stops).toBeGreaterThanOrEqual(1);
  });

  it("explains a denied camera permission and offers a retry", async () => {
    behaviour.mode = "denied";
    render(<QrScanner onScan={vi.fn()} />);
    fireEvent.click(screen.getByTestId("start-scan"));
    expect(await screen.findByTestId("scanner-message")).toHaveTextContent(/blocked/i);
    expect(screen.getByTestId("start-scan")).toHaveTextContent(/try the camera again/i);
  });

  it("explains a missing camera", async () => {
    behaviour.mode = "none";
    render(<QrScanner onScan={vi.fn()} />);
    fireEvent.click(screen.getByTestId("start-scan"));
    expect(await screen.findByTestId("scanner-message")).toHaveTextContent(/no camera/i);
  });

  it("needs a secure context and says so", async () => {
    secure(false);
    render(<QrScanner onScan={vi.fn()} />);
    fireEvent.click(screen.getByTestId("start-scan"));
    expect(await screen.findByTestId("scanner-message")).toHaveTextContent(/secure/i);
  });
});
