import { expect, test } from "@playwright/test";

test("landing page states the cash rule and the release limit", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("cash drawer");
  await expect(page.getByRole("heading", { name: "Not in this release" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Students" })).toBeVisible();
});

test("student area does not pretend a session exists", async ({ page }) => {
  await page.goto("/student");

  await expect(page.getByText("Authentication is not implemented").first()).toBeVisible();
  await expect(page.getByText("No operational data")).toBeVisible();
});
