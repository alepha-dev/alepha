import { expect, test } from "./fixtures.ts";

/**
 * The accessibility tree of three things, pinned (#Q3341): the shell, a form
 * with fields in error, and an open confirm dialog. This stands in for a
 * screen-reader pass, which nobody ran: it is the tree a screen reader reads
 * from, in Chromium, not what any reader speaks.
 *
 * Each snapshot covers the region it is about and matches its children as a
 * subset, so a fixture or a nav entry added elsewhere does not break it.
 */
test.describe("accessibility tree", () => {
  test("the shell: top bar, its breadcrumb, the sidebar and the main region", async ({
    page,
  }) => {
    await page.goto("/blocks/buttons");

    await expect(page.locator("header").first()).toMatchAriaSnapshot(`
      - button "Collapse sidebar"
      - navigation "breadcrumb":
        - list:
          - listitem:
            - link "Blocks"
          - listitem:
            - link "Buttons"
      - button "Search"
      - button "Pick theme"
      - button "Toggle color mode"
      - button "Colour-blind mode"
    `);

    await expect(page.locator('[data-slot="sidebar"]').first())
      .toMatchAriaSnapshot(`
      - link /^Alepha UI v/
      - list:
        - listitem:
          - link "Home"
      - text: Blocks
      - list:
        - listitem:
          - button "Layout"
          - list:
            - listitem:
              - link "App shell"
    `);

    await expect(page.locator('main[data-slot="sidebar-inset"]')).toHaveCount(
      1,
    );
  });

  test("a form in error: each field labelled, invalid, and described by its message", async ({
    page,
  }) => {
    await page.goto("/pages/auth/register");
    await page.getByRole("button", { name: "Create account" }).click();
    const form = page.locator("form").first();
    await expect(form.locator('[aria-invalid="true"]').first()).toBeVisible();

    await expect(form).toMatchAriaSnapshot(`
      - textbox "Email" [invalid]
      - alert: "'email' is required"
      - textbox "Password" [invalid]
      - button "Show password"
      - alert: "'password' is required"
      - button "Create account"
    `);

    await expect(
      form.getByRole("textbox", { name: "Email" }),
    ).toHaveAccessibleDescription("'email' is required");
    await expect(
      form.getByRole("textbox", { name: "Password" }),
    ).toHaveAccessibleDescription(/'password' is required/);
  });

  test("an open confirm dialog: its role, title, description and buttons", async ({
    page,
  }) => {
    await page.goto("/blocks/dialog");
    await page.getByRole("button", { name: "confirm", exact: true }).click();

    await expect(page.getByRole("alertdialog")).toMatchAriaSnapshot(`
      - alertdialog "Delete project":
        - heading "Delete project" [level=2]
        - paragraph: This permanently removes the project and its history.
        - button "Cancel"
        - button "Delete"
    `);
    await expect(page.getByRole("alertdialog")).toHaveAccessibleDescription(
      "This permanently removes the project and its history.",
    );
  });
});
