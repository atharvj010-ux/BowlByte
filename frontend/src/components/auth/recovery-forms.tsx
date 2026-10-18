"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { PasswordField, textInputClass } from "@/components/auth/password-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, readError } from "@/lib/auth";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/v1/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMessage(
        response.ok
          ? "If an account can be recovered, a message has been sent."
          : await readError(response),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:px-6">
      <Card>
        <CardHeader>
          <p className="font-mono text-[0.68rem] tracking-[0.16em] text-muted-foreground uppercase">BowlByte</p>
          <CardTitle>Forgot your password?</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            Enter the email on your account. The reply is the same whether or not that address is registered.
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit} aria-busy={pending}>
            <label className="block space-y-2 text-sm" htmlFor="email">
              <span className="font-medium">Email</span>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={textInputClass}
              />
            </label>
            {message ? (
              <p className="text-sm" role="status">
                {message}
              </p>
            ) : null}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Sending…" : "Send recovery email"}
            </Button>
            <p className="text-center text-sm">
              <Link href="/student/login" className="underline-offset-4 hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

export function ResetPasswordForm() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);
    const recovery = params.get("type") === "recovery" ? (params.get("access_token") ?? "") : "";
    const fromHash = params.get("token") || recovery;
    if (fromHash) {
      setToken(fromHash);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (password.length < 12) {
      setMessage("Use at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setMessage("Passwords do not match.");
      return;
    }
    if (!token) {
      setMessage("This recovery link is invalid or has expired.");
      return;
    }
    setPending(true);
    try {
      const response = await apiFetch("/api/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password, confirm_password: confirm }),
      });
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      setDone(true);
      setMessage("Your password has been changed. Sign in with the new password.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:px-6">
      <Card>
        <CardHeader>
          <p className="font-mono text-[0.68rem] tracking-[0.16em] text-muted-foreground uppercase">BowlByte</p>
          <CardTitle>New password</CardTitle>
        </CardHeader>
        <CardContent>
          {done ? (
            <p className="space-y-4 text-sm" role="status">
              {message}{" "}
              <Link href="/student/login" className="underline-offset-4 hover:underline">
                Sign in
              </Link>
            </p>
          ) : (
            <form className="space-y-4" onSubmit={onSubmit} aria-busy={pending}>
              <PasswordField
                id="password"
                label="New password"
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
              />
              <PasswordField
                id="confirm-password"
                label="Confirm password"
                autoComplete="new-password"
                value={confirm}
                onChange={setConfirm}
              />
              {message ? (
                <p className="text-sm text-destructive" role="alert">
                  {message}
                </p>
              ) : null}
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Saving…" : "Save password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
