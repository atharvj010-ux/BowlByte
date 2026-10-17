import { randomBytes } from "node:crypto";
import net from "node:net";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const contexts: BrowserContext[] = [];

import { bootstrapIsolatedManager, psqlCommand, psqlQuery } from "./safe-db";

const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const liveOrigin = process.env.LIVE_APP_ORIGIN ?? "http://127.0.0.1:3010";
const password = `horse-${randomBytes(8).toString("hex")}`;
const suffix = randomBytes(3).toString("hex");
const managerEmail = `manager-${suffix}@staff.bowlbyte.edu`;
const kitchenEmail = `kitchen-${suffix}@staff.bowlbyte.edu`;
const cashierEmail = `cashier-${suffix}@staff.bowlbyte.edu`;
const otherCashierEmail = `cashier-b-${suffix}@staff.bowlbyte.edu`;
const studentEmail = `student-a-${suffix}@student.bowlbyte.edu`;
const otherEmail = `student-b-${suffix}@student.bowlbyte.edu`;
const dish = `Privacy Dosa ${suffix}`;

test.describe("public pages do not need an account", () => {
  for (const width of [360, 390, 768, 1280, 1440]) {
    test(`isolated landing and signed-out history at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: /Good food/i })).toBeVisible();
      await expect(page.getByText("Zero queue drama.")).toBeVisible();
      await page.goto("/student/orders");
      await expect(page.getByRole("heading", { name: "Student sign-in" })).toBeVisible();
      await page.goto("/student/orders/00000000-0000-4000-8000-000000000000");
      await expect(page.getByRole("heading", { name: "Student sign-in" })).toBeVisible();
    });
  }

  test("the running production frontend still sends anonymous visitors to sign-in", async ({ page, request }) => {
    const probe = await request.get(`${liveOrigin}/student/login`).catch(() => null);
    test.skip(!probe?.ok(), "The production frontend on port 3010 is not running.");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${liveOrigin}/`);
    await expect(page.getByRole("heading", { name: /Good food/i })).toBeVisible();
    await page.goto(`${liveOrigin}/student/orders`);
    await expect(page.getByRole("heading", { name: "Student sign-in" })).toBeVisible();
  });
});

