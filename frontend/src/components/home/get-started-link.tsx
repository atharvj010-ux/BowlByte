"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { fetchCurrentUser, homeForRole } from "@/lib/auth";

/** Landing CTA: signed-in visitors go to their desk; everyone else to sign-in. */
export function GetStartedLink({ className }: { className?: string }) {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchCurrentUser });
  const href = me.data ? homeForRole(me.data.role) : "/login";
  return (
    <Link href={href} className={className} prefetch={Boolean(me.data)}>
      Get started now
    </Link>
  );
}
