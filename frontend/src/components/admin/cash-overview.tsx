"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
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

export function CashOverview() {
  const queryClient = useQueryClient();
  const today = isoDate(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reversing, setReversing] = useState<Receipt | null>(null);
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<"CASH_RETURNED" | "ERRONEOUS_ENTRY">("CASH_RETURNED");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey());

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
  });

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
    } finally {
      setBusy(false);
    }
  }

  const data = summary.data;
  return (
    <section className="space-y-6" aria-labelledby="cash-heading" data-testid="cash-overview">
      <div>
        <h1 id="cash-heading" className="font-display text-4xl">
          Cash
        </h1>
        <p className="text-sm text-muted-foreground">
          Cash that cashiers recorded at the counter. This is not a bank or till reconciliation.
        </p>
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => event.preventDefault()}>
        <label className="grid gap-1 text-sm">
          From
          <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="min-h-11 rounded-xl border border-border bg-card px-3" data-testid="cash-from" />
        </label>
        <label className="grid gap-1 text-sm">
          To
          <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="min-h-11 rounded-xl border border-border bg-card px-3" data-testid="cash-to" />
        </label>
      </form>
      {summary.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {summary.error.message}
        </p>
      ) : null}
      {data ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Order value placed" value={formatInrFromPaise(data.orders_placed_value_paise)} note={`${data.orders_placed} orders · not cash`} id="placed" />
            <Stat label="Cash recorded (gross)" value={formatInrFromPaise(data.gross_receipts_paise)} note={`${data.receipts_recorded} receipts`} id="gross" />
            <Stat label="Reversed" value={formatInrFromPaise(data.reversed_paise)} note={`${data.reversals_recorded} reversals`} id="reversed" />
            <Stat label="Net cash recorded" value={formatInrFromPaise(data.net_cash_paise)} note={`${data.paid_orders} paid orders`} id="net" />
            <Stat label="Ready, awaiting payment" value={String(data.ready_awaiting_payment)} note={`${formatInrFromPaise(data.ready_awaiting_payment_paise)} not yet cash`} id="awaiting-payment" />
            <Stat label="Paid, awaiting pickup" value={String(data.paid_awaiting_pickup)} note={formatInrFromPaise(data.paid_awaiting_pickup_paise)} id="awaiting-pickup" />
            <Stat label="Picked up" value={String(data.picked_up_orders)} note={formatInrFromPaise(data.picked_up_value_paise)} id="picked-up" />
          </dl>
          <p className="text-sm text-muted-foreground">{data.timezone_note}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{data.notes.recorded}</li>
            <li>{data.notes.pending}</li>
            <li>{data.notes.reconciliation}</li>
          </ul>
        </>
      ) : null}
      {message ? (
        <p role="status" className="rounded-xl border border-border p-3 text-sm" data-testid="cash-message">
          {message}
        </p>
      ) : null}
      <section className="space-y-3" aria-labelledby="receipts-heading">
        <h2 id="receipts-heading" className="font-display text-2xl">
          Cash receipts
        </h2>
        {transactions.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {transactions.error.message}
          </p>
        ) : null}
        {transactions.data && transactions.data.transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cash was recorded in this period.</p>
        ) : null}
        {transactions.data && transactions.data.transactions.length > 0 ? (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-left text-sm" data-testid="cash-table">
              <thead className="bg-muted text-xs uppercase">
                <tr>
                  <th className="p-3">Receipt</th>
                  <th className="p-3">Ticket</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Cashier</th>
                  <th className="p-3">Time</th>
                  <th className="p-3">Status</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {transactions.data.transactions.map((row) => (
                  <tr key={row.id} className="border-t border-border align-top" data-testid="cash-row" data-ticket={row.ticket_number}>
                    <td className="p-3 font-mono">{row.receipt_ref}</td>
                    <td className="p-3">{row.ticket_number}</td>
                    <td className="p-3">{formatInrFromPaise(row.amount_paise)}</td>
                    <td className="p-3">{row.cashier_name ?? "Unknown"}</td>
                    <td className="p-3">{new Date(row.received_at).toLocaleString()}</td>
                    <td className="p-3">
                      {row.reversed && row.reversal ? (
                        <span>
                          Reversed ({row.reversal.kind === "CASH_RETURNED" ? "cash returned" : "entered in error"}
                          ): {row.reversal.reason}
                        </span>
                      ) : (
                        "Recorded"
                      )}
                    </td>
                    <td className="p-3">
                      {row.reversed ? null : (
                        <Button type="button" size="sm" variant="outline" onClick={() => { setReversing(row); setMessage(""); }} data-testid="start-reverse">
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
      </section>
      {reversing ? (
        <form
          className="space-y-3 rounded-2xl border border-destructive/50 bg-card p-4"
          aria-labelledby="reverse-heading"
          data-testid="reverse-form"
          onSubmit={(event) => {
            event.preventDefault();
            void reverse();
          }}
        >
          <h2 id="reverse-heading" className="font-display text-2xl">
            Reverse receipt {reversing.receipt_ref}
          </h2>
          <p className="text-sm">
            Ticket {reversing.ticket_number}, {formatInrFromPaise(reversing.amount_paise)}. The receipt stays on record. The
            order goes back to payment pending. This is only possible before pickup.
          </p>
          <label className="grid gap-1 text-sm">
            Why is this being reversed?
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={300} required rows={3} className="rounded-xl border border-border bg-card p-3" data-testid="reverse-reason" />
          </label>
          <label className="grid gap-1 text-sm">
            What happened
            <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="min-h-11 rounded-xl border border-border bg-card px-3" data-testid="reverse-kind">
              <option value="CASH_RETURNED">The cash was returned to the student</option>
              <option value="ERRONEOUS_ENTRY">The cash entry was recorded by mistake</option>
            </select>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-5 w-5" data-testid="reverse-confirm" />
            <span>
              I confirm the cash was actually returned, or the entry was recorded in error.
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !confirmed || reason.trim().length < 5} data-testid="reverse-submit">
              Reverse this receipt
            </Button>
            <Button type="button" variant="outline" onClick={() => setReversing(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function Stat({ label, value, note, id }: { label: string; value: string; note: string; id: string }) {
  return (
    <div className="rounded-2xl border border-border p-4" data-testid={`stat-${id}`}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-display text-3xl">{value}</dd>
      <dd className="text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}
