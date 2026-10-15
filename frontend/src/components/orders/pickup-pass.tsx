"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";

import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { credentialSchema, pickupStatusSchema, type Credential } from "@/lib/cash";

/**
 * The student's pickup pass. The QR contents and manual code live only in this
 * component's memory. They are never written to storage, URLs, or logs, and they
 * are cleared when the order is collected.
 */
export function PickupPass({ orderId, orderStatus }: { orderId: string; orderStatus: string }) {
  const queryClient = useQueryClient();
  const [credential, setCredential] = useState<Credential | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const status = useQuery({
    queryKey: ["pickup-status", orderId, orderStatus],
    enabled: orderStatus === "READY",
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/orders/${orderId}/pickup-status`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return pickupStatusSchema.parse(await response.json());
    },
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (orderStatus !== "READY") {
    return null;
  }

  async function request() {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/orders/${orderId}/pickup-credential`, {
        method: "POST",
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      setCredential(credentialSchema.parse(await response.json()));
      await queryClient.invalidateQueries({ queryKey: ["pickup-status", orderId] });
    } finally {
      setBusy(false);
    }
  }

  const expiresAt = credential ? new Date(credential.expires_at).getTime() : 0;
  const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const live = credential !== null && remaining > 0;
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");

  return (
    <section
      className="space-y-3 rounded-2xl border border-border bg-card p-5"
      aria-labelledby="pickup-heading"
      data-testid="pickup-pass"
    >
      <h3 id="pickup-heading" className="font-display text-2xl">
        Pickup pass
      </h3>
      {live ? (
        <>
          <div className="mx-auto w-fit rounded-xl bg-white p-3" data-testid="pickup-qr">
            <QRCodeSVG
              value={credential.token}
              size={224}
              level="M"
              marginSize={2}
              title="Pickup QR code"
            />
          </div>
          <p className="text-center text-sm text-muted-foreground">
            If the camera cannot read the QR, give the cashier your ticket and this code.
          </p>
          <p
            className="text-center font-mono text-2xl tracking-widest"
            data-testid="pickup-code"
            aria-label="Manual pickup code"
          >
            {credential.code}
          </p>
          <p className="text-center text-sm" data-testid="pickup-expiry">
            Expires in {minutes}:{seconds}
          </p>
          <div className="flex justify-center">
            <Button type="button" variant="outline" onClick={request} disabled={busy}>
              Get a new code
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Getting a new code stops the old one from working.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm" data-testid="pickup-hint">
            {credential
              ? "Your pickup code expired. Get a new one when you reach the counter."
              : status.data?.state === "ACTIVE"
                ? "You already opened a pickup code. Get a new one to show it again."
                : "Open your pickup code when you reach the counter. It works once and expires quickly."}
          </p>
          <Button type="button" onClick={request} disabled={busy} data-testid="show-pickup">
            {credential ? "Get a new code" : "Show pickup QR"}
          </Button>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
