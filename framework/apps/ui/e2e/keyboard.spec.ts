import { expect, type Locator, type Page, test } from "./fixtures.ts";

/**
 * Keyboard and focus where the kit composes its overlays (#Q3339), driven by
 * real key presses in Chromium. Base UI owns the primitives' behaviour; what
 * is checked here is that the kit's wrappers did not break it.
 *
 * Every horizontal arrow key is read under `dir="ltr"`.
 */

/**
 * Whether the focused element is inside `container`.
 */
const holdsFocus = (container: Locator) =>
  container.evaluate((el) => el.contains(document.activeElement));

/**
 * Tab and Shift+Tab a few times past the end of the overlay's focusable
 * content, and check the focus never leaves it.
 *
 * Polled, not read once: Base UI's trap is a pair of focus guards at the
 * popup's edges, and a Tab off the last element lands on a guard for a
 * moment before the guard hands the focus back in. A real leak stays out
 * and fails the poll.
 */
const expectTrapped = async (page: Page, overlay: Locator) => {
  await expect
    .poll(() => holdsFocus(overlay), { message: "focus starts inside" })
    .toBe(true);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    await expect
      .poll(() => holdsFocus(overlay), { message: `after Tab ${i + 1}` })
      .toBe(true);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() => holdsFocus(overlay), { message: `after Shift+Tab ${i + 1}` })
      .toBe(true);
  }
};

/**
 * Open an overlay from its trigger with the keyboard, check the trap, close
 * it with Escape, and check the focus went back to the trigger.
 */
const roundTrip = async (page: Page, trigger: Locator, overlay: Locator) => {
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(overlay).toBeVisible();
  await expectTrapped(page, overlay);
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await expect(trigger).toBeFocused();
};

test.describe("overlays take, trap and give back the focus", () => {
  test("the confirm dialog of useDialog", async ({ page }) => {
    await page.goto("/blocks/dialog");
    await roundTrip(
      page,
      page.getByRole("button", { name: "confirm", exact: true }),
      page.getByRole("alertdialog"),
    );
  });

  test("a sheet", async ({ page }) => {
    await page.goto("/blocks/overlays");
    await roundTrip(
      page,
      page.getByRole("button", { name: "Open sheet" }),
      page.getByRole("dialog", { name: "Filters" }),
    );
  });

  test("a drawer", async ({ page }) => {
    await page.goto("/blocks/overlays");
    await roundTrip(
      page,
      page.getByRole("button", { name: "Open drawer" }),
      page.getByRole("dialog", { name: "Details" }),
    );
  });

  test("the command palette", async ({ page }) => {
    await page.goto("/blocks/buttons");
    await roundTrip(
      page,
      page.getByRole("button", { name: "Search", exact: true }).first(),
      page.getByRole("dialog"),
    );
  });

  test("a dialog over a sheet: Escape closes the top layer only", async ({
    page,
  }) => {
    await page.goto("/blocks/overlays");
    const opener = page.getByRole("button", { name: "Open sheet" });
    await opener.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await expect(sheet).toBeVisible();

    const inner = sheet.getByRole("button", { name: "Open dialog" });
    await inner.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Save the filter?" });
    await expect(dialog).toBeVisible();
    await expectTrapped(page, dialog);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect(inner).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test.describe("an overlay route", () => {
  test("opened from a link: focus inside, Escape goes back with the focus on the link", async ({
    page,
  }) => {
    await page.goto("/blocks/overlays");
    const link = page.getByRole("link", { name: "Open the panel route" });
    await link.focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/blocks\/overlays\/panel$/);
    const sheet = page.getByRole("dialog", { name: "Panel" });
    await expect(sheet).toBeVisible();
    await expectTrapped(page, sheet);

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/blocks\/overlays$/);
    await expect(sheet).toBeHidden();
    await expect(link).toBeFocused();
  });

  test("opened by its URL: the full page, nothing trapped", async ({
    page,
  }) => {
    await page.goto("/blocks/overlays/panel");
    await expect(page.getByRole("heading", { name: "Panel" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(page.locator("body")).not.toBeFocused();
  });
});

test.describe("one smoke per wrapper", () => {
  test("DropdownMenu: ArrowDown, Enter runs the item, Escape returns the focus", async ({
    page,
  }) => {
    await page.goto("/blocks/primitives");
    const trigger = page.getByRole("button", { name: "More actions" });
    await trigger.focus();

    await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("ControlSelect: opens from the keyboard, arrows move, Enter selects, Escape closes", async ({
    page,
  }) => {
    await page.goto("/blocks/control/select");
    const trigger = page.locator('[data-slot="combobox-trigger"]').first();
    await trigger.focus();

    await page.keyboard.press("ArrowDown");
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await page.keyboard.press("ArrowDown");
    const highlighted = list.locator("[data-highlighted]");
    await expect(highlighted).toHaveCount(1);
    const picked = (await highlighted.textContent())?.trim() ?? "";
    expect(picked).not.toBe("");
    await page.keyboard.press("Enter");
    await expect(trigger).toContainText(picked.split(/\s/)[0]!);

    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(list).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the sidebar under the mobile breakpoint: a sheet that opens, traps and closes", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/blocks/buttons");
    const toggle = page
      .getByRole("button", { name: /^(Expand|Toggle) sidebar$/ })
      .first();
    await roundTrip(page, toggle, page.getByRole("dialog"));
  });
});
