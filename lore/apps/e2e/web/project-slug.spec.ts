import { expect, test } from "./_fixtures.ts";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * Project URL identity: `/<slug>/quests/<shortId>`, no `/p/` prefix.
 *
 * The slug is derived from the title and unique across the whole instance, so
 * renaming a project MOVES it — the old URL stops resolving and the old name
 * becomes claimable again. That is a deliberately destructive change, which is
 * why the settings page gates it behind a confirmation naming both URLs.
 *
 * ⚠️ The Name field does not auto-commit. The form has a real Save button in
 * the settings card's last row, disabled until something is dirty, and the
 * tests below click it; typing alone saves nothing. It was an `autoSave` form
 * until the settings-card action row existed, and the tick button that mode
 * put inside the input carried the same `aria-label="Save"` — which is why
 * these selectors did not move when the button did.
 */
test.describe("Project slug routing", () => {
  test("the wizard lands on a slug derived from the title", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    await registerAndVerify(page, `slug${ts}@example.com`, "GoodPassw0rd");

    const { slug } = await createProjectViaWizard(
      page,
      `Elf W${ts}`.slice(0, 20),
    );

    // "Elf W<ts>" → "elf-w<ts>": lowercased, space folded to a dash.
    expect(slug).toBe(`elf-w${ts}`.slice(0, 20).toLowerCase());
    expect(new URL(page.url()).pathname).toBe(`/${slug}`);
  });

  test("renaming moves the URL and breaks the old one", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    await registerAndVerify(page, `ren${ts}@example.com`, "GoodPassw0rd");

    const { slug } = await createProjectViaWizard(
      page,
      `Ren${ts}`.slice(0, 20),
    );

    await page.goto(`/${slug}/settings/`);
    await page.waitForLoadState("networkidle");

    const name = page.getByRole("textbox", { name: "Name" });
    const renamed = `Sum${ts}`.slice(0, 20);
    await name.fill(renamed);

    // Cancelling must put the old title back — the field is committed by the
    // inline button, so a half-applied rename would otherwise linger.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: /keep current name/i }).click();
    await expect(name).toHaveValue(`Ren${ts}`.slice(0, 20));
    expect(new URL(page.url()).pathname).toBe(`/${slug}/settings/`);

    // Now go through with it.
    await page.getByRole("textbox", { name: "Name" }).fill(renamed);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /rename this project/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Rename", exact: true }).click();

    const nextSlug = renamed.toLowerCase();
    await page.waitForURL(`**/${nextSlug}/settings/**`, { timeout: 15_000 });

    // The old slug is freed, not redirected.
    await page.goto(`/${slug}`);
    await expect(page.getByText(/page not found/i)).toBeVisible();
  });

  test("the /p/:id prefix is gone", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    await registerAndVerify(page, `legacy${ts}@example.com`, "GoodPassw0rd");

    const { id } = await createProjectViaWizard(page, `Leg${ts}`.slice(0, 20));

    // Deleted outright rather than redirected — and `p` is in
    // `ProjectSlugService.reserved`, so no project can ever claim it back.
    await page.goto(`/p/${id}`);
    await expect(page.getByText(/page not found/i)).toBeVisible();
  });

  test("a name already taken is refused", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    await registerAndVerify(page, `dup${ts}@example.com`, "GoodPassw0rd");

    const first = `One${ts}`.slice(0, 20);
    await createProjectViaWizard(page, first);
    const { slug: secondSlug } = await createProjectViaWizard(
      page,
      `Two${ts}`.slice(0, 20),
    );

    await page.goto(`/${secondSlug}/settings/`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("textbox", { name: "Name" }).fill(first);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Rename", exact: true }).click();

    // The server refuses with a 409 and the project stays where it was.
    await expect(page.getByText(/already taken/i)).toBeVisible({
      timeout: 15_000,
    });
    expect(new URL(page.url()).pathname).toBe(`/${secondSlug}/settings/`);
  });
});
