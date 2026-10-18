"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore, useState, type FormEvent } from "react";

import { PasswordField, textInputClass } from "@/components/auth/password-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, currentUserSchema, homeForRole, loginFormSchema, readError } from "@/lib/auth";
import { clearPrivateBrowserState } from "@/lib/session-privacy";
import { z } from "zod";

export function LoginForm({ title, description }: { title: string; description: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpMessage, setOtpMessage] = useState("");
  const sessionNote = useSyncExternalStore(
    () => () => {},
    () =>
      new URLSearchParams(window.location.search).get("reason") === "expired"
        ? "Your session expired. Sign in again."
        : "",
    () => "",
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = loginFormSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrors({
        email: fieldErrors.email?.[0] ?? "",
        password: fieldErrors.password?.[0] ?? "",
      });
      return;
    }
    setErrors({});
    setFormError("");
    setPending(true);
    try {
      const response = await apiFetch("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        setFormError(await readError(response));
        return;
      }
      const body = z.object({ user: currentUserSchema }).parse(await response.json());
      queryClient.clear();
      clearPrivateBrowserState();
      queryClient.setQueryData(["me"], body.user);
      router.push(homeForRole(body.user.role));
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit} aria-busy={pending}>
            <label className="block space-y-2 text-sm" htmlFor="email">
              <span className="font-medium">Email</span>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={textInputClass}
              />
              {errors.email ? <span className="block text-destructive">{errors.email}</span> : null}
            </label>
            <PasswordField
              id="password"
              label="Password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              error={errors.password}
            />
            {sessionNote ? (
              <p className="text-sm" role="status">
                {sessionNote}
              </p>
            ) : null}
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-center text-sm">
              <Link href="/forgot-password" className="underline-offset-4 hover:underline">
                Forgot your password?
              </Link>
            </p>
          </form>
          <form
            className="mt-6 space-y-4 border-t border-border pt-6"
            onSubmit={async (event) => {
              event.preventDefault();
              setOtpMessage("");
              setPending(true);
              try {
                if (!otpCode) {
                  const response = await apiFetch("/api/v1/auth/email-otp", {
                    method: "POST",
                    body: JSON.stringify({ email }),
                  });
                  setOtpMessage(
                    response.ok
                      ? "If an eligible account exists, a sign-in code has been sent."
                      : await readError(response),
                  );
                  return;
                }
                const response = await apiFetch("/api/v1/auth/email-otp/verify", {
                  method: "POST",
                  body: JSON.stringify({ email, code: otpCode }),
                });
                if (!response.ok) {
                  setOtpMessage(await readError(response));
                  return;
                }
                const body = z.object({ user: currentUserSchema }).parse(await response.json());
                queryClient.clear();
                clearPrivateBrowserState();
                queryClient.setQueryData(["me"], body.user);
                router.push(homeForRole(body.user.role));
                router.refresh();
              } finally {
                setPending(false);
              }
            }}
          >
            <p className="text-sm leading-6 text-muted-foreground">
              Existing accounts can request a one-time email code. This does not create an account.
            </p>
            <label className="block space-y-2 text-sm" htmlFor="otp-code">
              <span className="font-medium">Email code</span>
              <input
                id="otp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value)}
                className={textInputClass}
              />
            </label>
            {otpMessage ? (
              <p className="text-sm" role="status">
                {otpMessage}
              </p>
            ) : null}
            <Button type="submit" disabled={pending || !email} variant="secondary" className="w-full">
              {otpCode ? "Verify code" : "Email me a code"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
