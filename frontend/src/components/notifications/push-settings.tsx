"use client";

import { useCallback, useEffect, useState } from "react";

import { disablePush, enablePush, readPushDiagnostics, sendTestPush, type PushDiagnostics, type PushStatus } from "@/lib/push";

const labels: Record<PushStatus["state"], string> = {
  checking: "Checking this device…",
  unsupported: "UNSUPPORTED",
  "needs-install": "NEEDS HOME SCREEN INSTALLATION",
  blocked: "BLOCKED BY BROWSER",
  permission: "PERMISSION REQUIRED",
  off: "NOT ENABLED",
  error: "SUBSCRIPTION ERROR",
  on: "ENABLED",
};

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

export function PushSettings({ userId }: { userId: string }) {
  const [diagnostics, setDiagnostics] = useState<PushDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [lastTest, setLastTest] = useState<"Success" | "Failed" | "Unknown">("Unknown");
  const [acceptance, setAcceptance] = useState<"Accepted" | "Rejected" | "Unknown">("Unknown");

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
  const canEnable = status.state === "off" || status.state === "permission" || status.state === "error";

  async function enable() {
    setBusy(true);
    setMessage("");
    try {
      await enablePush(userId);
      setMessage("This device is registered. BowlByte saved the subscription.");
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
      setAcceptance("Unknown");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function test() {
    setBusy(true);
    setMessage("");
    try {
      const result = await sendTestPush();
      setLastTest("Success");
      setAcceptance(result.acceptance === "accepted" ? "Accepted" : result.acceptance === "rejected" ? "Rejected" : "Unknown");
      setMessage(
        result.acceptance === "accepted"
          ? "The push service accepted the test. That does not prove this phone displayed it."
          : result.acceptance === "rejected"
            ? "The push service rejected the test. This device did not get a system notification from that attempt."
            : "The test was queued. The push service has not answered yet, so display is unknown.",
      );
    } catch (error) {
      setLastTest("Failed");
      setAcceptance("Unknown");
      setMessage(error instanceof Error ? error.message : "The test could not be sent.");
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <section className="space-y-4 rounded-[1.6rem] border border-border bg-card p-5" aria-labelledby="push-heading" data-testid="push-settings">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">This device</p>
          <h2 id="push-heading" className="font-display text-3xl font-extrabold tracking-tight uppercase">
            Phone notifications
          </h2>
        </div>
        <span className="grid h-12 w-12 place-items-center rounded-full bg-lime text-ink" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" strokeLinejoin="round" />
            <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
          </svg>
        </span>
      </div>
      <p className="max-w-xl text-sm text-muted-foreground">
        A message on this phone when your order is ready. It only reminds you. The order page shows the real status, and you still pay cash at the counter.
      </p>
      <p className="font-mono text-xs tracking-[0.16em]" data-testid="push-state">
        {labels[status.state]}
      </p>
      {"message" in status ? (
        <p className="text-sm" data-testid="push-message">
          {status.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canEnable ? (
          <button type="button" className="pill pill-solid min-h-13! px-5!" disabled={busy} onClick={() => void enable()}>
            Enable Phone Notifications
          </button>
        ) : null}
        {status.state === "on" || status.state === "error" ? (
          <button type="button" className="pill min-h-13! px-5!" disabled={busy} onClick={() => void disable()}>
            Disable Notifications
          </button>
        ) : null}
        {status.state === "on" ? (
          <button type="button" className="pill min-h-13! px-5!" disabled={busy} onClick={() => void test()}>
            Send Test Notification
          </button>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="text-sm" data-testid="push-feedback">
          {message}
        </p>
      ) : null}
      <dl className="grid gap-2 text-sm sm:grid-cols-2" data-testid="push-diagnostics">
        <div className="flex justify-between gap-3 border-b border-border py-1">
          <dt className="text-muted-foreground">Browser supports notifications</dt>
          <dd>{diagnostics ? yesNo(diagnostics.browserNotifications) : "…"}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-border py-1">
          <dt className="text-muted-foreground">Secure context</dt>
          <dd>{diagnostics ? yesNo(diagnostics.secureContext) : "…"}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-border py-1">
          <dt className="text-muted-foreground">Service worker active</dt>
          <dd>{diagnostics ? yesNo(diagnostics.serviceWorker === "active") : "…"}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-border py-1">
          <dt className="text-muted-foreground">Push API available</dt>
          <dd>{diagnostics ? yesNo(diagnostics.pushApi) : "…"}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-border py-1">
          <dt className="text-muted-foreground">Notification permission</dt>
          <dd className="capitalize">{diagnostics?.permission ?? "…"}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-border py-1">
          <dt className="text-muted-foreground">Browser subscription</dt>
          <dd className="capitalize">{diagnostics?.browserSubscription ?? "…"}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-border py-1">
          <dt className="text-muted-foreground">Backend subscription</dt>
          <dd className="capitalize">{diagnostics?.backendSubscription ?? "…"}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-border py-1">
          <dt className="text-muted-foreground">Last test request</dt>
          <dd>{lastTest}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-border py-1 sm:col-span-2">
          <dt className="text-muted-foreground">Push service acceptance</dt>
          <dd>{acceptance}. A backend response cannot prove the phone displayed it.</dd>
        </div>
      </dl>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>Android: open BowlByte in Chrome over HTTPS, sign in, and tap Enable Phone Notifications. Installing the app is optional when Chrome already offers push.</p>
        <p>To receive BowlByte alerts on iPhone, add BowlByte to your Home Screen, open the installed app, and enable notifications.</p>
      </div>
    </section>
  );
}
