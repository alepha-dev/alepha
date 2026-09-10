import { Alepha } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import {
  notificationInboxEntity,
  NotificationInboxRecipientProvider,
  NotificationJobs,
  NotificationPreferenceProvider,
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
import { notificationPreferences } from "../src/api/entities/notificationPreferences.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreInboxRecipientProvider } from "../src/api/providers/LoreInboxRecipientProvider.ts";
import { LoreNotificationPreferences } from "../src/api/providers/LoreNotificationPreferences.ts";

class Probe {
  members = $repository(members);
  prefs = $repository(notificationPreferences);
  inbox = $repository(notificationInboxEntity);
  executions = $repository(jobExecutionEntity);
}

/**
 * The person who wrote a report is told what happened to it.
 *
 * Before this they were outside every path Lore had: `MentionNotifier` needs
 * an `@name` AND project membership, and a reporter submitted through
 * `/:projectSlug/request`, which asks for an account and not for membership
 * (feedback #P2165).
 *
 * The reporter here is deliberately **not a member** in every case but the
 * last, because that is the case the old plumbing could not serve and the one
 * a spec written from the inside would forget to construct.
 */
describe("telling a reporter what happened to their report", () => {
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
    // ⚠️ Both substitutions live in `main.server.ts`, not in `LoreApi`, so a
    // container built from `LoreApi` alone gets the framework's permissive
    // defaults - which allow everything, and would make the muted-category
    // case below pass for the wrong reason. Before `LoreApi`, which resolves
    // them: a later `.with` is a `TooLateSubstitutionError`.
    alepha.with({
      provide: NotificationPreferenceProvider,
      use: LoreNotificationPreferences,
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
      email: "owner@example.com",
    });
    const reporter = await users.createUser({
      username: "reporter",
      email: "reporter@example.com",
    });

    const asUser = <R>(userId: string, fn: () => R): R =>
      alepha.context.run(() => {
        alepha.store.set(currentUserAtom, {
          id: userId,
          roles: ["user"],
        } as any);
        return fn();
      });

    const project = await asUser(owner.id, () =>
      projectApi.createProject({
        body: { title: "Feedback probe", capabilities: [{ key: "support" }] },
      } as any),
    );

    const report = (title: string, reporterId: string) =>
      asUser(reporterId, () =>
        feedbackApi.submitFeedback({
          params: { projectId: project.id },
          body: { title, description: "x" },
        } as any),
      );

    const sendJobName = alepha.inject(NotificationJobs).sendNotification.name;

    /**
     * Wait for the outbox to settle. It does NOT send: the job layer's direct
     * mode drains it itself, so a helper that also sent would deliver twice.
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
      feedbackApi,
      commentApi,
      asUser,
      report,
      project,
      owner,
      reporter,
    };
  };

  const triage = (
    ctx: Awaited<ReturnType<typeof setup>>,
    feedbackId: number,
    outcome: "accept" | "reject",
  ) =>
    ctx.asUser(ctx.owner.id, () =>
      outcome === "accept"
        ? ctx.feedbackApi.acceptFeedback({
            params: { projectId: ctx.project.id, feedbackId },
          } as any)
        : ctx.feedbackApi.rejectFeedback({
            params: { projectId: ctx.project.id, feedbackId },
          } as any),
    );

  it("tells a reporter who is not a project member that it was accepted", async ({
    expect,
  }) => {
    const ctx = await setup();
    const item = await ctx.report("It crashes", ctx.reporter.id);
    // The point of the whole feature: nobody added this person to anything.
    expect(
      await ctx.probe.members.findOne({
        where: { userId: { eq: ctx.reporter.id } },
      }),
    ).toBeUndefined();

    await triage(ctx, item.id, "accept");
    await ctx.deliver();

    const rows = await ctx.probe.inbox.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: ctx.reporter.id,
      template: "lore:feedback:triaged",
      scope: `project:${ctx.project.id}`,
    });
    expect(rows[0].title).toContain("accepted");
    // ⚠️ `P`, not `F`. Feedback kept `P` from its Petitions days.
    expect(rows[0].title).toMatch(/#P\d+/);

    await ctx.alepha.stop();
  });

  it("says rejected when it was rejected, from the same template", async ({
    expect,
  }) => {
    const ctx = await setup();
    const item = await ctx.report("Please add dark mode", ctx.reporter.id);

    await triage(ctx, item.id, "reject");
    await ctx.deliver();

    const rows = await ctx.probe.inbox.findMany({});
    expect(rows).toHaveLength(1);
    // ONE template with the outcome as a variable, not two: the same name is
    // what makes a single mute cover both halves of a triage decision.
    expect(rows[0].template).toBe("lore:feedback:triaged");
    expect(rows[0].title).toContain("rejected");

    await ctx.alepha.stop();
  });

  it("says nothing when the owner triages their own report", async ({
    expect,
  }) => {
    const ctx = await setup();
    // The owner is very often also the reporter on their own project, and a
    // decision you took yourself is not news.
    const item = await ctx.report("My own note", ctx.owner.id);

    await triage(ctx, item.id, "accept");
    await ctx.deliver();

    expect(await ctx.probe.inbox.findMany({})).toHaveLength(0);

    await ctx.alepha.stop();
  });

  it("tells a reporter somebody answered, and not about their own comment", async ({
    expect,
  }) => {
    const ctx = await setup();
    const item = await ctx.report("It crashes", ctx.reporter.id);

    // The reporter's own follow-up reaches nobody.
    await ctx.asUser(ctx.reporter.id, () =>
      ctx.commentApi.createFeedbackComment({
        params: { id: item.id },
        body: { body: "Still happening on 0.29" },
      }),
    );
    await ctx.deliver();
    expect(await ctx.probe.inbox.findMany({})).toHaveLength(0);

    // The owner's answer reaches them.
    await ctx.asUser(ctx.owner.id, () =>
      ctx.commentApi.createFeedbackComment({
        params: { id: item.id },
        body: { body: "A quest cannot be added to an active epic." },
      }),
    );
    await ctx.deliver();

    const rows = await ctx.probe.inbox.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: ctx.reporter.id,
      template: "lore:feedback:comment",
    });

    await ctx.alepha.stop();
  });

  it("sends one message, not two, when the reporter is also mentioned", async ({
    expect,
  }) => {
    const ctx = await setup();
    // A MEMBER this time: `MentionNotifier` matches against the roster, so a
    // non-member cannot be mentioned at all and the collision needs one.
    await ctx.probe.members.create({
      userId: ctx.reporter.id,
      projectId: ctx.project.id,
    });
    const item = await ctx.report("It crashes", ctx.reporter.id);

    await ctx.asUser(ctx.owner.id, () =>
      ctx.commentApi.createFeedbackComment({
        params: { id: item.id },
        body: { body: "@reporter fixed in the next release" },
      }),
    );
    await ctx.deliver();

    const rows = await ctx.probe.inbox.findMany({});
    // One event, one message. The mention wins because it fired first and is
    // the more specific of the two.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: ctx.reporter.id,
      template: "lore:inbox:mention",
    });

    await ctx.alepha.stop();
  });

  it("says nothing to a reporter who muted the feedback category", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.probe.prefs.create({
      userId: ctx.reporter.id,
      emailEnabled: true,
      mutedCategories: ["feedback"],
    });
    const item = await ctx.report("It crashes", ctx.reporter.id);

    await triage(ctx, item.id, "accept");
    await ctx.deliver();

    // ⚠️ The category is its own axis on purpose. Muting `mentions` to stop
    // hearing about your reports would be the alternative, and that is a
    // person choosing between two unrelated things.
    expect(await ctx.probe.inbox.findMany({})).toHaveLength(0);

    await ctx.alepha.stop();
  });
});
