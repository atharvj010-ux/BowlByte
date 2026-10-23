import { describe, expect, it } from "vitest";

import { isAuthScreen, isPrivatePath, loginHrefFor } from "@/lib/session-privacy";

describe("private order routes", () => {
  it("treats order pages as private and login pages as public", () => {
    expect(isPrivatePath("/student/orders")).toBe(true);
    expect(isPrivatePath("/student/orders/abc")).toBe(true);
    expect(isPrivatePath("/student/notifications")).toBe(true);
    expect(isPrivatePath("/student/login")).toBe(false);
    expect(isPrivatePath("/student/register")).toBe(false);
    expect(isPrivatePath("/student/verify-email")).toBe(false);
    expect(isPrivatePath("/verify-email")).toBe(false);
    expect(isPrivatePath("/forgot-password")).toBe(false);
    expect(loginHrefFor("/cashier/orders")).toBe("/cashier/login?reason=expired");
    expect(isAuthScreen("/student/login")).toBe(true);
    expect(isAuthScreen("/login")).toBe(true);
    expect(isAuthScreen("/student")).toBe(false);
  });
});
