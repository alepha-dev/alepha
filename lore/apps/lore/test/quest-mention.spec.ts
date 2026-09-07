import { Alepha, z } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import {
  notificationInboxEntity,
  NotificationInboxRecipientProvider,
  NotificationJobs,
} from "alepha/api/notifications";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestCommentController } from "../src/api/controllers/QuestCommentController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { members } from "../src/api/entities/members.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreInboxRecipientProvider } from "../src/api/providers/LoreInboxRecipientProvider.ts";

/**
 * The inbox is read directly rather than through the controller: the point
 * here is which rows the event produced, not how they are served.
 *
 * ⚠️ Nothing drains a queue in these tests. The push is deliberately NOT
 * `inline` - `$notification` warns against that for a send addressed to
 * somebody other than the caller, because the response time then tells the
 * caller whether the recipient exists - and the job layer's direct mode
 * processes the outbox in this same process, which is what production does
 * too.
 */
class Probe {
  members = $repository(members);
  inbox = $repository(notificationInboxEntity);
  executions = $repository(jobExecutionEntity);
}

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      PUBLIC_URL: "https://lore.test",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with({
    provide: NotificationInboxRecipientProvider,
    use: LoreInboxRecipientProvider,
  });
  alepha.with(LoreApi);

  const probe = alepha.inject(Probe);
  await alepha.start();

  return {
    alepha,
    probe,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    comments: alepha.inject(QuestCommentController),
    fake: alepha.inject(FakeProvider),
    sendJobName: alepha.inject(NotificationJobs).sendNotification.name,
  };
};

/**
 * Wait for the notification outbox to settle.
 *
 * ⚠️ It sends nothing. The job layer's direct mode drains the outbox itself,
 * asynchronously, so a helper that also sent would deliver every message
 * twice - which is exactly what the first version of this did. All a test
 * needs is to stop asserting before the drain has run.
 */
