"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, useState, type FormEvent } from "react";
import { z } from "zod";

import {
  AuthPhase,
  AuthStage,
  AuthSuccessBurst,
  OtpVerifyingMark,
} from "@/components/auth/auth-motion";
import { FreshRegistrationLink } from "@/components/auth/register-form";
import { armWelcome } from "@/components/auth/welcome";
import { PasswordField, textInputClass } from "@/components/auth/password-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  apiFetch,
  currentUserSchema,
  fetchCurrentUser,
  homeForRole,
  loginFormSchema,
  readError,
  roleLabel,
  type CurrentUser,
} from "@/lib/auth";
import { clearPrivateBrowserState } from "@/lib/session-privacy";
import { cn } from "@/lib/utils";

const desks = [
  { role: "KITCHEN_STAFF", label: "Kitchen" },
  { role: "CANTEEN_MANAGER", label: "Manager" },
  { role: "CASHIER", label: "Cashier" },
] as const;

type DeskRole = (typeof desks)[number]["role"];

const copy: Record<CurrentUser["role"], { title: string; description: string }> = {
  STUDENT: {
    title: "Student sign-in",
    description: "Use the email you confirmed. Unverified accounts cannot sign in.",
  },
  KITCHEN_STAFF: {
    title: "Kitchen sign-in",
    description: "Kitchen accounts are created from a manager invitation.",
  },
  CASHIER: {
    title: "Cashier sign-in",
    description: "Cashier accounts are created from a manager invitation.",
  },
  CANTEEN_MANAGER: {
    title: "Manager sign-in",
    description: "Manager accounts are created for the canteen. There is no public manager registration.",
  },
};

function choiceClass(selected: boolean): string {
  return cn(
    "min-h-11 rounded-full border px-3 text-sm font-medium transition-colors",
    selected
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-card text-foreground hover:bg-muted",
  );
}

