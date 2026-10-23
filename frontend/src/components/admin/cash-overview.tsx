"use client";

import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState, Notice, PageHead, Panel, Segmented, SkeletonLines } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { textInputClass } from "@/components/auth/password-field";
import { apiFetch, readError } from "@/lib/auth";
import {
  cashSummarySchema,
  historySchema,
  isoDate,
  newKey,
  reverseSchema,
  type Receipt,
} from "@/lib/cash";
import { formatInrFromPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

type Preset = "today" | "7" | "30" | "custom";

function daysAgo(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return isoDate(date);
}

export function CashOverview() {
  const queryClient = useQueryClient();
  const today = isoDate(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [preset, setPreset] = useState<Preset>("today");
  const [reversing, setReversing] = useState<Receipt | null>(null);
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<"CASH_RETURNED" | "ERRONEOUS_ENTRY">("CASH_RETURNED");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey());
  const reverseFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (reversing) {
      reverseFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [reversing]);

  const query = `date_from=${from}&date_to=${to}`;
  const summary = useQuery({
    queryKey: ["cash-summary", from, to],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/admin/cash/summary?${query}`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return cashSummarySchema.parse(await response.json());
    },
    placeholderData: keepPreviousData,
  });
  const transactions = useQuery({
    queryKey: ["cash-transactions", from, to],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/admin/cash/transactions?${query}&limit=50`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return historySchema.parse(await response.json());
    },
    placeholderData: keepPreviousData,
  });

  function choosePreset(next: Preset) {
    setPreset(next);
    if (next === "custom") {
      return;
    }
    setTo(today);
    setFrom(next === "today" ? today : daysAgo(today, Number(next) - 1));
  }

  async function reverse() {
    if (!reversing) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch(`/api/v1/admin/cash/${reversing.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason, kind, confirm: true, idempotency_key: key }),
      });
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      reverseSchema.parse(await response.json());
      setMessage(
        `Receipt ${reversing.receipt_ref} reversed. Order ${reversing.ticket_number} is waiting for payment again.`,
      );
      setReversing(null);
      setReason("");
      setConfirmed(false);
      setKey(newKey());
      await queryClient.invalidateQueries({ queryKey: ["cash-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["cash-transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["mgr", "cash"] });
    } finally {
      setBusy(false);
    }
  }

  const data = summary.data;
  const receipts = transactions.data?.transactions ?? [];
  return (
    <section className="grid gap-4" aria-labelledby="cash-heading" data-testid="cash-overview">
      <PageHead
        kicker="Money · counter only"
        title="Cash"
        titleId="cash-heading"
        description="Cash that cashiers recorded at the counter. This is not a bank or till reconciliation."
        actions={
          <Segmented<Preset>
            label="Cash period"
            value={preset}
            onChange={choosePreset}
            options={[
              { value: "today", label: "Today" },
              { value: "7", label: "7 days" },
              { value: "30", label: "30 days" },
              { value: "custom", label: "Custom" },
            ]}
          />
        }
      />
      <form className="mgr-toolbar" onSubmit={(event) => event.preventDefault()}>
        <label className="mgr-field">
          <span>From</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(event) => {
              setFrom(event.target.value);
              setPreset("custom");
            }}
            className={textInputClass}
            data-testid="cash-from"
          />
        </label>
        <label className="mgr-field">
          <span>To</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(event) => {
              setTo(event.target.value);
              setPreset("custom");
            }}
            className={textInputClass}
            data-testid="cash-to"
          />
        </label>
      </form>
      {summary.isError ? <Notice tone="error">{summary.error.message}</Notice> : null}
      {summary.isLoading ? <SkeletonLines count={2} /> : null}
      {data ? (
        <>
          <dl className={cn("mgr-stats", summary.isPlaceholderData && "is-stale")}>
            <Stat label="Net cash recorded" value={formatInrFromPaise(data.net_cash_paise)} note={`${data.paid_orders} paid orders`} id="net" tone="#3df28b" />
            <Stat label="Cash recorded (gross)" value={formatInrFromPaise(data.gross_receipts_paise)} note={`${data.receipts_recorded} receipts`} id="gross" tone="#d5f25b" />
            <Stat label="Reversed" value={formatInrFromPaise(data.reversed_paise)} note={`${data.reversals_recorded} reversals`} id="reversed" tone="#ff5c8a" />
            <Stat label="Order value placed" value={formatInrFromPaise(data.orders_placed_value_paise)} note={`${data.orders_placed} orders · not cash`} id="placed" tone="#4aa8ff" />
            <Stat label="Ready, awaiting payment" value={String(data.ready_awaiting_payment)} note={`${formatInrFromPaise(data.ready_awaiting_payment_paise)} not yet cash`} id="awaiting-payment" tone="#f6d15a" />
            <Stat label="Paid, awaiting pickup" value={String(data.paid_awaiting_pickup)} note={formatInrFromPaise(data.paid_awaiting_pickup_paise)} id="awaiting-pickup" tone="#8cc8ff" />
            <Stat label="Picked up" value={String(data.picked_up_orders)} note={formatInrFromPaise(data.picked_up_value_paise)} id="picked-up" tone="#6ff5a8" />
          </dl>
          <ul className="mgr-footnotes">
            <li>{data.timezone_note}</li>
            <li>{data.notes.recorded}</li>
            <li>{data.notes.pending}</li>
            <li>{data.notes.reconciliation}</li>
          </ul>
        </>
      ) : null}
      {message ? (
        <p role="status" className="mgr-notice is-success" data-testid="cash-message">
          {message}
        </p>
      ) : null}

      {reversing ? (
        <form
          ref={reverseFormRef}
          className="mgr-card has-tone"
          style={{ ["--tone" as string]: "#ff5c8a" }}
          aria-labelledby="reverse-heading"
          data-testid="reverse-form"
          onSubmit={(event) => {
            event.preventDefault();
            void reverse();
          }}
        >
          <div className="mgr-card-head">
            <div>
              <h2 id="reverse-heading" className="mgr-card-title">
                Reverse receipt {reversing.receipt_ref}
              </h2>
              <p className="mgr-card-sub">
                Ticket {reversing.ticket_number}, {formatInrFromPaise(reversing.amount_paise)}. The receipt stays on
                record. The order goes back to payment pending. This is only possible before pickup.
              </p>
            </div>
          </div>
          <div className="mgr-form-grid">
            <label className="mgr-field is-wide">
              <span>Why is this being reversed?</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={5}
                maxLength={300}
                required
                rows={3}
                className={cn(textInputClass, "py-2.5")}
                data-testid="reverse-reason"
              />
            </label>
            <label className="mgr-field is-wide">
              <span>What happened</span>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as typeof kind)}
                className={textInputClass}
                data-testid="reverse-kind"
              >
                <option value="CASH_RETURNED">The cash was returned to the student</option>
                <option value="ERRONEOUS_ENTRY">The cash entry was recorded by mistake</option>
              </select>
            </label>
          </div>
          <label className="mgr-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              data-testid="reverse-confirm"
            />
            <span>I confirm the cash was actually returned, or the entry was recorded in error.</span>
          </label>
          <div className="mgr-actions">
            <Button type="submit" disabled={busy || !confirmed || reason.trim().length < 5} data-testid="reverse-submit">
              Reverse this receipt
            </Button>
            <Button type="button" variant="outline" onClick={() => setReversing(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <section aria-labelledby="receipts-heading">
        <Panel
          title="Cash receipts"
          titleId="receipts-heading"
          subtitle="Each counter payment, newest first. Reverse only when cash went back or the entry was a mistake."
          action={transactions.data ? <span className="mgr-badge is-info">{receipts.length} shown</span> : null}
        >
          {transactions.isError ? <Notice tone="error">{transactions.error.message}</Notice> : null}
          {transactions.isLoading ? <SkeletonLines count={3} /> : null}
          {transactions.data && receipts.length === 0 ? <EmptyState>No cash was recorded in this period.</EmptyState> : null}
          {receipts.length > 0 ? (
            <div className={cn("mgr-table-wrap", transactions.isPlaceholderData && "is-stale")}>
              <table className="mgr-table" data-testid="cash-table">
                <thead>
                  <tr>
                    <th scope="col">Receipt</th>
                    <th scope="col">Ticket</th>
                    <th scope="col" className="is-num">
                      Amount
                    </th>
                    <th scope="col">Cashier</th>
                    <th scope="col">Time</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((row) => (
                    <tr key={row.id} data-testid="cash-row" data-ticket={row.ticket_number}>
                      <td className="mgr-mono">{row.receipt_ref}</td>
                      <td>
                        <span className="mgr-ticket">{row.ticket_number}</span>
                      </td>
                      <td className="is-num">{formatInrFromPaise(row.amount_paise)}</td>
                      <td>{row.cashier_name ?? "Unknown"}</td>
                      <td className="whitespace-nowrap">
                        {new Date(row.received_at).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td>
                        {row.reversed && row.reversal ? (
                          <span className="grid gap-1">
                            <span className="mgr-badge is-bad w-fit">Reversed</span>
                            <span className="mgr-cell-sub">
                              {row.reversal.kind === "CASH_RETURNED" ? "Cash returned" : "Entered in error"}:{" "}
                              {row.reversal.reason}
                            </span>
                          </span>
                        ) : (
                          <span className="mgr-badge is-good">Recorded</span>
                        )}
                      </td>
                      <td className="is-num">
                        {row.reversed ? null : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setReversing(row);
                              setMessage("");
                            }}
                            data-testid="start-reverse"
                          >
                            Reverse
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>
      </section>
    </section>
  );
}

function Stat({
  label,
  value,
  note,
  id,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  id: string;
  tone: string;
}) {
  return (
    <div className="mgr-stat" style={{ ["--tone" as string]: tone }} data-testid={`stat-${id}`}>
      <dt className="mgr-stat-label">{label}</dt>
      <dd className="mgr-stat-value">{value}</dd>
      <dd className="mgr-stat-note">{note}</dd>
    </div>
  );
}
