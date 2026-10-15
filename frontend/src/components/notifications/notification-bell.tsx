"use client";

import Link from "next/link";
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { apiFetch } from "@/lib/auth";
import { useLiveResource } from "@/lib/live";

export const unreadKey = ["notifications-unread"] as const;

export function NotificationBell() {
  const queryClient = useQueryClient();
  const unread = useQuery({
    queryKey: unreadKey,
    queryFn: async () => {
      const response = await apiFetch("/api/v1/notifications/unread-count");
      if (!response.ok) {
        return 0;
      }
      return z.object({ unread_count: z.number().int() }).parse(await response.json()).unread_count;
    },
  });
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: unreadKey });
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }, [queryClient]);
  useLiveResource("/api/v1/ws/notifications", refresh);

  const count = unread.data ?? 0;
  return (
    <Link
      href="/student/notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
      className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-foreground/80 hover:bg-secondary hover:text-foreground"
      data-testid="notification-bell"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" strokeLinejoin="round" />
        <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
      </svg>
      {count > 0 ? (
        <span
          data-testid="unread-count"
          className="absolute top-1 right-1 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] leading-5 font-semibold text-accent-foreground"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
