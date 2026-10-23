"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { EmptyState, Notice, Panel, Segmented, SkeletonLines, StatGrid, StatTile } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { textInputClass } from "@/components/auth/password-field";
import { apiFetch, readError, roleLabel } from "@/lib/auth";
import { cn } from "@/lib/utils";

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

function statusTone(status: string): string {
  if (status === "ACTIVE") {
    return "is-good";
  }
  if (status === "DISABLED" || status === "INACTIVE") {
    return "is-bad";
  }
  return "is-warn";
}

type RoleFilter = "" | "KITCHEN_STAFF" | "CASHIER";

export function StaffDesk() {
  const queryClient = useQueryClient();
  const staff = useQuery({ queryKey: ["staff"], queryFn: loadStaff });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"KITCHEN_STAFF" | "CASHIER">("KITCHEN_STAFF");
  const [message, setMessage] = useState("");
  const [show, setShow] = useState<RoleFilter>("");
  const [find, setFind] = useState("");

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

  const members = staff.data?.staff ?? [];
  const counts = {
    active: members.filter((member) => member.status === "ACTIVE").length,
    kitchen: members.filter((member) => member.role === "KITCHEN_STAFF").length,
    cashier: members.filter((member) => member.role === "CASHIER").length,
  };
  const needle = find.trim().toLowerCase();
  const visible = members.filter(
    (member) =>
      (!show || member.role === show) &&
      (!needle || member.full_name.toLowerCase().includes(needle) || member.email.toLowerCase().includes(needle)),
  );

  return (
    <section className="grid gap-4" aria-labelledby="staff-heading">
      <StatGrid>
        <StatTile label="Active accounts" value={staff.data ? counts.active : "—"} note="Can sign in now" tone="#3df28b" />
        <StatTile label="Kitchen" value={staff.data ? counts.kitchen : "—"} note="Cook and run the queue" tone="#ff5c8a" />
        <StatTile label="Cashiers" value={staff.data ? counts.cashier : "—"} note="Take cash at the counter" tone="#d5f25b" />
      </StatGrid>

      <div className="mgr-split">
        <Panel title="Invite someone" subtitle="They receive a one-time link by email to set their password." tone="#ff8d7a">
          <form
            className="mgr-form"
            onSubmit={(event) => {
              event.preventDefault();
              setMessage("");
              invite.mutate();
            }}
          >
            <label className="mgr-field">
              <span>Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={textInputClass}
                placeholder="name@college.edu"
              />
            </label>
            <label className="mgr-field">
              <span>Role</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as "KITCHEN_STAFF" | "CASHIER")}
                className={textInputClass}
              >
                <option value="KITCHEN_STAFF">Kitchen staff</option>
                <option value="CASHIER">Cashier</option>
              </select>
            </label>
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending ? "Sending…" : "Invite"}
            </Button>
          </form>
          {message ? <Notice tone={invite.isError ? "error" : "success"}>{message}</Notice> : null}
        </Panel>

        <Panel
          title="Staff"
          titleId="staff-heading"
          subtitle={staff.data ? `${visible.length} of ${members.length} people` : "Loading the team"}
          action={
            <Segmented<RoleFilter>
              label="Show role"
              value={show}
              onChange={setShow}
              options={[
                { value: "", label: "All", count: members.length },
                { value: "KITCHEN_STAFF", label: "Kitchen", count: counts.kitchen },
                { value: "CASHIER", label: "Cashier", count: counts.cashier },
              ]}
            />
          }
        >
          <input
            type="search"
            className="mgr-search"
            value={find}
            onChange={(event) => setFind(event.target.value)}
            placeholder="Find by name or email"
            aria-label="Find a person"
          />
          {staff.isLoading ? <SkeletonLines count={3} /> : null}
          {staff.isError ? <Notice tone="error">{staff.error.message}</Notice> : null}
          {setStatus.isError ? <Notice tone="error">{setStatus.error.message}</Notice> : null}
          {staff.data && visible.length === 0 ? (
            <EmptyState>{members.length === 0 ? "Nobody has been invited yet." : "Nobody matches."}</EmptyState>
          ) : null}
          <ul className="mgr-list">
            {visible.map((member) => (
              <li key={member.id} className={cn("mgr-list-row", member.status !== "ACTIVE" && "is-dim")}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="mgr-side-avatar" aria-hidden="true">
                    {member.full_name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <div className="min-w-0">
                    <p className="mgr-row-title truncate">{member.full_name}</p>
                    <p className="mgr-row-meta truncate">{member.email}</p>
                    <span className="mgr-badges mt-1.5">
                      <span className="mgr-badge is-info">{roleLabel(member.role)}</span>
                      <span className={cn("mgr-badge", statusTone(member.status))}>{member.status}</span>
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
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
        </Panel>
      </div>
    </section>
  );
}
