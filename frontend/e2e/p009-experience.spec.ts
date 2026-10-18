import { randomBytes } from "node:crypto";

import { bootstrapIsolatedManager, psqlCommand } from "./safe-db";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const shotsDir = process.env.P009_SHOTS ? path.resolve(__dirname, "../../docs/screenshots/p009") : null;

async function shot(page: Page, name: string, fullPage = false) {
  if (!shotsDir) {
    return;
  }
  fs.mkdirSync(shotsDir, { recursive: true });
  await page.evaluate(() =>
    Promise.race([
      Promise.all([
        ...[...document.images]
          .filter((img) => img.getBoundingClientRect().bottom > 0 && img.getBoundingClientRect().top < innerHeight * 3)
          .map((img) => {
            img.loading = "eager";
            return img.decode().catch(() => undefined);
          }),
        ...document
          .getAnimations()
          .filter((animation) => {
            const target = (animation.effect as KeyframeEffect | null)?.target;
            return target instanceof Element && target.classList.contains("kin-ch-load");
          })
          .map((animation) => animation.finished.catch(() => undefined)),
      ]),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]),
  );
  await page.screenshot({ path: path.join(shotsDir, `${name}.jpg`), type: "jpeg", quality: 72, fullPage });
}

async function scrollScene(page: Page, selector: string, progress: number) {
  await page.evaluate(
    ({ selector, progress }) => {
      const node = document.querySelector<HTMLElement>(selector);
      if (!node) {
        return;
      }
      const top = node.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top + Math.max(0, node.offsetHeight - window.innerHeight) * progress);
    },
    { selector, progress },
  );
  await page.waitForTimeout(1400);
}

test("capture landing frames at five widths", async ({ page }) => {
  test.skip(!shotsDir, "Set P009_SHOTS=1 to capture screenshots.");
  test.setTimeout(240_000);
  for (const width of [1440, 1280, 768, 390, 360]) {
    const full = width === 1440 || width === 390;
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    await page.goto("/");
    if (full) {
      await page.waitForTimeout(2900);
      await shot(page, `entrance-mid-${width}`);
    }
    await expect(shown(page, "food-hero")).toHaveAttribute("data-stage", "settled", { timeout: 10_000 });
    await page.waitForTimeout(600);
    await shot(page, `hero-settled-${width}`);
    await scrollScene(page, "#cravings", 0.36);
    await shot(page, `kinetic-break-${width}`);
    await scrollScene(page, "#cravings", 0.9);
    await shot(page, `kinetic-made-fresh-${width}`);
    if (full) {
      await scrollScene(page, ".fresh", 0);
      await shot(page, `made-fresh-${width}`);
      await scrollScene(page, "#how-it-works", 0.5);
      await shot(page, `journey-${width}`);
      await scrollScene(page, ".kin-scene:not(#cravings)", 0.62);
      await shot(page, `kinetic-kitchen-${width}`);
      await scrollScene(page, ".pay", 0);
      await shot(page, `pay-pickup-${width}`);
      await scrollScene(page, ".intel", 0);
      await shot(page, `intelligence-${width}`);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `overflow at ${width}`).toBeLessThanOrEqual(1);
  }
});

const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const password = `horse-${randomBytes(8).toString("hex")}`;
const suffix = randomBytes(3).toString("hex");
const managerEmail = `manager-p009-${suffix}@staff.bowlbyte.edu`;
const studentEmail = `student-p009-${suffix}@student.bowlbyte.edu`;