test.describe("isolated order privacy and pickup", () => {
  test.describe.configure({ mode: "serial" });
  let student: Page;
  let other: Page;
  let kitchen: Page;
  let cashier: Page;
  let otherCashier: Page;
  let manager: Page;
  let studentContext: BrowserContext;
  let orderId = "";
  let ticket = "";
  let pickupCode = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    expect(psqlQuery("SELECT current_database()")).toBe("bowlbyte_e2e");
    psqlCommand(
      "TRUNCATE preparation_plan_events, preparation_plan_items, preparation_plans, demand_forecast_values, demand_forecast_runs, model_evaluations, forecasting_models, forecast_jobs, food_waste_records, production_quantity_events, food_production_batches, demo_demand_days, canteen_closures, push_deliveries, notification_outbox, notifications, pickup_events, pickup_credentials, cash_reversals, cash_receipts; DELETE FROM order_idempotency_records; DELETE FROM inventory_adjustments; DELETE FROM preparation_tasks; DELETE FROM order_events; DELETE FROM order_payments; DELETE FROM order_items; DELETE FROM orders; DELETE FROM staff_invitations; DELETE FROM audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER')); DELETE FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER');",
    );
    bootstrapIsolatedManager(managerEmail, password);
    manager = await open(browser);
    kitchen = await open(browser);
    cashier = await open(browser);
    otherCashier = await open(browser);
    studentContext = await browser.newContext();
    contexts.push(studentContext);
    student = await studentContext.newPage();
    other = await open(browser);

    await manager.goto("/admin/login");
    await signIn(manager, managerEmail);
    await manager.goto("/admin/stations");
    await manager.locator("#content").getByLabel("Station name").first().fill(`Grill ${suffix}`);
    await manager.locator("#content").getByLabel("Capacity").first().fill("2");
    await manager.locator("#content").getByRole("button", { name: "Add station" }).first().click();
    await expect(manager.getByText("Station saved.")).toBeVisible();
    await manager.goto("/admin/menu");
    await expect(manager.getByText("Loading menu.")).toHaveCount(0);
    await manager.locator("#content").getByLabel("Category name").first().fill(`Counter ${suffix}`);
    await manager.locator("#content").getByRole("button", { name: "Add category" }).first().click();
    await expect(manager.getByText("Category saved.")).toBeVisible({ timeout: 15_000 });
    await manager.getByRole("link", { name: "Add menu item" }).click();
    await manager.locator("#content").getByLabel("Name").first().fill(dish);
    await manager.locator("#content").getByLabel("Description").first().fill("Isolated acceptance dish.");
    await manager.locator("#content").getByLabel("Price in rupees").first().fill("40");
    await manager.locator("#content").getByLabel("Preparation seconds").first().fill("120");
    await manager.locator("#content").getByLabel("Category").first().selectOption({ label: `Counter ${suffix}` });
    await manager.locator("#content").getByLabel("Station").first().selectOption({ label: `Grill ${suffix}` });
    await manager.locator("#content").getByLabel("Initial stock").first().fill("20");
    await manager.getByRole("button", { name: "Create item" }).click();
    await expect(manager.getByRole("heading", { name: "Edit item" })).toBeVisible();

    await invite(manager, kitchen, kitchenEmail, "KITCHEN_STAFF", "Kitchen Lead");
    await invite(manager, cashier, cashierEmail, "CASHIER", "Counter Cashier");
    await invite(manager, otherCashier, otherCashierEmail, "CASHIER", "Other Counter");
    await kitchen.goto("/staff/login");
    await signIn(kitchen, kitchenEmail);
    await cashier.goto("/cashier/login");
    await signIn(cashier, cashierEmail);
    await otherCashier.goto("/cashier/login");
    await signIn(otherCashier, otherCashierEmail);
    psqlCommand(
      "INSERT INTO canteens (id, college_id, name, slug, pickup_hold_minutes) SELECT gen_random_uuid(), college_id, 'Other Canteen', 'other-e2e', 30 FROM canteens WHERE slug <> 'other-e2e' LIMIT 1 ON CONFLICT (slug) DO NOTHING; UPDATE staff_memberships SET canteen_id = (SELECT id FROM canteens WHERE slug = 'other-e2e') WHERE user_id = (SELECT id FROM users WHERE email = '" +
        otherCashierEmail +
        "');",
    );

    await registerStudent(student, studentEmail, "Asha Rao");
    await registerStudent(other, otherEmail, "Ben Thomas");
  });

  test.afterAll(async () => {
    for (const context of contexts) {
      await context.close().catch(() => undefined);
    }
  });

  test("student places an order and sees the cinematic confirmation", async () => {
    test.setTimeout(120_000);
    await student.goto("/student/menu");
    const card = student.locator("article").filter({ hasText: dish }).first();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Add to cart" }).click();
    await expect(student.getByTestId("food-flight")).toBeVisible();
    await student.goto("/student/cart");
    const placed = student.waitForResponse(
      (response) => response.url().includes("/api/v1/orders") && response.request().method() === "POST",
    );
    await student.getByRole("button", { name: "Place order" }).click();
    expect((await placed).ok()).toBeTruthy();
    await expect(student.getByText("ORDER IN.")).toBeVisible();
    await expect(student.getByText("HAPPINESS LOADING.")).toBeVisible();
    ticket = ((await student.getByTestId("order-ticket").locator("h2").textContent()) ?? "").trim();
    expect(ticket.startsWith("B")).toBeTruthy();
    orderId = psqlQuery(`SELECT id FROM orders WHERE ticket_number = '${ticket}'`);
    expect(orderId).toMatch(/^[0-9a-f-]{36}$/);
    await student.getByRole("button", { name: "Track my order" }).click();
    await expect(student).toHaveURL(new RegExp(`/student/orders/${orderId}`));
  });

  test("a not-ready order does not render a pickup pass", async () => {
    await student.goto(`/student/orders/${orderId}`);
    await expect(student.getByTestId("order-status").first()).toContainText("PLACED");
    await expect(student.getByTestId("order-status").first()).toContainText("CASH · PENDING");
    await expect(student.getByTestId("pickup-pass").first()).toContainText("when your order is ready");
    await expect(student.getByTestId("pickup-qr")).toHaveCount(0);
    await expect(student.getByTestId("pickup-code")).toHaveCount(0);
  });

  test("refresh, a second tab, logout, back, and an expired session stay private", async () => {
    test.setTimeout(180_000);
    await student.reload();
    await expect(student.getByRole("heading", { level: 2, name: ticket })).toBeVisible();
    const second = await studentContext.newPage();
    await second.goto("/student/orders");
    await expect(second.getByRole("link", { name: ticket })).toBeVisible();
    await second.close();

    await student.getByRole("button", { name: "Log out" }).click();
    await expect(student).toHaveURL(/\/$/);
    await student.goBack();
    await expect(student.getByRole("heading", { name: "Student sign-in" })).toBeVisible({ timeout: 15_000 });
    await expect(student.getByTestId("pickup-code")).toHaveCount(0);
    await expect(student.getByText(ticket)).toHaveCount(0);
    const stored = await student.evaluate(() => window.localStorage.getItem("bowlbyte.cart.v1"));
    expect(stored).toBeNull();

    await signIn(student, studentEmail);
    await student.goto(`/student/orders/${orderId}`);
    await expect(student.getByRole("heading", { level: 2, name: ticket })).toBeVisible();
    psqlCommand(`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = '${studentEmail}')`);
    await student.reload();
    await expect(student.getByRole("heading", { name: "Student sign-in" })).toBeVisible();
    await student.goto("/student/login");
    await signIn(student, studentEmail);
  });

  test("anonymous and cross-student requests cannot read the order or its credential", async ({ request }) => {
    const anonymousOrders = await request.get("/api/v1/orders");
    expect(anonymousOrders.status()).toBe(401);
    const anonymousTracking = await request.get(`/api/v1/orders/${orderId}/tracking`);
    expect(anonymousTracking.status()).toBe(401);
    const anonymousCredential = await request.post(`/api/v1/orders/${orderId}/pickup-credential`);
    expect([401, 403]).toContain(anonymousCredential.status());

    await other.goto(`/student/orders/${orderId}`);
    await expect(other.getByTestId("order-denied")).toBeVisible();
    await expect(other.getByTestId("pickup-code")).toHaveCount(0);
    const foreign = await other.evaluate(async (id) => {
      const response = await fetch(`/api/v1/orders/${id}`, { credentials: "include" });
      return response.status;
    }, orderId);
    expect([403, 404]).toContain(foreign);

    await student.goto("/student/orders");
    await expect(student.getByRole("link", { name: ticket })).toBeVisible();
    await student.getByRole("button", { name: "Log out" }).click();
    await student.goto("/student/login");
    await signIn(student, otherEmail);
    await student.goto("/student/orders");
    await expect(student.getByText("You have not placed an order.")).toBeVisible();
    await expect(student.getByRole("link", { name: ticket })).toHaveCount(0);
    await student.goto(`/student/orders/${orderId}`);
    await expect(student.getByTestId("order-denied")).toBeVisible();
    await student.getByRole("button", { name: "Log out" }).click();
    await student.goto("/student/login");
    await signIn(student, studentEmail);
  });

  test("kitchen acceptance updates the student page and a ready order issues a real code", async () => {
    test.setTimeout(120_000);
    await student.goto(`/student/orders/${orderId}`);
    await kitchen.goto("/staff");
    const incoming = kitchen.getByTestId("incoming-order").filter({ hasText: ticket });
    await expect(incoming).toBeVisible();
    await incoming.getByRole("button", { name: "Accept" }).click();
    await expect(student.getByTestId("order-status").first()).toContainText(/ACCEPTED|QUEUED/);
    const cookies = await student.context().cookies();
    const handshake = await websocketHandshake(
      `/api/v1/ws/orders/${orderId}`,
      cookies.map((item) => `${item.name}=${item.value}`).join("; "),
    );
    expect(handshake.startsWith("HTTP/1.1 101")).toBeTruthy();

    const queue = await api(kitchen, "GET", "/api/v1/staff/queue");
    const order = (queue.json.orders as { id: string; tasks: { id: string }[] }[]).find((entry) => entry.id === orderId);
    expect(order).toBeTruthy();
    for (const task of order!.tasks) {
      expect((await api(kitchen, "POST", `/api/v1/staff/preparation-tasks/${task.id}/start`)).status).toBe(200);
      expect((await api(kitchen, "POST", `/api/v1/staff/preparation-tasks/${task.id}/complete`)).status).toBe(200);
    }
    expect((await api(kitchen, "POST", `/api/v1/staff/orders/${orderId}/ready`, { packed: true })).status).toBe(200);

    await student.reload();
    await expect(student.getByTestId("order-status").first()).toContainText("READY");
    await expect(student.getByTestId("order-status").first()).toContainText("CASH · PENDING");
    const issued = student.waitForResponse(
      (response) => response.url().includes("/pickup-credential") && response.request().method() === "POST",
    );
    await student.getByTestId("show-pickup").click();
    const response = await issued;
    expect(response.ok()).toBeTruthy();
    const credential = (await response.json()) as { token: string; code: string; expires_at: string };
    pickupCode = ((await student.getByTestId("pickup-code").textContent()) ?? "").replace(/\s/g, "");
    expect(pickupCode).toBe(credential.code);
    expect(pickupCode.replace(/-/g, "")).toMatch(/^[0-9A-Z]{12}$/);
    await expect(student.getByTestId("pickup-expiry")).toContainText(/Expires in \d+:\d{2}/);
    const decoded = await student.evaluate(async () => {
      const svg = document.querySelector("[data-testid='pickup-qr'] svg");
      if (!svg || !("BarcodeDetector" in window)) {
        return "UNAVAILABLE";
      }
      const xml = new XMLSerializer().serializeToString(svg);
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || 232;
      canvas.height = image.naturalHeight || 232;
      const context = canvas.getContext("2d");
      if (!context) {
        return "UNAVAILABLE";
      }
      context.drawImage(image, 0, 0);
      const Detector = (
        window as Window & {
          BarcodeDetector?: new (options: { formats: string[] }) => {
            detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
          };
        }
      ).BarcodeDetector;
      if (!Detector) {
        return "UNAVAILABLE";
      }
      const codes = await new Detector({ formats: ["qr_code"] }).detect(canvas);
      return codes[0]?.rawValue ?? "";
    });
    if (decoded !== "UNAVAILABLE") {
      expect(decoded).toBe(credential.token);
    }
    const renewed = student.waitForResponse(
      (response) => response.url().includes("/pickup-credential") && response.request().method() === "POST" && response.ok(),
    );
    await student.getByRole("button", { name: "Get a new code" }).click();
    const fresh = (await (await renewed).json()) as { code: string };
    const shown = ((await student.getByTestId("pickup-code").textContent()) ?? "").replace(/\s/g, "");
    expect(shown).toBe(fresh.code);
    expect(shown).not.toBe(pickupCode);
    pickupCode = shown;
  });

  test("cashier rejects bad, expired, foreign, and replayed codes, then completes a paid ready order", async () => {
    test.setTimeout(180_000);
    await cashier.goto("/cashier");
    await cashier.getByTestId("manual-ticket").fill(ticket);
    await cashier.getByTestId("manual-code").fill("AAAA-AAAA-AAAA");
    await cashier.getByTestId("manual-verify").click();
    await expect(cashier.getByTestId("cashier-error")).toBeVisible();

    await cashier.getByTestId("manual-ticket").fill(ticket);
    await cashier.getByTestId("manual-code").fill(pickupCode);
    await cashier.getByTestId("manual-verify").click();
    await expect(cashier.getByTestId("cashier-notice")).toContainText("Nothing has been paid");
    expect(psqlQuery(`SELECT status FROM order_payments WHERE order_id = '${orderId}'`)).toBe("PENDING");

    await otherCashier.goto("/cashier");
    await otherCashier.getByTestId("manual-ticket").fill(ticket);
    await otherCashier.getByTestId("manual-code").fill(pickupCode);
    await otherCashier.getByTestId("manual-verify").click();
    await expect(otherCashier.getByTestId("cashier-error")).toBeVisible();

    psqlCommand(
      `UPDATE pickup_credentials SET created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute' WHERE order_id = '${orderId}' AND redeemed_at IS NULL AND revoked_at IS NULL`,
    );
    await cashier.getByTestId("manual-ticket").fill(ticket);
    await cashier.getByTestId("manual-code").fill(pickupCode);
    await cashier.getByTestId("manual-verify").click();
    await expect(cashier.getByTestId("cashier-error")).toBeVisible();

    await student.goto(`/student/orders/${orderId}`);
    const issued = student.waitForResponse(
      (response) => response.url().includes("/pickup-credential") && response.ok(),
    );
    await student.getByTestId("show-pickup").click();
    pickupCode = ((await (await issued).json()) as { code: string }).code;
    await expect(student.getByTestId("pickup-code")).toHaveText(pickupCode);

    await cashier.getByTestId("manual-ticket").fill(ticket);
    await cashier.getByTestId("manual-code").fill(pickupCode);
    await cashier.getByTestId("manual-verify").click();
    const checked = cashier.getByTestId("checked-order");
    await expect(checked).toBeVisible();
    await checked.getByTestId("record-cash").click();
    await checked.getByTestId("confirm-cash").click();
    await expect(cashier.getByTestId("cashier-notice")).toContainText("Cash recorded");
    expect(psqlQuery(`SELECT status FROM order_payments WHERE order_id = '${orderId}'`)).toBe("PAID");
    await checked.getByTestId("complete-pickup").click();
    await expect(cashier.getByTestId("cashier-notice")).toContainText("handed over");
    expect(psqlQuery(`SELECT status FROM orders WHERE id = '${orderId}'`)).toBe("PICKED_UP");

    await cashier.getByTestId("manual-ticket").fill(ticket);
    await cashier.getByTestId("manual-code").fill(pickupCode);
    await cashier.getByTestId("manual-verify").click();
    await expect(cashier.getByTestId("cashier-error")).toBeVisible();
    const replay = await api(cashier, "POST", `/api/v1/cashier/orders/${orderId}/complete-pickup`, {
      code: pickupCode,
      idempotency_key: randomBytes(16).toString("hex"),
    });
    expect(replay.status).toBeGreaterThanOrEqual(400);

    const cachedUrls = await student.evaluate(async () => {
      const cacheStore = window.caches;
      if (!cacheStore) {
        return [];
      }
      const names = await cacheStore.keys();
      const requests: string[] = [];
      for (const name of names) {
        const cache = await cacheStore.open(name);
        for (const request of await cache.keys()) {
          requests.push(request.url);
        }
      }
      return requests;
    });
    expect(cachedUrls.some((url) => url.includes("/api/") || url.includes("/student/orders"))).toBeFalsy();
  });

  test("manager can open menu, stock, staff, cash, and forecasting", async () => {
    await manager.goto("/admin/menu");
    await expect(manager.getByRole("heading", { name: /menu/i }).first()).toBeVisible();
    await manager.goto("/admin/stock");
    await expect(manager.getByRole("heading").first()).toBeVisible();
    await manager.goto("/admin/staff");
    await expect(manager.getByRole("heading", { name: "Staff" })).toBeVisible();
    await manager.goto("/admin/cash");
    await expect(manager.getByRole("heading").first()).toBeVisible();
    await manager.goto("/admin/intelligence");
    await expect(manager.getByRole("heading").first()).toBeVisible();
    await expect(manager.getByTestId("access-denied")).toHaveCount(0);
  });
});

