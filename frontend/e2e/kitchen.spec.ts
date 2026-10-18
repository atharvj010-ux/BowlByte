import { randomBytes } from "node:crypto";

import { bootstrapIsolatedManager, psqlCommand, psqlQuery } from "./safe-db";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const password = `horse-${randomBytes(8).toString("hex")}`;
const suffix = randomBytes(3).toString("hex");
const managerEmail = `manager-${suffix}@staff.bowlbyte.edu`;
const kitchenEmail = `kitchen-${suffix}@staff.bowlbyte.edu`;
const secondKitchenEmail = `kitchen-b-${suffix}@staff.bowlbyte.edu`;
const studentEmail = `student-${suffix}@student.bowlbyte.edu`;
const sandwich = `Grill Sandwich ${suffix}`;
const coffee = `Filter Coffee ${suffix}`;

test.describe.configure({ mode: "serial" });

test("student order is accepted and shows queued", async ({ page, browser }) => {
  test.setTimeout(180_000);
  clearStaff();
  bootstrapManager(managerEmail, password);
  await page.goto("/admin/login");
  await signIn(page, managerEmail);
  await page.getByRole("link", { name: "Stations" }).click();
  await addStation(page, `Grill ${suffix}`, "1");
  await addStation(page, `Drinks ${suffix}`, "1");
  await page.goto("/admin/menu");
  await expect(page.getByText("Loading menu.")).toHaveCount(0);
  await page.locator("#content").getByLabel("Category name").first().fill(`Kitchen ${suffix}`);
  await page.locator("#content").getByRole("button", { name: "Add category" }).first().click();
  await expect(page.getByText("Category saved.")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Add menu item" }).click();
  await fillItem(page, sandwich, `Grill ${suffix}`, "20");
  await page.goto("/admin/menu/new");
  await fillItem(page, coffee, `Drinks ${suffix}`, "20");

  const kitchen = await browser.newContext();
  const kitchenPage = await kitchen.newPage();
  await inviteKitchen(page, kitchenPage, kitchenEmail, "Kitchen Lead");
  await registerStudent(page, studentEmail, "Asha Rao");
  await orderItem(page, sandwich);
  const ticket = await ticketHeading(page);
  const orderUrl = page.url();
  await expect(page.getByTestId("order-status").first()).toContainText("PLACED");
  await expect(page.getByTestId("order-status").first()).toContainText("CASH · PENDING");

  await kitchenPage.goto("/staff");
  const incoming = kitchenPage.getByTestId("incoming-order").filter({ hasText: ticket });
  await expect(incoming).toBeVisible();
  await incoming.getByRole("button", { name: "Accept" }).click();
  await expect
    .poll(async () =>
      kitchenPage.evaluate(async () => {
        const response = await fetch("/api/v1/staff/queue", { credentials: "include" });
        const body = (await response.json()) as {
          orders: { ticket_number: string; status: string }[];
        };
        return body.orders.map((order) => `${order.ticket_number}:${order.status}`).join(",");
      }),
      { timeout: 15_000 },
    )
    .toContain(ticket);
  await expect(kitchenPage.getByTestId("kitchen-ticket").filter({ hasText: ticket })).toBeVisible({
    timeout: 15_000,
  });
  await page.goto(orderUrl);
  await expect(page.getByTestId("order-status").first()).toContainText("QUEUED");
  await expect(page.getByTestId("connection-state").first()).toContainText("Live updates connected", {
    timeout: 15_000,
  });
  await expect(kitchenPage.getByTestId("connection-state").first()).toContainText("Live updates connected", {
    timeout: 15_000,
  });
  await expect(page.getByText("Waiting in preparation queue")).toBeVisible();
  await kitchen.close();
});

test("two stations prepare independently and the order becomes ready", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await page.goto("/student/login");
  await signIn(page, studentEmail);
  await orderItems(page, [sandwich, coffee]);
  const ticket = await ticketHeading(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const kitchen = await browser.newContext();
  const kitchenPage = await kitchen.newPage();
  await kitchenPage.goto("/staff/login");
  await signIn(kitchenPage, kitchenEmail);
  await kitchenPage.goto("/staff");
  await rejectQueued(kitchenPage);
  const card = kitchenPage.getByTestId("incoming-order").filter({ hasText: ticket });
  await card.getByRole("button", { name: "Accept" }).click();
  const ticketCard = kitchenPage.getByTestId("kitchen-ticket").filter({ hasText: ticket });
  await expect(ticketCard.getByRole("button", { name: "Start" })).toHaveCount(2, { timeout: 15_000 });
  await ticketCard.getByRole("button", { name: "Start" }).nth(0).click();
  await expect(ticketCard.getByRole("button", { name: "Complete" })).toHaveCount(1, { timeout: 15_000 });
  await ticketCard.getByRole("button", { name: "Start" }).click();
  await expect(ticketCard.getByRole("button", { name: "Complete" })).toHaveCount(2, { timeout: 15_000 });
  await expect(page.getByTestId("order-status").first()).toContainText("PREPARING", { timeout: 15_000 });
  await ticketCard.getByRole("button", { name: "Complete" }).nth(0).click();
  await expect(ticketCard.getByRole("button", { name: "Complete" })).toHaveCount(1, { timeout: 15_000 });
  await ticketCard.getByRole("button", { name: "Complete" }).click();
  await expect(ticketCard.getByRole("button", { name: "Complete" })).toHaveCount(0, { timeout: 15_000 });
  await ticketCard.getByRole("button", { name: "Confirm packed and ready" }).click();
  await expect(page.getByTestId("order-status").first()).toContainText("READY", { timeout: 15_000 });
  await expect(page.getByTestId("order-status").first()).toContainText("PENDING");
  await expect(
    page.getByText(/Your order is ready\. Pay .* in cash at the counter\./),
  ).toBeVisible();
  await expect(kitchenPage.getByRole("button", { name: /paid|picked up/i })).toHaveCount(0);
  await kitchen.close();
});

test("a second order waits behind the only station slot", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await page.goto("/student/login");
  await signIn(page, studentEmail);
  const firstId = await placeByName(page, sandwich);
  const secondId = await placeByName(page, sandwich);
  const kitchen = await browser.newContext();
  const kitchenPage = await kitchen.newPage();
  await kitchenPage.goto("/staff/login");
  await signIn(kitchenPage, kitchenEmail);
  await kitchenPage.goto("/staff");
  await acceptAllIncoming(kitchenPage);
  const first = await tracking(page, firstId);
  const second = await tracking(page, secondId);
  expect(Date.parse(second.eta_ready_at)).toBeGreaterThan(Date.parse(first.eta_ready_at));
  const firstCard = kitchenPage.getByTestId("kitchen-ticket").filter({ hasText: first.ticket_number });
  const secondCard = kitchenPage.getByTestId("kitchen-ticket").filter({ hasText: second.ticket_number });
  await firstCard.getByRole("button", { name: "Start" }).click();
  await secondCard.getByRole("button", { name: "Start" }).click();
  await expect(kitchenPage.getByText("That station is at capacity.")).toBeVisible();
  await expect(firstCard.getByRole("button", { name: "Complete" })).toBeVisible();
  await firstCard.getByRole("button", { name: "Complete" }).click();
  await expect(firstCard.getByRole("button", { name: "Complete" })).toHaveCount(0);
  await secondCard.getByRole("button", { name: "Start" }).click();
  await expect(secondCard.getByTestId("ticket-status").first()).toContainText("PREPARING", {
    timeout: 15_000,
  });
  await kitchen.close();
});

