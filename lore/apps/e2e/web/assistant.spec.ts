import type { Page, Route } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * The assistant in Lore's chrome (#Q3211): the header button appears when the
 * switch is on, the dock opens beside the page, a turn renders, and a link in
 * the reply navigates the page next to the conversation.
 *
 * The e2e server runs the production build with `AI_ASSISTANT_ENABLED`
 * unset, as every copy does by default (and a production boot with it set
 * and no Workers AI refuses to start). So the browser is told the switch is
 * on, and the turn is scripted, at the network: `aiAssistantStatus` (direct
 * or inside `/api/_batch`), the conversation list, and the chat stream. What
 * runs for real is everything in the browser: the registry entries, the
 * dock, the stream parser, the reply's markdown and its link.
 */
const scriptAssistant = async (page: Page, reply: string) => {
  const scripted: Record<string, unknown> = {
    aiAssistantStatus: { enabled: true },
    listConversations: [],
  };

  await page.route("**/api/assistant/status", (route) =>
    route.fulfill({ json: scripted.aiAssistantStatus }),
  );
  await page.route("**/api/ai/conversations", (route) =>
    route.fulfill({ json: scripted.listConversations }),
  );
  await page.route("**/api/_batch**", async (route: Route) => {
    const calls = (route.request().postDataJSON() ?? []) as Array<{
      action: string;
    }>;
    if (!calls.some((call) => call.action in scripted)) {
      return route.continue();
    }
    const response = await route.fetch();
    const results = (await response.json()) as Array<Record<string, unknown>>;
    await route.fulfill({
      response,
      json: results.map((result, index) =>
        calls[index].action in scripted
          ? {
              action: calls[index].action,
              status: 200,
              data: scripted[calls[index].action],
            }
          : result,
      ),
    });
  });
  await page.route("**/api/ai/chat", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: [
        {
          type: "conversation",
          conversationId: "00000000-0000-4000-8000-000000000001",
        },
        { type: "text", text: reply },
        { type: "end", reason: "stop" },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    }),
  );
};

test.describe("the assistant", () => {
  test("docks beside the page, renders a turn, and its link navigates the page", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const t = Date.now();
    await registerAndVerify(page, `ai${t}@example.com`, "GoodPassw0rd");
    const { slug } = await createProjectViaWizard(page, `AI${t}`.slice(0, 20));
    await scriptAssistant(
      page,
      `Two quests are open. See [the quest list](/${slug}/quests).`,
    );

    await page.goto(`/${slug}`);
    await page.waitForLoadState("networkidle");

    const button = page.getByTestId("assistant-button");
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click();

    const dock = page.getByTestId("ai-chat-dock");
    await expect(dock).toBeVisible();

    await dock
      .getByTestId("ai-chat-composer")
      .locator("textarea")
      .fill("What is open?");
    await dock
      .getByTestId("ai-chat-composer")
      .locator("textarea")
      .press("Enter");
    await expect(dock.getByText("Two quests are open.")).toBeVisible();

    await dock.getByTestId("assistant-link").click();
    await page.waitForURL((url) => url.pathname === `/${slug}/quests`);
    // The page changed beside the conversation, which is still there.
    await expect(dock.getByText("Two quests are open.")).toBeVisible();

    // Project pages only: Home has neither the button nor the dock.
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("assistant-button")).toHaveCount(0);
    await expect(page.getByTestId("ai-chat-dock")).toHaveCount(0);
  });

  test("shows no button while the server says the assistant is off", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const t = Date.now();
    await registerAndVerify(page, `aioff${t}@example.com`, "GoodPassw0rd");
    const { slug } = await createProjectViaWizard(page, `AO${t}`.slice(0, 20));
    await page.goto(`/${slug}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("assistant-button")).toHaveCount(0);
  });
});
