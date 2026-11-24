import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  confirmDialog,
  createProjectViaWizard,
  fillMarkdownEditor,
  newUserContext,
  openAccount,
  registerAndVerify,
} from "./_helpers.ts";

// A 1x1 PNG: what the avatar field takes.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/**
 * Chat agents, end to end (#E170, #Q4201): the owner creates `@jarvis` on
 * Settings > Chat agents > Agents with a playbook, a model and an avatar; a
 * Member sees it and its playbook but cannot create one, by the page or by
 * the API.
 *
 * The e2e server runs the production build with AI off, as every copy does by
 * default (a production boot with it on needs Workers AI), so no agent
 * answers here and the composer offers none: that is asserted too. The run
 * itself, the playbook reaching the model and the answer under the agent's
 * name, is proven by `apps/lore/test/chat-agent-persona.spec.ts` on the
 * memory AI provider, and on production by the epic's walk.
 */
test.describe("Chat agents", () => {
  test("the owner creates an agent with a playbook and an avatar, a member reads it and cannot create one", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await registerAndVerify(
      page,
      `agents-owner-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      "Agents",
      {
        capabilities: ["chat"],
      },
    );
    const member = await newUserContext(browser, baseURL!, "agents-member");
    try {
      await inviteAndAccept(page, member, slug);

      await page.goto(`/${slug}/settings/chat/agents`);
      // AI is off on the e2e server: the page lists and edits, and says so.
      await expect(page.getByTestId("chat-agents-ai-off")).toBeVisible();
      await expect(page.getByTestId("chat-agents-empty")).toBeVisible();

      await page.getByTestId("chat-agent-create").click();
      const form = page.getByTestId("chat-agent-form");
      await expect(form).toBeVisible();
      await form
        .getByTestId("chat-agent-avatar-field")
        .locator('input[type="file"]')
        .setInputFiles({
          name: "jarvis.png",
          mimeType: "image/png",
          buffer: PNG,
        });
      await form.getByTestId("chat-agent-handle").locator("input").fill("lore");
      await form.getByTestId("chat-agent-name").locator("input").fill("Jarvis");
      await form
        .getByTestId("chat-agent-model")
        .locator("input")
        .fill("claude-haiku-5-5");
      await fillMarkdownEditor(
        page,
        "Checking means: the feedback, then the errors.",
      );

      // `lore` is the built-in's, even with AI off: refused on its field.
      await form.getByTestId("chat-agent-save").click();
      await expect(form.getByTestId("chat-agent-handle")).toContainText(
        "built-in",
      );
      await form
        .getByTestId("chat-agent-handle")
        .locator("input")
        .fill("jarvis");
      const saved = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" && r.url().endsWith("/chat/agents"),
      );
      await form.getByTestId("chat-agent-save").click();
      expect((await saved).ok()).toBe(true);
      await expect(form).toBeHidden();

      const row = page.locator(
        '[data-testid="chat-agent-row"][data-handle="jarvis"]',
      );
      await expect(row).toContainText("Jarvis");
      await expect(row).toContainText("claude-haiku-5-5");
      // The uploaded picture, not the initials.
      await expect(
        row.getByTestId("chat-agent-avatar").locator("img"),
      ).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath("chat-agents-settings-light.png"),
      });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({
        path: test.info().outputPath("chat-agents-settings-dark.png"),
      });
      await page.emulateMedia({ colorScheme: "light" });

      // A Member reads the list and the playbook, and has no write control.
      await member.page.goto(`/${slug}/settings/chat/agents`);
      const theirs = member.page.locator(
        '[data-testid="chat-agent-row"][data-handle="jarvis"]',
      );
      await expect(theirs).toBeVisible();
      await expect(member.page.getByTestId("chat-agent-create")).toHaveCount(0);
      await expect(theirs.getByTestId("chat-agent-edit")).toHaveCount(0);
      // Nor through the API: chat:agent is the owner's and the Admin's.
      const create = (await apiPath(member.page, "createChatAgent")).replace(
        ":projectId",
        String(projectId),
      );
      const status = await member.page.evaluate(async (url) => {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ handle: "friday", name: "Friday" }),
        });
        return r.status;
      }, create);
      expect(status).toBe(403);

      // With AI off the composer offers no agent, the project's own included.
      await member.page.goto(`/${slug}/chat/general`);
      const composer = member.page.getByRole("combobox");
      await composer.click();
      await composer.pressSequentially("@ja");
      await expect(
        member.page.locator('[role="option"][data-handle="jarvis"]'),
      ).toHaveCount(0);

      // Deleting asks, then frees the handle.
      await page.goto(`/${slug}/settings/chat/agents`);
      await row.getByTestId("chat-agent-delete").click();
      await confirmDialog(page, "Delete agent");
      await expect(row).toHaveCount(0);
    } finally {
      await member.ctx.close();
    }
  });
});

/**
 * A long playbook must not push Save out of reach (#Q4238): at the reporter's
 * 1920x929 the dialog stays inside the viewport, its body scrolls, and Save
 * is on screen and saves.
 */
test.describe("Chat agent dialog", () => {
  test("a long playbook keeps the dialog inside the viewport and Save reachable", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1920, height: 929 });
    await registerAndVerify(
      page,
      `agents-long-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const { slug } = await createProjectViaWizard(page, "Long playbook", {
      capabilities: ["chat"],
    });
    await page.goto(`/${slug}/settings/chat/agents`);
    await page.getByTestId("chat-agent-create").click();
    const form = page.getByTestId("chat-agent-form");
    await expect(form).toBeVisible();
    await form.getByTestId("chat-agent-handle").locator("input").fill("bruce");
    await form.getByTestId("chat-agent-name").locator("input").fill("Bruce");
    // Inserted in one go: typing it key by key would take a minute, and
    // Enter would continue the list markup.
    const playbook = Array.from(
      { length: 120 },
      (_, i) => `Step ${i + 1}: inspect the next part of the project.`,
    ).join("\n");
    const editor = form.locator(".lore-md-edit .cm-content");
    await editor.waitFor({ state: "visible", timeout: 10_000 });
    await editor.click();
    await page.keyboard.insertText(playbook);
    await expect(editor).toContainText("Step 120:");

    const dialog = page.getByTestId("chat-agent-dialog");
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(929);
    const save = form.getByTestId("chat-agent-save");
    await expect(save).toBeInViewport();

    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/chat/agents"),
    );
    await save.click();
    expect((await saved).ok()).toBe(true);
    await expect(form).toBeHidden();
  });
});