test("a recorded delay updates the student without completing the task", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await page.goto("/student/login");
  await signIn(page, studentEmail);
  const kitchen = await browser.newContext();
  const kitchenPage = await kitchen.newPage();
  await kitchenPage.goto("/staff/login");
  await signIn(kitchenPage, kitchenEmail);
  await kitchenPage.goto("/staff");
  await finishOpenWork(kitchenPage);
  await rejectQueued(kitchenPage);
  const orderId = await placeByName(page, sandwich);
  const placed = await tracking(page, orderId);
  await kitchenPage.goto("/staff");
  const incoming = kitchenPage.getByTestId("incoming-order").filter({ hasText: placed.ticket_number });
  await incoming.getByRole("button", { name: "Accept" }).click();
  await kitchenPage.reload();
  const card = kitchenPage.getByTestId("kitchen-ticket").filter({ hasText: placed.ticket_number });
  await card.getByRole("button", { name: "Start" }).click();
  const started = await tracking(page, orderId);
  const preparing = kitchenPage.locator("section").filter({
    has: kitchenPage.getByRole("heading", { name: "Currently preparing" }),
  });
  await preparing.getByLabel("Delay seconds").first().fill("300");
  await card.getByRole("button", { name: "Delay" }).click();
  await page.goto(`/student/orders/${orderId}`);
  await expect(page.getByTestId("delay-message").first()).toContainText("Preparation is taking longer");
  await expect(page.getByTestId("order-status").first()).toContainText("PREPARING", { timeout: 15_000 });
  await expect(page.getByTestId("order-status").first()).not.toContainText("READY");
  const after = await tracking(page, orderId);
  expect(Date.parse(after.eta_ready_at)).toBeGreaterThan(Date.parse(started.eta_ready_at));
  expect(after.tasks.some((task: { status: string }) => task.status === "DONE")).toBeFalsy();
  await kitchen.close();
});

