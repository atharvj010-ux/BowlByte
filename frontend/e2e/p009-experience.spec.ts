import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const password = `horse-${randomBytes(8).toString("hex")}`;
const suffix = randomBytes(3).toString("hex");
const managerEmail = `manager-p009-${suffix}@staff.bowlbyte.edu`;
const studentEmail = `student-p009-${suffix}@student.bowlbyte.edu`;

test("premium landing page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Zero queue drama/i })).toBeVisible();
  await expect(page.getByTestId("food-hero")).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore menu" })).toBeVisible();
  await expect(page.getByRole("link", { name: "How it works" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not in this release" })).toBeVisible();
});

test("landing welcome animation completes", async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.removeItem("bowlbyte.welcome"));
  await page.goto("/");
  await expect(page.getByTestId("welcome")).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByTestId("welcome")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("reduced motion skips the welcome sequence", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByTestId("welcome")).toHaveCount(0);
  await expect(page.getByTestId("food-hero")).toBeVisible();
});

test("mobile landing has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("menu, cart flight, pairing, and confirmed order success", async ({ page }) => {
  test.setTimeout(240_000);
  clearStaff();
  bootstrapManager(managerEmail, password);
  await page.goto("/admin/login");
  await signIn(page, managerEmail);
  await page.getByRole("link", { name: "Stations" }).click();
  await page.locator("#content").getByLabel("Station name").first().fill(`Grill ${suffix}`);
  await page.locator("#content").getByLabel("Capacity").first().fill("2");
  await page.getByRole("button", { name: "Add station" }).click();
  await expect(page.getByText("Station saved.")).toBeVisible();
  await page.goto("/admin/menu");
  await page.locator("#content").getByLabel("Category name").first().fill(`Snacks ${suffix}`);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByText("Category saved.")).toBeVisible();
  await page.locator("#content").getByLabel("Category name").first().fill(`Drinks ${suffix}`);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByText("Category saved.")).toBeVisible();

  await page.getByRole("link", { name: "Add menu item" }).click();
  await fillItem(page, `Salted Fries ${suffix}`, `Snacks ${suffix}`, "4");
  const friesId = page.url().split("/").at(-2) ?? "";
  const nutrition = await page.evaluate(async (id) => {
    const raw = document.cookie
      .split("; ")
      .find((row) => row.startsWith("bowlbyte_csrf="))
      ?.split("=")[1];
    const response = await fetch(`/api/v1/admin/menu/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": decodeURIComponent(raw ?? ""),
      },
      body: JSON.stringify({
        calories_kcal: 280,
        nutrition_source: "ILLUSTRATIVE",
        serving_size_description: "one serving",
        nutrition_reference: "Labeled demo figure, not a lab test.",
      }),
    });
    return { status: response.status, body: await response.json() };
  }, friesId);
  expect(nutrition.status).toBe(200);
  expect(nutrition.body.calories_kcal).toBe(280);

  await page.goto("/admin/menu/new");
  await fillItem(page, `Coke ${suffix}`, `Drinks ${suffix}`, "3");
  const cokeId = page.url().split("/").at(-2) ?? "";
  const pairing = await page.evaluate(
    async ({ sourceId, suggestedId }) => {
      const raw = document.cookie
        .split("; ")
        .find((row) => row.startsWith("bowlbyte_csrf="))
        ?.split("=")[1];
      const response = await fetch(`/api/v1/admin/menu/${sourceId}/pairings`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": decodeURIComponent(raw ?? ""),
        },
        body: JSON.stringify({ suggested_item_id: suggestedId, priority: 5 }),
      });
      return response.status;
    },
    { sourceId: friesId, suggestedId: cokeId },
  );
  expect(pairing).toBe(201);

  const loggedOut = page.waitForResponse(
    (response) => response.url().includes("/api/v1/auth/logout") && response.ok(),
  );
  await page.getByRole("button", { name: "Log out" }).click();
  await loggedOut;
  await registerStudent(page, studentEmail, "Asha Rao");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/student/menu");
  const menuOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(menuOverflow).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.locator("#content").getByLabel("Search menu").first().fill(`Salted Fries ${suffix}`);
  const fries = page.locator("article").filter({ hasText: `Salted Fries ${suffix}` });
  await expect(fries.getByText("Illustrative 280 kcal / one serving")).toBeVisible();
  await fries.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("link", { name: "Cart 1" })).toBeVisible();
  await fries.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("link", { name: "Cart 2" })).toBeVisible();

  await fries.getByRole("heading", { name: `Salted Fries ${suffix}` }).getByRole("button").click();
  await expect(page.getByTestId("pairings")).toContainText(`Coke ${suffix}`);
  await page.getByRole("dialog").getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("link", { name: "Cart 3" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.goto("/student/cart");
  await expect(page.getByText("Pay cash when collecting your food.")).toBeVisible();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByTestId("order-success")).toBeVisible();
  await expect(page.getByTestId("order-payment")).toContainText("PLACED");
  await expect(page.getByTestId("order-payment")).toContainText("CASH");
  await expect(page.getByTestId("order-payment")).toContainText("PENDING");
  const ticket = (await page.getByRole("heading", { level: 2 }).textContent()) ?? "";
  expect(ticket).toMatch(/^B\d+$/);
  await page.getByRole("button", { name: "Track my order" }).click();
  await expect(page.getByRole("heading", { level: 2, name: ticket.trim() })).toBeVisible();
  await expect(page.getByTestId("order-status")).toContainText("PLACED");
});

async function fillItem(page: Page, name: string, category: string, stock: string) {
  await page.locator("#content").getByLabel("Name").first().fill(name);
  await page.locator("#content").getByLabel("Description").first().fill("Development sample for the pilot.");
  await page.locator("#content").getByLabel("Price in rupees").first().fill("40");
  await page.locator("#content").getByLabel("Preparation seconds").first().fill("300");
  await page.locator("#content").getByLabel("Category").first().selectOption({ label: category });
  await page.locator("#content").getByLabel("Station").first().selectOption({ label: `Grill ${suffix}` });
  await page.locator("#content").getByLabel("Initial stock").first().fill(stock);
  await page.getByRole("button", { name: "Create item" }).click();
  await expect(page.getByRole("heading", { name: "Edit item" })).toBeVisible();
}

async function registerStudent(page: Page, email: string, name: string) {
  await page.goto("/student/register");
  await page.locator("#content").getByLabel("Full name").first().fill(name);
  await page.locator("#content").getByLabel("Email").first().fill(email);
  await page.locator("#content").getByLabel("College roll number").first().fill(`P009${randomBytes(3).toString("hex").toUpperCase()}`);
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

function clearStaff() {
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "bowlbyte",
      "-d",
      "bowlbyte",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "TRUNCATE preparation_plan_events, preparation_plan_items, preparation_plans, demand_forecast_values, demand_forecast_runs, model_evaluations, forecasting_models, forecast_jobs, food_waste_records, production_quantity_events, food_production_batches, demo_demand_days, canteen_closures, push_deliveries, notification_outbox, notifications, pickup_events, pickup_credentials, cash_reversals, cash_receipts; DELETE FROM order_idempotency_records; DELETE FROM inventory_adjustments; DELETE FROM preparation_tasks; DELETE FROM order_events; DELETE FROM order_payments; DELETE FROM order_items; DELETE FROM orders; DELETE FROM staff_invitations; DELETE FROM audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER')); DELETE FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER');",
    ],
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
    {
      cwd: path.resolve(__dirname, "../.."),
      input: `${managerPassword}\n`,
      encoding: "utf8",
    },
  );
}

async function verificationToken(email: string): Promise<string> {
  const query = encodeURIComponent(`to:${email}`);
  for (let attempt = 0; attempt < 30; attempt += 1) {
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
  throw new Error(`No Mailpit token for ${email}`);
}
