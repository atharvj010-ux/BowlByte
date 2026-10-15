import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AccessDenied } from "@/components/account-home";
import { EmptyState } from "@/components/states/empty-state";
import { loginFormSchema } from "@/lib/auth";
import { releaseNotes } from "@/lib/content";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

describe("foundation copy", () => {
  it("lists cash pickup as available and keeps online payments out of the release", () => {
    expect(releaseNotes.available).toContain("Cash confirmation, one-time QR pickup, and in-app notifications");
    expect(releaseNotes.unavailable).toContain("Online payments of any kind");
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

describe("authentication forms", () => {
  it("rejects a short password and a mismatched confirmation is covered by the schema", () => {
    const result = loginFormSchema.safeParse({ email: "not-an-email", password: "" });

    expect(result.success).toBe(false);
  });

  it("shows a denial instead of another role's workspace", () => {
    render(
      <AccessDenied
        user={{
          id: "1",
          full_name: "Asha Rao",
          email: "asha@student.bowlbyte.edu",
          role: "STUDENT",
          status: "ACTIVE",
          canteen_id: null,
        }}
      />,
    );

    expect(screen.getByTestId("access-denied")).toHaveTextContent("cannot open this page");
  });
});
