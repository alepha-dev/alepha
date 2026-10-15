import { expect, test } from "./_fixtures.ts";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

test.describe("Uptime healthchecks", () => {
  test("the switch is visible and hides the sidebar entry when disabled", async ({
    page,
  }) => {
    await registerAndVerify(
      page,
      `uptime-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const { slug } = await createProjectViaWizard(page, "Healthchecks", {
      capabilities: ["apps"],
    });
    const nav = page.locator(`a[href="/${slug}/uptime"]`);
    await expect(nav).toHaveCount(0);
    await page.goto(`/${slug}/settings/capabilities`);
    const toggle = page.getByRole("switch", {
      name: "Healthchecks",
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    const saved = page.waitForResponse((res) =>
      res.url().includes("/capabilities/apps"),
    );
    await toggle.click();
    expect((await saved).ok()).toBe(true);
    await expect(nav).toBeVisible();
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    const disabled = page.waitForResponse((res) =>
      res.url().includes("/capabilities/apps"),
    );
    await toggle.click();
    expect((await disabled).ok()).toBe(true);
    await expect(nav).toHaveCount(0);
  });
});
