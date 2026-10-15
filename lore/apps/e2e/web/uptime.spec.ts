import { expect, test } from "./_fixtures.ts";
import {
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

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
  test("an Apps-only project creates, edits, pauses and deletes a monitor without a sigil", async ({
    page,
    baseURL,
  }) => {
    await registerAndVerify(
      page,
      `health-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const { id, slug } = await createProjectViaWizard(
      page,
      "Healthcheck board",
      { capabilities: ["apps"], options: { apps: ["uptime"] } },
    );
    await setCapability(page, id, "work", { enabled: false });
    await setCapability(page, id, "knowledge", { enabled: false });
    await page.goto(`/${slug}/uptime`);
    await page
      .getByRole("button", { name: "Add monitor", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Web probe");
    await dialog
      .getByRole("textbox", { name: "Target", exact: true })
      .fill(`${baseURL}/health`);
    await dialog
      .getByRole("button", { name: "Create monitor", exact: true })
      .click();
    let row = page.getByRole("listitem").filter({ hasText: "Web probe" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Renamed probe");
    await dialog
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    row = page.getByRole("listitem").filter({ hasText: "Renamed probe" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(row).toContainText("Paused");
    await row.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(
      row.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(row).toHaveCount(0);
  });

  test("a push URL is shown once and rotation revokes the previous URL", async ({
    page,
    request,
  }) => {
    await registerAndVerify(
      page,
      `receipt-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const { slug } = await createProjectViaWizard(page, "Backup checks", {
      capabilities: ["apps"],
      options: { apps: ["uptime"] },
    });
    await page.goto(`/${slug}/uptime`);
    await page
      .getByRole("button", { name: "Add monitor", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Nightly backup");
    await dialog.getByRole("combobox", { name: "Kind", exact: true }).click();
    await page
      .getByRole("option", { name: "Push receipt", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Create monitor", exact: true })
      .click();
    const first = await dialog.locator("code").innerText();
    expect((await request.get(first)).status()).toBe(204);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await page.reload();
    await expect(page.locator("code").filter({ hasText: first })).toHaveCount(
      0,
    );
    const row = page
      .getByRole("listitem")
      .filter({ hasText: "Nightly backup" });
    await row
      .getByRole("button", { name: "Rotate push URL", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Rotate push URL", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    const second = await dialog.locator("code").innerText();
    expect(second).not.toBe(first);
    expect((await request.get(first)).status()).toBe(404);
    expect((await request.get(second)).status()).toBe(204);
  });
});
