import type { Request, Response } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

/**
 * Every control waits for the actual mutation, direct or in /api/_batch.
 * A visible state change alone is never proof that a write completed.
 */
test.describe("Automations", () => {
  const mutation = (request: Request) =>
    (request.method() === "PATCH" &&
      /\/automations\/[^/]+\/enabled$/.test(new URL(request.url()).pathname)) ||
    (request.method() === "POST" &&
      request.url().includes("/api/_batch") &&
      request.postData()?.includes('"action":"setAutomationEnabled"') === true);
  const result = async (response: Response) => {
    const body = await response.json();
    if (Array.isArray(body)) {
      const index = response
        .request()
        .postDataJSON()
        .findIndex(
          (entry: { action: string }) =>
            entry.action === "setAutomationEnabled",
        );
      return body[index];
    }
    return body;
  };

  test("shows confirmed state, waits for writes and reconciles a revision conflict", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await registerAndVerify(
      page,
      `automation-list-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const project = await createProjectViaWizard(page, "Automation list");
    await setCapability(page, project.id, "work", {
      options: { automations: true },
    });
    const me = await (await page.request.get("/api/users/me")).json();
    const createPath = (await apiPath(page, "createAutomation")).replace(
      ":projectId",
      String(project.id),
    );
    const created = await page.request.post(createPath, {
      data: {
        title: "Confirm quest completion",
        rule: {
          version: 1,
          trigger: { kind: "event", event: "quest.completed" },
          select: null,
          guard: null,
          actions: [
            {
              kind: "notify",
              recipient: me.id,
              channel: "inbox",
              title: "Quest completed",
              text: "{{title}}",
              category: "automations",
            },
          ],
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const rule = await created.json();
    const enablePath = (await apiPath(page, "setAutomationEnabled"))
      .replace(":projectId", String(project.id))
      .replace(":id", rule.id);
    const getPath = (await apiPath(page, "getAutomation"))
      .replace(":projectId", String(project.id))
      .replace(":id", rule.id);
    await page.goto(`/${project.slug}/automations`);
    const row = page
      .getByRole("row")
      .filter({ hasText: "Confirm quest completion" });
    await expect(row.getByText("Disabled", { exact: true })).toBeVisible();
    await expect(
      page.getByPlaceholder("Search automations by name"),
    ).toBeVisible();
    const armed = page.waitForResponse((response) =>
      mutation(response.request()),
    );
    await row.getByRole("button", { name: "Enable", exact: true }).click();
    const armResponse = await armed;
    expect(armResponse.ok()).toBe(true);
    const armResult = await result(armResponse);
    expect(armResult.error).toBeUndefined();
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    const saved = await (await page.request.get(getPath)).json();
    expect(saved.enabled).toBe(true);
    const otherWrite = await page.request.patch(enablePath, {
      data: { enabled: false, expectedRevision: saved.revision },
    });
    expect(otherWrite.ok()).toBe(true);
    const refused = page.waitForResponse((response) =>
      mutation(response.request()),
    );
    await row.getByRole("button", { name: "Disable", exact: true }).click();
    const refusal = await refused;
    const conflict = await result(refusal);
    expect(JSON.stringify(conflict)).toMatch(/revision|changed/i);
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /revision|changed/i }),
    ).toBeVisible();
    await expect(row.getByText("Disabled", { exact: true })).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Enable", exact: true }),
    ).toBeEnabled();
    expect((await (await page.request.get(getPath)).json()).enabled).toBe(
      false,
    );
    await page.screenshot({
      path: testInfo.outputPath("automation-list-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("automation-list-mobile.png"),
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page
      .getByPlaceholder("Search automations by name")
      .fill("No matching rule");
    await expect(
      page.getByText("No matching automations", { exact: true }),
    ).toBeVisible();
  });

  test("offers the permitted gallery from an explicit empty state", async ({
    page,
  }) => {
    await registerAndVerify(
      page,
      `automation-empty-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const project = await createProjectViaWizard(page, "Automation empty");
    await setCapability(page, project.id, "work", {
      options: { automations: true },
    });
    await page.goto(`/${project.slug}/automations`);
    await expect(
      page.getByText("No automations yet", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Browse presets", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/${project.slug}/automations/presets$`),
    );
    await expect(
      page.getByRole("heading", { name: "Automation presets", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Nightly tagged quests",
        exact: true,
      }),
    ).toBeVisible();
  });
});