test("premium landing page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Zero queue drama/i })).toBeVisible();
  await expect(shown(page, "food-hero")).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore menu" })).toBeVisible();
  await expect(page.getByRole("link", { name: "How it works" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not in this release" })).toBeVisible();
});

test("entrance can be skipped and settles all four stations", async ({ page }) => {
  await page.goto("/");
  await expect(shown(page, "entrance")).toBeVisible();
  await shown(page, "entrance").getByRole("button", { name: "Skip" }).click();
  await expect(shown(page, "entrance")).toHaveCount(0);
  await expect(shown(page, "food-hero")).toHaveAttribute("data-stage", "settled");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("entrance replays on refresh but not on client navigation", async ({ page }) => {
  await page.goto("/");
  await expect(shown(page, "food-hero")).toHaveAttribute("data-stage", "settled", { timeout: 10_000 });
  await page.getByRole("link", { name: "Status" }).first().click();
  await expect(page).toHaveURL(/\/status$/);
  await page.getByRole("link", { name: "BowlByte" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(shown(page, "food-hero")).toHaveAttribute("data-stage", "settled");
  await expect(shown(page, "entrance")).toHaveCount(0);
  await page.reload();
  await expect(shown(page, "entrance")).toBeVisible();
});

test("reduced motion skips the entrance sequence", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(shown(page, "entrance")).toHaveCount(0);
  await expect(shown(page, "food-hero")).toHaveAttribute("data-stage", "settled");
});

test("kinetic scenes and journey render while scrolling", async ({ page }) => {
  await page.goto("/");
  await page.locator("#cravings").filter({ visible: true }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 900);
  await expect(page.locator("#cravings .kin-word-big").filter({ visible: true }).first()).toBeVisible();
  await page.locator("#how-it-works").filter({ visible: true }).scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("heading", { name: "From craving to counter." }).filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cash at the counter" }).filter({ visible: true }).first()).toBeVisible();
});

for (const width of [360, 390, 768, 1280, 1440]) {
  test(`landing has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/");
    await page.mouse.wheel(0, 3000);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

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
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(900);
  await shot(page, "student-dashboard-1280");

  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/student/menu");
  await expect(page.locator("article").first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  await shot(page, "menu-390");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  await shot(page, "menu-1280");

  await page.locator("#content").getByLabel("Search menu").first().fill(`Salted Fries ${suffix}`);
  const fries = page.locator("article").filter({ hasText: `Salted Fries ${suffix}` });
  await expect(fries.getByText("Illustrative 280 kcal / one serving")).toBeVisible();
  await fries.getByRole("button", { name: "Add to cart" }).click();
  if (shotsDir) {
    await page.waitForTimeout(260);
    await shot(page, "cart-flight-1280");
  }
  await expect(page.getByRole("link", { name: "Cart 1" })).toBeVisible();
  await fries.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("link", { name: "Cart 2" })).toBeVisible();

  await fries.getByRole("heading", { name: `Salted Fries ${suffix}` }).getByRole("button").click();
  await expect(page.getByTestId("pairings")).toContainText(`Coke ${suffix}`);
  await shot(page, "detail-pairing-1280");
  await page.getByRole("dialog").getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("link", { name: "Cart 3" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.goto("/student/cart");
  await expect(page.getByText("Pay cash at the canteen counter.")).toBeVisible();
  await expect(page.getByTestId("pairings").getByRole("heading", { name: "Perfect together." })).toBeVisible();
  await expect(page.locator(".cart-line").filter({ hasText: `Salted Fries ${suffix}` }).first()).toBeVisible();
  await shot(page, "cart-1280", true);
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByTestId("order-success")).toBeVisible();
  if (shotsDir) {
    await page.waitForTimeout(900);
    await shot(page, "success-assemble-1280");
    await page.waitForTimeout(2200);
    await shot(page, "success-ticket-1280", true);
  }
  await expect(page.getByTestId("order-payment")).toContainText("PLACED");
  await expect(page.getByTestId("order-payment")).toContainText("CASH");
  await expect(page.getByTestId("order-payment")).toContainText("PENDING");
  const ticket = (await page.getByRole("heading", { level: 2 }).textContent()) ?? "";
  expect(ticket).toMatch(/^B\d+$/);
  await page.getByRole("button", { name: "Track my order" }).click();
  await expect(page.getByRole("heading", { level: 2, name: ticket.trim() })).toBeVisible();
  await expect(page.getByTestId("order-status")).toContainText("PLACED");
  await page.waitForTimeout(600);
  await shot(page, "tracking-1280", true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  await shot(page, "tracking-390", true);
});

function shown(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

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
  psqlCommand(
    "TRUNCATE preparation_plan_events, preparation_plan_items, preparation_plans, demand_forecast_values, demand_forecast_runs, model_evaluations, forecasting_models, forecast_jobs, food_waste_records, production_quantity_events, food_production_batches, demo_demand_days, canteen_closures, push_deliveries, notification_outbox, notifications, pickup_events, pickup_credentials, cash_reversals, cash_receipts, order_hold_events; DELETE FROM order_idempotency_records; DELETE FROM inventory_adjustments; DELETE FROM preparation_tasks; DELETE FROM order_events; DELETE FROM order_payments; DELETE FROM order_items; DELETE FROM orders; DELETE FROM staff_invitations; DELETE FROM audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER')); DELETE FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER');",
  );
}

function bootstrapManager(email: string, managerPassword: string) {
  bootstrapIsolatedManager(email, managerPassword);
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
