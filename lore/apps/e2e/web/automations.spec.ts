import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  createHostInProject,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Agent automations on their page (#Q4231): one created the way the CLI
 * creates it (its action), seen in Settings > General > Automations, run
 * from its row, its job opened from the row's last run, and switched off.
 */
const apiCall = async <T>(
  page: Page,
  action: string,
  method: string,
  path: Record<string, string | number>,
  body?: unknown,
): Promise<T> => {
  let url = await apiPath(page, action);
  for (const [key, value] of Object.entries(path)) {
    url = url.replace(`:${key}`, String(value));
  }
  return (await page.evaluate(
    async ({ url, method, body }) => {
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.status === 204 ? null : r.json();
    },
    { url, method, body },
  )) as T;
};

test.describe("Agent automations", () => {
  test("an automation shows on its page, runs from its row, and opens its job", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await registerAndVerify(
      page,
      `automations-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    const project = await createProjectViaWizard(page, "Automations Walk");
    const { id: hostId } = await createHostInProject(
      page,
      project.slug,
      "agent-walk",
    );
    await apiCall(
      page,
      "updateHost",
      "PATCH",
      { hostId },
      { jobsAllowed: true },
    );
    await apiCall(page, "updateHost", "PATCH", { hostId }, { agentHost: true });
    await apiCall(
      page,
      "createProjectAutomation",
      "POST",
      { projectId: project.id },
      {
        name: "nightly",
        promptKind: "text",
        promptText: "Summarise the week.",
        on: "daily@7",
      },
    );

    await page.goto(`/${project.slug}/settings/automations`);
    const row = page.locator("tbody tr", {
      has: page.getByTestId("automation-name").getByText("nightly", {
        exact: true,
      }),
    });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText("Daily at 7:00 UTC")).toBeVisible();
    await expect(row.getByText("Never run")).toBeVisible();

    await row.getByRole("button", { name: /actions/i }).click();
    await page.getByRole("menuitem", { name: "Run now" }).click();
    const lastRun = row.getByRole("link");
    await expect(lastRun).toBeVisible({ timeout: 15_000 });
    const href = await lastRun.getAttribute("href");
    expect(href).toMatch(new RegExp(`^/${project.slug}/jobs/`));

    // Switched off from the row: the trigger stops, the row stays.
    await row.getByTestId("automation-enabled").getByRole("switch").click();
    await expect
      .poll(async () => {
        const { items } = await apiCall<{
          items: Array<{ name: string; enabled: boolean }>;
        }>(page, "listProjectAutomations", "GET", { projectId: project.id });
        return items.find((it) => it.name === "nightly")?.enabled;
      })
      .toBe(false);

    const response = await page.goto(href ?? "/");
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Page not found")).toHaveCount(0);
  });
});
