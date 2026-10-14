import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const password = `horse-${randomBytes(8).toString("hex")}`;
const suffix = randomBytes(3).toString("hex");
const managerEmail = `manager-${suffix}@staff.bowlbyte.edu`;
const kitchenEmail = `kitchen-${suffix}@staff.bowlbyte.edu`;
const studentEmail = `student-${suffix}@student.bowlbyte.edu`;
const otherEmail = `student-b-${suffix}@student.bowlbyte.edu`;

test.describe.configure({ mode: "serial" });

test("manager publishes an item and a student can see it", async ({ page }) => {
  test.setTimeout(120_000);
  clearStaff();
  bootstrapManager(managerEmail, password);
  await page.goto("/admin/login");
  await signIn(page, managerEmail);
  await expect(page.getByRole("heading", { name: "Hello, Pilot Manager" })).toBeVisible();
  await page.getByRole("link", { name: "Stations" }).click();
  await page.getByLabel("Station name").fill(`Sandwich ${suffix}`);
  await page.getByLabel("Capacity").fill("2");
  await page.getByRole("button", { name: "Add station" }).click();
  await expect(page.getByText("Station saved.")).toBeVisible();

  await page.goto("/admin/menu");
  await page.getByLabel("Category name").fill(`Snacks ${suffix}`);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByText("Category saved.")).toBeVisible();
  await page.getByRole("link", { name: "Add menu item" }).click();
  await fillItem(page, `Veg Sandwich ${suffix}`, "12");

  const loggedOut = page.waitForResponse(
    (response) => response.url().includes("/api/v1/auth/logout") && response.ok(),
  );
  await page.getByRole("button", { name: "Log out" }).click();
  await loggedOut;
  await registerStudent(page, studentEmail, "Asha Rao");
  await page.goto("/student/menu");
  await page.getByLabel("Search menu").fill(`Veg Sandwich ${suffix}`);
  await expect(page.getByRole("heading", { name: `Veg Sandwich ${suffix}` })).toBeVisible();
});

test("student places an order and kitchen sees the pending ticket", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.goto("/admin/login");
  await signIn(page, managerEmail);
  await page.goto("/admin/menu/new");
  await fillItem(page, `Masala Chai ${suffix}`, "8");
  await page.goto("/student/login");
  await signIn(page, studentEmail);
  await page.goto("/student/menu");
  await page.getByLabel("Search menu").fill(`Veg Sandwich ${suffix}`);
  await page.locator("article").filter({ hasText: `Veg Sandwich ${suffix}` }).getByRole("button", { name: "Add to cart" }).click();
  await page.getByLabel("Search menu").fill(`Masala Chai ${suffix}`);
  await page.locator("article").filter({ hasText: `Masala Chai ${suffix}` }).getByRole("button", { name: "Add to cart" }).click();
  await page.goto("/student/cart");
  await expect(page.getByText(`Veg Sandwich ${suffix}`)).toBeVisible();
  await expect(page.getByText(`Masala Chai ${suffix}`)).toBeVisible();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByText(/CASH · PENDING/)).toBeVisible();
  const ticket = (await page.getByRole("heading", { level: 2 }).textContent()) ?? "";
  expect(ticket).toMatch(/^B\d+$/);
  const saved = sql(
    `SELECT status, payment_method FROM orders WHERE ticket_number = '${ticket}'`,
  );
  expect(saved).toContain("PLACED");
  expect(saved).toContain("CASH");

  const kitchen = await browser.newContext();
  const kitchenPage = await kitchen.newPage();
  await page.goto("/admin/login");
  await signIn(page, managerEmail);
  await inviteKitchen(page, kitchenPage);
  await kitchenPage.goto("/staff");
  await expect(kitchenPage.getByTestId("incoming-order").filter({ hasText: ticket })).toBeVisible();
  await kitchen.close();
});

test("cancellation restores stock and another student cannot open the order", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await page.goto("/student/login");
  await signIn(page, studentEmail);
  await page.goto("/student/orders");
  await page.getByRole("link", { name: /^B\d+$/ }).first().click();
  const ticket = (await page.getByRole("heading", { level: 2 }).textContent()) ?? "";
  await page.getByRole("button", { name: "Cancel order" }).click();
  await expect(page.getByText("CANCELLED · CASH · PENDING")).toBeVisible();
  const orderUrl = page.url();
  const stock = sql(
    "SELECT available_qty, reserved_qty FROM daily_stock WHERE reserved_qty < 0 OR available_qty < 0",
  );
  expect(stock).toBe("");

  await registerStudent(page, otherEmail, "Other Student");
  const denied = await browser.newContext();
  const other = await denied.newPage();
  await other.goto("/student/login");
  await signIn(other, otherEmail);
  await expect(other.getByRole("heading", { name: "Hello, Other Student" })).toBeVisible();
  await other.goto(orderUrl);
  await expect(other.getByTestId("order-denied")).toBeVisible();
  await denied.close();
  expect(ticket.startsWith("B")).toBe(true);
});

