import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { afterEach, describe, expect, it } from "vitest";

import { pushSupport, unsupportedMessage, urlBase64ToBytes } from "@/lib/push";

describe("push helpers", () => {
  it("decodes a VAPID public key from URL-safe base64", () => {
    const bytes = urlBase64ToBytes("BAEC_w");
    expect(Array.from(bytes)).toEqual([4, 1, 2, 255]);
  });

  describe("support detection", () => {
    const original = Object.getOwnPropertyDescriptor(window, "isSecureContext");
    afterEach(() => {
      if (original) {
        Object.defineProperty(window, "isSecureContext", original);
      }
      Reflect.deleteProperty(navigator, "serviceWorker");
      Reflect.deleteProperty(window, "PushManager");
    });

    it("reports insecure origins", () => {
      Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
      expect(pushSupport()).toEqual({ kind: "unsupported", reason: "insecure" });
    });

    it("reports browsers without a service worker or Push API", () => {
      Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
      expect(pushSupport()).toEqual({ kind: "unsupported", reason: "no-service-worker" });
      Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
      const result = pushSupport();
      expect(result.kind).toBe("unsupported");
    });

    it("explains the iPhone Home Screen requirement", () => {
      expect(unsupportedMessage("ios-needs-install")).toMatch(/Home Screen/);
      expect(unsupportedMessage("ios-needs-install")).toMatch(/16\.4/);
    });
  });
});

type Handler = (event: Record<string, unknown>) => void;

function loadServiceWorker() {
  const handlers = new Map<string, Handler>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const cached: string[] = [];
  const self = {
    location: { origin: "https://bowlbyte.test" },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: () => Promise.resolve(),
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve([]),
      openWindow: (url: string) => {
        opened.push(url);
        return Promise.resolve(null);
      },
    },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
  };
  const caches = {
    open: () =>
      Promise.resolve({
        addAll: (files: string[]) => {
          cached.push(...files);
          return Promise.resolve();
        },
      }),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
    match: () => Promise.resolve(undefined),
  };
  const source = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  vm.runInNewContext(source, { self, caches, URL, Response, fetch: () => Promise.reject(new Error("offline")) });
  return { handlers, shown, opened, cached };
}

describe("service worker", () => {
  it("precaches only the offline page and an icon, never app or API data", () => {
    const { handlers, cached } = loadServiceWorker();
    let work: Promise<unknown> = Promise.resolve();
    handlers.get("install")?.({ waitUntil: (promise: Promise<unknown>) => (work = promise) });
    return work.then(() => {
      expect(cached).toEqual(["/offline.html", "/icons/icon-192.png"]);
      expect(cached.some((file) => file.includes("api") || file.includes("student"))).toBe(false);
    });
  });

  it("does not intercept API calls or non-navigation requests", () => {
    const { handlers } = loadServiceWorker();
    let responded = false;
    for (const request of [
      { method: "GET", mode: "cors", url: "https://bowlbyte.test/api/v1/orders" },
      { method: "POST", mode: "navigate", url: "https://bowlbyte.test/student" },
      { method: "GET", mode: "same-origin", url: "https://bowlbyte.test/api/v1/cashier/orders" },
    ]) {
      handlers.get("fetch")?.({ request, respondWith: () => (responded = true) });
    }
    expect(responded).toBe(false);
  });

  it("shows a ready notification with a safe order path", () => {
    const { handlers, shown } = loadServiceWorker();
    handlers.get("push")?.({
      data: {
        json: () => ({
          type: "ORDER_READY",
          title: "BowlByte — Order Ready!",
          body: "Your order #B00042 is ready for pickup. Please pay cash at the canteen counter.",
          tag: "order-1",
          url: "/student/orders/abc-123",
        }),
      },
      waitUntil: () => undefined,
    });
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe("BowlByte — Order Ready!");
    expect(shown[0].options.tag).toBe("order-1");
    expect((shown[0].options.data as { url: string }).url).toBe("/student/orders/abc-123");
  });

  it("falls back to a generic notification for malformed payloads and hostile paths", () => {
    const { handlers, shown } = loadServiceWorker();
    handlers.get("push")?.({
      data: {
        json: () => {
          throw new Error("not json");
        },
      },
      waitUntil: () => undefined,
    });
    for (const url of ["https://evil.example/x", "//evil.example", "javascript:alert(1)", "/admin/../../x"]) {
      handlers.get("push")?.({
        data: { json: () => ({ title: "t", body: "b", url }) },
        waitUntil: () => undefined,
      });
    }
    expect(shown[0].title).toBe("BowlByte");
    for (const item of shown.slice(1)) {
      expect((item.options.data as { url: string }).url).toBe("/student");
    }
  });

  it("opens the notification target on click", async () => {
    const { handlers, opened } = loadServiceWorker();
    let work: Promise<unknown> = Promise.resolve();
    handlers.get("notificationclick")?.({
      notification: { close: () => undefined, data: { url: "/student/orders/abc-123" } },
      waitUntil: (promise: Promise<unknown>) => (work = promise),
    });
    await work;
    expect(opened).toEqual(["https://bowlbyte.test/student/orders/abc-123"]);
  });
});