test("a disconnected student recovers the current kitchen status", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.goto("/student/login");
  await signIn(page, studentEmail);
  const orderId = await placeByName(page, coffee);
  await page.goto(`/student/orders/${orderId}`);
  await expect(page.getByTestId("order-status").first()).toContainText("PLACED");
  await expect(page.getByTestId("connection-state").first()).toContainText("Live updates connected");
  await page.routeWebSocket(/\/api\/v1\/ws\//, (socket) => socket.close());
  await page.reload();
  await expect(page.getByTestId("connection-state").first()).toContainText(/Reconnecting|Polling for updates/);
  await expect(page.getByTestId("connection-state").first()).not.toContainText("Live updates connected");
  const kitchen = await browser.newContext();
  const kitchenPage = await kitchen.newPage();
  await kitchenPage.goto("/staff/login");
  await signIn(kitchenPage, kitchenEmail);
  await kitchenPage.goto("/staff");
  const ticket = sql(`SELECT ticket_number FROM orders WHERE id = '${orderId}'`).trim();
  const incoming = kitchenPage.getByTestId("incoming-order").filter({ hasText: ticket });
  const accepted = kitchenPage.waitForResponse(
    (response) => response.url().includes("/accept") && response.request().method() === "POST",
  );
  await incoming.getByRole("button", { name: "Accept" }).click();
  expect((await accepted).ok()).toBeTruthy();
  await kitchenPage.reload();
  await expect(kitchenPage.getByTestId("kitchen-ticket").filter({ hasText: ticket })).toBeVisible({
    timeout: 15_000,
  });
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await expect(page.getByTestId("order-status").first()).toContainText("QUEUED", { timeout: 25_000 });
  await kitchen.close();
});

test("cash stays pending and pickup is not a kitchen action", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await page.goto("/student/login");
  await signIn(page, studentEmail);
  await page.goto("/student/orders");
  await expect(page.getByText("CASH · PENDING").first()).toBeVisible();
  const kitchen = await browser.newContext();
  const kitchenPage = await kitchen.newPage();
  await kitchenPage.goto("/staff/login");
  await signIn(kitchenPage, kitchenEmail);
  await kitchenPage.goto("/staff");
  await expect(kitchenPage.getByRole("button", { name: "Mark paid" })).toHaveCount(0);
  await expect(kitchenPage.getByRole("button", { name: "Picked up" })).toHaveCount(0);
  await expect(kitchenPage.getByText("CASH · PENDING").first()).toBeVisible();
  await kitchen.close();
});

test("only one staff member can take the last station slot", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await page.goto("/staff/login");
  await signIn(page, kitchenEmail);
  await page.goto("/staff");
  await finishOpenWork(page);
  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await inviteKitchen(await managerPage(browser), secondPage, secondKitchenEmail, "Second Cook");
  const student = await browser.newContext();
  const studentPage = await student.newPage();
  await studentPage.goto("/student/login");
  await signIn(studentPage, studentEmail);
  const left = await placeByName(studentPage, sandwich);
  const right = await placeByName(studentPage, sandwich);
  await page.goto("/staff");
  await acceptAllIncoming(page);
  const leftTicket = sql(`SELECT ticket_number FROM orders WHERE id = '${left}'`).trim();
  const rightTicket = sql(`SELECT ticket_number FROM orders WHERE id = '${right}'`).trim();
  await secondPage.goto("/staff");
  const statuses = await Promise.all([
    startFirstTask(page, leftTicket),
    startFirstTask(secondPage, rightTicket),
  ]);
  expect(statuses.sort()).toEqual([200, 409]);
  await student.close();
  await second.close();
});

