import { qrImageHash, sha256 } from "./qr-decode";
import { bootstrapIsolatedManager, psqlCommand, psqlQuery } from "./safe-db";
import { randomBytes } from "node:crypto";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * P005 end-to-end scenarios against the real running stack (PostgreSQL, Redis, API, worker).
 *
 * The only simulated part is the push *service*: the browser's PushManager is replaced with a
 * stand-in that produces real P-256 keys and a reserved test endpoint, and the backend sends to
 * its built-in simulator for that reserved host. This proves BowlByte's own behaviour. It does
 * not prove that any phone received or displayed a notification.
 */

const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const password = `horse-${randomBytes(8).toString("hex")}`;
const suffix = randomBytes(3).toString("hex");
const managerEmail = `manager-${suffix}@staff.bowlbyte.edu`;
const kitchenEmail = `kitchen-${suffix}@staff.bowlbyte.edu`;
const cashierEmail = `cashier-${suffix}@staff.bowlbyte.edu`;
const studentEmail = `student-a-${suffix}@student.bowlbyte.edu`;
const otherStudentEmail = `student-b-${suffix}@student.bowlbyte.edu`;
const pushStudentEmail = `student-c-${suffix}@student.bowlbyte.edu`;
const dish = `Masala Dosa ${suffix}`;
const PRICE_PAISE = 4000;

test.describe.configure({ mode: "serial" });

type Role = "manager" | "kitchen" | "cashier" | "student" | "other" | "push";
const pages = {} as Record<Role, Page>;
const contexts: BrowserContext[] = [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(420_000);
  clearPilotData();
  bootstrapManager(managerEmail, password);

  pages.manager = await open(browser, false);
  pages.kitchen = await open(browser, false);
  pages.cashier = await open(browser, false);
  pages.student = await open(browser, false);
  pages.other = await open(browser, false);
  pages.push = await open(browser, true);

  await pages.manager.goto("/admin/login");
  await signIn(pages.manager, managerEmail);

  await pages.manager.goto("/admin/stations");
  await pages.manager.locator("#content").getByLabel("Station name").first().fill(`Dosa ${suffix}`);
  await pages.manager.locator("#content").getByLabel("Capacity").first().fill("6");
  await pages.manager.locator("#content").getByRole("button", { name: "Add station" }).first().click();
  await expect(pages.manager.getByText("Station saved.")).toBeVisible();

  await pages.manager.goto("/admin/menu");
  await expect(pages.manager.getByText("Loading menu.")).toHaveCount(0);
  await pages.manager.locator("#content").getByLabel("Category name").first().fill(`South ${suffix}`);
  await pages.manager.locator("#content").getByRole("button", { name: "Add category" }).first().click();
  await expect(pages.manager.getByText("Category saved.")).toBeVisible({ timeout: 15_000 });
  await pages.manager.getByRole("link", { name: "Add menu item" }).click();
  await pages.manager.locator("#content").getByLabel("Name").first().fill(dish);
  await pages.manager.locator("#content").getByLabel("Description").first().fill("Development sample for the pilot.");
  await pages.manager.locator("#content").getByLabel("Price in rupees").first().fill("40");
  await pages.manager.locator("#content").getByLabel("Preparation seconds").first().fill("120");
  await expect(pages.manager.getByRole("option", { name: `South ${suffix}` })).toHaveCount(1);
  await pages.manager.locator("#content").getByLabel("Category").first().selectOption({ label: `South ${suffix}` });
  await pages.manager.locator("#content").getByLabel("Station").first().selectOption({ label: `Dosa ${suffix}` });
  await pages.manager.locator("#content").getByLabel("Initial stock").first().fill("60");
  await pages.manager.getByRole("button", { name: "Create item" }).click();
  await expect(pages.manager.getByRole("heading", { name: "Edit item" })).toBeVisible();

  await invite(pages.manager, pages.kitchen, kitchenEmail, "KITCHEN_STAFF", "Kitchen Lead");
  await invite(pages.manager, pages.cashier, cashierEmail, "CASHIER", "Counter Cashier");
  await pages.kitchen.goto("/staff/login");
  await signIn(pages.kitchen, kitchenEmail);
  await pages.cashier.goto("/cashier/login");
  await signIn(pages.cashier, cashierEmail);

  await registerStudent(pages.student, studentEmail, "Asha Rao");
  await registerStudent(pages.other, otherStudentEmail, "Ben Thomas");
  await registerStudent(pages.push, pushStudentEmail, "Chitra Menon");
});

