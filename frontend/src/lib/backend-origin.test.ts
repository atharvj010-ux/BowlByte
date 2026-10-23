import { afterEach, describe, expect, it } from "vitest";

import { backendOrigin, backendUrl } from "@/lib/backend-origin";

const originalInternal = process.env.API_INTERNAL_URL;
const originalPublic = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  if (originalInternal === undefined) {
    delete process.env.API_INTERNAL_URL;
  } else {
    process.env.API_INTERNAL_URL = originalInternal;
  }
  if (originalPublic === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = originalPublic;
  }
});

describe("backend binding URL", () => {
  it("joins API paths onto the injected service origin", () => {
    process.env.API_INTERNAL_URL = "https://backend.internal/";
    expect(backendOrigin()).toBe("https://backend.internal");
    expect(backendUrl("/api/v1/auth/me").href).toBe("https://backend.internal/api/v1/auth/me");
    expect(backendUrl("api/v1/health").href).toBe("https://backend.internal/api/v1/health");
  });

  it("keeps a path prefix on the binding", () => {
    process.env.API_INTERNAL_URL = "https://backend.internal/svc";
    expect(backendUrl("api/v1/ready").href).toBe("https://backend.internal/svc/api/v1/ready");
  });

  it("uses the local API when no binding is present", () => {
    delete process.env.API_INTERNAL_URL;
    delete process.env.NEXT_PUBLIC_API_URL;
    expect(backendUrl("/api/v1/health").href).toBe("http://127.0.0.1:8010/api/v1/health");
  });
});
