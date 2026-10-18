"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { OrderCard } from "@/components/cashier/order-card";
import { QrScanner } from "@/components/cashier/qr-scanner";
import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import {
  cashierBoardSchema,
  completePickupSchema,
  confirmCashSchema,
  newKey,
  verifySchema,
  type CounterOrder,
} from "@/lib/cash";
import { liveStatusLabel, useLiveResource } from "@/lib/live";
import { formatInrFromPaise } from "@/lib/money";

type Credential = { token: string } | { ticket: string; code: string };

type Checked = {
  order: CounterOrder;
  credential: Credential;
  canConfirm: boolean;
  canComplete: boolean;
};

export function CashierDesk() {
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Checked | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState("");
  const [code, setCode] = useState("");
  const confirmKeys = useRef(new Map<string, string>());
  const completeKeys = useRef(new Map<string, string>());
  const verifying = useRef(false);

  const board = useQuery({
    queryKey: ["cashier-board"],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/cashier/orders");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return cashierBoardSchema.parse(await response.json());
    },
  });
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["cashier-board"] });
  }, [queryClient]);
  const live = useLiveResource("/api/v1/ws/cashier", refresh, true, board.isSuccess);

  async function verify(credential: Credential) {
    if (verifying.current) {
      return; // a scan or a click is already being checked
    }
    verifying.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body =
        "token" in credential
          ? { token: credential.token }
          : { ticket_number: credential.ticket, code: credential.code };
      const response = await apiFetch("/api/v1/cashier/pickup/verify", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setChecked(null);
        setError(await readError(response));
        return;
      }
      const result = verifySchema.parse(await response.json());
      setChecked({
        order: result.order,
        credential,
        canConfirm: result.can_confirm_cash,
        canComplete: result.can_complete_pickup,
      });
      setNotice("Pickup code is valid. Nothing has been paid or handed over yet.");
    } finally {
      verifying.current = false;
      setBusy(false);
    }
  }

  async function confirmCash(order: CounterOrder) {
    setBusy(true);
    setError("");
    setNotice("");
    const key = confirmKeys.current.get(order.id) ?? newKey();
    confirmKeys.current.set(order.id, key); // a retry of the same action reuses the key
    try {
      const response = await apiFetch(`/api/v1/cashier/orders/${order.id}/confirm-cash`, {
        method: "POST",
        body: JSON.stringify({ amount_paise: order.total_paise, idempotency_key: key }),
      });
      if (!response.ok) {
        setError(await readError(response));
        refresh();
        return;
      }
      const result = confirmCashSchema.parse(await response.json());
      confirmKeys.current.delete(order.id);
      setConfirming(null);
      setNotice(
        `Cash recorded: ${formatInrFromPaise(result.receipt.amount_paise)} for ${result.order.ticket_number}. Receipt ${result.receipt.receipt_ref}.`,
      );
      setChecked((current) =>
        current && current.order.id === order.id
          ? { ...current, order: result.order, canConfirm: false, canComplete: true }
          : current,
      );
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function completePickup(current: Checked) {
    setBusy(true);
    setError("");
    setNotice("");
    const key = completeKeys.current.get(current.order.id) ?? newKey();
    completeKeys.current.set(current.order.id, key);
    try {
      const credential = current.credential;
      const body =
        "token" in credential
          ? { token: credential.token, idempotency_key: key }
          : { code: credential.code, idempotency_key: key };
      const response = await apiFetch(`/api/v1/cashier/orders/${current.order.id}/complete-pickup`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await readError(response));
        refresh();
        return;
      }
      const result = completePickupSchema.parse(await response.json());
      completeKeys.current.delete(current.order.id);
      setChecked(null);
      setTicket("");
      setCode("");
      setNotice(`Order ${result.order.ticket_number} handed over. The pickup code cannot be used again.`);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  function startConfirm(order: CounterOrder) {
    setConfirming(order.id);
    setError("");
  }

  function confirmPanel(order: CounterOrder) {
    if (confirming !== order.id) {
      return (
        <Button type="button" onClick={() => startConfirm(order)} disabled={busy} data-testid="record-cash">
          Record cash received
        </Button>
      );
    }
    return (
      <div className="space-y-2 rounded-xl border border-accent bg-accent/10 p-3" data-testid="confirm-panel">
        <p className="text-sm font-medium">
          Count {formatInrFromPaise(order.total_paise)} in cash. Confirm only when you are holding it.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => confirmCash(order)} disabled={busy} data-testid="confirm-cash">
            Confirm {formatInrFromPaise(order.total_paise)} received
          </Button>
          <Button type="button" variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const data = board.data;
  return (
    <section className="space-y-6" aria-labelledby="cashier-heading" data-testid="cashier-desk">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="cashier-heading" className="font-display text-4xl">
            Cashier desk
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="cashier-live">
            {liveStatusLabel(live)}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/cashier/history">My cash history</Link>
        </Button>
      </div>

      {data ? (
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border p-4">
            <dt className="text-sm text-muted-foreground">Waiting to be paid (not yet cash)</dt>
            <dd className="font-display text-3xl" data-testid="total-awaiting">
              {formatInrFromPaise(data.totals.awaiting_payment_paise)}
            </dd>
          </div>
          <div className="rounded-2xl border border-border p-4">
            <dt className="text-sm text-muted-foreground">Cash recorded today (net of reversals)</dt>
            <dd className="font-display text-3xl" data-testid="total-recorded">
              {formatInrFromPaise(data.totals.recorded_today_paise)}
            </dd>
          </div>
        </dl>
      ) : null}

      <div aria-live="polite" className="space-y-2">
        {notice ? (
          <p role="status" className="rounded-xl border border-primary/40 bg-secondary p-3 text-sm" data-testid="cashier-notice">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-xl border border-destructive/50 p-3 text-sm text-destructive" data-testid="cashier-error">
            {error}
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <section className="space-y-4 rounded-2xl border border-border p-4" aria-labelledby="check-heading">
            <h2 id="check-heading" className="font-display text-2xl">
              Check a pickup code
            </h2>
            <QrScanner disabled={busy} onScan={(value) => void verify({ token: value })} />
            <form
              className="space-y-3 border-t border-border pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void verify({ ticket: ticket.trim(), code: code.trim() });
              }}
            >
              <p className="text-sm font-medium">Camera not working? Enter the code by hand.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  Ticket number
                  <input
                    value={ticket}
                    onChange={(event) => setTicket(event.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="min-h-11 rounded-xl border border-border bg-card px-3 font-mono uppercase"
                    data-testid="manual-ticket"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Manual code
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="XXXX-XXXX-XXXX"
                    className="min-h-11 rounded-xl border border-border bg-card px-3 font-mono uppercase"
                    data-testid="manual-code"
                  />
                </label>
              </div>
              <Button type="submit" variant="secondary" disabled={busy || !ticket.trim() || !code.trim()} data-testid="manual-verify">
                Check code
              </Button>
            </form>
          </section>

          {checked ? (
            <section aria-labelledby="checked-heading" className="space-y-3" data-testid="checked-order">
              <h2 id="checked-heading" className="font-display text-2xl">
                Order at the counter
              </h2>
              <ul>
                <OrderCard order={checked.order} highlight>
                  <div className="space-y-3 pt-2">
                    {checked.canConfirm ? (
                      <>
                        <p className="text-sm">
                          Payment is pending. Record the cash first, then hand the order over.
                        </p>
                        {confirmPanel(checked.order)}
                      </>
                    ) : null}
                    {checked.canComplete ? (
                      <Button type="button" onClick={() => completePickup(checked)} disabled={busy} data-testid="complete-pickup">
                        Hand over order {checked.order.ticket_number}
                      </Button>
                    ) : null}
                    <Button type="button" variant="ghost" size="sm" onClick={() => setChecked(null)}>
                      Clear
                    </Button>
                  </div>
                </OrderCard>
              </ul>
            </section>
          ) : null}
        </div>

        <div className="space-y-6">
          {board.isLoading ? <p>Loading orders.</p> : null}
          {board.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {board.error.message}
            </p>
          ) : null}
          {data ? (
            <>
              <OrderList
                id="awaiting-payment"
                title="Ready · payment pending"
                empty="No ready orders are waiting for payment."
                orders={data.awaiting_payment}
                render={(order) => confirmPanel(order)}
              />
              <OrderList
                id="awaiting-handover"
                title="Paid · waiting for handover"
                empty="No paid orders are waiting for handover."
                orders={data.awaiting_handover}
                render={() => (
                  <p className="text-sm text-muted-foreground">
                    Cash recorded. Scan the student&apos;s pickup QR to hand this order over.
                  </p>
                )}
              />
              <OrderList
                id="overdue"
                title="Pickup hold ended"
                empty="No orders are past their pickup hold."
                orders={data.overdue}
                render={() => (
                  <p className="text-sm text-muted-foreground">
                    Do not hand this over with an old QR. A manager reviews it. Cash is not reversed automatically.
                  </p>
                )}
              />
              <OrderList
                id="completed"
                title="Picked up (last 24 hours)"
                empty="No orders collected yet."
                orders={data.completed}
              />
            </>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{data?.totals.window_note}</p>
    </section>
  );
}

function OrderList({
  id,
  title,
  empty,
  orders,
  render,
}: {
  id: string;
  title: string;
  empty: string;
  orders: CounterOrder[];
  render?: (order: CounterOrder) => React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} data-testid={id} className="space-y-3">
      <h2 id={`${id}-heading`} className="font-display text-2xl">
        {title} <span className="text-base text-muted-foreground">({orders.length})</span>
      </h2>
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid gap-3">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order}>
              {render ? render(order) : null}
            </OrderCard>
          ))}
        </ul>
      )}
    </section>
  );
}
