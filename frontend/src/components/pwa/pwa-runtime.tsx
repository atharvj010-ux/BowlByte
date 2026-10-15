"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { fetchCurrentUser } from "@/lib/auth";
import { registerServiceWorker, resyncPush } from "@/lib/push";

/**
 * Registers the service worker (install + push) and keeps this browser's push
 * subscription attached to the signed-in student who turned notifications on.
 * It never asks for permission by itself.
 */
export function PwaRuntime() {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchCurrentUser });
  const studentId = me.data?.role === "STUDENT" ? me.data.id : null;

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  useEffect(() => {
    if (!studentId || !("serviceWorker" in navigator)) {
      return;
    }
    const sync = () => {
      void resyncPush(studentId).catch(() => undefined);
    };
    sync();
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === "PUSH_SUBSCRIPTION_CHANGED") {
        sync();
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [studentId]);

  return null;
}
