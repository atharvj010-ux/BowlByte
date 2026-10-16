import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/components/auth/login-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("LoginForm", () => {
  it("shows validation before a request and can reveal the password", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LoginForm title="Student sign-in" description="Confirm the email first." />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(document.getElementById("password")).toHaveAttribute("type", "text");
  });
});
