"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import { roleLabel, type CurrentUser } from "@/lib/auth";

export const WELCOME_KEY = "bowlbyte.welcome.v1";

type WelcomePayload = { name: string; role: CurrentUser["role"] };

export function armWelcome(user: Pick<CurrentUser, "full_name" | "role">): void {
  const payload: WelcomePayload = { name: user.full_name, role: user.role };
  window.sessionStorage.setItem(WELCOME_KEY, JSON.stringify(payload));
  window.dispatchEvent(new Event("bowlbyte-welcome"));
}

export function WelcomeSplash() {
  const [welcome, setWelcome] = useState<WelcomePayload | null>(null);

  useEffect(() => {
    function show() {
      const raw = window.sessionStorage.getItem(WELCOME_KEY);
      if (!raw) {
        return;
      }
      window.sessionStorage.removeItem(WELCOME_KEY);
      try {
        const parsed = JSON.parse(raw) as WelcomePayload;
        if (parsed.name && parsed.role) {
          setWelcome(parsed);
        }
      } catch {
        setWelcome(null);
      }
    }
    show();
    window.addEventListener("bowlbyte-welcome", show);
    return () => window.removeEventListener("bowlbyte-welcome", show);
  }, []);

  useEffect(() => {
    if (!welcome) {
      return;
    }
    const timer = window.setTimeout(() => setWelcome(null), 2600);
    return () => window.clearTimeout(timer);
  }, [welcome]);

  return (
    <AnimatePresence>
      {welcome ? (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
          <motion.div
            data-testid="welcome"
            role="status"
            initial={{ opacity: 0, y: -16, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 22 }}
            className="flex items-center gap-3 rounded-3xl border border-border bg-card px-4 py-3 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.7)]"
          >
            <motion.span
              aria-hidden="true"
              initial={{ rotate: -18, scale: 0.6 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 14 }}
              className="grid h-11 w-11 place-items-center rounded-2xl bg-chili text-ivory"
            >
              <svg viewBox="0 0 32 32" className="h-7 w-7">
                <path d="M7 14h18c0 6.2-4 11-9 11s-9-4.8-9-11z" fill="#f4eddd" />
                <path d="M10 14c1.4-3.2 10.6-3.2 12 0" fill="none" stroke="#191919" strokeWidth="1.6" />
              </svg>
            </motion.span>
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Welcome</p>
              <p className="font-display text-xl leading-tight">{welcome.name}</p>
              <p className="text-sm text-muted-foreground">{roleLabel(welcome.role)}</p>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
