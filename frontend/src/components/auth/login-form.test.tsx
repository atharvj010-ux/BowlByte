import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/components/auth/login-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    fetchCurrentUser: vi.fn(async () => null),
  };
});

afterEach(() => {
  cleanup();
});

async function renderLogin() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginForm initialRole="STUDENT" />
    </QueryClientProvider>,
  );
  return screen.findByRole("heading", { name: "Student sign-in" });
}

describe("LoginForm", () => {
  it("shows validation before a request and can reveal the password", async () => {
    await renderLogin();

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(document.getElementById("password")).toHaveAttribute("type", "text");
  });

  it("opens the admin desks from the same sign-in screen", async () => {
    await renderLogin();

    expect(screen.getByRole("heading", { name: "Student sign-in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a student account" })).toHaveAttribute("href", "/student/register");
    expect(screen.queryByRole("button", { name: "Kitchen" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Admin" }));

    expect(screen.getByRole("heading", { name: "Kitchen sign-in" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manager" }));
    expect(screen.getByRole("heading", { name: "Manager sign-in" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cashier" }));
    expect(screen.getByRole("heading", { name: "Cashier sign-in" })).toBeInTheDocument();
  });
});
