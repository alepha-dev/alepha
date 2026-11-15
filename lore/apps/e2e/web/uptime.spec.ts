import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

/**
 * An app copy for a monitor to belong to (#Q3657): a name and an
 * environment, no deploy and no sigil. Through the API, since the dialog is
 * covered by `apps.spec.ts`.
 */
const createApp = async (
  page: Page,
  projectId: number,
  app: string,
  url?: string,
): Promise<void> => {
  const res = await page.request.post(`/api/projects/${projectId}/apps`, {
    data: { app, env: "production", ...(url ? { url } : {}) },
  });
  expect(res.ok()).toBe(true);
};

test.describe("Uptime healthchecks", () => {
  test("Uptime has no sidebar entry, its switch is on the Apps settings, and /uptime opens Apps", async ({
    page,
  }) => {
    await registerAndVerify(
      page,
      `uptime-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const { slug } = await createProjectViaWizard(page, "Healthchecks", {
      capabilities: ["ship"],
    });
    const nav = page.locator(`a[href="/${slug}/uptime"]`);
    await page.goto(`/${slug}/settings/apps`);
    const toggle = page.getByRole("switch", {
      name: "Monitor apps",
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    const saved = page.waitForResponse((res) =>
      res.url().includes("/capabilities/ship"),
    );
    await toggle.click();
    expect((await saved).ok()).toBe(true);
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(nav).toHaveCount(0);

    await page.goto(`/${slug}/uptime`);
    await expect(page).toHaveURL(new RegExp(`/${slug}/apps$`));
  });

  test("a Ship-only project adds a monitor to an app with no sigil, then edits, pauses and deletes it", async ({
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
      { capabilities: ["ship"], options: { ship: ["uptime"] } },
    );
    await setCapability(page, id, "plan", { enabled: false });
    await setCapability(page, id, "remember", { enabled: false });
    await createApp(page, id, "web", `${baseURL}/health`);
    await page.goto(`/${slug}/apps/web/production`);
    await page
      .getByRole("button", { name: "Add monitor", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("textbox", { name: "Target", exact: true }),
    ).toHaveValue(`${baseURL}/health`);
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Web probe");
    await expect(
      dialog.getByRole("switch", { name: "Email alerts", exact: true }),
    ).toBeChecked();
    await dialog
      .getByRole("textbox", { name: "Recipients", exact: true })
      .fill("health-team@example.com");
    await dialog
      .getByRole("button", { name: "Create monitor", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);

    // The app's card links to the monitor, which the Apps table shows too.
    await page.getByRole("link", { name: "Web probe", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Web probe", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Incident history", exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("textbox", {
        name: "Recipients",
        exact: true,
      }),
    ).toHaveValue("health-team@example.com");
    await dialog
      .getByRole("switch", { name: "Email alerts", exact: true })
      .click();
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Renamed probe");
    await dialog
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Renamed probe", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/apps$`));
    await page.goto(`/${slug}/errors`);
    await expect(page.getByText(/No errors\./i)).toBeVisible();
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
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
    const { id, slug } = await createProjectViaWizard(page, "Backup checks", {
      capabilities: ["ship"],
      options: { ship: ["uptime"] },
    });
    // A job with no address: its app is only a name.
    await createApp(page, id, "backups");
    await page.goto(`/${slug}/apps/backups/production`);
    await page
      .getByRole("button", { name: "Add monitor", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    // The dialog starts from the app's name: wait for it before typing over.
    const name = dialog.getByRole("textbox", { name: "Name", exact: true });
    await expect(name).toHaveValue("backups production");
    await name.fill("Nightly backup");
    await expect(name).toHaveValue("Nightly backup");
    await dialog.getByRole("combobox", { name: "Kind", exact: true }).click();
    await page
      .getByRole("option", { name: "Push receipt", exact: true })
      .click();
    await expect(name).toHaveValue("Nightly backup");
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
    await page
      .getByRole("link", { name: "Nightly backup", exact: true })
      .click();
    await page
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
