"use client";

import { useCallback, useEffect, useState } from "react";

import { disablePush, enablePush, readPushDiagnostics, type PushDiagnostics, type PushStatus } from "@/lib/push";

const labels: Record<PushStatus["state"], string> = {
  checking: "Checking…",
  unsupported: "UNSUPPORTED",
  "needs-install": "NEEDS HOME SCREEN",
  blocked: "BLOCKED",
  permission: "PERMISSION REQUIRED",
  off: "NOT ENABLED",
  error: "ERROR",
  on: "ENABLED",
};

function hintFor(status: PushStatus): string | null {
  switch (status.state) {
    case "unsupported":
      return "This browser cannot show push alerts.";
    case "needs-install":
      return "On iPhone, add BowlByte to your Home Screen, then open it and turn notifications on.";
    case "blocked":
      return "Notifications are blocked in browser settings. Allow them for BowlByte, then try again.";
    case "error":
      return "message" in status ? status.message : "Something went wrong. Try again.";
    case "permission":
      return "BowlByte will ask for permission when you turn this on.";
    default:
      return null;
  }
}

export function PushSettings({ userId }: { userId: string }) {
  const [diagnostics, setDiagnostics] = useState<PushDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setDiagnostics(await readPushDiagnostics(userId));
    } catch {
      setDiagnostics({
        status: { state: "error", message: "Notification status could not be loaded." },
        browserNotifications: false,
        secureContext: false,
        serviceWorker: "missing",
        pushApi: false,
        permission: "unsupported",
        browserSubscription: "missing",
        backendSubscription: "unknown",
      });
    }
  }, [userId]);

  useEffect(() => {
    // Reading browser state after mount keeps server and client markup identical.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const status = diagnostics?.status ?? { state: "checking" as const };
  const enabled = status.state === "on";
  const canEnable = status.state === "off" || status.state === "permission" || status.state === "error";
  const canDisable = status.state === "on" || status.state === "error";
  const hint = hintFor(status);

  async function enable() {
    setBusy(true);
    setMessage("");
    try {
      await enablePush(userId);
      setMessage("Notifications are on for this device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function disable() {
    setBusy(true);
    setMessage("");
    try {
      await disablePush(userId);
      setMessage("Notifications are off for this device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <section
      className="push-card"
      aria-labelledby="push-heading"
      data-testid="push-settings"
      data-enabled={enabled ? "true" : "false"}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="eyebrow">This device</p>
          <h2 id="push-heading" className="font-display text-xl font-extrabold tracking-tight uppercase sm:text-2xl">
            Phone notifications
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">
            Alert when your order is ready. Cash still at the counter.
          </p>
        </div>
        <span
          className={`push-icon ${enabled ? "push-icon-on" : ""}`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" strokeLinejoin="round" />
            <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
          </svg>
        </span>
      </div>

      <div className="push-row">
        <div className="min-w-0 space-y-0.5">
          <p className="font-mono text-[0.68rem] tracking-[0.14em]" data-testid="push-state">
            {labels[status.state]}
          </p>
          {hint ? (
            <p className="text-xs leading-5 text-muted-foreground" data-testid="push-message">
              {hint}
            </p>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              {enabled ? "You will get a ping when food is ready." : "Turn on to get a ready alert on this phone."}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {canEnable ? (
            <button
              type="button"
              className="pill pill-solid min-h-10! px-4! text-sm!"
              disabled={busy}
              onClick={() => void enable()}
            >
              Enable Phone Notifications
            </button>
          ) : null}
          {canDisable ? (
            <button
              type="button"
              className="pill min-h-10! px-4! text-sm!"
              disabled={busy}
              onClick={() => void disable()}
            >
              Disable Notifications
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <p role="status" className="text-xs text-muted-foreground" data-testid="push-feedback">
          {message}
        </p>
      ) : null}
    </section>
  );
}
