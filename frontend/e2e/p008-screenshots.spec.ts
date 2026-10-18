import { randomBytes } from "node:crypto";

import { bootstrapIsolatedManager, psqlCommand, psqlQuery } from "./safe-db";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Captures the demonstration pages at phone, tablet, and desktop widths.
 * Accounts and the dish are synthetic. The pictured pickup QR is redeemed
 * before the test ends, so the image is not a live credential.
 */

const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const password = `horse-${randomBytes(8).toString("hex")}`;
const suffix = randomBytes(3).toString("hex");
const managerEmail = `manager-shot-${suffix}@staff.bowlbyte.edu`;
const kitchenEmail = `kitchen-shot-${suffix}@staff.bowlbyte.edu`;
const cashierEmail = `cashier-shot-${suffix}@staff.bowlbyte.edu`;
const studentEmail = `student-shot-${suffix}@student.bowlbyte.edu`;
const dish = `Demo Dosa ${suffix}`;
const outDir = path.resolve(
  process.env.E2E_SCREENSHOT_DIR ?? path.join(__dirname, "../../deliverables/report/screenshots"),
);
const widths = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1280", width: 1280, height: 800 },
];

test.describe.configure({ mode: "serial" });
test.setTimeout(420_000);

test("capture pilot screens at three widths", async ({ browser }) => {
  mkdirSync(outDir, { recursive: true });
  clearPilotData();
  bootstrapManager(managerEmail, password);

  const manager = await open(browser);
  const kitchen = await open(browser);
  const cashier = await open(browser);
  const student = await open(browser);
  const pages = [manager, kitchen, cashier, student];

  await manager.goto("/admin/login");
  await signIn(manager, managerEmail);
  await manager.goto("/admin/stations");
  await manager.locator("#content").getByLabel("Station name").first().fill(`Dosa ${suffix}`);
  await manager.locator("#content").getByLabel("Capacity").first().fill("4");
  await manager.locator("#content").getByRole("button", { name: "Add station" }).first().click();
  await expect(manager.getByText("Station saved.")).toBeVisible();
  await manager.goto("/admin/menu");
  await manager.locator("#content").getByLabel("Category name").first().fill(`South ${suffix}`);
  await manager.locator("#content").getByRole("button", { name: "Add category" }).first().click();
  await expect(manager.getByText("Category saved.")).toBeVisible();
  await manager.getByRole("link", { name: "Add menu item" }).click();
  await manager.locator("#content").getByLabel("Name").first().fill(dish);
  await manager.locator("#content").getByLabel("Description").first().fill("Synthetic demonstration item.");
  await manager.locator("#content").getByLabel("Price in rupees").first().fill("40");
  await manager.locator("#content").getByLabel("Preparation seconds").first().fill("120");
  await manager.locator("#content").getByLabel("Category").first().selectOption({ label: `South ${suffix}` });
  await manager.locator("#content").getByLabel("Station").first().selectOption({ label: `Dosa ${suffix}` });
  await manager.locator("#content").getByLabel("Initial stock").first().fill("20");
  await manager.getByRole("button", { name: "Create item" }).click();
  await expect(manager.getByRole("heading", { name: "Edit item" })).toBeVisible();

  await invite(manager, kitchen, kitchenEmail, "KITCHEN_STAFF", "Demo Kitchen");
  await invite(manager, cashier, cashierEmail, "CASHIER", "Demo Cashier");
  await kitchen.goto("/staff/login");
  await signIn(kitchen, kitchenEmail);
  await cashier.goto("/cashier/login");
  await signIn(cashier, cashierEmail);
  await registerStudent(student, studentEmail, "Demo Student");

  const landing = await open(browser);
  pages.push(landing);
  await landing.goto("/");
  await expect(landing.getByRole("heading", { name: /Zero queue/i })).toBeVisible();
  await shoot(landing, "landing");
  await landing.goto("/student/login");
  await expect(landing.getByRole("button", { name: "Sign in" })).toBeVisible();
  await shoot(landing, "student-login");

  await student.goto("/student");
  await expect(student.getByRole("heading", { name: "Hello, Demo Student" })).toBeVisible();
  await shoot(student, "student-home");
  await student.goto("/student/menu");
  await student.locator("#content").getByPlaceholder("Search").first().fill(dish);
  const add = student.locator("article").filter({ hasText: dish }).getByRole("button", { name: "Add to cart" }).first();
  await expect(add).toBeVisible();
  await add.click();
  await shoot(student, "menu");
  await student.goto("/student/cart");
  await expect(student.getByRole("heading", { name: "Cart" })).toBeVisible();
  await shoot(student, "cart");
  await student.getByRole("button", { name: "Place order" }).click();
  await student.getByRole("button", { name: "Track my order" }).click();
  await student.waitForURL(/\/student\/orders\/[0-9a-f-]+$/);
  const orderId = student.url().split("/").pop() ?? "";
  await expect(student.getByTestId("order-status").filter({ visible: true })).toContainText(/PLACED|ACCEPTED|QUEUED|PREPARING|READY/);
  await expect(student.getByTestId("connection-state").first()).toContainText("Live updates connected", {
    timeout: 15_000,
  });
  await shoot(student, "tracking");

  const accepted = await api(kitchen, "POST", `/api/v1/staff/orders/${orderId}/accept`);
  expect(accepted.status, JSON.stringify(accepted.json)).toBe(200);
  await kitchen.goto("/staff/queue");
  await expect(kitchen.getByText(dish).first()).toBeVisible({ timeout: 15_000 });
  await expect(kitchen.getByTestId("connection-state").first()).toContainText("Live updates connected", {
    timeout: 15_000,
  });
  await shoot(kitchen, "kitchen");

  const queue = await api(kitchen, "GET", "/api/v1/staff/queue");
  const order = (queue.json.orders as { id: string; tasks: { id: string }[] }[]).find(
    (entry) => entry.id === orderId,
  );
  expect(order).toBeTruthy();
  for (const task of order!.tasks) {
    expect((await api(kitchen, "POST", `/api/v1/staff/preparation-tasks/${task.id}/start`)).status).toBe(200);
    expect((await api(kitchen, "POST", `/api/v1/staff/preparation-tasks/${task.id}/complete`)).status).toBe(200);
  }
  expect((await api(kitchen, "POST", `/api/v1/staff/orders/${orderId}/ready`, { packed: true })).status).toBe(200);

  await student.reload();
  await expect(student.locator("#content").getByTestId("show-pickup").first()).toBeVisible({ timeout: 15_000 });
  await student.locator("#content").getByTestId("show-pickup").first().click();
  const qr = student.locator("#content").getByTestId("pickup-qr").first();
  await expect(qr).toBeVisible();
  const box = await qr.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(160);
  await shoot(student, "qr-pass");

  await cashier.goto("/cashier");
  await expect(cashier.getByRole("button", { name: "Scan QR code" })).toBeVisible();
  await expect(cashier.getByTestId("cashier-live").first()).toContainText("Live updates connected", {
    timeout: 15_000,
  });
  await shoot(cashier, "cashier");

  const price = Number(sql(`SELECT total_paise FROM orders WHERE id = '${orderId}'`).trim());
  const paid = await api(cashier, "POST", `/api/v1/cashier/orders/${orderId}/confirm-cash`, {
    amount_paise: price,
    idempotency_key: randomBytes(12).toString("hex"),
  });
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  const credential = sql(
    `SELECT token_hash IS NOT NULL FROM pickup_credentials WHERE order_id = '${orderId}' ORDER BY created_at DESC LIMIT 1`,
  ).trim();
  expect(credential).toBe("t");
  const code = (await student.locator("#content").getByTestId("pickup-code").first().innerText()).trim();
  const handed = await api(cashier, "POST", `/api/v1/cashier/orders/${orderId}/complete-pickup`, {
    code,
    idempotency_key: randomBytes(12).toString("hex"),
  });
  expect(handed.status, JSON.stringify(handed.json)).toBe(200);

  await manager.goto("/admin");
  await expect(manager.getByRole("link", { name: "Intelligence" })).toBeVisible();
  await shoot(manager, "manager");
  await manager.goto("/admin/cash");
  await expect(manager.getByText(/cash|receipt/i).first()).toBeVisible();
  await shoot(manager, "cash-audit");
  await manager.goto("/admin/intelligence/forecasts");
  await manager.getByTestId("load-demo").first().click();
  await expect(manager.getByTestId("forecast-notice").first()).toContainText(/demo|synthetic|seed/i, { timeout: 20_000 });
  await manager.getByTestId("train-demo").first().click();
  await expect(manager.getByTestId("forecast-notice").first()).toContainText(/SUCCEEDED|FAILED/, { timeout: 90_000 });
  await shoot(manager, "forecast");

  await Promise.all(pages.map((page) => page.context().close()));
});