async function managerPage(browser: { newContext: () => Promise<BrowserContext> }) {
  const context = await browser.newContext();
  const manager = await context.newPage();
  await manager.goto("/admin/login");
  await signIn(manager, managerEmail);
  return manager;
}

async function addStation(page: Page, name: string, capacity: string) {
  await page.locator("#content").getByLabel("Station name").first().fill(name);
  await page.locator("#content").getByLabel("Capacity").first().fill(capacity);
  await page.locator("#content").getByRole("button", { name: "Add station" }).first().click();
  await expect(page.getByText("Station saved.")).toBeVisible();
}

async function fillItem(page: Page, name: string, station: string, stock: string) {
  await page.locator("#content").getByLabel("Name").first().fill(name);
  await page.locator("#content").getByLabel("Description").first().fill("Development sample for the pilot.");
  await page.locator("#content").getByLabel("Price in rupees").first().fill("40");
  await page.locator("#content").getByLabel("Preparation seconds").first().fill("300");
  await expect(page.getByRole("option", { name: `Kitchen ${suffix}` })).toHaveCount(1);
  await page.locator("#content").getByLabel("Category").first().selectOption({ label: `Kitchen ${suffix}` });
  await page.locator("#content").getByLabel("Station").first().selectOption({ label: station });
  await page.locator("#content").getByLabel("Initial stock").first().fill(stock);
  await page.getByRole("button", { name: "Create item" }).click();
  await expect(page.getByRole("heading", { name: "Edit item" })).toBeVisible();
}

async function orderItem(page: Page, name: string) {
  await page.goto("/student/menu");
  await page.locator("#content").getByLabel("Search menu").first().fill(name);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.goto("/student/cart");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByText(/CASH · PENDING/)).toBeVisible();
  await page.getByRole("button", { name: "Track my order" }).click();
  await expect(page.getByTestId("order-status").first()).toBeVisible();
}

async function orderItems(page: Page, names: string[]) {
  await page.goto("/student/menu");
  for (const name of names) {
    await page.locator("#content").getByLabel("Search menu").first().fill(name);
    await page.getByRole("button", { name: "Add to cart" }).click();
  }
  await page.goto("/student/cart");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByText(/CASH · PENDING/)).toBeVisible();
  await page.getByRole("button", { name: "Track my order" }).click();
  await expect(page.getByTestId("order-status").first()).toBeVisible();
}

async function ticketHeading(page: Page) {
  const ticket = (await page.getByRole("heading", { level: 2 }).textContent()) ?? "";
  expect(ticket).toMatch(/^B\d+$/);
  return ticket;
}

async function placeByName(page: Page, name: string) {
  const itemId = sql(`SELECT id FROM menu_items WHERE name = '${name.replace(/'/g, "''")}'`).trim();
  const orderId = await page.evaluate(async (id) => {
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
    const body = (await response.json()) as { id?: string };
    if (!response.ok || !body.id) {
      throw new Error(`place failed ${response.status}`);
    }
    return body.id;
  }, itemId);
  return orderId;
}

