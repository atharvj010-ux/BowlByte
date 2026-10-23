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
    setConfirming(null);
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
      setNotice(
        result.can_confirm_cash
          ? "Pickup code verified. Collect cash, then confirm below."
          : "Pickup code verified. Cash is already recorded — hand the order over.",
      );
    } finally {
      verifying.current = false;
      setBusy(false);
    }
  }

  async function confirmCash(current: Checked) {
    setBusy(true);
    setError("");
    setNotice("");
    const order = current.order;
    const key = confirmKeys.current.get(order.id) ?? newKey();
    confirmKeys.current.set(order.id, key); // a retry of the same action reuses the key
    try {
      const credential = current.credential;
      const body =
        "token" in credential
          ? { token: credential.token, amount_paise: order.total_paise, idempotency_key: key }
          : { code: credential.code, amount_paise: order.total_paise, idempotency_key: key };
      const response = await apiFetch(`/api/v1/cashier/orders/${order.id}/confirm-cash`, {
        method: "POST",
        body: JSON.stringify(body),
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
      setChecked((prev) =>
        prev && prev.order.id === order.id
          ? { ...prev, order: result.order, canConfirm: false, canComplete: true }
          : prev,
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

  function confirmPanel(current: Checked) {
    const order = current.order;
    if (confirming !== order.id) {
      return (
        <Button type="button" onClick={() => setConfirming(order.id)} disabled={busy} data-testid="record-cash">
          Record cash received
        </Button>
      );
    }
    return (
      <div className="cashier-confirm space-y-3" data-testid="confirm-panel">
        <p className="text-sm font-medium leading-6">
          Count {formatInrFromPaise(order.total_paise)} in cash. Confirm only when you are holding it.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void confirmCash(current)} disabled={busy} data-testid="confirm-cash">
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
  const awaitingCount = data?.awaiting_payment.length ?? 0;
  const handoverCount = data?.awaiting_handover.length ?? 0;

  return (
    <section className="cashier-desk space-y-8" aria-labelledby="cashier-heading" data-testid="cashier-desk">
      <header className="cashier-hero relative overflow-hidden rounded-[2rem] border border-white/5 p-6 sm:p-8">
        <div className="cashier-hero-glow" aria-hidden="true" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-xl space-y-3">
            <p className="eyebrow">Cash counter</p>
            <h1 id="cashier-heading" className="font-display text-[clamp(2.2rem,5vw,3.6rem)] leading-[0.92] tracking-tight uppercase">
              Cashier desk
            </h1>
            <p className="text-sm leading-6 text-ivory/80" data-testid="cashier-live">
              {liveStatusLabel(live)} · Verify code → take cash → hand over.
            </p>
          </div>
          <Link href="/cashier/history" className="pill pill-ghost">
            My cash history
          </Link>
        </div>
        <ol className="cashier-steps relative z-10 mt-6" aria-label="Cashier workflow">
          <li>
            <span className="cashier-step-num">1</span>
            <span>Verify pickup code</span>
          </li>
          <li>
            <span className="cashier-step-num">2</span>
            <span>Record cash</span>
          </li>
          <li>
            <span className="cashier-step-num">3</span>
            <span>Hand over</span>
          </li>
        </ol>
      </header>

      {data ? (
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="cashier-stat" data-tone="pending">
            <dt className="eyebrow text-muted-foreground!">Waiting to be paid</dt>
            <dd className="mt-2 font-display text-4xl tracking-tight" data-testid="total-awaiting">
              {formatInrFromPaise(data.totals.awaiting_payment_paise)}
            </dd>
            <p className="mt-1 text-sm text-muted-foreground">
              {awaitingCount} ready order{awaitingCount === 1 ? "" : "s"} · scan code to collect
            </p>
          </div>
          <div className="cashier-stat" data-tone="recorded">
            <dt className="eyebrow text-muted-foreground!">Cash recorded today</dt>
            <dd className="mt-2 font-display text-4xl tracking-tight" data-testid="total-recorded">
              {formatInrFromPaise(data.totals.recorded_today_paise)}
            </dd>
            <p className="mt-1 text-sm text-muted-foreground">
              {handoverCount} waiting for handover · net of reversals
            </p>
          </div>
        </dl>
      ) : null}

      <div aria-live="polite" className="space-y-2">
        {notice ? (
          <p role="status" className="cashier-flash cashier-flash-ok text-sm" data-testid="cashier-notice">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="cashier-flash cashier-flash-bad text-sm text-destructive" data-testid="cashier-error">
            {error}
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="space-y-4">
          <section className="cashier-check space-y-5" aria-labelledby="check-heading">
            <div className="space-y-1">
              <p className="eyebrow">Step one · required</p>
              <h2 id="check-heading" className="font-display text-3xl tracking-tight uppercase">
                Check a pickup code
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Payment and handover stay locked until this check succeeds. Prefer the camera; use
                ticket + code when the lens is blocked.
              </p>
            </div>
            <QrScanner disabled={busy} onScan={(value) => void verify({ token: value })} />
            <form
              className="cashier-manual space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void verify({ ticket: ticket.trim(), code: code.trim() });
              }}
            >
              <p className="text-sm font-medium">Camera not working? Enter the code by hand.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm">
                  Ticket number
                  <input
                    value={ticket}
                    onChange={(event) => setTicket(event.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="cashier-input"
                    data-testid="manual-ticket"
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  Manual code
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="XXXX-XXXX-XXXX"
                    className="cashier-input"
                    data-testid="manual-code"
                  />
                </label>
              </div>
              <Button type="submit" disabled={busy || !ticket.trim() || !code.trim()} data-testid="manual-verify">
                Check code
              </Button>
            </form>
          </section>

          {checked ? (
            <section aria-labelledby="checked-heading" className="cashier-active space-y-3" data-testid="checked-order">
              <div className="space-y-1">
                <p className="eyebrow">At the counter</p>
                <h2 id="checked-heading" className="font-display text-3xl tracking-tight uppercase">
                  {checked.canConfirm ? "Collect payment" : "Hand over order"}
                </h2>
              </div>
              <ul>
                <OrderCard order={checked.order} highlight>
                  <div className="space-y-3 pt-2">
                    {checked.canConfirm ? (
                      <>
                        <p className="text-sm leading-6 text-muted-foreground">
                          Code verified. Payment is still pending — record the cash, then hand over.
                        </p>
                        {confirmPanel(checked)}
                      </>
                    ) : null}
                    {checked.canComplete ? (
                      <Button
                        type="button"
                        onClick={() => void completePickup(checked)}
                        disabled={busy}
                        data-testid="complete-pickup"
                      >
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

        <div className="space-y-4">
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
                render={() => (
                  <p className="text-sm leading-6 text-muted-foreground">
                    Scan or enter this student&apos;s pickup code first. Cash can only be recorded
                    after a valid check.
                  </p>
                )}
              />
              <OrderList
                id="awaiting-handover"
                title="Paid · waiting for handover"
                empty="No paid orders are waiting for handover."
                orders={data.awaiting_handover}
                render={() => (
                  <p className="text-sm leading-6 text-muted-foreground">
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
                  <p className="text-sm leading-6 text-muted-foreground">
                    Do not hand this over with an old QR. A manager reviews it. Cash is not reversed
                    automatically.
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
    <section aria-labelledby={`${id}-heading`} data-testid={id} className="cashier-queue space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-heading`} className="font-display text-2xl tracking-tight uppercase">
          {title}
        </h2>
        <span className="cashier-count">{orders.length}</span>
      </div>
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
