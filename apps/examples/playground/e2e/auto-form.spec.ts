import { expect, test } from "@playwright/test";

test.describe("AutoForm demo — schema-driven flow", () => {
  test("function $control toggles apiToken visibility", async ({ page }) => {
    await page.goto("/demo/auto-form");

    // initially viewer → no Api Token row
    await expect(page.getByLabel("Api Token")).toHaveCount(0);

    // pick admin
    await page.getByRole("combobox").filter({ hasText: "viewer" }).click();
    await page.getByRole("option", { name: "admin" }).click();

    await expect(page.getByLabel("Api Token")).toBeVisible();

    // back to viewer → row hidden again
    await page.getByRole("combobox").filter({ hasText: "admin" }).click();
    await page.getByRole("option", { name: "viewer" }).click();
    await expect(page.getByLabel("Api Token")).toHaveCount(0);
  });

  test("ControlObject Initialize reveals nested fields", async ({ page }) => {
    await page.goto("/demo/auto-form");
    const init = page.getByRole("button", { name: "Initialize" });
    await expect(init).toBeVisible();
    await init.click();
    await expect(page.locator('input[name="address.street"]')).toBeVisible();
    await expect(page.locator('input[name="address.city"]')).toBeVisible();
    await expect(page.locator('input[name="address.zip"]')).toBeVisible();
  });

  test("ControlArray switches to tabs at >4 items", async ({ page }) => {
    await page.goto("/demo/auto-form");

    // add 5 contacts via the contacts (+) button
    const addBtn = page.getByRole("button", { name: "Add" });
    for (let i = 0; i < 5; i++) await addBtn.click();

    // tabs render with our renderTabName: "Contact #1" .. "#5"
    for (let i = 1; i <= 5; i++) {
      await expect(
        page.getByRole("button", { name: `Contact #${i}` }),
      ).toBeVisible();
    }
  });

  test("required validation surfaces inline + form error popover", async ({
    page,
  }) => {
    await page.goto("/demo/auto-form");
    const username = page.locator('input[name="username"]');
    await username.click();
    await username.fill("");
    await username.blur();
    await page.getByRole("button", { name: "Save" }).click();

    // inline message under the field (zod's standard "Too small" phrasing)
    await expect(page.getByRole("alert").first()).toContainText(
      /2 characters/i,
    );
    // form-level error icon in the bottom bar
    await expect(
      page.getByRole("button", { name: "Form errors" }),
    ).toBeVisible();
  });
});

test.describe("Upload control", () => {
  test.use({ storageState: "./e2e/.admin-state.json" });

  test("single image upload stores UUID in form value", async ({ page }) => {
    await page.goto("/demo/forms/upload");

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles("./e2e/fixtures/sample.png");

    // Image uploads render as a thumbnail with the filename in its `alt`.
    await expect(page.getByRole("img", { name: "sample.png" })).toBeVisible({
      timeout: 15_000,
    });

    // wait until Save is enabled (form not in flight)
    const save = page.getByRole("button", { name: "Save" });
    await expect(save).toBeEnabled();
    await save.click();

    // sonner adds the toast asynchronously; first toast contains the form JSON
    await expect(page.locator("[data-sonner-toast]").first()).toContainText(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      { timeout: 5_000 },
    );
  });

  test("× removes the uploaded file from the form", async ({ page }) => {
    await page.goto("/demo/forms/upload");

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles("./e2e/fixtures/sample.png");

    const thumb = page.getByRole("img", { name: "sample.png" });
    await expect(thumb).toBeVisible({ timeout: 15_000 });
    // Two buttons have "Remove" in their accessible name (the outer thumbnail
    // button and the inner × button). Match the inner one exactly.
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(thumb).toHaveCount(0);
  });
});
