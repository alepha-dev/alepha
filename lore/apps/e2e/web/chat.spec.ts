import type { Page } from "@playwright/test";
import { scanPageAccessibility } from "alepha/testing/playwright";

import { expect, test } from "./_fixtures.ts";
import {
  createProjectViaWizard,
  newUserContext,
  openAccount,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * The Chat page, end to end (#E161): two members in two browsers, one room,
 * a message that reaches the other side without a reload.
 */
test.describe("Chat", () => {
  test("a message sent in one browser appears live in the other, and the room reads as read", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await registerAndVerify(
      page,
      `chat-owner-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const { slug } = await createProjectViaWizard(page, "Chat room", {
      capabilities: ["chat"],
    });
    const member = await newUserContext(browser, baseURL!, "chat-member");
    try {
      await inviteAndAccept(page, member, slug);

      await page.goto(`/${slug}/chat`);
      await member.page.goto(`/${slug}/chat/general`);

      // The sidebar folds to icons while Chat is shown.
      await expect(page.locator("html")).toHaveAttribute(
        "data-sidebar",
        "collapsed",
      );
      for (const side of [page, member.page]) {
        await expect(side.getByTestId("chat-conversation")).toBeVisible();
        await expect(
          side.getByRole("heading", { name: "general" }),
        ).toBeVisible();
      }

      const composer = page.getByTestId("chat-composer");
      await composer.fill("Hello from the owner, see #Q1");
      await composer.press("Enter");
      await expect(composer).toHaveValue("");

      // Live: the member's page was open before the message existed.
      await expect(
        member.page
          .getByTestId("chat-message")
          .filter({ hasText: "Hello from the owner" }),
      ).toBeVisible({ timeout: 15_000 });

      // Shift+Enter breaks the line rather than sending.
      const reply = member.page.getByTestId("chat-composer");
      await reply.fill("first line");
      await reply.press("Shift+Enter");
      await reply.pressSequentially("second line");
      await expect(reply).toHaveValue("first line\nsecond line");
      await reply.press("Enter");
      const twoLines = page
        .getByTestId("chat-message")
        .filter({ hasText: "second line" });
      await expect(twoLines).toBeVisible({ timeout: 15_000 });
      // The line break is kept as typed, not folded into a space.
      await expect(twoLines.locator("br")).toHaveCount(1);

      // The room row previews the newest message, and nothing is unread on
      // the page that has the room open.
      const row = page.locator(
        '[data-testid="chat-room-row"][data-room="general"]',
      );
      await expect(row).toContainText("first line");
      await expect(row.getByText(/unread/)).toHaveCount(0);

      // The @ popup: the member is offered, arrows and Enter insert them.
      const handle = member.email.split("@")[0]!;
      await composer.click();
      await composer.pressSequentially(`ping @${handle.slice(0, 8)}`);
      const popup = page.getByRole("listbox");
      await expect(popup).toBeVisible();
      await expect(composer).toHaveAttribute("aria-expanded", "true");
      expect(
        await scanPageAccessibility(page, {
          include: ['[data-testid="chat-conversation"]'],
        }),
      ).toEqual([]);
      await composer.press("Enter");
      await expect(popup).toHaveCount(0);
      await expect(composer).toHaveValue(`ping @${handle} `);
      await composer.pressSequentially("please look");
      await composer.press("Enter");
      const pinged = member.page
        .getByTestId("chat-message")
        .filter({ hasText: "please look" });
      await expect(pinged).toHaveAttribute("data-mentions-me", "true", {
        timeout: 15_000,
      });

      // Edit, from the message's menu, by keyboard: live for the member.
      const mine = page
        .getByTestId("chat-message")
        .filter({ hasText: "please look" });
      await mine.hover();
      await mine.getByRole("button", { name: "Message actions" }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menuitem", { name: "Edit" }).click();
      const editor = page.getByRole("textbox", { name: "Edit message" });
      await expect(editor).toBeFocused();
      await editor.fill("please look again");
      await editor.press("Enter");
      await expect(
        member.page
          .getByTestId("chat-message")
          .filter({ hasText: "please look again" }),
      ).toContainText("(edited)", { timeout: 15_000 });

      // Delete: the row stays, its words go, for everyone.
      const edited = page
        .getByTestId("chat-message")
        .filter({ hasText: "please look again" });
      await edited.hover();
      await edited.getByRole("button", { name: "Message actions" }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await page.getByRole("button", { name: "Delete" }).last().click();
      await expect(
        member.page.getByText("This message was deleted."),
      ).toBeVisible({ timeout: 15_000 });
      await expect(member.page.getByText("please look again")).toHaveCount(0);

      // A phone shows the list and the conversation as two screens.
      await member.page.setViewportSize({ width: 390, height: 800 });
      await member.page.goto(`/${slug}/chat`);
      await expect(member.page.getByTestId("chat-room-list")).toBeVisible();
      await expect(member.page.getByTestId("chat-conversation")).toHaveCount(0);
      await member.page
        .locator('[data-testid="chat-room-row"][data-room="general"]')
        .click();
      await expect(member.page.getByTestId("chat-conversation")).toBeVisible();
      await member.page.getByRole("button", { name: "Back to rooms" }).click();
      await expect(member.page.getByTestId("chat-room-list")).toBeVisible();
    } finally {
      await member.ctx.close();
    }
  });

  test("a private room is seen by its members only, and an invite brings it to the member live", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await registerAndVerify(
      page,
      `chat-private-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const { slug } = await createProjectViaWizard(page, "Chat private", {
      capabilities: ["chat"],
    });
    const member = await newUserContext(browser, baseURL!, "chat-invitee");
    try {
      await inviteAndAccept(page, member, slug);
      await page.goto(`/${slug}/chat`);
      await member.page.goto(`/${slug}/chat`);
      const secretRow = (side: Page) =>
        side.locator('[data-testid="chat-room-row"][data-room="secret"]');

      // The + above the list: a name, and private.
      await page.getByTestId("chat-new-room").click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill("secret");
      await dialog.getByLabel("Private", { exact: true }).first().click();
      await dialog.getByRole("button", { name: "Create room" }).click();
      await page.waitForURL(`**/${slug}/chat/secret`);
      await expect(secretRow(page)).toBeVisible();

      // Not a member: the room does not exist for them.
      await expect(
        member.page.locator(
          '[data-testid="chat-room-row"][data-room="general"]',
        ),
      ).toBeVisible();
      await expect(secretRow(member.page)).toHaveCount(0);

      // The members panel invites them, and their list shows it at once.
      await page.getByTestId("chat-room-members-toggle").click();
      const panel = page.getByTestId("chat-room-panel");
      await panel.getByRole("combobox", { name: "Invite a member" }).click();
      await page.getByRole("option").first().click();
      await panel.getByRole("button", { name: "Invite" }).click();
      await expect(
        panel.getByTestId("chat-room-members").locator("li"),
      ).toHaveCount(2);
      await expect(secretRow(member.page)).toBeVisible({ timeout: 15_000 });

      // Removed, it is gone from their list as quickly.
      await panel.getByRole("button", { name: "Remove" }).click();
      await expect(secretRow(member.page)).toHaveCount(0, { timeout: 15_000 });

      // The room name opens the jump list, which lists only what one can see.
      await member.page.getByTestId("chat-room-jump").click();
      const jump = member.page.getByTestId("chat-room-jump-list");
      await expect(jump.getByRole("button", { name: "general" })).toBeVisible();
      await expect(jump.getByRole("button", { name: "secret" })).toHaveCount(0);
    } finally {
      await member.ctx.close();
    }
  });
});

/**
 * The invite/accept block of `inbox.spec.ts`.
 */
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
