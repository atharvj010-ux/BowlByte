"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { PasswordField, textInputClass } from "@/components/auth/password-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, readError, registerFormSchema, registrationPolicySchema } from "@/lib/auth";

async function loadPolicy() {
  const response = await apiFetch("/api/v1/auth/registration-policy");
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return registrationPolicySchema.parse(await response.json());
}

export function FreshRegistrationLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Link
      href="/student/register"
      className={className}
      onClick={(event) => {
        event.preventDefault();
        router.push(`/student/register?attempt=${Date.now()}`);
      }}
    >
      {children}
    </Link>
  );
}

export function RegisterForm() {
  const attempt = useSearchParams().get("attempt") ?? "start";
  return <RegisterFields key={attempt} />;
}

function RegisterFields() {
  const policy = useQuery({ queryKey: ["registration-policy"], queryFn: loadPolicy });
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeMessage, setCodeMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = registerFormSchema.safeParse({
      full_name: fullName,
      email,
      roll_number: rollNumber,
      enrollment_code: enrollmentCode || undefined,
      password,
      confirm_password: confirmPassword,
    });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrors({
        full_name: fieldErrors.full_name?.[0] ?? "",
        email: fieldErrors.email?.[0] ?? "",
        roll_number: fieldErrors.roll_number?.[0] ?? "",
        password: fieldErrors.password?.[0] ?? "",
        confirm_password: fieldErrors.confirm_password?.[0] ?? "",
      });
      return;
    }
    if (policy.data?.enrollment_code_required && !enrollmentCode.trim()) {
      setErrors({ enrollment_code: "Enter the enrollment code from the college." });
      return;
    }
    setErrors({});
    setFormError("");
    setPending(true);
    try {
      const response = await apiFetch("/api/v1/auth/student/register", {
        method: "POST",
        body: JSON.stringify({
          ...parsed.data,
          enrollment_code: enrollmentCode.trim() || null,
        }),
      });
      if (!response.ok) {
        setFormError(await readError(response));
        return;
      }
      setRegisteredEmail(parsed.data.email.trim().toLowerCase());
      setCodeMessage("Enter the 6-digit code from your email.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Create a student account</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            {policy.data
              ? policy.data.mode === "open"
                ? "Use your name, email, and college roll number."
                : `${policy.data.college_name} students can register when eligibility is open.`
              : "Loading the college rules."}
          </p>
        </CardHeader>
        <CardContent>
          {policy.data && !policy.data.open ? (
            <p className="text-sm leading-6">
              Registration is closed until the college finishes eligibility setup.
            </p>
          ) : null}
          {registeredEmail ? (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setFormError("");
                setCodeMessage("");
                if (!/^\d{6}$/.test(code)) {
                  setFormError("Enter the 6-digit code from the email.");
                  return;
                }
                setPending(true);
                try {
                  const response = await apiFetch("/api/v1/auth/verify-email-code", {
                    method: "POST",
                    body: JSON.stringify({ email: registeredEmail, code }),
                  });
                  if (!response.ok) {
                    setFormError(await readError(response));
                    return;
                  }
                  setConfirmed(true);
                } finally {
                  setPending(false);
                }
              }}
            >
              {confirmed ? (
                <p className="text-sm leading-6" role="status">
                  Email confirmed.{" "}
                  <Link href="/login" className="underline-offset-4 hover:underline">
                    Sign in
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <p className="text-sm leading-6" role="status">
                    {codeMessage || "Enter the 6-digit code from your email."} Codes are sent to {registeredEmail}.
                  </p>
                  <Field
                    id="verification-code"
                    label="Email code"
                    value={code}
                    onChange={setCode}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                  />
                  {formError ? (
                    <p className="text-sm text-destructive" role="alert">
                      {formError}
                    </p>
                  ) : null}
                  <Button type="submit" disabled={pending} className="w-full">
                    {pending ? "Checking code…" : "Confirm email"}
                  </Button>
                  <p className="text-center text-sm">
                    <FreshRegistrationLink className="underline-offset-4 hover:underline">
                      Create a new account
                    </FreshRegistrationLink>
                  </p>
                  <button
                    type="button"
                    className="w-full text-sm underline-offset-4 hover:underline"
                    disabled={pending}
                    onClick={async () => {
                      setFormError("");
                      setPending(true);
                      try {
                        const response = await apiFetch("/api/v1/auth/resend-verification", {
                          method: "POST",
                          body: JSON.stringify({ email: registeredEmail }),
                        });
                        setCodeMessage(
                          response.ok
                            ? "If the account is still unverified, a new code has been sent."
                            : await readError(response),
                        );
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    Send a new code
                  </button>
                </>
              )}
            </form>
          ) : (
            <form className="space-y-4" onSubmit={onSubmit} aria-busy={pending}>
              <Field id="full-name" label="Full name" value={fullName} onChange={setFullName} error={errors.full_name} autoComplete="name" />
              <Field id="email" label="Email" type="email" value={email} onChange={setEmail} error={errors.email} autoComplete="email" />
              {policy.data?.mode === "institutional_domain" && policy.data.email_domain ? (
                <p className="text-sm text-muted-foreground">
                  Institutional mode accepts @{policy.data.email_domain}.
                </p>
              ) : null}
              <Field id="roll" label="College roll number" value={rollNumber} onChange={setRollNumber} error={errors.roll_number} autoComplete="off" />
              {policy.data?.enrollment_code_required ? (
                <PasswordField
                  id="enrollment-code"
                  label="Enrollment code"
                  autoComplete="off"
                  value={enrollmentCode}
                  onChange={setEnrollmentCode}
                  error={errors.enrollment_code}
                />
              ) : null}
              <PasswordField id="password" label="Password" autoComplete="new-password" value={password} onChange={setPassword} error={errors.password} />
              <PasswordField id="confirm-password" label="Confirm password" autoComplete="new-password" value={confirmPassword} onChange={setConfirmPassword} error={errors.confirm_password} />
              {formError ? (
                <p className="text-sm text-destructive" role="alert">
                  {formError}
                </p>
              ) : null}
              <Button type="submit" disabled={pending || policy.isLoading} className="w-full">
                {pending ? "Sending confirmation…" : "Create account"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  type = "text",
  autoComplete,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  autoComplete: string;
  inputMode?: "numeric" | "text";
}) {
  return (
    <label className="block space-y-2 text-sm" htmlFor={id}>
      <span className="font-medium">{label}</span>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={textInputClass}
      />
      {error ? <span className="block text-destructive">{error}</span> : null}
    </label>
  );
}