export function LoginForm({ initialRole }: { initialRole: CurrentUser["role"] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [gate, setGate] = useState<"student" | "admin">(initialRole === "STUDENT" ? "student" : "admin");
  const [desk, setDesk] = useState<DeskRole>(initialRole === "STUDENT" ? "KITCHEN_STAFF" : initialRole);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpMessage, setOtpMessage] = useState("");
  const [otpPhase, setOtpPhase] = useState<"idle" | "verifying" | "success">("idle");
  // Hold the form until we know there is no session — avoids a login flash after "Get started".
  const [sessionGate, setSessionGate] = useState<"checking" | "ready" | "leaving">(
    () => (queryClient.getQueryData<CurrentUser | null>(["me"]) ? "leaving" : "checking"),
  );
  const role: CurrentUser["role"] = gate === "student" ? "STUDENT" : desk;
  useEffect(() => {
    let cancel = false;
    const cached = queryClient.getQueryData<CurrentUser | null>(["me"]);
    if (cached) {
      router.replace(homeForRole(cached.role));
      return;
    }
    void (async () => {
      try {
        const user = await fetchCurrentUser();
        if (cancel) {
          return;
        }
        if (user) {
          queryClient.setQueryData(["me"], user);
          setSessionGate("leaving");
          router.replace(homeForRole(user.role));
          return;
        }
      } catch {
        if (cancel) {
          return;
        }
      }
      queryClient.setQueryData(["me"], null);
      clearPrivateBrowserState();
      if (!cancel) {
        setSessionGate("ready");
      }
    })();
    return () => {
      cancel = true;
    };
  }, [queryClient, router]);

  const sessionNote = useSyncExternalStore(
    () => () => {},
    () =>
      new URLSearchParams(window.location.search).get("reason") === "expired"
        ? "Your session expired. Sign in again."
        : "",
    () => "",
  );

  async function enter(user: CurrentUser) {
    if (user.role !== role) {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
      queryClient.clear();
      clearPrivateBrowserState();
      setFormError(
        `This account is ${roleLabel(user.role).toLowerCase()}. Choose ${copy[user.role].title.replace(" sign-in", "")} and sign in again.`,
      );
      return;
    }
    armWelcome(user);
    queryClient.clear();
    clearPrivateBrowserState();
    queryClient.setQueryData(["me"], user);
    router.push(homeForRole(user.role));
    router.refresh();
  }

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
      await enter(body.user);
    } finally {
      setPending(false);
    }
  }

  if (sessionGate !== "ready") {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:px-6">
        <p className="text-sm text-muted-foreground" role="status">
          {sessionGate === "leaving" ? "Opening your desk…" : "Checking your session…"}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:px-6">
      <AuthStage>
        <Card>
          <CardHeader>
            <CardTitle>{copy[role].title}</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">{copy[role].description}</p>
          </CardHeader>
          <CardContent>
            <fieldset className="auth-login-field mb-4" style={{ animationDelay: "60ms" }}>
              <legend className="text-sm font-medium">Sign in as</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" className={choiceClass(gate === "student")} aria-pressed={gate === "student"} onClick={() => setGate("student")}>
                  Student
                </button>
                <button type="button" className={choiceClass(gate === "admin")} aria-pressed={gate === "admin"} onClick={() => setGate("admin")}>
                  Admin
                </button>
              </div>
            </fieldset>
            {gate === "admin" ? (
              <fieldset className="auth-login-field mb-4" style={{ animationDelay: "110ms" }}>
                <legend className="text-sm font-medium">Admin desk</legend>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {desks.map((item) => (
                    <button
                      key={item.role}
                      type="button"
                      className={choiceClass(desk === item.role)}
                      aria-pressed={desk === item.role}
                      onClick={() => setDesk(item.role)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <form className="space-y-4" onSubmit={onSubmit} aria-busy={pending}>
              <label className="auth-login-field block space-y-2 text-sm" htmlFor="email" style={{ animationDelay: "140ms" }}>
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
              <div className="auth-login-field" style={{ animationDelay: "190ms" }}>
                <PasswordField
                  id="password"
                  label="Password"
                  autoComplete="current-password"
                  value={password}
                  onChange={setPassword}
                  error={errors.password}
                />
              </div>
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
              <div className="auth-login-field" style={{ animationDelay: "240ms" }}>
                <Button type="submit" disabled={pending} className="w-full">
                  {pending ? "Signing in…" : "Sign in"}
                </Button>
              </div>
              <p className="auth-login-field text-center text-sm" style={{ animationDelay: "280ms" }}>
                <Link href="/forgot-password" className="underline-offset-4 hover:underline">
                  Forgot your password?
                </Link>
              </p>
              <p className="auth-login-field text-center text-sm text-muted-foreground" style={{ animationDelay: "320ms" }}>
                New here?{" "}
                <FreshRegistrationLink className="font-medium text-foreground underline-offset-4 hover:underline">
                  Create a student account
                </FreshRegistrationLink>
              </p>
            </form>
            <div className="auth-login-field mt-6 border-t border-border pt-6" style={{ animationDelay: "360ms" }}>
              <AuthPhase
                phase={otpPhase}
                verifying={<OtpVerifyingMark label="Checking your email code" />}
                success={
                  <AuthSuccessBurst title="Code confirmed" detail="Opening your desk…" />
                }
                idle={
                  <form
                    className="space-y-4"
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
                        setOtpPhase("verifying");
                        const response = await apiFetch("/api/v1/auth/email-otp/verify", {
                          method: "POST",
                          body: JSON.stringify({ email, code: otpCode }),
                        });
                        if (!response.ok) {
                          setOtpPhase("idle");
                          setOtpMessage(await readError(response));
                          return;
                        }
                        const body = z.object({ user: currentUserSchema }).parse(await response.json());
                        setOtpPhase("success");
                        await new Promise((resolve) => window.setTimeout(resolve, 900));
                        await enter(body.user);
                      } catch (error) {
                        setOtpPhase("idle");
                        setOtpMessage(error instanceof Error ? error.message : "That code could not be checked.");
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
                }
              />
            </div>
          </CardContent>
        </Card>
      </AuthStage>
    </main>
  );
}
