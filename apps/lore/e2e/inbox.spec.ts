import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  createProjectViaWizard,
  findLatestEmail,
  newUserContext,
  registerAndVerify,
  signInAsAdmin,
} from "./_helpers.ts";

/**
 * The one path that proves epic #E42 in a browser: somebody writes your name,
 * the bell says so, clicking the message takes you to it, and the count goes
 * back to zero.
 *
 * ## ⚠️ Three hazards, and each one makes a spec pass or fail for the wrong
 * reason
 *
 * **A notification is delivered by a JOB, not by the request.** Lore registers
 * no queue module, so `$job` runs in direct mode: the outbox row is written
 * and processed in the same process **after** the HTTP response returns. The
 * POST that creates a comment therefore resolves before the inbox row exists,
 * and an assertion right after it is racing the sweep. Everything here polls
 * under `expect.toPass()`; nothing sleeps.
 *
 * **Calls are batched through `/api/_batch`.** A `waitForResponse` on a
 * per-action URL never fires, so a reload plus a polled assertion is the only
 * honest wait.
 *
 * **A Base UI popover leaves `pointer-events: none` on the body after it
 * closes.** The dropdown is one, so the click after it closes is the one that
 * mysteriously does nothing. The row click here navigates, which unmounts the
 * page and takes the style with it.
 *
 * The port comes from `e2ePort("lore")` through the shared fixture; nothing
 * here hard-codes one.
 */
test.describe("Inbox", () => {
  test("a mention reaches the bell, the rail, and the quest behind it", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    const t = Date.now();
    await registerAndVerify(page, `inbowner${t}@example.com`, "GoodPassw0rd");
    const projectTitle = `Inb${t}`.slice(0, 20);
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const member = await newUserContext(browser, baseURL!, "inbmember");
    try {
      await inviteAndAccept(page, member, slug);

      // The handle the owner has to type. `displayName` is `username` then
      // the email prefix, and a registered account has a username.
      const handle = await member.page.evaluate(async () => {
        const r = await fetch("/api/users/me", { credentials: "include" });
        const me = (await r.json()) as { username?: string; email?: string };
        return me.username ?? (me.email ?? "").split("@")[0];
      });
      expect(handle).toBeTruthy();

      const quest = await createQuest(
        page,
        slug,
        projectId,
        "Something to talk about",
      );
      const startedAt = Date.now();

      await page.goto(`/${slug}/quests/${quest}`);
      await page.waitForLoadState("domcontentloaded");
      await postComment(page, quest, `hey @${handle} can you look at this`);

      // The member's side. A reload plus a polled assertion, because the
      // count rides the project loader's batch and the job that produces it
      // finishes after the comment's own response.
      await expect(async () => {
        await member.page.goto(`/${slug}/quests`);
        await member.page.waitForLoadState("domcontentloaded");
        await expect(member.page.getByTestId("inbox-badge")).toHaveText("1", {
          timeout: 5_000,
        });
      }).toPass({ timeout: 60_000 });

      /*
        ⚠️ The rail's badge is a DIFFERENT number from the bell's: the bell is
        cross-project, the rail is this project's. A spec reading only the bell
        would pass with the rail wired to the wrong atom.

        ⚠️ And the badge is a SIBLING of the link, not inside it:
        `SidebarMenuItem` renders the button and then `SidebarMenuBadge`
        beside it. Asserting on the link matches "Notifications" and nothing
        else, which is a green test of the wrong element.
      */
      const railItem = member.page.locator("li").filter({
        has: member.page.getByRole("link", { name: /notifications/i }),
      });
      await expect(railItem).toContainText("1");

      // The email half. `since` is not optional: the member registered
      // moments ago and their verification mail is in the same directory, so
      // an assertion with no floor passes on the wrong message.
      expect(
        await findLatestEmail(member.email, 20_000, startedAt),
      ).toBeTruthy();

      // Open the bell, click the message, land on the quest.
      await member.page
        .getByRole("button", { name: /notifications/i })
        .first()
        .click();
      const row = member.page.getByText(/mentioned you/i).first();
      await expect(row).toBeVisible();
      await row.click();

      await member.page.waitForURL(new RegExp(`/${slug}/quests/${quest}$`), {
        timeout: 20_000,
      });

      // Read, so the badge is gone. Polled for the same reason as above: the
      // mark-read write and the next count are two round trips.
      await expect(async () => {
        await member.page.goto(`/${slug}/quests`);
        await member.page.waitForLoadState("domcontentloaded");
        await expect(member.page.getByTestId("inbox-badge")).toHaveCount(0);
      }).toPass({ timeout: 30_000 });

      /*
        ⚠️ The owner ruled the bell renders in the PROJECT SHELL ONLY. The
        failure mode is somebody later tidying `ButtonInbox` into `AppActions`,
        which puts it on all three shells at once with nothing red. This is the
        only browser-level thing standing between that ruling and its silent
        reversal.
      */
      await member.page.goto("/account");
      await member.page.waitForLoadState("domcontentloaded");
      await expect(
        member.page.getByRole("button", { name: /notifications/i }),
      ).toHaveCount(0);
    } finally {
      await member.ctx.close();
    }
  });

  /**
   * The third shell. Cheap because `signInAsAdmin` already exists, and worth
   * having beside the `/account` assertion: the refactor that would break the
   * ruling breaks both at once, and a spec covering one of the two reads as
   * if the other had been considered.
   */
  test("the bell is absent from the admin shell", async ({ page }) => {
    test.setTimeout(90_000);

    await signInAsAdmin(page);
    await page.goto("/admin");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("button", { name: /notifications/i }),
    ).toHaveCount(0);
  });

  /**
   * ⚠️ THREE members, not two. The claim is "every member except the
   * publisher", and a two-person project cannot tell that apart from "the one
   * person who is not me".
   */
  test("publishing a release reaches every member but the publisher", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);

    const t = Date.now();
    const ownerEmail = `relowner${t}@example.com`;
    await registerAndVerify(page, ownerEmail, "GoodPassw0rd");
    const projectTitle = `Rel${t}`.slice(0, 20);
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const first = await newUserContext(browser, baseURL!, "relfirst");
    const second = await newUserContext(browser, baseURL!, "relsecond");
    try {
      await inviteAndAccept(page, first, slug);
      await inviteAndAccept(page, second, slug);

      const startedAt = Date.now();
      const tag = `0.${t % 1000}.0`;

      await page.goto(`/${slug}/quests`);
      await page.waitForLoadState("domcontentloaded");
      const release = await post<{ id: number }>(
        page,
        "createRelease",
        { projectId },
        { tag, title: "Inbox epic" },
      );
      expect(release.id).toBeTruthy();
      await post(page, "publishRelease", { id: release.id }, {});

      for (const who of [first, second]) {
        await expect(async () => {
          await who.page.goto(`/${slug}/quests`);
          await who.page.waitForLoadState("domcontentloaded");
          await expect(who.page.getByTestId("inbox-badge")).toHaveText("1", {
            timeout: 5_000,
          });
        }).toPass({ timeout: 90_000 });

        expect(
          await findLatestEmail(who.email, 20_000, startedAt),
        ).toBeTruthy();
      }

      // And nothing for the publisher, who is looking at the button they
      // pressed.
      await page.goto(`/${slug}/quests`);
      await page.waitForLoadState("domcontentloaded");
      await expect(page.getByTestId("inbox-badge")).toHaveCount(0);
      expect(await findLatestEmail(ownerEmail, 3_000, startedAt)).toBeNull();
    } finally {
      await first.ctx.close();
      await second.ctx.close();
    }
  });
});