test.afterAll(async () => {
  for (const context of contexts) {
    await context.close().catch(() => undefined);
  }
});

test("scenario 1: kitchen marks READY, cashier sees the amount, confirms cash, student sees PAID", async () => {
  test.setTimeout(150_000);
  const orderId = await placeOrder(pages.student);
  const ticket = await ticketOf(pages.student, orderId);
  await kitchenToReady(pages.kitchen, orderId);

  await pages.cashier.goto("/cashier");
  const waiting = pages.cashier.getByTestId("awaiting-payment").first();
  const row = waiting.getByTestId("counter-order").filter({ hasText: ticket });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(/₹\s?40(\.00)?/);
  expect(sql(`SELECT status FROM order_payments WHERE order_id = '${orderId}'`).trim()).toBe(
    "PENDING",
  );

  await row.getByTestId("record-cash").first().click();
  await expect(row.getByTestId("confirm-panel").first()).toContainText(/₹\s?40(\.00)?/);
  await row.getByTestId("confirm-cash").first().click();
  await expect(pages.cashier.getByTestId("cashier-notice").first()).toContainText("Cash recorded");

  expect(sql(`SELECT status FROM order_payments WHERE order_id = '${orderId}'`).trim()).toBe("PAID");
  expect(sql(`SELECT count(*) FROM cash_receipts WHERE order_id = '${orderId}'`).trim()).toBe("1");
  expect(
    sql(
      `SELECT u.email FROM cash_receipts r JOIN users u ON u.id = r.cashier_user_id WHERE r.order_id = '${orderId}'`,
    ).trim(),
  ).toBe(cashierEmail);

  await pages.student.goto(`/student/orders/${orderId}`);
  await expect(pages.student.getByTestId("order-status").first()).toContainText("READY · CASH · PAID");
  await expect(pages.student.getByTestId("order-status").first()).not.toContainText("PICKED_UP");
});

