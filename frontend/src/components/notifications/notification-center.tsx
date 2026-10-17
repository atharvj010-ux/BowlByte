"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { unreadKey } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { notificationListSchema } from "@/lib/cash";
import { apiFetch, fetchCurrentUser, readError } from "@/lib/auth";
import { useLiveResource } from "@/lib/live";

export function NotificationCenter() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: fetchCurrentUser });
  const list = useQuery({
    queryKey: ["notifications", me.data?.id],
    enabled: Boolean(me.data?.id),
    queryFn: async () => {
      const response = await apiFetch("/api/v1/notifications?limit=50");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return notificationListSchema.parse(await response.json());
    },
  });
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["notifications", me.data?.id] });
    void queryClient.invalidateQueries({ queryKey: unreadKey });
  }, [me.data?.id, queryClient]);
  const live = useLiveResource("/api/v1/ws/notifications", refresh, Boolean(me.data?.id) && list.isSuccess);

  async function markRead(id: string) {
    const response = await apiFetch(`/api/v1/notifications/${id}/read`, { method: "POST" });
    if (!response.ok) {
      setMessage(await readError(response));
      return;
    }
    refresh();
  }

  async function markAll() {
    const response = await apiFetch("/api/v1/notifications/read-all", { method: "POST" });
    if (!response.ok) {
      setMessage(await readError(response));
      return;
    }
    setMessage("");
    refresh();
  }

  if (!me.data?.id || !list.isSuccess || !list.data) {
    return (
      <p role="alert" className="text-sm text-destructive" data-testid="notifications-denied">
        {list.isError ? list.error.message : "Sign in to see notifications."}
      </p>
    );
  }
  const data = list.data;
  return (
    <section className="space-y-4" aria-labelledby="notifications-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="notifications-heading" className="font-display text-4xl">
          Notifications
        </h1>
        <Button type="button" variant="outline" onClick={markAll} disabled={data.unread_count === 0}>
          Mark all as read
        </Button>
      </div>
      <p className="text-sm text-muted-foreground" data-testid="notification-live">
        {data.unread_count} unread · {live === "live" ? "Live updates connected" : "Checking for updates"}
      </p>
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      {data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="notifications-empty">
          No notifications yet. You will see a message here when your order is ready.
        </p>
      ) : (
        <ul className="grid gap-3">
          {data.items.map((item) => (
            <li
              key={item.id}
              data-testid="notification-item"
              data-read={item.read}
              className={`rounded-2xl border p-4 ${item.read ? "border-border bg-card" : "border-primary/50 bg-secondary"}`}
            >
              <p className="font-medium">
                {item.title}
                {item.read ? null : <span className="ml-2 text-xs text-accent">New</span>}
              </p>
              <p className="text-sm">{item.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.order_id ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/student/orders/${item.order_id}`}>Open order</Link>
                  </Button>
                ) : null}
                {item.read ? null : (
                  <Button type="button" size="sm" variant="outline" onClick={() => markRead(item.id)}>
                    Mark as read
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Notifications are a convenience. The order page always shows the real order and payment state.
      </p>
    </section>
  );
}
