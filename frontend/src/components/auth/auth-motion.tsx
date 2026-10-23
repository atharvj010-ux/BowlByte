"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

/** Soft staggered entrance for sign-in cards — visuals only. */
export function AuthStage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08, duration: 0.35 }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/** Unique mark while an OTP / email confirmation is in flight. */
export function OtpVerifyingMark({ label = "Verifying your code" }: { label?: string }) {
  return (
    <div className="auth-otp-verify" role="status" aria-live="polite" data-testid="otp-verifying">
      <div className="auth-otp-orbit" aria-hidden="true">
        <span className="auth-otp-ring" />
        <span className="auth-otp-ring auth-otp-ring-delay" />
        <span className="auth-otp-core">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
            <circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none" />
          </svg>
        </span>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <span
            key={index}
            className="auth-otp-dot"
            style={{ ["--otp-i" as string]: String(index) }}
          />
        ))}
      </div>
      <p className="font-mono text-[0.68rem] tracking-[0.16em] text-muted-foreground uppercase">
        {label}
      </p>
    </div>
  );
}

/** Unique celebration when OTP / email confirmation succeeds. */
export function AuthSuccessBurst({
  title = "You're in",
  detail = "Taking you to your desk…",
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <motion.div
      className="auth-success"
      role="status"
      aria-live="polite"
      data-testid="otp-success"
      initial={{ opacity: 0, scale: 0.88 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 20 }}
    >
      <div className="auth-success-burst" aria-hidden="true">
        {Array.from({ length: 8 }).map((_, index) => (
          <span key={index} className="auth-success-ray" style={{ ["--ray-i" as string]: String(index) }} />
        ))}
        <motion.span
          className="auth-success-mark"
          initial={{ scale: 0.4, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 460, damping: 16, delay: 0.05 }}
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.2">
            <motion.path
              d="M5 13l4 4L19 7"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.45, delay: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            />
          </svg>
        </motion.span>
      </div>
      <p className="font-display text-2xl font-extrabold tracking-tight uppercase">{title}</p>
      <p className="text-sm text-muted-foreground">{detail}</p>
    </motion.div>
  );
}

/** Cross-fade between idle form content and verifying / success stages. */
export function AuthPhase({
  phase,
  idle,
  verifying,
  success,
}: {
  phase: "idle" | "verifying" | "success";
  idle: ReactNode;
  verifying: ReactNode;
  success: ReactNode;
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={phase}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {phase === "verifying" ? verifying : phase === "success" ? success : idle}
      </motion.div>
    </AnimatePresence>
  );
}
