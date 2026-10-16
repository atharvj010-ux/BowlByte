import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const password = `horse-${randomBytes(8).toString("hex")}`;
const suffix = randomBytes(3).toString("hex");
const managerEmail = `manager-${suffix}@staff.bowlbyte.edu`;
const cashierEmail = `cashier-${suffix}@staff.bowlbyte.edu`;
const studentEmail = `student-${suffix}@student.bowlbyte.edu`;
const dish = `Idli ${suffix}`;

test.describe.configure({ mode: "serial" });

const pages = {} as Record<"manager" | "cashier" | "student", Page>;
const contexts: BrowserContext[] = [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  clearPilotData();
  bootstrapManager(managerEmail, password);
  pages.manager = await open(browser);
  pages.cashier = await open(browser);
  pages.student = await open(browser);
  await pages.manager.goto("/admin/login");
  await signIn(pages.manager, managerEmail);
  await pages.manager.goto("/admin/stations");
  await pages.manager.locator("#content").getByLabel("Station name").first().fill(`Idli ${suffix}`);
  await pages.manager.locator("#content").getByLabel("Capacity").first().fill("2");
  await pages.manager.locator("#content").getByRole("button", { name: "Add station" }).first().click();
  await expect(pages.manager.getByText("Station saved.")).toBeVisible();
  await pages.manager.goto("/admin/menu");
  await pages.manager.locator("#content").getByLabel("Category name").first().fill(`Breakfast ${suffix}`);
  await pages.manager.locator("#content").getByRole("button", { name: "Add category" }).first().click();
  await expect(pages.manager.getByText("Category saved.")).toBeVisible({ timeout: 15_000 });
  await pages.manager.getByRole("link", { name: "Add menu item" }).click();
  await pages.manager.locator("#content").getByLabel("Name").first().fill(dish);
  await pages.manager.locator("#content").getByLabel("Description").first().fill("Steamed cakes for the pilot.");
  await pages.manager.locator("#content").getByLabel("Price in rupees").first().fill("30");
  await pages.manager.locator("#content").getByLabel("Preparation seconds").first().fill("120");
  await pages.manager.locator("#content").getByLabel("Category").first().selectOption({ label: `Breakfast ${suffix}` });
  await pages.manager.locator("#content").getByLabel("Station").first().selectOption({ label: `Idli ${suffix}` });
  await pages.manager.locator("#content").getByLabel("Initial stock").first().fill("40");
  await pages.manager.getByRole("button", { name: "Create item" }).click();
  await expect(pages.manager.getByRole("heading", { name: "Edit item" })).toBeVisible();
  await invite(pages.manager, pages.cashier, cashierEmail);
  await pages.cashier.goto("/cashier/login");
  await signIn(pages.cashier, cashierEmail);
  await registerStudent(pages.student, studentEmail);
});

test.afterAll(async () => {
  for (const context of contexts) {
    await context.close().catch(() => undefined);
  }
});

test("scenario 1: production and waste show up in recorded analytics", async () => {
  test.setTimeout(60_000);
  const manager = pages.manager;
  await manager.goto("/admin/production");
  const day = await manager.locator("#content").getByTestId("production-date").first().inputValue();
  await manager.locator("#content").getByTestId("production-search").first().fill(dish);
  await manager.locator("#content").getByTestId("production-item").first().selectOption({ label: dish });
  await manager.locator("#content").getByTestId("production-qty").first().fill("12");
  await manager.locator("#content").getByTestId("production-save").first().click();
  await expect(manager.locator("#content").getByTestId("production-notice").first()).toContainText("Production batch saved");
  await expect(manager.locator("#content").getByTestId("production-list").first()).toContainText("Produced 12");

  await manager.goto("/admin/waste");
  await manager.locator("#content").getByTestId("waste-date").first().fill(day);
  await manager.locator("#content").getByTestId("waste-search").first().fill(dish);
  await manager.locator("#content").getByTestId("waste-item").first().selectOption({ label: dish });
  await manager.locator("#content").getByTestId("waste-qty").first().fill("2");
  await manager.locator("#content").getByTestId("waste-reason").first().selectOption("UNSOLD");
  await manager.locator("#content").getByTestId("waste-save").first().click();
  await expect(manager.locator("#content").getByTestId("waste-notice").first()).toContainText("Discard recorded");

  await manager.goto("/admin/intelligence");
  await manager.locator("#content").getByTestId("overview-from").first().fill(day);
  await manager.locator("#content").getByTestId("overview-to").first().fill(day);
  await expect(manager.locator("#content").getByTestId("produced").first()).toContainText("12");
  await expect(manager.locator("#content").getByTestId("discarded").first()).toContainText("2");
  await expect(manager.locator("#content").getByTestId("source-badge").first()).toContainText("ACTUAL");
});