const inviteAndAccept = async (
  owner: Page,
  member: { page: Page; email: string },
  slug: string,
): Promise<void> => {
  await owner.goto(`/${slug}/settings/members`);
  await owner.waitForLoadState("domcontentloaded");
  await owner.getByRole("button", { name: /^invite$/i }).click();
  await owner.getByPlaceholder("user@example.com").fill(member.email);
  const invited = owner.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/invitations"),
    { timeout: 20_000 },
  );
  await owner.getByRole("button", { name: /send invitation/i }).click();
  expect((await invited).ok()).toBe(true);
  await expect(async () => {
    const entries = await member.page.evaluate(async () => {
      const r = await fetch("/api/inbox", { credentials: "include" });
      const page = (await r.json()) as { items?: { href?: string }[] };
      return (page.items ?? []).map((it) => it.href);
    });
    expect(entries).toContain("/?account=invitations");
  }).toPass({ timeout: 60_000 });
  await openAccount(member.page, "invitations");
  await member.page.waitForLoadState("domcontentloaded");
  const accepted = member.page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/api\/invitations\/[^/]+\/accept$/.test(r.url()),
    { timeout: 20_000 },
  );
  await member.page.getByRole("button", { name: /^accept$/i }).click();
  expect((await accepted).ok()).toBe(true);
};