async function shoot(page: Page, name: string) {
  for (const viewport of widths) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${name} at ${viewport.name}`).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: path.join(outDir, `${name}-${viewport.name}.png`),
      fullPage: true,
    });
  }
}

async function open(browser: Browser): Promise<Page> {
  const context: BrowserContext = await browser.newContext();
  return context.newPage();
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
      return { status: response.status, json: json as { orders?: unknown } };
    },
    { method, url, body },
  );
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
  await page.locator("#content").getByLabel("College roll number").first().fill(`SHOT${randomBytes(3).toString("hex").toUpperCase()}`);
  await page.locator("#content").getByLabel("Password", { exact: true }).first().fill(password);
  await page.locator("#content").getByLabel("Confirm password").first().fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/verification message has been sent/i)).toBeVisible();
  const token = await verificationToken(email);
  await page.goto(`/student/verify-email#token=${token}`);
  await expect(page.getByText("Your email is confirmed. Sign in to continue.")).toBeVisible();
  await page.goto("/student/login");
  await signIn(page, email);
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

function clearPilotData() {
  psql(
    "TRUNCATE preparation_plan_events, preparation_plan_items, preparation_plans, demand_forecast_values, demand_forecast_runs, model_evaluations, forecasting_models, forecast_jobs, food_waste_records, production_quantity_events, food_production_batches, demo_demand_days, canteen_closures, push_deliveries, notification_outbox, notifications, pickup_events, pickup_credentials, cash_reversals, cash_receipts, order_hold_events; DELETE FROM order_idempotency_records; DELETE FROM inventory_adjustments; DELETE FROM preparation_tasks; DELETE FROM order_events; DELETE FROM order_payments; DELETE FROM order_items; DELETE FROM orders; DELETE FROM staff_invitations; DELETE FROM audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER')); DELETE FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER');",
  );
}

function psql(command: string) {
  return psqlCommand(command);
}

function bootstrapManager(email: string, managerPassword: string) {
  bootstrapIsolatedManager(email, managerPassword, "Demo Manager");
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
