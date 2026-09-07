import { Alepha } from "alepha";
import {
  notificationInboxEntity,
  NotificationInboxRecipientProvider,
} from "alepha/api/notifications";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { users } from "../src/api/entities/users.ts";
import { LoreApi } from "../src/api/index.ts";
import { EstateNotifications } from "../src/api/notifications/EstateNotifications.ts";
import { LoreInboxNotifications } from "../src/api/notifications/LoreInboxNotifications.ts";
import { NotificationHtmlEscaper } from "../src/api/notifications/NotificationHtmlEscaper.ts";
import { QuestNotifications } from "../src/api/notifications/QuestNotifications.ts";
import { LoreInboxRecipientProvider } from "../src/api/providers/LoreInboxRecipientProvider.ts";

class Rows {
  readonly inbox = $repository(notificationInboxEntity);
  readonly users = $repository(users);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  // The substitution `main.server.ts` makes, before LoreApi puts the
  // framework's default into use.
  alepha.with({
    provide: NotificationInboxRecipientProvider,
    use: LoreInboxRecipientProvider,
  });
  alepha.with(LoreApi);

  const rows = alepha.inject(Rows);
  await alepha.start();

  return {
    alepha,
    rows,
    templates: alepha.inject(LoreInboxNotifications),
    recipients: alepha.inject(NotificationInboxRecipientProvider),
    mail: alepha.inject(MemoryEmailProvider),
  };
};

describe("Lore's inbox notifications", () => {
  it("resolves an address to its user, normalizing on the way in", async ({
    expect,
  }) => {
    const { alepha, recipients, rows } = await setup();

    // ⚠️ Stored MIXED CASE, deliberately. `users.email` is not normalized on
    // the way in - `AdminUserController` stores what it was given - so a
    // lower-cased argument compared against the stored spelling matches
    // nothing, and every such account reads as "belongs to nobody".
    const user = await rows.users.create({
      username: "nfo",
      email: "Member@Example.com",
    } as never);

    expect(await recipients.resolve("member@example.com")).toEqual({
      userId: user.id,
    });
    // The channel lower-cases before asking; this proves the provider also
    // survives whitespace and a capital the caller did not strip.
    expect(await recipients.resolve("  MEMBER@Example.com  ")).toEqual({
      userId: user.id,
    });
    expect(await recipients.resolve("stranger@example.com")).toBeNull();
    expect(await recipients.resolve("   ")).toBeNull();

    await alepha.stop();
  });

  /**
   * ⚠️ `$notification` falls back to the property key, and that string is
   * written into ninety days of receipts. A rename refactor must not be able
   * to change it silently.
   */
  it("names both templates explicitly", async ({ expect }) => {
    const { alepha, templates } = await setup();

    expect(templates.inboxMention.name).toBe("lore:inbox:mention");
    expect(templates.inboxReleasePublished.name).toBe(
      "lore:inbox:release-published",
    );

    await alepha.stop();
  });

  it("files a mention in the inbox and mails it, with a readable scope chip", async ({
    expect,
  }) => {
    const { alepha, mail, rows, templates } = await setup();

    await rows.users.create({
      username: "nfo",
      email: "Member@Example.com",
    } as never);

    await templates.inboxMention.push({
      contact: "member@example.com",
      lang: "en",
      variables: {
        reference: templates.questReference(402),
        subjectTitle: "The bell renders in the project shell",
        authorName: "Fabrice",
        excerpt: "@nfo could you look at this one",
        projectTitle: "Alepha",
        href: "/alepha/quests/402",
        url: "https://lore.alepha.dev/alepha/quests/402",
        scope: "project:1",
      },
      inline: true,
    });

    const [row] = await rows.inbox.findMany({});
    expect(row).toMatchObject({
      title: "Fabrice mentioned you in #Q402",
      body: "The bell renders in the project shell",
      href: "/alepha/quests/402",
      scope: "project:1",
      // Without this the bell's chip would read `project:1`.
      scopeLabel: "Alepha",
      template: "lore:inbox:mention",
      category: "mentions",
    });

    // The email half is a real email, not a copy of the one-line title.
    expect(mail.last?.subject).toBe("Fabrice mentioned you in #Q402");
    expect(mail.last?.body).toContain("could you look at this one");
    expect(mail.last?.body).toContain(
      "https://lore.alepha.dev/alepha/quests/402",
    );

    await alepha.stop();
  });

  it("files a published release the same way", async ({ expect }) => {
    const { alepha, mail, rows, templates } = await setup();

    await rows.users.create({
      username: "nfo",
      email: "Member@Example.com",
    } as never);

    await templates.inboxReleasePublished.push({
      contact: "member@example.com",
      lang: "en",
      variables: {
        releaseTag: "0.30.0",
        releaseTitle: "Lore Inbox",
        projectTitle: "Alepha",
        questCount: 19,
        href: "/alepha/releases/0.30.0",
        url: "https://lore.alepha.dev/alepha/releases/0.30.0",
        scope: "project:1",
      },
      inline: true,
    });

    const [row] = await rows.inbox.findMany({});
    expect(row).toMatchObject({
      title: "Alepha released 0.30.0",
      body: "Lore Inbox",
      scopeLabel: "Alepha",
      category: "releases",
    });
    expect(mail.last?.body).toContain("It ships 19 quests.");

    await alepha.stop();
  });

  /**
   * A contact nobody owns is an ordinary outcome. The channel declines
   * through `unavailable()`, so nothing is filed and nothing throws.
   */
  it("files nothing for an address that belongs to nobody", async ({
    expect,
  }) => {
    const { alepha, rows, templates } = await setup();

    await templates.inboxMention.push({
      contact: "stranger@example.com",
      lang: "en",
      variables: {
        reference: "#Q1",
        subjectTitle: "t",
        authorName: "a",
        excerpt: "e",
        projectTitle: "Alepha",
        href: "/x",
        url: "https://example.com/x",
        scope: "project:1",
      },
      inline: true,
    });

    expect(await rows.inbox.findMany({})).toHaveLength(0);

    await alepha.stop();
  });

  /**
   * The escaper is one class now. These two are the classes that used to
   * carry their own copy, and a DKIM-signed email is a high-trust surface to
   * inject an anchor into.
   */
  it("still escapes user-controlled strings in the templates that were lifted", async ({
    expect,
  }) => {
    const { alepha } = await setup();

    const escaper = alepha.inject(NotificationHtmlEscaper);
    expect(escaper.escape(`<img src=x onerror="alert('1')">&`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;",
    );

    // Both still render, which is what a broken lift would have cost.
    expect(alepha.inject(QuestNotifications).questReminder.name).toBeTruthy();
    expect(
      alepha.inject(EstateNotifications).credentialInvalid.name,
    ).toBeTruthy();

    await alepha.stop();
  });

  it("builds references through the one implementation of the grammar", async ({
    expect,
  }) => {
    const { alepha, templates } = await setup();

    expect(templates.questReference(402)).toBe("#Q402");
    // Feedback is #P. #F is a folio, which is the mistake worth pinning.
    expect(templates.feedbackReference(120)).toBe("#P120");

    await alepha.stop();
  });
});
