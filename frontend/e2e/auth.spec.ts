import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { expect, test } from "@playwright/test";

const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const password = `horse-${randomBytes(8).toString("hex")}`;
const roll = `E2E${randomBytes(3).toString("hex").toUpperCase()}`;
const studentEmail = `student-${randomBytes(4).toString("hex")}@student.bowlbyte.edu`;
const managerEmail = `manager-${randomBytes(4).toString("hex")}@staff.bowlbyte.edu`;
const kitchenEmail = `kitchen-${randomBytes(4).toString("hex")}@staff.bowlbyte.edu`;

test.describe.configure({ mode: "serial" });

test("registration layout stays usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/student/register");

  await expect(page.getByRole("heading", { name: "Create a student account" })).toBeVisible();
  await expect(page.getByText("Menu", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});

test("student can verify, stay signed in, and lose access after logout", async ({ page }) => {
  await page.goto("/student/register");
  await page.getByLabel("Full name").fill("Asha Rao");
  await page.getByLabel("Email").fill(studentEmail);
  await page.getByLabel("College roll number").fill(roll);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/verification message has been sent/i)).toBeVisible();

  const token = await verificationToken(studentEmail);
  await page.goto(`/student/verify-email#token=${token}`);
  await expect(page.getByText("Your email is confirmed. Sign in to continue.")).toBeVisible();
  await page.getByRole("link", { name: "Go to student sign-in" }).click();
  await signIn(page, studentEmail);
  await expect(page.getByRole("heading", { name: "Hello, Asha Rao" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hello, Asha Rao" })).toBeVisible();

  await page.goto("/admin");
  await expect(page.getByTestId("access-denied")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/v1/auth/logout") && response.status() === 200,
    ),
    page.getByRole("button", { name: "Log out" }).click(),
  ]);
  await page.goto("/student");
  await expect(page.getByRole("heading", { name: "Student sign-in" })).toBeVisible();
});

test("manager invitation, kitchen login, and deactivation", async ({ browser, page }) => {
  test.setTimeout(120_000);
  clearExistingManagers();
  bootstrapManager(managerEmail, password);
  await page.goto("/admin/login");
  await signIn(page, managerEmail);
  await expect(page.getByRole("heading", { name: "Hello, Pilot Manager" })).toBeVisible();
  await page.getByRole("link", { name: "Staff" }).click();
  const staffDesk = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Staff" }),
  });
  await staffDesk.locator('input[type="email"]').fill(kitchenEmail);
  await staffDesk.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByText("Invitation sent")).toBeVisible();

  const token = await verificationToken(kitchenEmail);
  const kitchen = await browser.newContext();
  const kitchenPage = await kitchen.newPage();
  await kitchenPage.goto(`/invite/accept#token=${token}`);
  await kitchenPage.getByLabel("Full name").fill("Kitchen Lead");
  await kitchenPage.getByLabel("Password", { exact: true }).fill(password);
  await kitchenPage.getByLabel("Confirm password").fill(password);
  await kitchenPage.getByRole("button", { name: "Activate account" }).click();
  await expect(kitchenPage.getByText("Your staff account is active")).toBeVisible();
  await kitchenPage.goto("/staff/login");
  await signIn(kitchenPage, kitchenEmail);
  await expect(kitchenPage.getByRole("heading", { name: "Hello, Kitchen Lead" })).toBeVisible();
  await kitchenPage.goto("/cashier");
  await expect(kitchenPage.getByTestId("access-denied")).toBeVisible();

  await page.reload();
  const kitchenRow = staffDesk.locator("li").filter({ hasText: kitchenEmail });
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/admin/staff/") &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
    ),
    kitchenRow.getByRole("button", { name: "Deactivate" }).click(),
  ]);
  await expect(kitchenRow).toContainText("DISABLED");
  await kitchenPage.goto("/staff");
  await expect(kitchenPage.getByRole("heading", { name: "Kitchen sign-in" })).toBeVisible();
  await kitchen.close();
});

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

function clearExistingManagers() {
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
