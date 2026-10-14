import { expect, test } from "@playwright/test";

test("landing page states the cash rule and the release limit", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("cash drawer");
  await expect(page.getByRole("heading", { name: "Not in this release" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Students" })).toBeVisible();
});

test("student area requires a session", async ({ page }) => {
  await page.goto("/student");

  await expect(page.getByRole("heading", { name: "Student sign-in" })).toBeVisible();
});
