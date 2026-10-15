"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export type ScannerState =
  | "idle"
  | "starting"
  | "scanning"
  | "denied"
  | "no-camera"
  | "insecure"
  | "error";

type Controls = { stop: () => void };

const messages: Record<Exclude<ScannerState, "idle" | "starting" | "scanning">, string> = {
  denied:
    "Camera access was blocked. Allow the camera for this site in your browser settings, or enter the code by hand.",
  "no-camera": "No camera was found on this device. Enter the ticket number and code by hand.",
  insecure: "The camera needs a secure (HTTPS) connection. Enter the code by hand instead.",
  error: "The camera could not start. Try again, or enter the code by hand.",
};

/**
 * Starts only after the cashier presses the button (browsers require a user
 * action for camera permission). It prefers the rear camera, stops after one
 * successful read, and reports each scan at most once.
 */
export function QrScanner({
  onScan,
  disabled = false,
}: {
  onScan: (value: string) => void;
  disabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const controls = useRef<Controls | null>(null);
  const handled = useRef(false);
  const [state, setState] = useState<ScannerState>("idle");

  const stop = useCallback(() => {
    controls.current?.stop();
    controls.current = null;
    setState((current) => (current === "scanning" || current === "starting" ? "idle" : current));
  }, []);

  useEffect(() => stop, [stop]);

  async function start() {
    handled.current = false;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState("insecure");
      return;
    }
    setState("starting");
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 200,
        delayBetweenScanSuccess: 600,
      });
      const element = video.current;
      if (!element) {
        setState("error");
        return;
      }
      const started = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" } } },
        element,
        (result, _error, active) => {
          if (!result || handled.current) {
            return;
          }
          handled.current = true; // one scan, one submission
          active.stop();
          controls.current = null;
          setState("idle");
          onScan(result.getText());
        },
      );
      if (handled.current) {
        started.stop();
        return;
      }
      controls.current = started;
      setState("scanning");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setState("denied");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setState("no-camera");
      } else {
        setState("error");
      }
    }
  }

  const active = state === "scanning" || state === "starting";
  return (
    <div className="space-y-3" data-testid="qr-scanner" data-state={state}>
      <div
        className={`overflow-hidden rounded-2xl border border-border bg-black ${active ? "" : "hidden"}`}
      >
        <video
          ref={video}
          className="aspect-square w-full max-w-md object-cover"
          muted
          playsInline
          aria-label="Camera preview for scanning the pickup QR code"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {active ? (
          <Button type="button" variant="outline" onClick={stop}>
            Stop camera
          </Button>
        ) : (
          <Button type="button" onClick={start} disabled={disabled} data-testid="start-scan">
            {state === "idle" ? "Scan QR code" : "Try the camera again"}
          </Button>
        )}
        {state === "starting" ? <span className="text-sm">Starting camera…</span> : null}
        {state === "scanning" ? <span className="text-sm">Point the camera at the pickup QR.</span> : null}
      </div>
      {state in messages ? (
        <p role="alert" className="text-sm text-destructive" data-testid="scanner-message">
          {messages[state as keyof typeof messages]}
        </p>
      ) : null}
    </div>
  );
}