async function tracking(page: Page, orderId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/orders/${id}/tracking`, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`tracking ${response.status}`);
    }
    return response.json();
  }, orderId);
}

async function rejectQueued(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const raw = document.cookie
          .split("; ")
          .find((row) => row.startsWith("bowlbyte_csrf="))
          ?.split("=")[1];
        const token = decodeURIComponent(raw ?? "");
        const queue = await fetch("/api/v1/staff/queue", { credentials: "include" });
        const body = (await queue.json()) as { orders?: { id: string; status: string }[] };
        const waiting = (body.orders ?? []).filter((order) => order.status === "QUEUED");
        for (const order of waiting) {
          await fetch(`/api/v1/staff/orders/${order.id}/reject`, {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              "x-csrf-token": token,
            },
            body: JSON.stringify({ reason: "Clear the station for the next ticket" }),
          });
        }
        return waiting.length;
      }),
      { timeout: 20_000 },
    )
    .toBe(0);
  await page.reload();
}

async function acceptAllIncoming(page: Page) {
  await expect(page.getByTestId("incoming-order").first()).toBeVisible({ timeout: 15_000 });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const cards = page.getByTestId("incoming-order");
    const count = await cards.count();
    if (count === 0) {
      return;
    }
    await cards.first().getByRole("button", { name: "Accept" }).click();
    await expect(cards).toHaveCount(count - 1, { timeout: 10_000 });
  }
}

async function finishOpenWork(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const raw = document.cookie
          .split("; ")
          .find((row) => row.startsWith("bowlbyte_csrf="))
          ?.split("=")[1];
        const token = decodeURIComponent(raw ?? "");
        const queue = await fetch("/api/v1/staff/queue", { credentials: "include" });
        const body = (await queue.json()) as {
          orders?: { id: string; status: string; tasks: { id: string; status: string }[] }[];
        };
        let open = 0;
        for (const order of body.orders ?? []) {
          for (const task of order.tasks ?? []) {
            if (task.status === "IN_PROGRESS") {
              open += 1;
              await fetch(`/api/v1/staff/preparation-tasks/${task.id}/complete`, {
                method: "POST",
                credentials: "include",
                headers: { "x-csrf-token": token },
              });
            }
          }
          const unfinished = (order.tasks ?? []).some((task) => task.status !== "DONE" && task.status !== "CANCELLED");
          if (order.status === "PREPARING" && !unfinished) {
            await fetch(`/api/v1/staff/orders/${order.id}/ready`, {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json", "x-csrf-token": token },
              body: JSON.stringify({ packed: true }),
            });
          }
        }
        return open;
      }),
      { timeout: 20_000 },
    )
    .toBe(0);
}

async function startFirstTask(page: Page, ticket: string) {
  return page.evaluate(async (ticketNumber) => {
    const raw = document.cookie
      .split("; ")
      .find((row) => row.startsWith("bowlbyte_csrf="))
      ?.split("=")[1];
    const queue = await fetch("/api/v1/staff/queue", { credentials: "include" });
    const body = (await queue.json()) as {
      orders: { ticket_number: string; tasks: { id: string; status: string }[] }[];
    };
    const task = body.orders
      .find((order) => order.ticket_number === ticketNumber)
      ?.tasks.find((row) => row.status === "QUEUED");
    if (!task) {
      return 404;
    }
    const response = await fetch(`/api/v1/staff/preparation-tasks/${task.id}/start`, {
      method: "POST",
      credentials: "include",
      headers: { "x-csrf-token": decodeURIComponent(raw ?? "") },
    });
    return response.status;
  }, ticket);
}

async function inviteKitchen(manager: Page, kitchen: Page, email: string, name: string) {
  await manager.goto("/admin/staff");
  const staffDesk = manager.locator("section").filter({
    has: manager.getByRole("heading", { name: "Staff" }),
  });
  await staffDesk.locator('input[type="email"]').fill(email);
  await staffDesk.getByRole("button", { name: "Invite" }).click();
  await expect(manager.getByText("Invitation sent")).toBeVisible();
  const token = await verificationToken(email);
  await kitchen.goto(`/invite/accept#token=${token}`);
  await kitchen.locator("#content").getByLabel("Full name").first().fill(name);
  await kitchen.locator("#content").getByLabel("Password", { exact: true }).first().fill(password);
  await kitchen.locator("#content").getByLabel("Confirm password").first().fill(password);
  await kitchen.getByRole("button", { name: "Activate account" }).click();
  await expect(kitchen.getByText("Your staff account is active")).toBeVisible();
  await kitchen.goto("/staff/login");
  await signIn(kitchen, email);
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

function clearStaff() {
  psqlCommand(
    "TRUNCATE preparation_plan_events, preparation_plan_items, preparation_plans, demand_forecast_values, demand_forecast_runs, model_evaluations, forecasting_models, forecast_jobs, food_waste_records, production_quantity_events, food_production_batches, demo_demand_days, canteen_closures, push_deliveries, notification_outbox, notifications, pickup_events, pickup_credentials, cash_reversals, cash_receipts; DELETE FROM order_idempotency_records; DELETE FROM inventory_adjustments; DELETE FROM preparation_tasks; DELETE FROM order_events; DELETE FROM order_payments; DELETE FROM order_items; DELETE FROM orders; DELETE FROM staff_invitations; DELETE FROM audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER')); DELETE FROM users WHERE role IN ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER');",
  );
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
