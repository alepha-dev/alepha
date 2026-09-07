import { Alepha } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import {
  notificationInboxEntity,
  NotificationInboxRecipientProvider,
  NotificationJobs,
} from "alepha/api/notifications";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { FeedbackCommentController } from "../src/api/controllers/FeedbackCommentController.ts";
import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { members } from "../src/api/entities/members.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreInboxRecipientProvider } from "../src/api/providers/LoreInboxRecipientProvider.ts";

class Probe {
  members = $repository(members);
  inbox = $repository(notificationInboxEntity);
  executions = $repository(jobExecutionEntity);
}

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
  const feedbackApi = alepha.inject(FeedbackController);
  const commentApi = alepha.inject(FeedbackCommentController);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({
    username: "owner",
    email: "Owner@Example.com",
  });
  const member = await users.createUser({
    username: "teammate",
    email: "teammate@example.com",
  });
  const reporter = await users.createUser({
    username: "reporter",
    email: "reporter@example.com",
  });

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  const project = await asUser(owner.id, () =>
    projectApi.createProject({
      body: { title: "Feedback probe", capabilities: [{ key: "support" }] },
    } as any),
  );
  await probe.members.create({ userId: member.id, projectId: project.id });

  const report = (title: string, reporterId: string) =>
    asUser(reporterId, () =>
      feedbackApi.submitFeedback({
        params: { projectId: project.id },
        body: { title, description: "x" },
      } as any),
    );

  const sendJobName = alepha.inject(NotificationJobs).sendNotification.name;

  /**
   * Wait for the outbox to settle.
   *
   * ⚠️ It does NOT send anything. The job layer's direct mode drains the
   * outbox itself, asynchronously - so a helper that also sent would deliver
   * every message twice, which is exactly what the first version of this did.
   * The only thing a test needs is to stop asserting before the drain has
   * run, and that is what this waits for.
   */
  const deliver = async () => {
    const terminal = new Set(["ok", "error", "cancelled"]);
    for (let attempt = 0; attempt < 50; attempt++) {
      const rows = await probe.executions.findMany({
        where: { jobName: { eq: sendJobName } },
      });
      if (rows.every((row) => terminal.has(String(row.status)))) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("The notification outbox never settled");
  };

  return {
    alepha,
    probe,
    deliver,
    commentApi,
    asUser,
    report,
    project,
    owner,
    member,
    reporter,
  };
};

describe("a mention in a feedback comment", () => {
  it("reaches the member a member named", async ({ expect }) => {
    const ctx = await setup();
    const item = await ctx.report("It crashes", ctx.reporter.id);

    await ctx.asUser(ctx.owner.id, () =>
      ctx.commentApi.createFeedbackComment({
        params: { id: item.id },
        body: { body: "@teammate can you reproduce this" },
      }),
    );

    await ctx.deliver();

    const rows = await ctx.probe.inbox.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: ctx.member.id,
      template: "lore:inbox:mention",
      scope: `project:${ctx.project.id}`,
      scopeLabel: "Feedback probe",
    });
    // ⚠️ `P`, not `F`. Feedback kept `P` from its Petitions days; `F` is the
    // folio, and hand-building the string is the only way to get it wrong.
    expect(rows[0].title).toMatch(/#P\d+/);
    expect(rows[0].href).toContain("/feedback");

    await ctx.alepha.stop();
  });

  /**
   * ⚠️ The owner's ruling, and the assertion that keeps it: an outsider
   * never pings anyone. The gate is on the AUTHOR, not on the handle - a
   * non-member's `@owner` matches a real member and is still dropped, and a
   * spec gating the other way round looks identical until somebody tests it.
   */
  it("reaches nobody when the author is not a member", async ({ expect }) => {
    const ctx = await setup();
    const item = await ctx.report("It crashes", ctx.reporter.id);

    await ctx.asUser(ctx.reporter.id, () =>
      ctx.commentApi.createFeedbackComment({
        params: { id: item.id },
        body: { body: "@owner @teammate please look" },
      }),
    );

    await ctx.deliver();

    expect(await ctx.probe.inbox.findMany({})).toHaveLength(0);

    await ctx.alepha.stop();
  });

  /**
   * ⚠️ `loadReadable` takes the reporter branch FIRST, so a member who filed
   * feedback on their own project returns through it. Inferring "not a
   * member" from that branch would silence the owner's own mentions on their
   * own item - the case most likely to be typed and least likely to be
   * tested.
   */
  it("reaches somebody when the reporter is also a member", async ({
    expect,
  }) => {
    const ctx = await setup();
    const item = await ctx.report("I found it myself", ctx.owner.id);

    await ctx.asUser(ctx.owner.id, () =>
      ctx.commentApi.createFeedbackComment({
        params: { id: item.id },
        body: { body: "@teammate this one is mine" },
      }),
    );

    await ctx.deliver();

    const rows = await ctx.probe.inbox.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ctx.member.id);

    await ctx.alepha.stop();
  });

  it("never pings the author, here as on a quest", async ({ expect }) => {
    const ctx = await setup();
    const item = await ctx.report("It crashes", ctx.reporter.id);

    await ctx.asUser(ctx.owner.id, () =>
      ctx.commentApi.createFeedbackComment({
        params: { id: item.id },
        body: { body: "note to self @owner" },
      }),
    );

    await ctx.deliver();

    expect(await ctx.probe.inbox.findMany({})).toHaveLength(0);

    await ctx.alepha.stop();
  });

  it("holds out a handle in a code span, here as on a quest", async ({
    expect,
  }) => {
    const ctx = await setup();
    const item = await ctx.report("It crashes", ctx.reporter.id);

    await ctx.asUser(ctx.owner.id, () =>
      ctx.commentApi.createFeedbackComment({
        params: { id: item.id },
        body: { body: "the stack says `@teammate` somewhere" },
      }),
    );

    await ctx.deliver();

    expect(await ctx.probe.inbox.findMany({})).toHaveLength(0);

    await ctx.alepha.stop();
  });
});
