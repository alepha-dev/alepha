import { expect, test } from "@playwright/test";

/**
 * The showcase's contract is that every block page renders the real component
 * with real content. Two things can break that silently, and both have already
 * happened once during this app's construction:
 *
 *   - the data path resolving to nothing, which renders an empty table and a
 *     toast rather than a failure;
 *   - a component that hides itself when unconfigured, which renders an empty
 *     box that reads as a broken build.
 *
 * So these specs assert CONTENT, never just that a page returned 200.
 */
test.describe("shell", () => {
  test("home lists every block in the sidebar", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        name: "Every component, with its variants.",
      }),
    ).toBeVisible();

    const nav = page.locator('[data-sidebar="group-label"]');
    await expect(nav.filter({ hasText: "Overview" })).toBeVisible();
    await expect(nav.filter({ hasText: "Blocks" })).toBeVisible();
  });

  test("the top bar carries a working colour-mode control", async ({
    page,
  }) => {
    await page.goto("/");

    // Regression guard: this was `ButtonTheme`, which renders NOTHING until
    // `uiThemeListAtom` holds two entries, so the top bar silently had no
    // control at all.
    await expect(
      page.getByRole("button", { name: /toggle color mode/i }).first(),
    ).toBeVisible();
  });
});

test.describe("AlephaTable", () => {
  test("renders rows fetched through the action registry", async ({ page }) => {
    await page.goto("/blocks/table");

    // Real content, not a row count: an empty table also has a tbody.
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await expect(page.getByText("ada.lovelace@alepha.dev")).toBeVisible();
    await expect(page.getByText("No results.")).toHaveCount(0);
  });

  test("filters on the server", async ({ page }) => {
    await page.goto("/blocks/table");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    await page.getByPlaceholder("Search members").fill("turing");

    await expect(page.getByText("Alan Turing")).toBeVisible();
    await expect(page.getByText("Ada Lovelace")).toHaveCount(0);
  });
});

test.describe("blocks", () => {
  test("a toast is raised on demand", async ({ page }) => {
    await page.goto("/blocks/feedback");
    await page.getByRole("button", { name: "Success", exact: true }).click();

    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
    await expect(page.getByText("Settings saved")).toBeVisible();
  });

  test("AutoForm reveals its conditional field", async ({ page }) => {
    await page.goto("/blocks/auto-form");

    await expect(page.getByLabel("Api Token")).toHaveCount(0);
    // Filter on the CURRENT value, not on "Select": `role` defaults to
    // "viewer", so a "Select" filter matches the Region combobox instead and
    // opens a dropdown with no `admin` option in it.
    await page.getByRole("combobox").filter({ hasText: "viewer" }).click();
    await page.getByRole("option", { name: "admin" }).click();

    await expect(page.getByLabel("Api Token")).toBeVisible();
  });

  test("controls render one input per schema field", async ({ page }) => {
    await page.goto("/blocks/controls");

    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Bio")).toBeVisible();
    await expect(page.getByLabel("Age")).toBeVisible();
  });

  test("the primitives inventory links upstream", async ({ page }) => {
    await page.goto("/primitives");

    await expect(
      page.getByText("43 primitives.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "button", exact: true }),
    ).toHaveAttribute("href", /ui\.shadcn\.com/);
  });
});
