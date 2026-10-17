"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";

import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { credentialSchema, pickupStatusSchema, type Credential } from "@/lib/cash";

/**
 * Pickup QR and manual code stay in memory. They are not written to storage,
 * URLs, or logs, and a logged-out render never receives them.
 */
export function PickupPass({
  orderId,
  orderStatus,
  ticketNumber,
  paymentStatus,
}: {
  orderId: string;
  orderStatus: string;
  ticketNumber: string;
  paymentStatus: string;
}) {
  const queryClient = useQueryClient();
  const [credential, setCredential] = useState<Credential | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const requested = useRef(false);

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

  useEffect(() => {
    if (orderStatus !== "READY" || requested.current) {
      return;
    }
    requested.current = true;
    const handle = window.setTimeout(() => void request(), 0);
    return () => window.clearTimeout(handle);
    // Request once when the order first becomes ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderStatus]);

  if (orderStatus === "PICKED_UP") {
    return (
      <section className="rounded-[1.6rem] border border-border bg-card p-5" data-testid="pickup-pass">
        <h3 className="font-display text-2xl">Collected</h3>
        <p className="mt-2 text-sm text-muted-foreground">This order has been handed over. The pickup code no longer works.</p>
      </section>
    );
  }

  if (orderStatus !== "READY") {
    return (
      <section className="rounded-[1.6rem] border border-border bg-card p-5" data-testid="pickup-pass">
        <p className="eyebrow">Pickup</p>
        <h3 className="font-display text-2xl">Pickup pass available when your order is ready</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Ticket {ticketNumber}. Pay cash at the counter. A QR code is not shown yet.
        </p>
      </section>
    );
  }

  const expiresAt = credential ? new Date(credential.expires_at).getTime() : 0;
  const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const live = credential !== null && remaining > 0;
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");

  async function copyCode() {
    if (!credential) {
      return;
    }
    await navigator.clipboard.writeText(credential.code);
    setCopied(true);
  }

  return (
    <section
      className="space-y-4 rounded-[1.6rem] border border-border bg-card p-5"
      aria-labelledby="pickup-heading"
      data-testid="pickup-pass"
    >
      <div>
        <p className="eyebrow">Counter</p>
        <h3 id="pickup-heading" className="font-display text-3xl font-extrabold tracking-tight uppercase">
          Your pickup pass
        </h3>
      </div>
      <p className="font-mono text-sm tracking-[0.14em] uppercase">
        Ticket {ticketNumber} · Cash {paymentStatus}
        {status.data?.state === "COLLECTED" ? " · Collected" : ""}
      </p>
      {live && credential ? (
        <>
          <div className="mx-auto w-fit rounded-2xl bg-white p-4" data-testid="pickup-qr">
            <QRCodeSVG value={credential.token} size={232} level="M" marginSize={2} title="Pickup QR code" />
          </div>
          <p className="text-center text-sm text-muted-foreground">
            Show this at the counter. Scanning does not take the cash by itself.
          </p>
          <p
            className="text-center font-mono text-3xl tracking-[0.28em]"
            data-testid="pickup-code"
            aria-label="Manual pickup code"
          >
            {credential.code}
          </p>
          <div className="flex justify-center">
            <Button type="button" variant="outline" onClick={() => void copyCode()}>
              {copied ? "Copied" : "Copy code"}
            </Button>
          </div>
          <p className="text-center text-sm" data-testid="pickup-expiry">
            Expires in {minutes}:{seconds}
          </p>
        </>
      ) : (
        <p className="text-sm" data-testid="pickup-hint">
          {busy
            ? "Preparing your pickup pass."
            : credential
              ? "Your pickup code expired. Ask for a fresh one at the counter."
              : "Your pickup pass will appear here when the kitchen marks the order ready."}
        </p>
      )}
      <div className="flex justify-center">
        <Button type="button" onClick={() => void request()} disabled={busy} data-testid="show-pickup">
          {live ? "Get a new code" : "Refresh pickup pass"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">A new code stops the previous code from working. It expires in about 10 minutes.</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
