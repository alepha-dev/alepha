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

      // Chat leaves the sidebar as the reader set it: it no longer folds it.
      await expect(page.locator("html")).not.toHaveAttribute(
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

      // The room row is one line, its name with no preview of the newest
      // message, and nothing is unread on the page that has the room open.
      const row = page.locator(
        '[data-testid="chat-room-row"][data-room="general"]',
      );
      await expect(row).toHaveText("general");
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

      // Edit, from the message's hover bar, by keyboard: live for the member.
      const mine = page
        .getByTestId("chat-message")
        .filter({ hasText: "please look" });
      await mine.hover();
      await mine.getByRole("button", { name: "Edit" }).focus();
      await page.keyboard.press("Enter");
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
      await edited.getByRole("button", { name: "Delete" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete" })
        .click();
      await expect(
        member.page.getByText("This message was deleted."),
      ).toBeVisible({ timeout: 15_000 });
      await expect(member.page.getByText("please look again")).toHaveCount(0);

      // A reaction from the member shows under the owner's message, live.
      const hello = member.page
        .getByTestId("chat-message")
        .filter({ hasText: "Hello from the owner" });
      await hello.hover();
      await hello.getByRole("button", { name: "Add a reaction" }).click();
      await member.page.getByRole("button", { name: "👍" }).click();
      await expect(
        page
          .getByTestId("chat-message")
          .filter({ hasText: "Hello from the owner" })
          .getByTestId("chat-reactions"),
      ).toContainText("👍 1", { timeout: 15_000 });

      // A file, picked and sent with no text, opens for the other member.
      await page.getByTestId("chat-file-input").setInputFiles({
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("release notes"),
      });
      await expect(page.getByTestId("chat-pending-files")).toContainText(
        "notes.txt",
      );
      await composer.press("Enter");
      const link = member.page.getByRole("link", { name: "notes.txt" });
      await expect(link).toBeVisible({ timeout: 15_000 });
      const href = await link.getAttribute("href");
      const served = await member.page.request.get(href!);
      expect(served.status()).toBe(200);

      // Away from Chat, the sidebar's Chat row counts what arrives, live.
      await member.page.goto(`/${slug}`);
      const chatRow = member.page.getByRole("link", {
        name: /^Chat( @?\d+)?$/,
      });
      await expect(chatRow).toBeVisible();
      await composer.fill("badge check");
      await composer.press("Enter");
      // The badge sits beside the link, in the same menu item.
      await expect(member.page.locator("li", { has: chatRow })).toContainText(
        "1",
        { timeout: 15_000 },
      );

      // Back in the room, the owner typing shows under the conversation.
      await member.page.goto(`/${slug}/chat/general`);
      await expect(member.page.getByTestId("chat-conversation")).toBeVisible();
      // Typed until it shows: the member's socket may still be connecting
      // when the first key goes, and a page tells the room at most every
      // 3 s, so one key alone can be missed.
      await expect(async () => {
        await composer.pressSequentially("t");
        await expect(member.page.getByTestId("chat-typing")).toContainText(
          "is typing",
          { timeout: 1_500 },
        );
      }).toPass({ timeout: 30_000 });

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
      // Nor by its URL.
      await member.page.goto(`/${slug}/chat/secret`);
      await expect(
        member.page.getByText("This room does not exist, or it is private."),
      ).toBeVisible();
      await member.page.goto(`/${slug}/chat`);

      // The members panel's + opens the invite dialog (#Q4267), and their
      // list shows the invite at once.
      await page.getByTestId("chat-room-members-toggle").click();
      const panel = page.getByTestId("chat-room-panel");
      await panel.getByTestId("chat-room-invite").click();
      const invite = page.getByTestId("chat-room-invite-form");
      await invite.getByRole("combobox", { name: "Member" }).click();
      await page.getByRole("option").first().click();
      await invite.getByRole("button", { name: "Invite" }).click();
      await expect(invite).toHaveCount(0);
      await expect(
        panel.getByTestId("chat-room-members").locator("li"),
      ).toHaveCount(2);
      await expect(secretRow(member.page)).toBeVisible({ timeout: 15_000 });

      // Reading it, they receive what is said there.
      await secretRow(member.page).click();
      await page.getByTestId("chat-composer").fill("members only");
      await page.getByTestId("chat-composer").press("Enter");
      await expect(
        member.page
          .getByTestId("chat-message")
          .filter({ hasText: "members only" }),
      ).toBeVisible({
        timeout: 15_000,
      });

      // Removed while reading it: it is gone at once, and so is what follows.
      await panel.getByRole("button", { name: "Remove" }).click();
      await expect(secretRow(member.page)).toHaveCount(0, { timeout: 15_000 });
      await expect(
        member.page.getByText("This room does not exist, or it is private."),
      ).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("chat-composer").fill("after you left");
      await page.getByTestId("chat-composer").press("Enter");
      await expect(
        page.getByTestId("chat-message").filter({ hasText: "after you left" }),
      ).toBeVisible();
      await member.page.waitForTimeout(1_000);
      await expect(
        member.page
          .getByTestId("chat-message")
          .filter({ hasText: "after you left" }),
      ).toHaveCount(0);

      // The room list shows only what one can see: the private room the
      // member left is gone from it.
      await member.page.goto(`/${slug}/chat/general`);
      const list = member.page.getByTestId("chat-room-list");
      await expect(
        list.locator('[data-testid="chat-room-row"][data-room="general"]'),
      ).toBeVisible();
      await expect(
        list.locator('[data-testid="chat-room-row"][data-room="secret"]'),
      ).toHaveCount(0);
    } finally {
      await member.ctx.close();
    }
  });

  test("a mention reaches the member's bell, linking to the room", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await registerAndVerify(
      page,
      `chat-mention-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const { slug } = await createProjectViaWizard(page, "Chat mention", {
      capabilities: ["chat"],
    });
    const member = await newUserContext(browser, baseURL!, "chat-named");
    try {
      await inviteAndAccept(page, member, slug);
      // Away from Chat: the bell is how they hear of it.
      await member.page.goto(`/${slug}`);

      await page.goto(`/${slug}/chat/general`);
      const composer = page.getByTestId("chat-composer");
      // Picked from the @ popup, as a person would.
      await composer.click();
      await composer.pressSequentially("@chat-named");
      await expect(page.getByRole("listbox")).toBeVisible();
      await composer.press("Enter");
      await composer.pressSequentially("please review");
      await composer.press("Enter");

      await expect(async () => {
        const hrefs = await member.page.evaluate(async () => {
          const r = await fetch("/api/inbox", { credentials: "include" });
          const page = (await r.json()) as { items?: { href?: string }[] };
          return (page.items ?? []).map((it) => it.href);
        });
        expect(hrefs).toContain(`/${slug}/chat/general`);
      }).toPass({ timeout: 60_000 });
    } finally {
      await member.ctx.close();
    }
  });

  test("with AI off, the header has no assistant button and chat still works", async ({
    page,
  }) => {
    await registerAndVerify(
      page,
      `chat-no-ai-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const { slug } = await createProjectViaWizard(page, "Chat no AI", {
      capabilities: ["chat"],
    });
    await page.goto(`/${slug}/chat/general`);
    await expect(page.getByTestId("chat-conversation")).toBeVisible();
    await expect(page.getByTestId("assistant-button")).toHaveCount(0);
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
