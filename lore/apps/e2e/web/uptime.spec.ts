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
): Promise<string> => {
  const res = await page.request.post(`/api/projects/${projectId}/apps`, {
    data: { app, env: "production", ...(url ? { url } : {}) },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { id: string }).id;
};

test.describe("Uptime healthchecks", () => {
  test("Uptime has no sidebar entry, its switch is in General > Capabilities, and /uptime opens Apps", async ({
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
    // In General > Capabilities only since #Q3702.
    await page.goto(`/${slug}/settings/capabilities`);
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

  test("a Ship-only project monitors an app with no sigil from its settings: on, edit, off, on again", async ({
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

    // Nothing on the Overview until Monitor is on (#Q3684).
    await page.goto(`/${slug}/apps/web/production`);
    await expect(page.getByTestId("app-uptime")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add monitor", exact: true }),
    ).toHaveCount(0);

    await page.goto(`/${slug}/apps/web/production/settings`);
    const toggle = page.getByTestId("app-monitor-toggle");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    const summary = page.getByTestId("app-monitor-summary");
    await expect(summary).toContainText(`${baseURL}/health`);

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const name = dialog.getByRole("textbox", { name: "Name", exact: true });
    await expect(name).toHaveValue("web production");
    await name.fill("Web probe");
    // Alerts are notifications (#Q3892): the form has no recipients.
    await expect(
      dialog.getByRole("textbox", { name: "Recipients", exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);

    await page.goto(`/${slug}/apps/web/production`);
    const card = page.getByTestId("app-uptime");
    await expect(card).toBeVisible();
    // The card opens the app's Uptime tab (#Q3677), which reads and watches.
    const link = card.getByRole("link", { name: "Web probe", exact: true });
    const href = `/${slug}/apps/web/production/uptime`;
    await expect(link).toHaveAttribute("href", href);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(
      page.getByRole("heading", { name: "Web probe", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Incident history", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).toHaveCount(0);
    const tab = page.getByRole("link", { name: "Uptime", exact: true });
    await expect(tab).toBeVisible();

    // The monitor's old address lands on the tab.
    const monitors = await page.request.get(`/api/projects/${id}/monitors`);
    const [{ id: monitorId }] = (
      (await monitors.json()) as {
        items: Array<{ id: string }>;
      }
    ).items;
    await page.goto(`/${slug}/uptime/${monitorId}`);
    await expect(page).toHaveURL(new RegExp(`${href}$`));

    // Off keeps the monitor: the card goes, and on brings back the same one.
    await page.goto(`/${slug}/apps/web/production/settings`);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.goto(`/${slug}/apps/web/production`);
    await expect(page.getByTestId("app-uptime")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Uptime", exact: true }),
    ).toHaveCount(0);
    await page.goto(`/${slug}/apps/web/production/settings`);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.goto(`/${slug}/apps/web/production`);
    await expect(
      page.getByTestId("app-uptime").getByRole("link", { name: "Web probe" }),
    ).toHaveAttribute("href", href);
    await page.getByRole("link", { name: "Uptime", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Web probe", exact: true }),
    ).toBeVisible();

    await page.goto(`/${slug}/errors`);
    await expect(page.getByText("No open errors")).toBeVisible();
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });

  test("an app with no address cannot switch Monitor on", async ({ page }) => {
    await registerAndVerify(
      page,
      `nowhere-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const { id, slug } = await createProjectViaWizard(page, "No address", {
      capabilities: ["ship"],
      options: { ship: ["uptime"] },
    });
    await createApp(page, id, "worker");
    await page.goto(`/${slug}/apps/worker/production/settings`);
    await expect(page.getByTestId("app-monitor-toggle")).toHaveAttribute(
      "data-disabled",
      "",
    );
    await expect(page.getByText(/Set the address above first/)).toBeVisible();
  });

  test("a push URL is shown once and rotation, from the app's settings, revokes the previous URL", async ({
    page,
    request,
    baseURL,
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
    // A job with no address: its app is only a name, and its push monitor
    // is made the way an agent or the CLI makes one.
    const appInstanceId = await createApp(page, id, "backups");
    const made = await page.request.post(`/api/projects/${id}/monitors`, {
      data: { appInstanceId, name: "Nightly backup", kind: "push", target: "" },
    });
    expect(made.ok()).toBe(true);
    const first = `${baseURL}/uptime/push/${((await made.json()) as { token: string }).token}`;
    expect((await request.get(first)).status()).toBe(204);

    await page.goto(`/${slug}/apps/backups/production/settings`);
    await expect(page.getByTestId("app-monitor-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page
      .getByRole("button", { name: "Rotate push URL", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Rotate push URL", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const second = await dialog.locator("code").innerText();
    expect(second).not.toBe(first);
    expect((await request.get(first)).status()).toBe(404);
    expect((await request.get(second)).status()).toBe(204);
  });
});
