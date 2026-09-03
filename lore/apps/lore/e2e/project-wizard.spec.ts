import { expect, test } from "./_fixtures.ts";
import { registerAndVerify } from "./_helpers.ts";

/**
 * Regression — Lore #103. The create-project wizard's StepModules
 * toggles were lost on submit because the `useForm` handler closed
 * over a stale `features` state (FormModel built once in useMemo with
 * empty deps). The fix reads `features` through a ref so submit sees
 * the live value.
 *
 * Drive the full wizard with Kanban + Releases toggled OFF, then assert
 * from the UI that the created project actually has those features
 * disabled: Releases via its (still gated) sidebar link, Kanban via the
 * "Enable" switch on its settings sub-page — Kanban stopped being a
 * sidebar entry in the great rename (Task 8), so the sidebar can no
 * longer be the observation for it.
 */
test.describe("Project wizard — feature toggles", () => {
  test("toggling Kanban + Releases off in StepModules persists to the created project", async ({
    page,
  }) => {
    const stamp = Date.now();
    const email = `wiz-${stamp}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.goto("/new-project");
    await page.waitForLoadState("networkidle");

    // Step 1 — title.
    await page
      .locator('input[type="text"]')
      .first()
      .fill(`Wiz${stamp}`.slice(0, 24));
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 2 — icon (skip).
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 3 — modules. Toggle Kanban + Releases OFF.
    // ModuleToggle renders as <button aria-pressed=…> with the label
    // ("Kanban - Visual board" / "Releases - Shipping") inside.
    const kanbanToggle = page
      .getByRole("button", { name: /kanban.*visual board|kanban.*tableau/i })
      .first();
    const releasesToggle = page
      .getByRole("button", { name: /releases.*shipping|versions.*livraisons/i })
      .first();
    await expect(kanbanToggle).toHaveAttribute("aria-pressed", "true");
    await expect(releasesToggle).toHaveAttribute("aria-pressed", "true");
    await kanbanToggle.click();
    await releasesToggle.click();
    await expect(kanbanToggle).toHaveAttribute("aria-pressed", "false");
    await expect(releasesToggle).toHaveAttribute("aria-pressed", "false");

    // Submit.
    await page.getByRole("button", { name: /create project/i }).click();
    // Lands on `/<slug>`. Matched with a predicate rather than a regex —
    // `/new-project`, the page being left, is also a single root segment.
    await page.waitForURL(
      (url) =>
        url.pathname !== "/new-project" &&
        url.pathname.split("/").filter(Boolean).length === 1,
      { timeout: 15_000 },
    );
    const projectSlug = new URL(page.url()).pathname.split("/").find(Boolean);
    expect(projectSlug).toBeTruthy();

    // ProjectView's sidebar gates the Releases entry on the matching
    // feature flag. If the toggle persisted as `false`, the link should
    // not appear — that's the visible regression we're guarding against.
    // Scope to the actual sidebar container (`[data-slot="sidebar"]`,
    // from @alepha/ui's shadcn `<Sidebar>`) rather than
    // `getByRole("navigation")`, which resolves to the breadcrumb `<nav>`
    // in the main content area, not the sidebar — the sidebar itself has
    // no ARIA landmark.
    const sidebar = page.locator('[data-slot="sidebar"]');
    // Quests has no feature gate, so it's a stable positive control that
    // the (correctly-scoped) sidebar locator actually found the sidebar.
    await expect(
      sidebar.getByRole("link", { name: /^quests$|^quêtes$/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      sidebar.getByRole("link", { name: /^releases$|^chapitres$/i }),
    ).toHaveCount(0);

    // Kanban is a view of the Quests page now, not a
    // sidebar entry (the great rename, Task 8) — there is no sidebar link
    // whose absence would prove the toggle persisted. The UI's only other
    // observable surface for the flag is the settings sub-page switch.
    await page.goto(`/${projectSlug}/settings/kanban`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("switch", { name: /enable/i })).toHaveAttribute(
      "aria-checked",
      "false",
      { timeout: 10_000 },
    );
  });
});
