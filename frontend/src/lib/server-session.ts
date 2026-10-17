import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";

import { currentUserSchema, type CurrentUser } from "@/lib/auth";
import { sessionCookieName } from "@/lib/cookies";

export type Access =
  | { kind: "anonymous"; expired: boolean }
  | { kind: "forbidden"; user: CurrentUser }
  | { kind: "ok"; user: CurrentUser };

export async function fetchServerUser(): Promise<CurrentUser | null> {
  await connection();
  const jar = await cookies();
  const session = jar.get(sessionCookieName())?.value;
  if (!session) {
    return null;
  }
  const base = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8010";
  const response = await fetch(`${base}/api/v1/auth/me`, {
    headers: { cookie: `${sessionCookieName()}=${encodeURIComponent(session)}` },
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }
  const parsed = z.object({ user: currentUserSchema }).safeParse(await response.json());
  return parsed.success ? parsed.data.user : null;
}

export async function requireRole(role: CurrentUser["role"]): Promise<Access> {
  await connection();
  const jar = await cookies();
  const expired = Boolean(jar.get(sessionCookieName())?.value);
  const user = await fetchServerUser();
  if (!user) {
    return { kind: "anonymous", expired };
  }
  if (user.role !== role) {
    return { kind: "forbidden", user };
  }
  return { kind: "ok", user };
}

export function redirectToLogin(loginHref: string, expired = false): never {
  const target = expired ? `${loginHref}?reason=expired` : loginHref;
  redirect(target);
}
