import { z } from "zod";

import { csrfCookieName, readCookie } from "@/lib/cookies";

export const accountRoles = ["STUDENT", "KITCHEN_STAFF", "CASHIER", "CANTEEN_MANAGER"] as const;

export const currentUserSchema = z.object({
  id: z.string(),
  full_name: z.string(),
  email: z.string(),
  role: z.enum(accountRoles),
  status: z.string(),
  canteen_id: z.string().nullable(),
});

export type CurrentUser = z.infer<typeof currentUserSchema>;

export const registrationPolicySchema = z.object({
  mode: z.enum(["disabled", "institutional_domain", "roster"]),
  open: z.boolean(),
  college_name: z.string(),
  email_domain: z.string().nullable(),
  enrollment_code_required: z.boolean(),
});

export type RegistrationPolicy = z.infer<typeof registrationPolicySchema>;

export const registerFormSchema = z
  .object({
    full_name: z.string().trim().min(1, "Enter your name.").max(120),
    email: z.string().trim().email("Enter a valid email address."),
    roll_number: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/, "Use letters, digits, or hyphens."),
    enrollment_code: z.string().optional(),
    password: z.string().min(12, "Use at least 12 characters.").max(128),
    confirm_password: z.string(),
  })
  .refine((value) => value.password === value.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords do not match.",
  });

export const loginFormSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password.").max(128),
});

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export function homeForRole(role: CurrentUser["role"]): string {
  switch (role) {
    case "STUDENT":
      return "/student";
    case "KITCHEN_STAFF":
      return "/staff";
    case "CASHIER":
      return "/cashier";
    case "CANTEEN_MANAGER":
      return "/admin";
  }
}

export function roleLabel(role: CurrentUser["role"]): string {
  switch (role) {
    case "STUDENT":
      return "Student";
    case "KITCHEN_STAFF":
      return "Kitchen staff";
    case "CASHIER":
      return "Cashier";
    case "CANTEEN_MANAGER":
      return "Canteen manager";
  }
}

export async function readError(response: Response): Promise<string> {
  try {
    const body = errorSchema.parse(await response.json());
    return body.error.message;
  } catch {
    return "The request could not be completed.";
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const token = readCookie(csrfCookieName());
    if (token) {
      headers.set("x-csrf-token", token);
    }
  }
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(path, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
}

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await apiFetch("/api/v1/auth/me");
  if (!response.ok) {
    return null;
  }
  const body = z.object({ user: currentUserSchema }).parse(await response.json());
  return body.user;
}