test("scenario 2: demo training persists an evaluation", async () => {
  test.setTimeout(180_000);
  const manager = pages.manager;
  await manager.goto("/admin/intelligence/forecasts");
  await manager.locator("#content").getByTestId("load-demo").first().click();
  await expect(manager.locator("#content").getByTestId("forecast-notice").first()).toContainText("Demo history");
  await manager.locator("#content").getByTestId("train-demo").first().click();
  await expect(manager.locator("#content").getByTestId("forecast-notice").first()).toContainText("SUCCEEDED", { timeout: 120_000 });
  await expect(manager.locator("#content").getByTestId("model-list").first()).toContainText("DEMO");
  expect(sql("SELECT count(*) FROM model_evaluations").trim()).not.toBe("0");
  expect(sql("SELECT count(*) FROM orders").trim()).toBe("0");
});

test("scenario 3: forecasts are stored and hidden from students and cashiers", async () => {
  const manager = pages.manager;
  await manager.goto("/admin/intelligence/forecasts");
  await manager.locator("#content").getByTestId("forecast-demo").first().click();
  await expect(manager.locator("#content").getByTestId("forecast-result").first()).toContainText("DEMO");
  expect(sql("SELECT count(*) FROM demand_forecast_runs").trim()).not.toBe("0");
  const cashier = await api(pages.cashier, "GET", "/api/v1/admin/forecasts");
  const student = await api(pages.student, "GET", "/api/v1/admin/forecasts");
  expect(cashier.status).toBe(403);
  expect(student.status).toBe(403);
});

test("scenario 4: approving a plan does not create production", async () => {
  const before = sql("SELECT count(*) FROM food_production_batches").trim();
  const manager = pages.manager;
  await manager.goto("/admin/intelligence/planning");
  await manager.locator("#content").getByTestId("plan-generate").first().click();
  await expect(manager.locator("#content").getByTestId("plan-status").first()).toContainText("DRAFT");
  await manager.locator("#content").getByTestId("plan-approve").first().click();
  await expect(manager.locator("#content").getByTestId("plan-status").first()).toContainText("APPROVED");
  expect(sql("SELECT count(*) FROM food_production_batches").trim()).toBe(before);
  expect(sql("SELECT status FROM preparation_plans ORDER BY created_at DESC LIMIT 1").trim()).toBe("APPROVED");
});

test("scenario 5: a station simulation changes the estimate and leaves stock alone", async () => {
  const stock = sql("SELECT coalesce(sum(available_qty), 0) FROM daily_stock").trim();
  const orders = sql("SELECT count(*) FROM orders").trim();
  const manager = pages.manager;
  await manager.goto("/admin/intelligence/planning");
  await manager.locator("#content").getByTestId("simulate-station").first().selectOption({ label: `Idli ${suffix}` });
  await manager.locator("#content").getByTestId("demand-factor").first().fill("1.2");
  await manager.locator("#content").getByTestId("simulate-run").first().click();
  await expect(manager.locator("#content").getByTestId("simulate-label").first()).toContainText("Estimate");
  await expect(manager.locator("#content").getByTestId("simulate-items").first()).toContainText("Unmet");
  expect(sql("SELECT coalesce(sum(available_qty), 0) FROM daily_stock").trim()).toBe(stock);
  expect(sql("SELECT count(*) FROM orders").trim()).toBe(orders);
});

