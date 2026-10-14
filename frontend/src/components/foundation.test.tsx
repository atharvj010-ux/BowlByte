import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { RoleScaffold } from "@/components/role-scaffold";
import { EmptyState } from "@/components/states/empty-state";
import { releaseNotes } from "@/lib/content";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

describe("foundation copy", () => {
  it("keeps cash recording out of this release", () => {
    expect(releaseNotes.unavailable).toContain("Cash recording, receipts, and QR pickup");
    expect(JSON.stringify(releaseNotes).toLowerCase()).not.toContain("razorpay");
    expect(JSON.stringify(releaseNotes).toLowerCase()).not.toContain("stripe");
  });
});

describe("EmptyState", () => {
  it("renders the empty title and description", () => {
    render(<EmptyState title="No orders" description="Nothing has been placed." />);

    expect(screen.getByRole("heading", { name: "No orders" })).toBeInTheDocument();
    expect(screen.getByText("Nothing has been placed.")).toBeInTheDocument();
  });
});

describe("RoleScaffold", () => {
  it("states that authentication is not implemented", () => {
    render(<RoleScaffold href="/cashier" />);

    expect(screen.getByRole("heading", { name: "Cashier" })).toBeInTheDocument();
    expect(screen.getByText(/Authentication is not implemented/)).toBeInTheDocument();
    expect(screen.getByText("No operational data")).toBeInTheDocument();
  });
});