const settle = async (ctx: {
  probe: { executions: { findMany: (q: any) => Promise<any[]> } };
  sendJobName: string;
}): Promise<void> => {
  const terminal = new Set(["ok", "error", "cancelled"]);
  for (let attempt = 0; attempt < 50; attempt++) {
    const rows = await ctx.probe.executions.findMany({
      where: { jobName: { eq: ctx.sendJobName } },
    });
    if (rows.every((row) => terminal.has(String(row.status)))) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("The notification outbox never settled");
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const createUser = async (ctx: Ctx, username: string) => {
  const fake = ctx.fake.generate(userDataSchema);
  const response = await ctx.admin.createUser.fetch(
    { body: { ...fake, username, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles, username };
};

const seed = async (ctx: Ctx) => {
  const author = await createUser(ctx, "fabrice");
  const mentioned = await createUser(ctx, "nfo");
  const bystander = await createUser(ctx, "someone");

  const project = await ctx.projects.createProject.fetch(
    { body: { title: "Mention probe" } },
    { user: author },
  );
  const projectId = project.data.id;

  await ctx.probe.members.create({ userId: mentioned.id, projectId });
  await ctx.probe.members.create({ userId: bystander.id, projectId });

  const quest = await ctx.quests.createQuest.fetch(
    {
      body: {
        projectId,
        title: "Something to talk about",
        description: "",
        area: "ops",
        priority: "low",
      },
    },
    { user: author },
  );

  return {
    author,
    mentioned,
    bystander,
    projectId,
    questId: quest.data.shortId,
  };
};

const comment = (
  ctx: Ctx,
  questId: number,
  user: { id: string },
  body: string,
) =>
  ctx.comments.createQuestComment.fetch(
    { params: { id: questId }, body: { body } },
    { user },
  );

describe("a mention in a quest comment", () => {
  it("files one message, with a clickable href and a readable chip", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { author, mentioned, questId, projectId } = await seed(ctx);

    await comment(ctx, questId, author, "hey @nfo can you look at this");

    await settle(ctx);
    const rows = await ctx.probe.inbox.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: mentioned.id,
      template: "lore:inbox:mention",
      category: "mentions",
      scope: `project:${projectId}`,
      scopeLabel: "Mention probe",
    });
    expect(rows[0].title).toContain("#Q");
    expect(rows[0].href).toContain(`/quests/${questId}`);

    await ctx.alepha.stop();
  });

  /**
   * Mentioning yourself is a note to self.
   */
  it("never pings the author", async ({ expect }) => {
    const ctx = await setup();
    const { author, questId } = await seed(ctx);

    await comment(ctx, questId, author, "note to self: @fabrice do the thing");

    await settle(ctx);
    expect(await ctx.probe.inbox.findMany({})).toHaveLength(0);

    await ctx.alepha.stop();
  });

  it("collapses the same handle repeated in one body", async ({ expect }) => {
    const ctx = await setup();
    const { author, questId } = await seed(ctx);

    await comment(ctx, questId, author, "@nfo @nfo and once more @nfo");
    await settle(ctx);
    expect(await ctx.probe.inbox.findMany({})).toHaveLength(1);

    await ctx.alepha.stop();
  });

  /**
   * A mention is not a way to reach somebody outside the project. The roster
   * IS the member list, so this falls out of the matcher - and it is
   * asserted rather than assumed.
   */
  it("reaches nobody outside the project", async ({ expect }) => {
    const ctx = await setup();
    const { author, questId } = await seed(ctx);
    await createUser(ctx, "outsider");

    await comment(ctx, questId, author, "cc @outsider on this");

    await settle(ctx);
    expect(await ctx.probe.inbox.findMany({})).toHaveLength(0);

    await ctx.alepha.stop();
  });

  /**
   * ⚠️ The whole reason the edit path is real work rather than a copy of the
   * create path: fixing a typo elsewhere must not re-ping everyone.
   */
  it("pings only the handles an edit added", async ({ expect }) => {
    const ctx = await setup();
    const { author, bystander, questId } = await seed(ctx);

    const created = await comment(ctx, questId, author, "hi @nfo");
    await settle(ctx);
    expect(await ctx.probe.inbox.findMany({})).toHaveLength(1);

    // A typo fix that keeps the same mention pings nobody again.
    await ctx.comments.updateQuestComment.fetch(
      {
        params: { id: created.data.id },
        body: { body: "hi @nfo, sorry for the typo" },
      },
      { user: author },
    );
    await settle(ctx);
    expect(await ctx.probe.inbox.findMany({})).toHaveLength(1);

    // Adding a handle pings that one, and only that one.
    await ctx.comments.updateQuestComment.fetch(
      {
        params: { id: created.data.id },
        body: { body: "hi @nfo and @someone, sorry for the typo" },
      },
      { user: author },
    );
    await settle(ctx);
    const rows = await ctx.probe.inbox.findMany({});
    expect(rows).toHaveLength(2);
    expect(rows.filter((it) => it.userId === bystander.id)).toHaveLength(1);

    await ctx.alepha.stop();
  });

  /**
   * The four shapes the renderer holds out, held out here too: a comment
   * explaining an `@decorator` in a code span links nobody, so it must ping
   * nobody.
   */
  it("ignores a handle inside a code span", async ({ expect }) => {
    const ctx = await setup();
    const { author, questId } = await seed(ctx);

    await comment(ctx, questId, author, "the decorator is `@nfo` in that file");

    await settle(ctx);
    expect(await ctx.probe.inbox.findMany({})).toHaveLength(0);

    await ctx.alepha.stop();
  });

  it("does not treat an email address as a mention", async ({ expect }) => {
    const ctx = await setup();
    const { author, questId } = await seed(ctx);

    await comment(ctx, questId, author, "write to me@nfo.example about it");

    await settle(ctx);
    expect(await ctx.probe.inbox.findMany({})).toHaveLength(0);

    await ctx.alepha.stop();
  });

  it("saves the comment even with no mention in it", async ({ expect }) => {
    const ctx = await setup();
    const { author, questId } = await seed(ctx);

    const created = await comment(
      ctx,
      questId,
      author,
      "plain prose, no one named",
    );

    expect(created.data.body).toBe("plain prose, no one named");
    await settle(ctx);
    expect(await ctx.probe.inbox.findMany({})).toHaveLength(0);

    await ctx.alepha.stop();
  });
});
