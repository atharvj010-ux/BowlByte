"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
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

export function RegisterForm() {
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
  const [done, setDone] = useState("");

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
      const body = (await response.json()) as { message?: string };
      setDone(body.message ?? "Check your email for the confirmation link.");
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
              ? `${policy.data.college_name} students can register when eligibility is open.`
              : "Loading the college rules."}
          </p>
        </CardHeader>
        <CardContent>
          {policy.data && !policy.data.open ? (
            <p className="text-sm leading-6">
              Registration is closed until the college finishes eligibility setup.
            </p>
          ) : null}
          {done ? (
            <div className="space-y-4" role="status">
              <p className="text-sm leading-6">{done}</p>
              <p className="text-sm">
                Open the link from the email, then{" "}
                <Link href="/student/login" className="underline-offset-4 hover:underline">
                  sign in
                </Link>
                .
              </p>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={onSubmit} aria-busy={pending}>
              <Field id="full-name" label="Full name" value={fullName} onChange={setFullName} error={errors.full_name} autoComplete="name" />
              <Field id="email" label="Email" type="email" value={email} onChange={setEmail} error={errors.email} autoComplete="email" />
              {policy.data?.email_domain ? (
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  autoComplete: string;
}) {
  return (
    <label className="block space-y-2 text-sm" htmlFor={id}>
      <span className="font-medium">{label}</span>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={textInputClass}
      />
      {error ? <span className="block text-destructive">{error}</span> : null}
    </label>
  );
}