/**
 * The invite/accept block, lifted from `epics.spec.ts`: each side arms its own
 * `waitForResponse` before the click that causes it.
 */
const inviteAndAccept = async (
  owner: import("@playwright/test").Page,
  member: { page: import("@playwright/test").Page; email: string },
  slug: string,
): Promise<void> => {
  await owner.goto(`/${slug}/settings/members`);
  await owner.waitForLoadState("domcontentloaded");
  await owner.getByRole("button", { name: /^invite$/i }).click();
  await owner.getByPlaceholder("user@example.com").fill(member.email);
  const invited = owner.waitForResponse(
    (r) =>
      r.request().method() === "POST" && r.url().endsWith("/api/invitations"),
    { timeout: 20_000 },
  );
  await owner.getByRole("button", { name: /send invitation/i }).click();
  expect((await invited).ok()).toBe(true);

  await member.page.goto("/account/invitations");
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

/**
 * ⚠️ Paths come from the SSR-injected action table, never written out: the
 * framework derives them from the action name, and a spec that hard-codes one
 * fails for a reason that is not what it is testing. `:param` placeholders
 * are the caller's to fill.
 */
const post = async <T>(
  page: import("@playwright/test").Page,
  action: string,
  params: Record<string, string | number>,
  body: unknown,
): Promise<T> => {
  let url = await apiPath(page, action);
  for (const [key, value] of Object.entries(params)) {
    url = url.replace(`:${key}`, String(value));
  }
  return await page.evaluate(
    async ({ url, body }) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${url} → ${r.status} ${await r.text()}`);
      return r.json();
    },
    { url, body },
  );
};

const createQuest = async (
  page: import("@playwright/test").Page,
  slug: string,
  projectId: number,
  title: string,
): Promise<number> => {
  // Land on a project page first: the action table rides the SSR payload,
  // which only the project pages carry.
  await page.goto(`/${slug}/quests`);
  await page.waitForLoadState("domcontentloaded");
  const quest = await post<{ shortId: number }>(
    page,
    "createQuest",
    {},
    {
      projectId,
      title,
      description: "",
      area: "ops",
      priority: "low",
    },
  );
  return quest.shortId;
};

const postComment = async (
  page: import("@playwright/test").Page,
  quest: number,
  body: string,
): Promise<void> => {
  await post(page, "createQuestComment", { id: quest }, { body });
};
