"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { disablePush, enablePush, readPushStatus, sendTestPush, type PushStatus } from "@/lib/push";

export function PushSettings({ userId }: { userId: string }) {
  const [status, setStatus] = useState<PushStatus>({ state: "checking" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setStatus(await readPushStatus(userId));
    } catch {
      setStatus({ state: "server-off", message: "Notification status could not be loaded." });
    }
  }, [userId]);

  useEffect(() => {
    // Reading browser state after mount keeps server and client markup identical.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(done);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-5" aria-labelledby="push-heading" data-testid="push-settings">
      <h2 id="push-heading" className="font-display text-2xl">
        Phone notifications
      </h2>
      <p className="text-sm text-muted-foreground">
        Get a message on this device when your order is ready. It only reminds you. Your order page
        always shows the real status, and payment is always cash at the counter.
      </p>
      <p className="text-sm font-medium" data-testid="push-state">
        {status.state === "checking" && "Checking this device…"}
        {status.state === "unsupported" && "Not supported on this device"}
        {status.state === "server-off" && "Not available right now"}
        {status.state === "blocked" && "Blocked in browser settings"}
        {status.state === "off" && "Off on this device"}
        {status.state === "on" && "On for this device"}
      </p>
      {"message" in status ? (
        <p className="text-sm" data-testid="push-message">
          {status.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status.state === "off" ? (
          <Button
            type="button"
            disabled={busy}
            onClick={() => run(() => enablePush(userId), "Notifications are on for this device.")}
          >
            Turn on notifications
          </Button>
        ) : null}
        {status.state === "on" ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => run(() => disablePush(userId), "Notifications are off for this device.")}
            >
              Turn off notifications
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                run(
                  sendTestPush,
                  "Test queued. The push service accepting it does not prove this device showed it.",
                )
              }
            >
              Send a test notification
            </Button>
          </>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="text-sm" data-testid="push-feedback">
          {message}
        </p>
      ) : null}
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">Installing BowlByte on your phone</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Android (Chrome): open the menu, choose Install app or Add to Home screen.</li>
          <li>
            iPhone (Safari, iOS 16.4 or later): tap Share, then Add to Home Screen. Open BowlByte from
            the Home Screen icon, then turn notifications on here.
          </li>
          <li>Notifications need a secure HTTPS address.</li>
        </ul>
      </details>
    </section>
  );
}
