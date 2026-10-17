"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { csrfCookieName, readCookie } from "@/lib/cookies";
import { clearPrivateBrowserState, isPrivatePath, loginHrefFor } from "@/lib/session-privacy";

export const SESSION_EPOCH_KEY = "bowlbyte-session-epoch";

/** Drop private client state when the session cookie pair is gone or another tab signs out. */
export function SessionPrivacy() {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    function purge(redirect: boolean) {
      queryClient.clear();
      clearPrivateBrowserState();
      if (!redirect || !isPrivatePath(window.location.pathname)) {
        return;
      }
      router.replace(loginHrefFor(window.location.pathname));
      router.refresh();
    }

    function signedOut() {
      return readCookie(csrfCookieName()) === "";
    }

    function onStorage(event: StorageEvent) {
      if (event.key === SESSION_EPOCH_KEY) {
        purge(true);
      }
    }

    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted && signedOut()) {
        purge(true);
      }
    }

    if (signedOut() && isPrivatePath(window.location.pathname)) {
      purge(true);
    }

    const watch = window.setInterval(() => {
      if (signedOut() && isPrivatePath(window.location.pathname)) {
        purge(true);
      }
    }, 4000);

    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.clearInterval(watch);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [queryClient, router]);

  return null;
}
