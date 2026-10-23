import { expect, test } from "@playwright/test";

test("landing page states the cash rule and the release limit", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Zero queue");
  await expect(page.getByRole("heading", { name: "Not in this release" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cash at the counter" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Get started now" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Students" })).toHaveCount(0);
});

test("student area requires a session", async ({ page }) => {
  await page.goto("/student");

  await expect(page.getByRole("heading", { name: "Student sign-in" })).toBeVisible();
});