test("scenario 2: student shows a pickup code, cashier verifies, confirms payment and hands over", async () => {
  test.setTimeout(150_000);
  const orderId = await placeOrder(pages.student);
  const ticket = await ticketOf(pages.student, orderId);
  await kitchenToReady(pages.kitchen, orderId);

  await pages.student.goto(`/student/orders/${orderId}`);
  await expect(pages.student.getByTestId("order-status").first()).toContainText("READY");
  await expect(pages.student.getByTestId("payment-notice").first()).toContainText(
    /Your order is ready\. Pay .* in cash at the counter\./,
  );
  const issued = pages.student.waitForResponse(
    (response) =>
      response.url().includes("/pickup-credential") &&
      response.request().method() === "POST" &&
      response.ok(),
  );
  await pages.student.getByTestId("show-pickup").first().click();
  const credential = (await (await issued).json()) as { token: string; code: string };
  await expect(pages.student.getByTestId("pickup-qr").first()).toBeVisible();
  const code = ((await pages.student.getByTestId("pickup-code").first().textContent()) ?? "").replace(/\s/g, "");
  expect(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code)).toBeTruthy();
  expect(sha256(code)).toBe(sha256(credential.code));
  expect(await qrImageHash(pages.student)).toBe(sha256(credential.token));

  await pages.cashier.goto("/cashier");
  await pages.cashier.getByTestId("manual-ticket").first().fill(ticket);
  await pages.cashier.getByTestId("manual-code").first().fill(code);
  await pages.cashier.getByTestId("manual-verify").first().click();
  const checked = pages.cashier.getByTestId("checked-order").first();
  await expect(checked).toBeVisible();
  await expect(pages.cashier.getByTestId("cashier-notice").first()).toContainText("Nothing has been paid");
  // Scanning or entering a code is never a payment.
  expect(sql(`SELECT status FROM order_payments WHERE order_id = '${orderId}'`).trim()).toBe(
    "PENDING",
  );
  await expect(checked.getByTestId("complete-pickup").first()).toHaveCount(0);

  await checked.getByTestId("record-cash").first().click();
  await checked.getByTestId("confirm-cash").first().click();
  await expect(pages.cashier.getByTestId("cashier-notice").first()).toContainText("Cash recorded");
  await checked.getByTestId("complete-pickup").first().click();
  await expect(pages.cashier.getByTestId("cashier-notice").first()).toContainText("handed over");

  await pages.student.goto(`/student/orders/${orderId}`);
  await expect(pages.student.getByTestId("order-status").first()).toContainText("PICKED_UP · CASH · PAID");
  await expect(pages.student.getByTestId("payment-notice").first()).toContainText("collected successfully");
  await expect(pages.student.getByTestId("pickup-pass").first()).toContainText("The pickup code no longer works.");
  await expect(pages.student.getByTestId("pickup-qr")).toHaveCount(0);
  await expect(pages.student.getByTestId("pickup-code")).toHaveCount(0);
  await pages.cashier.getByTestId("manual-ticket").first().fill(ticket);
  await pages.cashier.getByTestId("manual-code").first().fill(code);
  await pages.cashier.getByTestId("manual-verify").first().click();
  await expect(pages.cashier.getByTestId("cashier-error").first()).toBeVisible();
  expect(
    sql(`SELECT count(*) FROM pickup_credentials WHERE order_id = '${orderId}' AND redeemed_at IS NOT NULL`).trim(),
  ).toBe("1");
});

test("scenario 3: the backend refuses a handover while payment is pending", async () => {
  test.setTimeout(120_000);
  const orderId = await placeOrder(pages.student);
  await kitchenToReady(pages.kitchen, orderId);
  const credential = await api(pages.student, "POST", `/api/v1/orders/${orderId}/pickup-credential`);
  expect(credential.status).toBe(200);

  const attempt = await api(pages.cashier, "POST", `/api/v1/cashier/orders/${orderId}/complete-pickup`, {
    token: credential.json.token,
    idempotency_key: key(),
  });
  expect(attempt.status).toBeGreaterThanOrEqual(400);
  expect(attempt.status).toBeLessThan(500);
  expect(sql(`SELECT status FROM orders WHERE id = '${orderId}'`).trim()).toBe("READY");
  expect(sql(`SELECT status FROM order_payments WHERE order_id = '${orderId}'`).trim()).toBe(
    "PENDING",
  );
  expect(
    sql(`SELECT count(*) FROM pickup_credentials WHERE order_id = '${orderId}' AND redeemed_at IS NOT NULL`).trim(),
  ).toBe("0");
});

test("only the cashier role can record cash, and only for READY orders", async () => {
  test.setTimeout(120_000);
  const orderId = await placeOrder(pages.student);
  const body = { amount_paise: PRICE_PAISE, idempotency_key: key() };

  // Not READY yet: refused even for a cashier.
  const early = await api(pages.cashier, "POST", `/api/v1/cashier/orders/${orderId}/confirm-cash`, body);
  expect(early.status).toBeGreaterThanOrEqual(400);
  expect(early.status).toBeLessThan(500);

  await kitchenToReady(pages.kitchen, orderId);
  for (const who of ["student", "kitchen"] as const) {
    const refused = await api(pages[who], "POST", `/api/v1/cashier/orders/${orderId}/confirm-cash`, {
      amount_paise: PRICE_PAISE,
      idempotency_key: key(),
    });
    expect(refused.status).toBe(403);
  }
  expect(sql(`SELECT count(*) FROM cash_receipts WHERE order_id = '${orderId}'`).trim()).toBe("0");

  const wrongAmount = await api(pages.cashier, "POST", `/api/v1/cashier/orders/${orderId}/confirm-cash`, {
    amount_paise: PRICE_PAISE - 100,
    idempotency_key: key(),
  });
  expect(wrongAmount.status).toBeGreaterThanOrEqual(400);
  expect(sql(`SELECT status FROM order_payments WHERE order_id = '${orderId}'`).trim()).toBe(
    "PENDING",
  );

  const first = await api(pages.cashier, "POST", `/api/v1/cashier/orders/${orderId}/confirm-cash`, body);
  expect(first.status).toBe(200);
  const replay = await api(pages.cashier, "POST", `/api/v1/cashier/orders/${orderId}/confirm-cash`, body);
  expect(replay.status).toBe(200);
  expect(sql(`SELECT count(*) FROM cash_receipts WHERE order_id = '${orderId}'`).trim()).toBe("1");
});

