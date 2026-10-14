"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { textInputClass } from "@/components/auth/password-field";
import { apiFetch, readError, roleLabel } from "@/lib/auth";

const staffSchema = z.object({
  staff: z.array(
    z.object({
      id: z.string(),
      full_name: z.string(),
      email: z.string(),
      role: z.enum(["KITCHEN_STAFF", "CASHIER"]),
      status: z.string(),
      canteen_id: z.string(),
    }),
  ),
});

async function loadStaff() {
  const response = await apiFetch("/api/v1/admin/staff");
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return staffSchema.parse(await response.json());
}

export function StaffDesk() {
  const queryClient = useQueryClient();
  const staff = useQuery({ queryKey: ["staff"], queryFn: loadStaff });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"KITCHEN_STAFF" | "CASHIER">("KITCHEN_STAFF");
  const [message, setMessage] = useState("");

  const invite = useMutation({
    mutationFn: async () => {
      const response = await apiFetch("/api/v1/admin/staff/invitations", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
    },
    onSuccess: async () => {
      setMessage("Invitation sent. The link is only in the email.");
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "inactive" }) => {
      const response = await apiFetch(`/api/v1/admin/staff/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
  });

  return (
    <section className="space-y-6" aria-labelledby="staff-heading">
      <h2 id="staff-heading" className="font-display text-2xl">
        Staff
      </h2>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage("");
          invite.mutate();
        }}
      >
        <label className="space-y-2 text-sm">
          <span className="font-medium">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={textInputClass}
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">Role</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as "KITCHEN_STAFF" | "CASHIER")}
            className={textInputClass}
          >
            <option value="KITCHEN_STAFF">Kitchen staff</option>
            <option value="CASHIER">Cashier</option>
          </select>
        </label>
        <Button type="submit" disabled={invite.isPending} className="self-end">
          {invite.isPending ? "Sending…" : "Invite"}
        </Button>
      </form>
      {message ? <p className="text-sm">{message}</p> : null}
      {staff.isLoading ? <p>Loading staff.</p> : null}
      {staff.isError ? <p className="text-sm text-destructive">{staff.error.message}</p> : null}
      <ul className="grid gap-3">
        {staff.data?.staff.map((member) => (
          <li key={member.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{member.full_name}</p>
              <p className="text-sm text-muted-foreground">
                {member.email} · {roleLabel(member.role)} · {member.status}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={setStatus.isPending}
              onClick={() =>
                setStatus.mutate({
                  id: member.id,
                  status: member.status === "ACTIVE" ? "inactive" : "active",
                })
              }
            >
              {member.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
