"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { PasswordField, textInputClass } from "@/components/auth/password-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, currentUserSchema, homeForRole, loginFormSchema, readError } from "@/lib/auth";
import { z } from "zod";

export function LoginForm({ title, description }: { title: string; description: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);

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
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
