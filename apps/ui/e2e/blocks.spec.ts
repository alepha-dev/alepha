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
  test("home lists both subjects in the sidebar", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        name: "Every component, with its variants.",
      }),
    ).toBeVisible();

    // Home sits in an unlabelled group, so these two are the only headings
    // the sidebar draws.
    const nav = page.locator('[data-sidebar="group-label"]');
    await expect(nav.filter({ hasText: "Blocks" })).toBeVisible();
    await expect(nav.filter({ hasText: "Pages" })).toBeVisible();
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

test.describe("Showcase", () => {
  test("the props panel collapses and the viewport control narrows the preview", async ({
    page,
  }) => {
    await page.goto("/blocks/select");

    // The panel is open by default, so its first knob is on screen.
    await expect(page.getByLabel("How many items")).toBeVisible();

    await page.getByRole("button", { name: "Hide props" }).click();
    await expect(page.getByLabel("How many items")).toHaveCount(0);

    await page.getByRole("button", { name: "Show props" }).click();
    await expect(page.getByLabel("How many items")).toBeVisible();

    // The viewport control constrains the preview rather than the window, so
    // the proof is the preview's own box.
    const preview = page.getByTestId("showcase-preview");
    const full = (await preview.boundingBox())!.width;

    await page.getByRole("radio", { name: "Mobile" }).click();
    await expect(preview).toHaveAttribute("data-viewport", "mobile");
    const mobile = (await preview.boundingBox())!.width;

    expect(mobile).toBeLessThanOrEqual(375);
    expect(mobile).toBeLessThan(full);

    // A page with no knobs still gets the viewport control, and nothing to
    // toggle the panel with. `Segmented` is a radiogroup, not a row of
    // buttons - its segments answer to `radio`.
    await page.goto("/pages/admin/jobs");
    await expect(page.getByRole("radio", { name: "Mobile" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide props" })).toHaveCount(
      0,
    );
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
    await page.goto("/blocks/toast");
    await page.getByRole("button", { name: "Success", exact: true }).click();

    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
    await expect(page.getByText("Settings saved")).toBeVisible();
  });

  test("a dialog resolves with the reader's answer", async ({ page }) => {
    await page.goto("/blocks/dialog");
    await page.getByRole("button", { name: "confirm", exact: true }).click();

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("confirmed")).toBeVisible();
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

  test("the select page offers every shape of the control", async ({
    page,
  }) => {
    await page.goto("/blocks/select");

    // The knob-driven control, then the ones the schema decides on its own.
    await expect(page.getByText("Driven by the knobs")).toBeVisible();
    await expect(page.getByLabel("Fruit (a bare enum)")).toBeVisible();
    await expect(page.getByText("Clearable", { exact: true })).toBeVisible();
  });

  test("buttons and the two page showcases render", async ({ page }) => {
    await page.goto("/blocks/buttons");
    await expect(page.getByText("Common shapes")).toBeVisible();

    await page.goto("/pages/auth");
    await expect(page.getByLabel("Email").first()).toBeVisible();

    // Fed by a literal profile, so a missing field is a render error rather
    // than an empty card.
    await page.goto("/pages/account");
    await expect(page.getByText("ada@alepha.dev").first()).toBeVisible();
  });
});