test("scenario 4: a redeemed pickup code can never be used again", async () => {
  test.setTimeout(120_000);
  const orderId = await placeOrder(pages.student);
  await kitchenToReady(pages.kitchen, orderId);
  const credential = await api(pages.student, "POST", `/api/v1/orders/${orderId}/pickup-credential`);
  expect(credential.status).toBe(200);
  const { token, code } = credential.json as { token: string; code: string };

  const paid = await api(pages.cashier, "POST", `/api/v1/cashier/orders/${orderId}/confirm-cash`, {
    amount_paise: PRICE_PAISE,
    idempotency_key: key(),
  });
  expect(paid.status).toBe(200);

  const redeemKey = key();
  const done = await api(pages.cashier, "POST", `/api/v1/cashier/orders/${orderId}/complete-pickup`, {
    token,
    idempotency_key: redeemKey,
  });
  expect(done.status).toBe(200);
  expect(sql(`SELECT status FROM orders WHERE id = '${orderId}'`).trim()).toBe("PICKED_UP");

  const again = await api(pages.cashier, "POST", `/api/v1/cashier/orders/${orderId}/complete-pickup`, {
    token,
    idempotency_key: key(),
  });
  expect(again.status).toBeGreaterThanOrEqual(400);
  const byCode = await api(pages.cashier, "POST", `/api/v1/cashier/orders/${orderId}/complete-pickup`, {
    code,
    idempotency_key: key(),
  });
  expect(byCode.status).toBeGreaterThanOrEqual(400);
  const verify = await api(pages.cashier, "POST", "/api/v1/cashier/pickup/verify", { token });
  expect(verify.status).toBeGreaterThanOrEqual(400);
  const reissue = await api(pages.student, "POST", `/api/v1/orders/${orderId}/pickup-credential`);
  expect(reissue.status).toBeGreaterThanOrEqual(400);

  // A genuine retry of the very same request (lost response) is answered, not repeated.
  const retry = await api(pages.cashier, "POST", `/api/v1/cashier/orders/${orderId}/complete-pickup`, {
    token,
    idempotency_key: redeemKey,
  });
  expect(retry.status).toBe(200);
  expect(
    sql(`SELECT count(*) FROM pickup_credentials WHERE order_id = '${orderId}' AND redeemed_at IS NOT NULL`).trim(),
  ).toBe("1");
});

test("scenario 5: another student cannot reach a pickup credential by changing the URL or id", async () => {
  test.setTimeout(120_000);
  const orderId = await placeOrder(pages.student);
  await kitchenToReady(pages.kitchen, orderId);

  const status = await api(pages.other, "GET", `/api/v1/orders/${orderId}/pickup-status`);
  expect([403, 404]).toContain(status.status);
  const issue = await api(pages.other, "POST", `/api/v1/orders/${orderId}/pickup-credential`);
  expect([403, 404]).toContain(issue.status);
  expect(JSON.stringify(issue.json)).not.toContain("bbp1.");
  expect(
    sql(`SELECT count(*) FROM pickup_credentials WHERE order_id = '${orderId}'`).trim(),
  ).toBe("0");

  await pages.other.goto(`/student/orders/${orderId}`);
  await expect(pages.other.getByTestId("pickup-pass").first()).toHaveCount(0);
  await expect(pages.other.getByTestId("show-pickup").first()).toHaveCount(0);
});

