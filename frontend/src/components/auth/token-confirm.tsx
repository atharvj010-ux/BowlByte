"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { PasswordField, textInputClass } from "@/components/auth/password-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, readError } from "@/lib/auth";

let capturedToken = "";
const verificationRequests = new Map<string, Promise<{ ok: boolean; message: string }>>();

function verifyOnce(token: string): Promise<{ ok: boolean; message: string }> {
  const existing = verificationRequests.get(token);
  if (existing) {
    return existing;
  }
  const pending = apiFetch("/api/v1/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  }).then(async (response) => ({
    ok: response.ok,
    message: response.ok ? "Your email is confirmed. Sign in to continue." : await readError(response),
  }));
  verificationRequests.set(token, pending);
  return pending;
}

function takeToken(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const fromHash = new URLSearchParams(hash).get("token") ?? "";
  if (fromHash) {
    capturedToken = fromHash;
    window.history.replaceState(null, "", window.location.pathname);
  }
  return capturedToken;
}

export function VerifyEmailForm() {
  const [token, setToken] = useState("");
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const next = takeToken();
    if (next) {
      setToken(next);
    }
    setChecked(true);
  }, []);
  const [status, setStatus] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("Confirming your email.");
  const [email, setEmail] = useState("");
  const [resendMessage, setResendMessage] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    void verifyOnce(token).then((result) => {
      if (cancelled) {
        return;
      }
      setStatus(result.ok ? "done" : "error");
      setMessage(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResendMessage("");
    try {
      const response = await apiFetch("/api/v1/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setResendMessage(
        response.ok
          ? "If an unverified account exists, a new message has been sent."
          : await readError(response),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Confirm email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p role="status">
            {checked && token === ""
              ? "This page needs the confirmation link from your email."
              : status === "working"
                ? "Confirming your email…"
                : message}
          </p>
          {status === "done" ? (
            <Button asChild>
              <Link href="/student/login">Go to student sign-in</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
      {status === "error" || (checked && token === "") ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Send another link</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={resend} aria-busy={pending}>
              <label className="block space-y-2 text-sm" htmlFor="resend-email">
                <span className="font-medium">Email</span>
                <input
                  id="resend-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={textInputClass}
                />
              </label>
              <Button type="submit" disabled={pending}>
                {pending ? "Sending…" : "Resend"}
              </Button>
              {resendMessage ? <p className="text-sm">{resendMessage}</p> : null}
            </form>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}

export function AcceptInviteForm() {
  const [token, setToken] = useState("");
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const next = takeToken();
    if (next) {
      setToken(next);
    }
    setChecked(true);
  }, []);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!token) {
      setError("This page needs the invitation link from your email.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await apiFetch("/api/v1/auth/accept-invitation", {
        method: "POST",
        body: JSON.stringify({
          token,
          full_name: fullName,
          password,
          confirm_password: confirmPassword,
        }),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      setDone("Your staff account is active. Sign in with the email that received the invitation.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Accept staff invitation</CardTitle>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4" role="status">
              <p className="text-sm leading-6">{done}</p>
              <Button asChild>
                <Link href="/staff/login">Go to staff sign-in</Link>
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={onSubmit} aria-busy={pending}>
              <label className="block space-y-2 text-sm" htmlFor="staff-name">
                <span className="font-medium">Full name</span>
                <input
                  id="staff-name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className={textInputClass}
                />
              </label>
              <PasswordField
                id="staff-password"
                label="Password"
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
              />
              <PasswordField
                id="staff-confirm"
                label="Confirm password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={setConfirmPassword}
              />
              {error || (checked && token === "") ? (
                <p className="text-sm text-destructive" role="alert">
                  {error || "This page needs the invitation link from your email."}
                </p>
              ) : null}
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Saving…" : "Activate account"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
