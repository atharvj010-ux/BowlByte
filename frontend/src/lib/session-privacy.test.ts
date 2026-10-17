import { describe, expect, it } from "vitest";

import { isPrivatePath, loginHrefFor } from "@/lib/session-privacy";

describe("private order routes", () => {
  it("treats order pages as private and login pages as public", () => {
    expect(isPrivatePath("/student/orders")).toBe(true);
    expect(isPrivatePath("/student/orders/abc")).toBe(true);
    expect(isPrivatePath("/student/login")).toBe(false);
    expect(isPrivatePath("/forgot-password")).toBe(false);
    expect(loginHrefFor("/cashier/orders")).toBe("/cashier/login?reason=expired");
  });
});
