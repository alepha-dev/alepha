import type { Locator, Page, Request, Response } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  newUserContext,
  signInAsAdmin,
  createProjectViaWizard,
  createRankFromPreset,
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
  /**
   * Opens one row's menu, where Enable, Disable and Delete live.
   */
  const openRowMenu = async (row: Locator) => {
    const menu = row.page().getByRole("menu");
    // A menu still animating closed from the last pick swallows the click.
    await expect(menu).toHaveCount(0);
    await row.getByRole("button", { name: "Open row actions" }).click();
    return menu;
  };
  /**
   * One field of the preset form: its control, the Share link and, once
   * sharing is on, the segmented choice of where the value comes from.
   */
  const presetSlot = (page: Page, label: string) =>
    page
      .locator("form > div > div")
      .filter({ hasText: new RegExp(`^${label}`) });
  const previewResult = (page: Page) =>
    page.locator('[aria-label="Preview result"]');

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
      page.getByPlaceholder("Search", { exact: true }),
    ).toBeVisible();
    const armed = page.waitForResponse((response) =>
      mutation(response.request()),
    );
    const enableMenu = await openRowMenu(row);
    await enableMenu
      .getByRole("menuitem", { name: "Enable", exact: true })
      .click();
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
    const disableMenu = await openRowMenu(row);
    await disableMenu
      .getByRole("menuitem", { name: "Disable", exact: true })
      .click();
    const refusal = await refused;
    const conflict = await result(refusal);
    expect(JSON.stringify(conflict)).toMatch(/revision|changed/i);
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /revision|changed/i }),
    ).toBeVisible();
    await expect(row.getByText("Disabled", { exact: true })).toBeVisible();
    const menu = await openRowMenu(row);
    await expect(
      menu.getByRole("menuitem", { name: "Enable", exact: true }),
    ).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
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
      .getByPlaceholder("Search", { exact: true })
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
      page.getByRole("link", { name: "How automations work" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/alepha-dev/lore/blob/main/docs/1-guides/9-automations.md",
    );
    await expect(
      page.getByText("No automations yet", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "New automation", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/${project.slug}/automations/presets$`),
    );
    await expect(
      page.getByRole("heading", { name: "New automation", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId("automation-preset-tagged-quest-digest"),
    ).toContainText("Nightly tagged quests");
  });
  test("keeps rule diagnostics on their own Quests tab, readable with the option off, and off General", async ({
    page,
  }) => {
    await registerAndVerify(
      page,
      `automation-diagnostics-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    // The option is off by default: the case the diagnostics exist for.
    const project = await createProjectViaWizard(page, "Automation diag");
    const diagnostics = page.getByRole("heading", {
      name: "Automation diagnostics",
    });

    await page.goto(`/${project.slug}/settings`);
    await expect(page.getByText("Danger Zone", { exact: true })).toBeVisible();
    await expect(diagnostics).toHaveCount(0);

    const tab = page.locator(
      `a[href="/${project.slug}/settings/work/automations"]`,
    );
    await page.goto(`/${project.slug}/settings/work`);
    await tab.first().click();
    await expect(page).toHaveURL(
      new RegExp(`/${project.slug}/settings/work/automations$`),
    );
    await expect(diagnostics).toBeVisible();
    await expect(
      page.getByText("No automations in this project.", { exact: true }),
    ).toBeVisible();
    // One page of rules has no pager.
    await expect(page.getByRole("button", { name: "Previous" })).toHaveCount(0);
  });
  test("creates an isolated preset, previews without writes and enables only after an explicit action", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await registerAndVerify(
      page,
      `automation-setup-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const project = await createProjectViaWizard(page, "Preset setup");
    await setCapability(page, project.id, "work", {
      options: { automations: true },
    });
    const me = await (await page.request.get("/api/users/me")).json();
    const variablePath = (await apiPath(page, "setAutomationVariable"))
      .replace(":projectId", String(project.id))
      .replace(":key", "recipient");
    const seeded = await page.request.put(variablePath, {
      data: { value: { kind: "member", value: me.id } },
    });
    expect(seeded.ok()).toBe(true);
    const originalVariable = (await seeded.json()).variable;
    const memberPath = (
      await apiPath(page, "getAutomationSetupOptions")
    ).replace(":projectId", String(project.id));
    const members = await (
      await page.request.get(`${memberPath}?kind=member&offset=0&limit=50`)
    ).json();
    const owner = members.items.find(
      (item: { value: string }) => item.value === me.id,
    );
    expect(owner).toBeTruthy();
    await page.goto(`/${project.slug}/automations/presets`);
    await page.getByTestId("automation-preset-tagged-quest-digest").click();
    await expect(
      page.getByRole("heading", { name: "Nightly tagged quests", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "All presets", exact: true }),
    ).toBeVisible();
    // Every value is this rule's own until sharing is asked for explicitly.
    await expect(
      presetSlot(page, "Recipient").getByRole("button", {
        name: "Share with other automations",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("radiogroup")).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "Recipient", exact: true })
      .click();
    await page.getByRole("option", { name: owner.label, exact: true }).click();
    await page.getByRole("textbox", { name: "Tag", exact: true }).fill("daily");
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        (new URL(response.url()).pathname.endsWith("/automation-presets") ||
          (response.url().includes("/api/_batch") &&
            response
              .request()
              .postData()
              ?.includes('"action":"createAutomationFromPreset"') === true)),
    );
    await page
      .getByRole("button", { name: "Create automation", exact: true })
      .click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    const body = await response.json();
    const created = Array.isArray(body)
      ? body.find((item) => item.action === "createAutomationFromPreset").data
      : body;
    expect(created).toMatchObject({
      enabled: false,
      revision: 0,
      presetKey: "tagged-quest-digest",
      rule: {
        select: { filters: { tag: "daily" } },
        actions: [
          expect.objectContaining({ recipient: me.id, channel: "inbox" }),
        ],
      },
    });
    await expect(page).toHaveURL(
      new RegExp(`/${project.slug}/automations/${created.id}$`),
    );
    await expect(page.getByText("Disabled", { exact: true })).toBeVisible();
    const getPath = (await apiPath(page, "getAutomation"))
      .replace(":projectId", String(project.id))
      .replace(":id", created.id);
    const before = await (await page.request.get(getPath)).json();
    const tested = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        (new URL(response.url()).pathname.endsWith("/test") ||
          (response.url().includes("/api/_batch") &&
            response
              .request()
              .postData()
              ?.includes('"action":"testAutomation"') === true)),
    );
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    expect((await tested).ok()).toBe(true);
    await expect(previewResult(page)).toContainText("Planned actions: 0.");
    expect(await (await page.request.get(getPath)).json()).toEqual(before);
    const enabled = page.waitForResponse((response) =>
      mutation(response.request()),
    );
    await page.getByRole("button", { name: "Enable", exact: true }).click();
    expect((await enabled).ok()).toBe(true);
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    expect((await (await page.request.get(getPath)).json()).enabled).toBe(true);
    const variablesPath = (
      await apiPath(page, "listAutomationVariables")
    ).replace(":projectId", String(project.id));
    const variables = await (await page.request.get(variablesPath)).json();
    expect(variables.items).toEqual([originalVariable]);
  });

  test("binds an existing recipient and explicitly creates a tag variable without replacing a shared key", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await registerAndVerify(
      page,
      `automation-share-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const project = await createProjectViaWizard(page, "Shared preset");
    await setCapability(page, project.id, "work", {
      options: { automations: true },
    });
    const me = await (await page.request.get("/api/users/me")).json();
    const variablePath = (await apiPath(page, "setAutomationVariable"))
      .replace(":projectId", String(project.id))
      .replace(":key", "recipient");
    const seeded = await page.request.put(variablePath, {
      data: { value: { kind: "member", value: me.id } },
    });
    expect(seeded.ok()).toBe(true);
    const original = (await seeded.json()).variable;
    await page.goto(`/${project.slug}/automations/presets`);
    await page.getByTestId("automation-preset-tagged-quest-digest").click();
    const recipient = presetSlot(page, "Recipient");
    await recipient
      .getByRole("button", { name: "Share with other automations" })
      .click();
    // A compatible variable exists, so sharing starts on binding it.
    await expect(
      recipient.getByRole("radio", { name: "Shared variable", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await page
      .getByRole("combobox", { name: "Recipient shared variable", exact: true })
      .click();
    await page
      .getByRole("option", { name: "recipient (v0)", exact: true })
      .click();
    const tag = presetSlot(page, "Tag");
    await tag
      .getByRole("button", { name: "Share with other automations" })
      .click();
    // No text variable exists, so the only way to share is a new one.
    await expect(
      tag.getByRole("radio", { name: "New shared variable", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      tag.getByRole("radio", { name: "Shared variable", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("textbox", { name: "Tag", exact: true }).fill("daily");
    await page
      .getByRole("textbox", { name: "New variable key", exact: true })
      .fill("dailyTag");
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        (new URL(response.url()).pathname.endsWith("/automation-presets") ||
          (response.url().includes("/api/_batch") &&
            response
              .request()
              .postData()
              ?.includes('"action":"createAutomationFromPreset"') === true)),
    );
    await page
      .getByRole("button", { name: "Create automation", exact: true })
      .click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    const body = await response.json();
    const created = Array.isArray(body)
      ? body.find((item) => item.action === "createAutomationFromPreset").data
      : body;
    expect(created).toMatchObject({
      enabled: false,
      rule: {
        select: { filters: { tag: "{{dailyTag}}" } },
        actions: [expect.objectContaining({ recipient: "{{recipient}}" })],
      },
    });
    const variablesPath = (
      await apiPath(page, "listAutomationVariables")
    ).replace(":projectId", String(project.id));
    const variables = await (await page.request.get(variablesPath)).json();
    expect(variables.items).toHaveLength(2);
    expect(
      variables.items.find((item: { key: string }) => item.key === "recipient"),
    ).toEqual(original);
    expect(
      variables.items.find((item: { key: string }) => item.key === "dailyTag"),
    ).toMatchObject({
      version: 0,
      kind: "text",
      value: { kind: "text", value: "daily" },
    });
    await expect(page).toHaveURL(
      new RegExp(`/${project.slug}/automations/${created.id}$`),
    );
    await expect(
      page.getByText(/^Notify shared variable recipient via /),
    ).toBeVisible();
  });

  test("previews release publication through same-project folio and source pickers without appending", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await registerAndVerify(
      page,
      `automation-release-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const project = await createProjectViaWizard(page, "Release preset");
    await setCapability(page, project.id, "work", {
      options: { automations: true, releases: true },
    });
    const folioResponse = await page.request.post(
      await apiPath(page, "create"),
      {
        data: {
          projectId: project.id,
          title: "Release journal",
          content: "Human introduction",
        },
      },
    );
    expect(folioResponse.ok()).toBe(true);
    const folio = await folioResponse.json();
    const readFolio = (await apiPath(page, "get")).replace(":id", folio.id);
    const releasePath = (await apiPath(page, "createRelease")).replace(
      ":projectId",
      String(project.id),
    );
    const releaseResponse = await page.request.post(releasePath, {
      data: { tag: "3.2.1", title: "Planned release" },
    });
    expect(releaseResponse.ok()).toBe(true);
    const optionsPath = (
      await apiPath(page, "getAutomationSetupOptions")
    ).replace(":projectId", String(project.id));
    const members = await (
      await page.request.get(`${optionsPath}?kind=member&offset=0&limit=50`)
    ).json();
    await page.goto(`/${project.slug}/automations/presets`);
    await page.getByTestId("automation-preset-release-to-folio").click();
    await expect(
      page.getByRole("heading", {
        name: "Publish release notes to a folio",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Recipient", exact: true })
      .click();
    await page
      .getByRole("option", { name: members.items[0].label, exact: true })
      .click();
    await page.getByRole("combobox", { name: "Folio", exact: true }).click();
    await page
      .getByRole("option", { name: "Release journal", exact: true })
      .click();
    await expect(
      page.getByRole("option", { name: "Release journal", exact: true }),
    ).toBeHidden();
    await page.screenshot({
      path: testInfo.outputPath("release-preset-setup.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Create automation", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/${project.slug}/automations/[^/]+$`),
    );
    await page
      .getByRole("combobox", { name: "Source record", exact: true })
      .click();
    await page
      .getByRole("option", { name: "3.2.1: Planned release", exact: true })
      .click();
    const tested = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        (new URL(response.url()).pathname.endsWith("/test") ||
          (response.url().includes("/api/_batch") &&
            response
              .request()
              .postData()
              ?.includes('"action":"testAutomation"') === true)),
    );
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    expect((await tested).ok()).toBe(true);
    const preview = previewResult(page);
    await expect(preview).toContainText("Planned actions: 2.");
    await expect(preview).toContainText("3.2.1");
    expect((await (await page.request.get(readFolio)).json()).content).toBe(
      "Human introduction",
    );
    await page
      .getByRole("button", { name: "Enable", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("release-preset-preview.png"),
      fullPage: true,
    });
  });

  test("edits four typed slots and preserves a refused revision draft", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await registerAndVerify(
      page,
      `automation-editor-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const project = await createProjectViaWizard(page, "Rule editor");
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
        title: "Editable rule",
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
              title: "Original title",
              text: "Original body",
              category: "automations",
            },
          ],
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const original = await created.json();
    await page.goto(`/${project.slug}/automations/${original.id}`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.getByRole("region", { name: "Edit rule", exact: true });
    await editor
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Edited nightly rule");
    await editor
      .getByRole("combobox", { name: "Trigger", exact: true })
      .click();
    await page
      .getByRole("option", { name: "On a schedule (UTC)", exact: true })
      .click();
    await editor.getByRole("combobox", { name: "Source", exact: true }).click();
    await page
      .getByRole("option", {
        name: "Open quests with a tag, as one digest",
        exact: true,
      })
      .click();
    await editor
      .getByRole("textbox", { name: "Tag", exact: true })
      .fill("editor-tag");
    await editor.getByRole("combobox", { name: "Field", exact: true }).click();
    await page.getByRole("option", { name: "total", exact: true }).click();
    await editor
      .getByRole("combobox", { name: "Operator", exact: true })
      .click();
    await page.getByRole("option", { name: "is above", exact: true }).click();
    await editor
      .getByRole("spinbutton", { name: "Value", exact: true })
      .fill("2");
    await editor
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Edited {{title}}");
    await editor
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Edited {{summary}}");
    await editor
      .getByRole("textbox", { name: "Name", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("automation-editor-top.png"),
    });
    await editor
      .getByRole("button", { name: "Save changes", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("automation-editor-actions.png"),
    });
    const save = page.waitForResponse(
      (response) =>
        (response.request().method() === "PUT" &&
          response.url().includes("/automations/")) ||
        (response.url().includes("/api/_batch") &&
          response
            .request()
            .postData()
            ?.includes('"action":"updateAutomation"') === true),
    );
    await editor
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    expect((await save).ok()).toBe(true);
    await expect(
      page.getByRole("heading", {
        name: "Edited nightly rule",
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    const getPath = (await apiPath(page, "getAutomation"))
      .replace(":projectId", String(project.id))
      .replace(":id", original.id);
    const saved = await (await page.request.get(getPath)).json();
    expect(saved.rule.trigger).toEqual({ kind: "schedule", cron: "0 0 * * *" });
    expect(saved.rule.select).toEqual({
      key: "quests.tagged",
      kind: "collection",
      filters: { tag: "editor-tag" },
    });
    expect(saved.rule.guard).toEqual({
      field: "total",
      operator: "gt",
      value: 2,
    });
    expect(saved.rule.actions[0].text).toBe("Edited {{summary}}");
    expect(saved.authorUserId).toBe(original.authorUserId);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await editor
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Preserved draft");
    const updatePath = (await apiPath(page, "updateAutomation"))
      .replace(":projectId", String(project.id))
      .replace(":id", original.id);
    const concurrent = await page.request.put(updatePath, {
      data: {
        title: "Other saved edit",
        rule: saved.rule,
        expectedRevision: saved.revision,
      },
    });
    expect(concurrent.ok()).toBe(true);
    const conflict = page.waitForResponse(
      (response) =>
        (response.request().method() === "PUT" &&
          response.url().includes("/automations/")) ||
        (response.url().includes("/api/_batch") &&
          response
            .request()
            .postData()
            ?.includes('"action":"updateAutomation"') === true),
    );
    await editor
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await conflict;
    await expect(
      page.getByRole("status").filter({ hasText: "Your draft is preserved" }),
    ).toBeVisible();
    await expect(
      editor.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("Preserved draft");
    expect((await (await page.request.get(getPath)).json()).title).toBe(
      "Other saved edit",
    );
    await page
      .getByRole("button", { name: "Discard draft and reload", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Other saved edit",
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Detailed snapshots are retained for 30 days. Deduplication identities remain for 90 days.",
      ),
    ).toBeVisible();
  });

  test("manages typed shared values with version fencing and unused-only deletion", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await registerAndVerify(
      page,
      `automation-vars-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const project = await createProjectViaWizard(
      page,
      "Shared variable management",
    );
    await setCapability(page, project.id, "work", {
      options: { automations: true },
    });
    await page.goto(`/${project.slug}/automations/variables`);
    await expect(
      page.getByRole("heading", { name: "Shared variables", exact: true }),
    ).toBeVisible();
    // A list row is named by its key, then its type and version.
    const variableRow = () =>
      page.getByRole("button", { name: /^editor_label\b.*v\d+$/ });
    await page
      .getByRole("button", { name: "Create shared variable", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Variable key", exact: true })
      .fill("editor_label");
    await page
      .getByRole("textbox", { name: "Value", exact: true })
      .fill("First value");
    const changed = () =>
      page.waitForResponse(
        (response) =>
          (response.request().method() === "PUT" &&
            response.url().includes("/automation-variables/")) ||
          (response.url().includes("/api/_batch") &&
            response
              .request()
              .postData()
              ?.includes('"action":"setAutomationVariable"') === true),
      );
    const create = changed();
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    expect((await create).ok()).toBe(true);
    await variableRow().click();
    await expect(page.getByText("Version 0", { exact: true })).toBeVisible();
    await page
      .getByRole("textbox", { name: "Value", exact: true })
      .fill("Second value");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    const edited = changed();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    expect((await edited).ok()).toBe(true);
    await expect(page.getByText("Version 1", { exact: true })).toBeVisible();
    const listPath = (await apiPath(page, "listAutomationVariables")).replace(
      ":projectId",
      String(project.id),
    );
    const variables = await (await page.request.get(listPath)).json();
    expect(variables.items[0].value).toEqual({
      kind: "text",
      value: "Second value",
    });
    const me = await (await page.request.get("/api/users/me")).json();
    const createRulePath = (await apiPath(page, "createAutomation")).replace(
      ":projectId",
      String(project.id),
    );
    const consumerResponse = await page.request.post(createRulePath, {
      data: {
        title: "Shared label consumer",
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
              title: "{{editor_label}}",
              text: "Done",
              category: "automations",
            },
          ],
        },
      },
    });
    expect(consumerResponse.ok(), await consumerResponse.text()).toBe(true);
    const consumer = await consumerResponse.json();
    await page.reload();
    await variableRow().click();
    await expect(
      page.getByRole("button", { name: "Shared label consumer", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Shared label consumer", exact: true })
      .click();
    await page
      .getByRole("button", { name: "editor_label", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/automations/variables\\?key=editor_label$`),
    );
    await expect(
      page.getByRole("textbox", { name: "Value", exact: true }),
    ).toHaveValue("Second value");
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).toBeDisabled();
    const deleteRulePath = (await apiPath(page, "deleteAutomation"))
      .replace(":projectId", String(project.id))
      .replace(":id", consumer.id);
    const removedConsumer = await page.request.delete(deleteRulePath, {
      data: { expectedRevision: consumer.revision },
    });
    expect(removedConsumer.ok()).toBe(true);
    await page.reload();
    await variableRow().click();
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const deleted = page.waitForResponse(
      (response) =>
        (response.request().method() === "DELETE" &&
          response.url().includes("/automation-variables/")) ||
        (response.url().includes("/api/_batch") &&
          response
            .request()
            .postData()
            ?.includes('"action":"deleteAutomationVariable"') === true),
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    expect((await deleted).ok()).toBe(true);
    await expect(variableRow()).toHaveCount(0);
  });

  test("joins preset authoring, a real source, durable execution, delivery and capability health", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(120_000);
    await registerAndVerify(
      page,
      `automation-journey-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const project = await createProjectViaWizard(page, "Automation journey");
    await setCapability(page, project.id, "work", {
      options: { automations: true },
    });
    await setCapability(page, project.id, "support");
    const me = await (await page.request.get("/api/users/me")).json();
    const optionsPath = (
      await apiPath(page, "getAutomationSetupOptions")
    ).replace(":projectId", String(project.id));
    const members = await (
      await page.request.get(`${optionsPath}?kind=member`)
    ).json();
    const owner = members.items.find(
      (item: { value: string }) => item.value === me.id,
    );
    const submitPath = (await apiPath(page, "submitFeedback")).replace(
      ":projectId",
      String(project.id),
    );
    const prospective = await page.request.post(submitPath, {
      data: { title: "Preview feedback", description: "A prospective record" },
    });
    expect(prospective.ok()).toBe(true);
    await page.goto(`/${project.slug}/automations/presets`);
    await page.getByTestId("automation-preset-feedback-created").click();
    await page
      .getByRole("combobox", { name: "Recipient", exact: true })
      .click();
    await page.getByRole("option", { name: owner.label, exact: true }).click();
    const written = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        (new URL(response.url()).pathname.endsWith("/automation-presets") ||
          (response.url().includes("/api/_batch") &&
            response
              .request()
              .postData()
              ?.includes('"action":"createAutomationFromPreset"') === true)),
    );
    await page
      .getByRole("button", { name: "Create automation", exact: true })
      .click();
    expect((await written).ok()).toBe(true);
    await expect(page).toHaveURL(
      new RegExp(`/${project.slug}/automations/[^/]+$`),
    );
    const listPath = (await apiPath(page, "listAutomations")).replace(
      ":projectId",
      String(project.id),
    );
    const rules = await (await page.request.get(listPath)).json();
    const rule = rules.items[0];
    expect(rule.enabled).toBe(false);
    expect(rule.rule.actions[0].recipient).toBe(me.id);
    expect(JSON.stringify(rule.rule)).not.toContain(`{{${me.id}}}`);
    const variablesPath = (
      await apiPath(page, "listAutomationVariables")
    ).replace(":projectId", String(project.id));
    expect(
      (await (await page.request.get(variablesPath)).json()).items,
    ).toEqual([]);
    const runsPath = (await apiPath(page, "listAutomationRuns"))
      .replace(":projectId", String(project.id))
      .replace(":id", rule.id);
    const beforeRuns = await (await page.request.get(runsPath)).json();
    await page
      .getByRole("combobox", { name: "Source record", exact: true })
      .click();
    await page.getByRole("option", { name: /Preview feedback/ }).click();
    const preview = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        (response.url().includes(`/automations/${rule.id}/test`) ||
          (response.url().includes("/api/_batch") &&
            response
              .request()
              .postData()
              ?.includes('"action":"testAutomation"') === true)),
    );
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    expect((await preview).ok()).toBe(true);
    await expect(previewResult(page)).toBeVisible();
    expect(await (await page.request.get(runsPath)).json()).toEqual(beforeRuns);
    const armed = page.waitForResponse((response) =>
      mutation(response.request()),
    );
    await page.getByRole("button", { name: "Enable", exact: true }).click();
    const armResult = await result(await armed);
    expect(armResult.error).toBeUndefined();
    const getPath = (await apiPath(page, "getAutomation"))
      .replace(":projectId", String(project.id))
      .replace(":id", rule.id);
    expect((await (await page.request.get(getPath)).json()).enabled).toBe(true);
    const source = await page.request.post(submitPath, {
      data: {
        title: "Live automation feedback",
        description: "Must produce exactly one occurrence",
      },
    });
    expect(source.ok(), await source.text()).toBe(true);
    const admin = await browser.newContext({ baseURL });
    try {
      const adminPage = await admin.newPage();
      await signInAsAdmin(adminPage);
      await adminPage.goto("/admin/jobs/automations.dispatch");
      const trigger = (await apiPath(adminPage, "triggerJob")).replace(
        ":name",
        "automations.dispatch",
      );
      // These are the existing synchronous cron invocations, not a test-only endpoint.
      // One pass reserves events and the next queues ready workers regardless of tick priority.
      for (let index = 0; index < 2; index++) {
        const tick = await adminPage.request.post(trigger, { data: {} });
        expect(tick.ok(), await tick.text()).toBe(true);
      }
      let occurrences: { id: string; status: string }[] = [];
      await expect
        .poll(
          async () => {
            const rows = await (await page.request.get(runsPath)).json();
            occurrences = rows.items.filter((item: { occurrenceId: string }) =>
              item.occurrenceId.startsWith("event:"),
            );
            return (
              occurrences.length === 1 && occurrences[0].status === "succeeded"
            );
          },
          { timeout: 20_000 },
        )
        .toBe(true);
      const runId = occurrences[0].id;
      const runPath = (await apiPath(page, "getAutomationRun"))
        .replace(":projectId", String(project.id))
        .replace(":id", runId);
      await expect
        .poll(
          async () =>
            (await (await page.request.get(runPath)).json()).notifications[0]
              ?.status,
          { timeout: 20_000 },
        )
        .toBe("delivered");
      const evidence = await (await page.request.get(runPath)).json();
      expect(evidence.snapshot.actions[0].status).toBe("queued");
      expect(evidence.snapshot.actions[0].result.enqueued).toBe(true);
      expect(evidence.notifications).toHaveLength(1);
      expect(evidence.notifications[0].receiptId).toBeTruthy();
      expect(evidence.snapshot.inputs.title).toBe("Live automation feedback");
      const replay = await adminPage.request.post(trigger, { data: {} });
      expect(replay.ok()).toBe(true);
      expect(
        (await (await page.request.get(runsPath)).json()).items.filter(
          (item: { occurrenceId: string }) =>
            item.occurrenceId.startsWith("event:"),
        ),
      ).toHaveLength(1);
      await page.goto(`/${project.slug}/automations/runs/${runId}`);
      await expect(
        page.getByRole("link", {
          name: "Delivery receipt: Delivered",
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("link", { name: "Delivery receipt: Delivered", exact: true })
        .click();
      await expect(
        page.locator(`#delivery-${evidence.notifications[0].outboxId}`),
      ).toContainText(evidence.notifications[0].receiptId);
      await page.screenshot({
        path: testInfo.outputPath("automation-live-receipt.png"),
      });
      await setCapability(page, project.id, "support", { enabled: false });
      await page.goto(`/${project.slug}/automations`);
      const row = page.getByRole("row").filter({ hasText: rule.title });
      await expect(row.getByText("Broken", { exact: true })).toBeVisible();
      await expect(row).toContainText("Current source access is unavailable");
      const broken = await (await page.request.get(getPath)).json();
      expect(broken.enabled).toBe(true);
      expect(broken.health).toBe("broken");
      const redacted = await (await page.request.get(runPath)).json();
      expect(redacted.redacted).toBe(true);
      expect(redacted.snapshot).toBeNull();
      expect(redacted.notifications).toEqual([]);
    } finally {
      await admin.close();
    }
  });

  test("refuses foreign-author edits and removes write controls after an owner assigns Viewer", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await registerAndVerify(
      page,
      `automation-owner-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const project = await createProjectViaWizard(page, "Automation access");
    await setCapability(page, project.id, "work", {
      options: { automations: true },
    });
    await createRankFromPreset(page, project.slug, "Contributor");
    await createRankFromPreset(page, project.slug, "Viewer");
    const member = await newUserContext(browser, baseURL!, "automation-writer");
    try {
      await page.goto(`/${project.slug}/settings/members`);
      await page.getByRole("button", { name: /^invite$/i }).click();
      await page.getByPlaceholder("user@example.com").fill(member.email);
      await page.getByTestId("invite-rank").click();
      await page.getByRole("option", { name: /^contributor$/i }).click();
      await expect(
        page.getByRole("option", { name: /^contributor$/i }),
      ).toBeHidden();
      const invite = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/invitations"),
      );
      await page.getByRole("button", { name: /send invitation/i }).click();
      expect((await invite).ok()).toBe(true);
      await member.page.goto("/account/invitations");
      const accepted = member.page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          /\/invitations\/[^/]+\/accept$/.test(response.url()),
      );
      await member.page.getByRole("button", { name: /^accept$/i }).click();
      expect((await accepted).ok()).toBe(true);
      const me = await (await page.request.get("/api/users/me")).json();
      const createPath = (await apiPath(page, "createAutomation")).replace(
        ":projectId",
        String(project.id),
      );
      const create = await page.request.post(createPath, {
        data: {
          title: "Owner authored rule",
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
                title: "Done",
                text: "{{title}}",
                category: "automations",
              },
            ],
          },
        },
      });
      expect(create.ok()).toBe(true);
      const rule = await create.json();
      await member.page.goto(`/${project.slug}/automations/${rule.id}`);
      await expect(
        member.page.getByRole("heading", {
          name: "Owner authored rule",
          exact: true,
          level: 1,
        }),
      ).toBeVisible();
      await expect(
        member.page.getByRole("button", { name: "Edit", exact: true }),
      ).toHaveCount(0);
      await expect(
        member.page.getByRole("button", { name: "Enable", exact: true }),
      ).toHaveCount(0);
      const updatePath = (await apiPath(page, "updateAutomation"))
        .replace(":projectId", String(project.id))
        .replace(":id", rule.id);
      const foreign = await member.page.request.put(updatePath, {
        data: {
          title: "Forbidden rewrite",
          rule: rule.rule,
          expectedRevision: rule.revision,
        },
      });
      expect(foreign.status()).toBe(403);
      const ranksPath = (await apiPath(page, "getOrganizationRanks")).replace(
        ":organizationId",
        project.organizationId,
      );
      const ranks = await (await page.request.get(ranksPath)).json();
      const viewer = ranks.items.find(
        (rank: { name: string }) => rank.name === "Viewer",
      );
      const memberUser = await (
        await member.page.request.get("/api/users/me")
      ).json();
      const memberRuleResponse = await member.page.request.post(createPath, {
        data: {
          title: "Member authored rule",
          rule: {
            ...rule.rule,
            actions: [{ ...rule.rule.actions[0], recipient: memberUser.id }],
          },
        },
      });
      expect(memberRuleResponse.ok(), await memberRuleResponse.text()).toBe(
        true,
      );
      const memberRule = await memberRuleResponse.json();
      const memberEnablePath = (await apiPath(page, "setAutomationEnabled"))
        .replace(":projectId", String(project.id))
        .replace(":id", memberRule.id);
      const memberEnabled = await member.page.request.patch(memberEnablePath, {
        data: { expectedRevision: memberRule.revision, enabled: true },
      });
      expect(memberEnabled.ok(), await memberEnabled.text()).toBe(true);
      const assignPath = (await apiPath(page, "assignOrganizationRank"))
        .replace(":organizationId", project.organizationId)
        .replace(":userId", memberUser.id);
      const assigned = await page.request.put(assignPath, {
        data: { key: viewer.key },
      });
      expect(assigned.ok(), await assigned.text()).toBe(true);
      await member.page.goto(`/${project.slug}/automations`);
      const ownerRow = member.page
        .getByRole("row")
        .filter({ hasText: "Owner authored rule" });
      await expect(ownerRow).toBeVisible();
      await expect(
        member.page.getByRole("button", {
          name: "New automation",
          exact: true,
        }),
      ).toHaveCount(0);
      // Enable, Disable and Delete live in the row menu, which a Viewer
      // is not offered at all.
      await expect(
        ownerRow.getByRole("button", { name: "Open row actions" }),
      ).toHaveCount(0);
      const refused = await member.page.request.post(createPath, {
        data: { title: "Viewer write", rule: rule.rule },
      });
      expect(refused.status()).toBe(403);
      const getPath = (await apiPath(page, "getAutomation"))
        .replace(":projectId", String(project.id))
        .replace(":id", rule.id);
      expect((await (await page.request.get(getPath)).json()).title).toBe(
        "Owner authored rule",
      );
      const removePath = (await apiPath(page, "removeOrganizationMember"))
        .replace(":organizationId", project.organizationId)
        .replace(":userId", memberUser.id);
      const removed = await page.request.delete(removePath);
      expect(removed.ok(), await removed.text()).toBe(true);
      await page.goto(`/${project.slug}/automations`);
      const paused = page
        .getByRole("row")
        .filter({ hasText: "Member authored rule" });
      await expect(paused.getByText("Paused", { exact: true })).toBeVisible();
      await expect(paused).toContainText(
        "Author is no longer a project member",
      );
      const memberGetPath = getPath.replace(rule.id, memberRule.id);
      const stopped = await (await page.request.get(memberGetPath)).json();
      expect(stopped).toMatchObject({
        enabled: true,
        health: "paused",
        requiresApproval: true,
      });
    } finally {
      await member.ctx.close();
    }
  });
  test("previews existing policies, adopts with named consent and keeps opt-out after reload", async ({
    page,
  }, testInfo) => {
    await registerAndVerify(
      page,
      `adoption-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const project = await createProjectViaWizard(page, "Policy adoption");
    await setCapability(page, project.id, "work", {
      options: { automations: true, reminder: true, releases: true },
    });
    await page.goto(`/${project.slug}/automations`);
    await page
      .getByRole("button", { name: "Built-in notifications", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Built-in notifications" }),
    ).toBeVisible();
    // The page frame is a section too: the card is the innermost match.
    const card = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Release announcements",
          exact: true,
        }),
      })
      .last();
    await expect(
      card.getByText("Existing policy is still active", { exact: true }),
    ).toBeVisible();
    await expect(card.getByText("Inbox, Email", { exact: true })).toBeVisible();
    await expect(
      card.getByText("automation:write, release:read, member:read", {
        exact: true,
      }),
    ).toBeVisible();
    const path = (await apiPath(page, "previewAutomationAdoption"))
      .replace(":projectId", String(project.id))
      .replace(":policy", "release-notifications");
    const before = await (await page.request.get(path)).json();
    expect(before.state).toBe("legacy");
    expect(before.replacementId).toBeUndefined();
    await card
      .getByRole("button", { name: "Consent and adopt", exact: true })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByText(/legacy path stops permanently/),
    ).toBeVisible();
    const pending = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        (new URL(response.url()).pathname.includes("/automation-adoptions/") ||
          response
            .request()
            .postData()
            ?.includes('"action":"adoptAutomationPolicy"') === true),
    );
    await dialog
      .getByRole("button", { name: "Consent and adopt", exact: true })
      .click();
    const response = await pending;
    expect(response.ok()).toBe(true);
    expect(JSON.stringify(await response.json())).not.toContain('"error":');
    await expect(card.getByText("Adopted", { exact: true })).toBeVisible();
    const adopted = await (await page.request.get(path)).json();
    expect(adopted.candidate.enabled).toBe(true);
    expect(adopted.author.id).toBe(adopted.candidate.authorUserId);
    await card.getByRole("button", { name: "Open replacement rule" }).click();
    // The summary names the roster once per action: inbox and email.
    await expect(
      page.getByText(/^Notify Current roster except publisher via /),
    ).toHaveCount(2);
    const disabled = page.waitForResponse((response) =>
      mutation(response.request()),
    );
    await page.getByRole("button", { name: "Disable", exact: true }).click();
    expect((await disabled).ok()).toBe(true);
    await page.goto(`/${project.slug}/automations/adoption`);
    await expect(
      card.getByText("Adopted, replacement disabled or deleted", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Consent and adopt", exact: true }),
    ).toHaveCount(0);
    const after = await (await page.request.get(path)).json();
    expect(after.replacementId).toBe(adopted.replacementId);
    expect(after.candidate.enabled).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath("automation-adoption.png"),
      fullPage: true,
    });
  });
});
