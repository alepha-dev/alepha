import { expect, test } from "@playwright/test";
import { registerAndVerify } from "./_helpers.ts";

/**
 * Regression — Lore #103. The create-campaign wizard's StepModules
 * toggles were lost on submit because the `useForm` handler closed
 * over a stale `features` state (FormModel built once in useMemo with
 * empty deps). The fix reads `features` through a ref so submit sees
 * the live value.
 *
 * Drive the full wizard with Kanban + Chapters toggled OFF, then
 * assert via the API that the created campaign actually has those
 * features disabled.
 */
test.describe("Campaign wizard — feature toggles", () => {
  test("toggling Kanban + Chapters off in StepModules persists to the created campaign", async ({
    page,
  }) => {
    const stamp = Date.now();
    const email = `wiz-${stamp}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.goto("/new-campaign");
    await page.waitForLoadState("networkidle");

    // Step 1 — title.
    await page
      .locator('input[type="text"]')
      .first()
      .fill(`Wiz${stamp}`.slice(0, 24));
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 2 — icon (skip).
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 3 — modules. Toggle Kanban + Chapters OFF.
    // ModuleToggle renders as <button aria-pressed=…> with the label
    // ("Kanban — Visual board" / "Chapters — Sprints") inside.
    const kanbanToggle = page
      .getByRole("button", { name: /kanban.*visual board|kanban.*tableau/i })
      .first();
    const chaptersToggle = page
      .getByRole("button", { name: /chapters.*sprints|chapitres.*cycles/i })
      .first();
    await expect(kanbanToggle).toHaveAttribute("aria-pressed", "true");
    await expect(chaptersToggle).toHaveAttribute("aria-pressed", "true");
    await kanbanToggle.click();
    await chaptersToggle.click();
    await expect(kanbanToggle).toHaveAttribute("aria-pressed", "false");
    await expect(chaptersToggle).toHaveAttribute("aria-pressed", "false");

    // Submit.
    await page.getByRole("button", { name: /create campaign/i }).click();
    await page.waitForURL(/\/c\/\d+/, { timeout: 15_000 });

    // CampaignView's sidebar gates the Kanban + Chapters entries on
    // the matching feature flag (CampaignView.tsx:115, :165). If the
    // toggles persisted as `false`, neither link should appear in the
    // sidebar — that's the visible regression we're guarding against.
    // Scope to the sidebar nav so the breadcrumb "Board" pseudo-link
    // doesn't confuse the locator.
    const sidebar = page.getByRole("navigation").first();
    await expect(
      sidebar.getByRole("link", { name: /^board$|^tableau$/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(sidebar.getByRole("link", { name: /^kanban$/i })).toHaveCount(
      0,
    );
    await expect(
      sidebar.getByRole("link", { name: /^chapters$|^chapitres$/i }),
    ).toHaveCount(0);
  });
});