test("scenario 6: a student turns on notifications and READY creates exactly one record", async () => {
  test.setTimeout(180_000);
  const page = pages.push;
  await page.evaluate(() => window.localStorage.setItem("e2e.push.mode", "accept"));
  await page.goto("/student");
  await expect(page.getByRole("button", { name: "Enable Phone Notifications" }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.goto("/student/notifications");
  await expect(page.getByTestId("push-settings").first()).toBeVisible();
  await page.goto("/student/profile");
  await expect(page.locator("#content").getByTestId("push-state").first()).toHaveText("NOT ENABLED", {
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Enable Phone Notifications" }).click();
  await expect(page.locator("#content").getByTestId("push-state").first()).toHaveText("ENABLED", {
    timeout: 20_000,
  });
  const userId = sql(`SELECT id FROM users WHERE email = '${pushStudentEmail}'`).trim();
  expect(
    sql(`SELECT count(*) FROM push_subscriptions WHERE user_id = '${userId}' AND enabled`).trim(),
  ).toBe("1");
  // Endpoint and keys are encrypted at rest.
  expect(
    sql(`SELECT count(*) FROM push_subscriptions WHERE user_id = '${userId}' AND endpoint_enc LIKE '%push-test%'`).trim(),
  ).toBe("0");

  const orderId = await placeOrder(page);
  await kitchenToReady(pages.kitchen, orderId);
  expect(
    sql(`SELECT count(*) FROM notifications WHERE order_id = '${orderId}' AND kind = 'ORDER_READY'`).trim(),
  ).toBe("1");
  expect(
    sql(`SELECT count(*) FROM notification_outbox WHERE order_id = '${orderId}'`).trim(),
  ).toBe("1");

  // The worker, not the kitchen request, sends. The simulator "accepts" the message.
  await expect
    .poll(
      () =>
        sql(
          `SELECT d.status || ':' || coalesce(d.transport, '') FROM push_deliveries d JOIN notification_outbox o ON o.id = d.outbox_id WHERE o.order_id = '${orderId}'`,
        ).trim(),
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe("ACCEPTED:simulator");
  // "Accepted" means the push service took it. Nothing here claims it was displayed.
  expect(
    sql(`SELECT count(*) FROM notifications WHERE order_id = '${orderId}'`).trim(),
  ).toBe("1");

  await page.goto("/student/notifications");
  await expect(page.getByTestId("notification-item").first()).toContainText("Your Food Is Ready");
  await expect(page.getByTestId("notification-item").first()).toContainText("pay cash at the canteen counter");
});

test("scenario 7: a push provider failure leaves the order READY and the message retryable", async () => {
  test.setTimeout(180_000);
  const page = pages.push;
  await page.goto("/student/profile");
  await expect(page.locator("#content").getByTestId("push-state").first()).toHaveText("ENABLED", {
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Disable Notifications" }).click();
  await expect(page.locator("#content").getByTestId("push-state").first()).toHaveText("NOT ENABLED");
  await page.evaluate(() => {
    window.localStorage.removeItem("e2e.push.sub");
    window.localStorage.setItem("e2e.push.mode", "fail");
  });
  sql(
    `UPDATE push_subscriptions SET enabled = false WHERE user_id = (SELECT id FROM users WHERE email = '${pushStudentEmail}')`,
  );
  await page.getByRole("button", { name: "Enable Phone Notifications" }).click();
  await expect(page.locator("#content").getByTestId("push-state").first()).toHaveText("ENABLED", {
    timeout: 20_000,
  });

  const orderId = await placeOrder(page);
  await kitchenToReady(pages.kitchen, orderId);
  const delivery = () =>
    sql(
      `SELECT d.status || ':' || coalesce(d.error_code, '') || ':' || (d.accepted_at IS NOT NULL) FROM push_deliveries d JOIN notification_outbox o ON o.id = d.outbox_id WHERE o.order_id = '${orderId}'`,
    ).trim();
  await expect.poll(delivery, { timeout: 60_000, intervals: [2_000] }).toBe("PENDING:http_503:false");

  expect(sql(`SELECT status FROM orders WHERE id = '${orderId}'`).trim()).toBe("READY");
  expect(
    sql(`SELECT status || ':' || coalesce(result, '') FROM notification_outbox WHERE order_id = '${orderId}'`).trim(),
  ).toBe("PENDING:");
  expect(
    sql(
      `SELECT count(*) FROM push_deliveries d JOIN notification_outbox o ON o.id = d.outbox_id WHERE o.order_id = '${orderId}' AND d.status = 'ACCEPTED'`,
    ).trim(),
  ).toBe("0");
  // The in-app record exists regardless, and the order page tells the truth.
  expect(
    sql(`SELECT count(*) FROM notifications WHERE order_id = '${orderId}'`).trim(),
  ).toBe("1");
  await page.goto(`/student/orders/${orderId}`);
  await expect(page.getByTestId("order-status").first()).toContainText("READY · CASH · PENDING");

  // Tidy up: remove this device so later runs do not keep retrying against the failing endpoint.
  await page.goto("/student/profile");
  await page.getByRole("button", { name: "Disable Notifications" }).click();
  await expect(page.locator("#content").getByTestId("push-state").first()).toHaveText("NOT ENABLED");
});

test("scenario 8: with the WebSocket disconnected, a reload shows the real status and history", async () => {
  test.setTimeout(150_000);
  const page = pages.student;
  const orderId = await placeOrder(page);
  const ticket = await ticketOf(page, orderId);
  await page.goto(`/student/orders/${orderId}`);
  await expect(page.getByTestId("order-status").first()).toContainText("PLACED");
  await page.routeWebSocket(/\/api\/v1\/ws\//, (socket) => socket.close());
  await page.reload();
  await expect(page.getByTestId("connection-state").first()).toContainText(/Reconnecting|Polling for updates/);
  await expect(page.getByTestId("connection-state").first()).not.toContainText("Live updates connected");

  await kitchenToReady(pages.kitchen, orderId);
  await page.reload();
  await expect(page.getByTestId("order-status").first()).toContainText("READY", { timeout: 25_000 });
  await page.goto("/student/notifications");
  await expect(
    page.getByTestId("notification-item").filter({ hasText: ticket }),
  ).toBeVisible({ timeout: 25_000 });
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("scenario 9: the manager reviews receipts and makes an audited correction before pickup", async () => {
  test.setTimeout(180_000);
  const orderId = await placeOrder(pages.student);
  const ticket = await ticketOf(pages.student, orderId);
  await kitchenToReady(pages.kitchen, orderId);
  const paid = await api(pages.cashier, "POST", `/api/v1/cashier/orders/${orderId}/confirm-cash`, {
    amount_paise: PRICE_PAISE,
    idempotency_key: key(),
  });
  expect(paid.status).toBe(200);

  const cashierView = await api(pages.cashier, "POST", `/api/v1/admin/cash/${paid.json.receipt.id}/reverse`, {
    reason: "Cashier should not be able to do this",
    kind: "ERRONEOUS_ENTRY",
    confirm: true,
    idempotency_key: key(),
  });
  expect(cashierView.status).toBe(403);

  await pages.manager.goto("/admin/cash");
  const row = pages.manager.getByTestId("cash-row").filter({ hasText: ticket });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText("Counter Cashier");
  await expect(row).toContainText("Recorded");
  await row.getByTestId("start-reverse").first().click();
  await pages.manager.getByTestId("reverse-reason").first().fill("Student took the cash back before leaving");
  await pages.manager.getByTestId("reverse-kind").first().selectOption("CASH_RETURNED");
  await expect(pages.manager.getByTestId("reverse-submit").first()).toBeDisabled();
  await pages.manager.getByTestId("reverse-confirm").first().check();
  await pages.manager.getByTestId("reverse-submit").first().click();
  await expect(pages.manager.getByTestId("cash-message").first()).toContainText("reversed");
  await expect(row).toContainText("Reversed");

  expect(sql(`SELECT status FROM order_payments WHERE order_id = '${orderId}'`).trim()).toBe("PENDING");
  expect(sql(`SELECT status FROM orders WHERE id = '${orderId}'`).trim()).toBe("READY");
  // Nothing was deleted: the original receipt and the reversal are both kept.
  expect(sql(`SELECT count(*) FROM cash_receipts WHERE order_id = '${orderId}'`).trim()).toBe("1");
  expect(sql(`SELECT count(*) FROM cash_reversals WHERE order_id = '${orderId}'`).trim()).toBe("1");
  expect(
    sql(
      `SELECT u.email FROM cash_reversals r JOIN users u ON u.id = r.manager_user_id WHERE r.order_id = '${orderId}'`,
    ).trim(),
  ).toBe(managerEmail);

  // The order can be paid again, as a new numbered receipt.
  const again = await api(pages.cashier, "POST", `/api/v1/cashier/orders/${orderId}/confirm-cash`, {
    amount_paise: PRICE_PAISE,
    idempotency_key: key(),
  });
  expect(again.status).toBe(200);
  expect(sql(`SELECT count(*) FROM cash_receipts WHERE order_id = '${orderId}'`).trim()).toBe("2");
});

async function open(browser: Browser, push: boolean): Promise<Page> {
  const context = await browser.newContext(push ? { permissions: ["notifications"] } : {});
  contexts.push(context);
  if (push) {
    await context.addInitScript(installFakePushManager);
  }
  return context.newPage();
}

/**
 * Replaces only the browser's push *service* connection. Keys are real P-256 / auth secrets and
 * the endpoint is the reserved test host that the backend routes to its simulator.
 */
function installFakePushManager() {
  const b64 = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const read = () => {
    try {
      return JSON.parse(window.localStorage.getItem("e2e.push.sub") ?? "null");
    } catch {
      return null;
    }
  };
  const wrap = (stored: { endpoint: string; p256dh: string; auth: string }) => ({
    endpoint: stored.endpoint,
    expirationTime: null,
    toJSON: () => ({
      endpoint: stored.endpoint,
      expirationTime: null,
      keys: { p256dh: stored.p256dh, auth: stored.auth },
    }),
    unsubscribe: async () => {
      window.localStorage.removeItem("e2e.push.sub");
      return true;
    },
  });
  const manager = {
    getSubscription: async () => {
      const stored = read();
      return stored ? wrap(stored) : null;
    },
    permissionState: async () => "granted",
    subscribe: async () => {
      const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
        "deriveBits",
      ]);
      const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
      const auth = crypto.getRandomValues(new Uint8Array(16));
      const mode = window.localStorage.getItem("e2e.push.mode") ?? "accept";
      const id = b64(crypto.getRandomValues(new Uint8Array(12)));
      const stored = {
        endpoint: `https://push-test.bowlbyte.invalid/${mode}/${id}`,
        p256dh: b64(raw),
        auth: b64(auth),
      };
      window.localStorage.setItem("e2e.push.sub", JSON.stringify(stored));
      return wrap(stored);
    },
  };
  // Headless Chromium reports notifications as blocked, so the user's "Allow" is simulated too.
  Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
  Notification.requestPermission = async () => "granted";
  Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", {
    configurable: true,
    get: () => manager,
  });
}

function key() {
  return randomBytes(12).toString("hex");
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
      let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        json = await response.json();
      } catch {
        json = null;
      }
      return { status: response.status, json };
    },
    { method, url, body },
  );
}

async function placeOrder(page: Page): Promise<string> {
  const itemId = sql(`SELECT id FROM menu_items WHERE name = '${dish}'`).trim();
  const placed = await api(page, "POST", "/api/v1/orders", {
    items: [{ menu_item_id: itemId, quantity: 1 }],
    idempotency_key: randomBytes(16).toString("hex"),
  });
  expect(placed.status, JSON.stringify(placed.json)).toBeLessThan(300);
  return placed.json.id as string;
}

async function ticketOf(page: Page, orderId: string): Promise<string> {
  const tracked = await api(page, "GET", `/api/v1/orders/${orderId}/tracking`);
  expect(tracked.status).toBe(200);
  return tracked.json.ticket_number as string;
}

async function kitchenToReady(kitchen: Page, orderId: string) {
  const accepted = await api(kitchen, "POST", `/api/v1/staff/orders/${orderId}/accept`);
  expect(accepted.status, JSON.stringify(accepted.json)).toBe(200);
  const queue = await api(kitchen, "GET", "/api/v1/staff/queue");
  const order = (queue.json.orders as { id: string; tasks: { id: string }[] }[]).find(
    (entry) => entry.id === orderId,
  );
  expect(order, "order is in the kitchen queue").toBeTruthy();
  for (const task of order!.tasks) {
    const started = await api(kitchen, "POST", `/api/v1/staff/preparation-tasks/${task.id}/start`);
    expect(started.status, JSON.stringify(started.json)).toBe(200);
    const finished = await api(kitchen, "POST", `/api/v1/staff/preparation-tasks/${task.id}/complete`);
    expect(finished.status, JSON.stringify(finished.json)).toBe(200);
  }
  const ready = await api(kitchen, "POST", `/api/v1/staff/orders/${orderId}/ready`, { packed: true });
  expect(ready.status, JSON.stringify(ready.json)).toBe(200);
}

async function invite(
  manager: Page,
  invitee: Page,
  email: string,
  role: "KITCHEN_STAFF" | "CASHIER",
  name: string,
) {
  await manager.goto("/admin/staff");
  const desk = manager.locator("section").filter({
    has: manager.getByRole("heading", { name: "Staff" }),
  });
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
  await expect(page.getByText(/verification message has been sent/i)).toBeVisible();
  const token = await verificationToken(email);
  await page.goto(`/student/verify-email#token=${token}`);
  await expect(page.getByText("Your email is confirmed. Sign in to continue.")).toBeVisible();
  await page.goto("/student/login");
  await signIn(page, email);
  await expect(page.getByRole("heading", { name: `Hello, ${name}` })).toBeVisible();
}

async function signIn(page: Page, email: string) {
  await page.locator("#content").getByLabel("Email").first().fill(email);
  await page.locator("#content").getByLabel("Password", { exact: true }).first().fill(password);
  const login = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  expect((await login).ok()).toBeTruthy();
}

function clearPilotData() {
  psql(
    "TRUNCATE preparation_plan_events, preparation_plan_items, preparation_plans, demand_forecast_values, demand_forecast_runs, model_evaluations, forecasting_models, forecast_jobs, food_waste_records, production_quantity_events, food_production_batches, demo_demand_days, canteen_closures, push_deliveries, notification_outbox, notifications, pickup_events, pickup_credentials, cash_reversals, cash_receipts; DELETE FROM order_idempotency_records; DELETE FROM inventory_adjustments; DELETE FROM preparation_tasks; DELETE FROM order_events; DELETE FROM order_payments; DELETE FROM order_items; DELETE FROM orders; DELETE FROM staff_invitations; DELETE FROM audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER')); DELETE FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER');",
  );
}

function psql(command: string) {
  return psqlCommand(command);
}

function bootstrapManager(email: string, managerPassword: string) {
  bootstrapIsolatedManager(email, managerPassword);
}

function sql(query: string) {
  return psqlQuery(query);
}

async function verificationToken(email: string): Promise<string> {
  const query = encodeURIComponent(`to:${email}`);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const search = await fetch(`${mailpit}/api/v1/search?query=${query}`);
    const result = (await search.json()) as { messages?: { ID: string }[] };
    const id = result.messages?.[0]?.ID;
    if (id) {
      const message = await fetch(`${mailpit}/api/v1/message/${id}`);
      const body = (await message.json()) as { Text?: string };
      const match = body.Text?.match(/token=([A-Za-z0-9_-]+)/);
      if (match?.[1]) {
        return match[1];
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No message arrived for ${email}`);
}
