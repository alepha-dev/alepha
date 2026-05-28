import * as fs from "node:fs";
import { expect, test } from "@playwright/test";
import {
  createCampaignViaWizard,
  emailDir,
  registerAndVerify,
} from "./_helpers.ts";

test.describe("Character Sheet page", () => {
  test.beforeAll(() => {
    fs.mkdirSync(emailDir, { recursive: true });
  });

  test("edits name and reflects on reload", async ({ page }) => {
    test.setTimeout(90_000);

    const email = `mc-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    const title = `MC${Date.now()}`.slice(0, 20);
    const campaignId = await createCampaignViaWizard(page, title);

    await page.goto(`/c/${campaignId}/character`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText(/identity|identité/i).first()).toBeVisible({
      timeout: 10_000,
    });

    const name = `Magnus-${Date.now()}`.slice(0, 30);
    const nameInput = page.getByRole("textbox", { name: /^name$|^nom$/i });
    await nameInput.fill(name);

    // AutoForm text fields commit on Enter OR via the inline ✓ Save
    // tick button (visible while the field is dirty). Click it — the
    // Base UI Input's <form> submit-on-Enter behaviour shifted with the
    // Nova migration, but the explicit Save button is stable.
    const saveResp = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && /\/updateMyCharacter/.test(r.url()),
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await saveResp).ok()).toBe(true);

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText(name).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