async function websocketHandshake(path: string, cookie: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect(8011, "127.0.0.1");
    let data = "";
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(data.split("\r\n")[0] || "timeout");
    }, 4000);
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.includes("\r\n")) {
        clearTimeout(timer);
        socket.destroy();
        resolve(data.split("\r\n")[0] ?? "");
      }
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve("error");
    });
    socket.write(
      `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:8011\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: http://127.0.0.1:3011\r\nCookie: ${cookie}\r\n\r\n`,
    );
  });
}

async function open(browser: Browser) {
  const context = await browser.newContext();
  contexts.push(context);
  return context.newPage();
}

async function signIn(page: Page, email: string) {
  await page.locator("#content").getByLabel("Email").first().fill(email);
  await page.locator("#content").getByLabel("Password", { exact: true }).first().fill(password);
  const login = page.waitForResponse(
    (response) => response.url().includes("/api/v1/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  expect((await login).ok()).toBeTruthy();
}

async function invite(
  manager: Page,
  invitee: Page,
  email: string,
  role: "KITCHEN_STAFF" | "CASHIER",
  name: string,
) {
  await manager.goto("/admin/staff");
  const desk = manager.locator("section").filter({ has: manager.getByRole("heading", { name: "Staff" }) });
  await desk.locator('input[type="email"]').fill(email);
  await desk.locator("select").selectOption(role);
  await desk.getByRole("button", { name: "Invite" }).click();
  await expect(manager.getByText("Invitation sent")).toBeVisible();
  const token = await verificationToken(email);
  await invitee.goto(`/invite/accept#token=${token}`);
  await invitee.locator("#content").getByLabel("Full name").first().fill(name);
  await invitee.locator("#content").getByLabel("Password", { exact: true }).first().fill(password);
  await invitee.locator("#content").getByLabel("Confirm password").first().fill(password);
  await invitee.getByRole("button", { name: "Activate account" }).click();
  await expect(invitee.getByText("Your staff account is active")).toBeVisible();
}

async function registerStudent(page: Page, email: string, name: string) {
  await page.goto("/student/register");
  await page.locator("#content").getByLabel("Full name").first().fill(name);
  await page.locator("#content").getByLabel("Email").first().fill(email);
  await page.locator("#content").getByLabel("College roll number").first().fill(`E2E${randomBytes(3).toString("hex").toUpperCase()}`);
  await page.locator("#content").getByLabel("Password", { exact: true }).first().fill(password);
  await page.locator("#content").getByLabel("Confirm password").first().fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText(/verification message has been sent/i);
  const token = await verificationToken(email);
  await page.goto(`/student/verify-email#token=${token}`);
  await expect(page.getByText("Your email is confirmed. Sign in to continue.")).toBeVisible();
  await page.goto("/student/login");
  await signIn(page, email);
  await expect(page.getByRole("heading", { name: `Hello, ${name}` })).toBeVisible();
}

async function verificationToken(email: string): Promise<string> {
  const query = encodeURIComponent(`to:${email}`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = await fetch(`${mailpit}/api/v1/search?query=${query}`);
    const payload = (await search.json()) as { messages?: { ID: string }[] };
    const message = payload.messages?.[0];
    if (message) {
      const detail = await fetch(`${mailpit}/api/v1/message/${message.ID}`);
      const body = (await detail.json()) as { Text?: string };
      const match = body.Text?.match(/#token=([A-Za-z0-9_-]+)/);
      if (match) {
        return match[1];
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("No Mailpit token arrived.");
}

async function api(page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const raw = document.cookie
        .split("; ")
        .find((row) => row.startsWith("bowlbyte_csrf="))
        ?.split("=")[1];
      const response = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": decodeURIComponent(raw ?? ""),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json: unknown = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }
      return { status: response.status, json: json as { orders?: { id: string; tasks: { id: string }[] }[] } };
    },
    { method, url, body },
  );
}