test("scenario 6: recorded history without enough days stays insufficient", async () => {
  const manager = pages.manager;
  await manager.goto("/admin/intelligence/forecasts");
  await manager.locator("#content").getByTestId("train-real").first().click();
  await expect(manager.locator("#content").getByTestId("forecast-notice").first()).toContainText("SUCCEEDED", { timeout: 120_000 });
  await manager.locator("#content").getByTestId("forecast-real").first().click();
  await expect(manager.locator("#content").getByTestId("forecast-result").first()).toContainText("INSUFFICIENT_DATA");
});

async function open(browser: Browser): Promise<Page> {
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

async function invite(manager: Page, invitee: Page, email: string) {
  await manager.goto("/admin/staff");
  const desk = manager.locator("section").filter({ has: manager.getByRole("heading", { name: "Staff" }) });
  await desk.locator('input[type="email"]').fill(email);
  await desk.locator("select").selectOption("CASHIER");
  await desk.getByRole("button", { name: "Invite" }).click();
  await expect(manager.getByText("Invitation sent")).toBeVisible();
  const token = await verificationToken(email);
  await invitee.goto(`/invite/accept#token=${token}`);
  await invitee.locator("#content").getByLabel("Full name").first().fill("Counter Cashier");
  await invitee.locator("#content").getByLabel("Password", { exact: true }).first().fill(password);
  await invitee.locator("#content").getByLabel("Confirm password").first().fill(password);
  await invitee.getByRole("button", { name: "Activate account" }).click();
  await expect(invitee.getByText("Your staff account is active")).toBeVisible();
}

async function registerStudent(page: Page, email: string) {
  await page.goto("/student/register");
  await page.locator("#content").getByLabel("Full name").first().fill("Asha Rao");
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
}

async function api(page: Page, method: string, url: string) {
  return page.evaluate(
    async ({ method, url }) => {
      const response = await fetch(url, { method, credentials: "include" });
      return { status: response.status };
    },
    { method, url },
  );
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

function clearPilotData() {
  psql(
    "TRUNCATE preparation_plan_events, preparation_plan_items, preparation_plans, demand_forecast_values, demand_forecast_runs, model_evaluations, forecasting_models, forecast_jobs, food_waste_records, production_quantity_events, food_production_batches, demo_demand_days, canteen_closures, push_deliveries, notification_outbox, notifications, pickup_events, pickup_credentials, cash_reversals, cash_receipts; DELETE FROM order_idempotency_records; DELETE FROM inventory_adjustments; DELETE FROM preparation_tasks; DELETE FROM order_events; DELETE FROM order_payments; DELETE FROM order_items; DELETE FROM orders; DELETE FROM staff_invitations; DELETE FROM audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER')); DELETE FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER');",
  );
}

function psql(command: string) {
  execFileSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "psql", "-U", "bowlbyte", "-d", "bowlbyte", "-v", "ON_ERROR_STOP=1", "-c", command],
    { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" },
  );
}

function sql(query: string) {
  return execFileSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "psql", "-U", "bowlbyte", "-d", "bowlbyte", "-tAc", query],
    { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" },
  );
}

function bootstrapManager(email: string, managerPassword: string) {
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "-e",
      `BOWLBYTE_BOOTSTRAP_EMAIL=${email}`,
      "-e",
      "BOWLBYTE_BOOTSTRAP_NAME=Pilot Manager",
      "backend",
      "python",
      "-m",
      "app.cli.bootstrap_manager",
    ],
    { cwd: path.resolve(__dirname, "../.."), input: `${managerPassword}\n`, encoding: "utf8" },
  );
}
