"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { historySchema } from "@/lib/cash";
import { formatInrFromPaise } from "@/lib/money";

const pageSize = 20;

export function CashHistory() {
  const [offset, setOffset] = useState(0);
  const history = useQuery({
    queryKey: ["cashier-history", offset],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/cashier/history?limit=${pageSize}&offset=${offset}`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return historySchema.parse(await response.json());
    },
  });
  if (history.isLoading) {
    return <p>Loading cash history.</p>;
  }
  if (history.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {history.error.message}
      </p>
    );
  }
  const data = history.data;
  if (!data) {
    return <p>Loading cash history.</p>;
  }
  return (
    <section className="space-y-4" aria-labelledby="history-heading">
      <h1 id="history-heading" className="font-display text-4xl">
        My cash history
      </h1>
      <p className="text-sm text-muted-foreground">
        Cash you confirmed at this counter. A reversed entry stays listed and is marked.
      </p>
      {data.transactions.length === 0 ? (
        <p className="text-sm text-muted-foreground">You have not recorded any cash yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-left text-sm" data-testid="history-table">
            <thead className="bg-muted text-xs uppercase">
              <tr>
                <th className="p-3">Receipt</th>
                <th className="p-3">Ticket</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Time</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((row) => (
                <tr key={row.id} className="border-t border-border" data-testid="history-row">
                  <td className="p-3 font-mono">{row.receipt_ref}</td>
                  <td className="p-3">{row.ticket_number}</td>
                  <td className="p-3">{formatInrFromPaise(row.amount_paise)}</td>
                  <td className="p-3">{new Date(row.received_at).toLocaleString()}</td>
                  <td className="p-3">{row.reversed ? "Reversed by manager" : "Recorded"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
          Newer
        </Button>
        <span className="text-sm text-muted-foreground">
          {data.total === 0 ? 0 : offset + 1}–{Math.min(offset + pageSize, data.total)} of {data.total}
        </span>
        <Button type="button" variant="outline" disabled={offset + pageSize >= data.total} onClick={() => setOffset(offset + pageSize)}>
          Older
        </Button>
      </div>
    </section>
  );
}