test("two students cannot oversell the last portion", async ({ browser }) => {
  test.setTimeout(120_000);
  const manager = await browser.newContext();
  const managerPage = await manager.newPage();
  await managerPage.goto("/admin/login");
  await signIn(managerPage, managerEmail);
  await managerPage.goto("/admin/menu/new");
  await fillItem(managerPage, `Last Samosa ${suffix}`, "1");
  const itemId = managerPage.url().split("/admin/menu/")[1]?.replace("/edit", "");
  expect(itemId).toBeTruthy();

  const first = await browser.newContext();
  const second = await browser.newContext();
  const firstPage = await first.newPage();
  const secondPage = await second.newPage();
  await firstPage.goto("/student/login");
  await signIn(firstPage, studentEmail);
  const thirdEmail = `student-c-${suffix}@student.bowlbyte.edu`;
  await registerStudent(secondPage, thirdEmail, "Third Student");
  const [left, right] = await Promise.all([
    placeFromPage(firstPage, itemId),
    placeFromPage(secondPage, itemId),
  ]);
  const successes = [left, right].filter((status) => status === 201);
  expect(successes).toHaveLength(1);
  const negative = sql(
    "SELECT COUNT(*) FROM daily_stock WHERE available_qty < 0 OR reserved_qty < 0",
  );
  expect(negative.trim()).toBe("0");
  await first.close();
  await second.close();
  await manager.close();
});

async function fillItem(page: Page, name: string, stock: string) {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Description").fill("Development sample for the pilot.");
  await page.getByLabel("Price in rupees").fill("40");
  await page.getByLabel("Preparation seconds").fill("300");
  await expect(page.getByRole("option", { name: `Snacks ${suffix}` })).toHaveCount(1);
  await page.getByLabel("Category").selectOption({ label: `Snacks ${suffix}` });
  await page.getByLabel("Station").selectOption({ label: `Sandwich ${suffix}` });
  await page.getByLabel("Initial stock").fill(stock);
  await page.getByRole("button", { name: "Create item" }).click();
  await expect(page.getByRole("heading", { name: "Edit item" })).toBeVisible();
}

async function placeFromPage(page: Page, itemId: string) {
  return page.evaluate(async (id) => {
    const raw = document.cookie
      .split("; ")
      .find((row) => row.startsWith("bowlbyte_csrf="))
      ?.split("=")[1];
    const response = await fetch("/api/v1/orders", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": decodeURIComponent(raw ?? ""),
      },
      body: JSON.stringify({
        items: [{ menu_item_id: id, quantity: 1 }],
        idempotency_key: crypto.randomUUID().replace(/-/g, ""),
      }),
    });
    return response.status;
  }, itemId);
}

async function inviteKitchen(manager: Page, kitchen: Page) {
  await manager.goto("/admin/staff");
  const staffDesk = manager.locator("section").filter({
    has: manager.getByRole("heading", { name: "Staff" }),
  });
  await staffDesk.locator('input[type="email"]').fill(kitchenEmail);
  await staffDesk.getByRole("button", { name: "Invite" }).click();
  await expect(manager.getByText("Invitation sent")).toBeVisible();
  const token = await verificationToken(kitchenEmail);
  await kitchen.goto(`/invite/accept#token=${token}`);
  await kitchen.getByLabel("Full name").fill("Kitchen Lead");
  await kitchen.getByLabel("Password", { exact: true }).fill(password);
  await kitchen.getByLabel("Confirm password").fill(password);
  await kitchen.getByRole("button", { name: "Activate account" }).click();
  await expect(kitchen.getByText("Your staff account is active")).toBeVisible();
  await kitchen.goto("/staff/login");
  await signIn(kitchen, kitchenEmail);
}

async function registerStudent(page: Page, email: string, name: string) {
  await page.goto("/student/register");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("College roll number").fill(`E2E${randomBytes(3).toString("hex").toUpperCase()}`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
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
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
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
      "DELETE FROM order_idempotency_records; DELETE FROM inventory_adjustments; DELETE FROM preparation_tasks; DELETE FROM order_events; DELETE FROM order_payments; DELETE FROM order_items; DELETE FROM orders; DELETE FROM staff_invitations; DELETE FROM audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER')); DELETE FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER');",
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

function sql(query: string) {
  return execFileSync(
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
      "-tAc",
      query,
    ],
    { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" },
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
