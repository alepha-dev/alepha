import {
  LoreInboxRecipientProvider,
  ProjectEventCatalog,
  ProjectEventDelivery,
  ProjectEvents,
  SubscriptionController,
  eventSubscriptions,
  projectEvents,
} from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { FeedbackController } from "@lore/plan/api";
import { DeployRegistry } from "@lore/ship/api";
import { appInstances, deployments } from "@lore/ship/schemas";
import { Alepha, AlephaError } from "alepha";
import {
  JobProvider,
  JobQueueProvider,
  jobExecutionEntity,
} from "alepha/api/jobs";
import {
  NotificationInboxRecipientProvider,
  notificationInboxEntity,
} from "alepha/api/notifications";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class Rows extends TestEntityRepositories {
  subscriptions = $repository(eventSubscriptions);
  events = $repository(projectEvents);
  jobs = $repository(jobExecutionEntity);
  inbox = $repository(notificationInboxEntity);
  instances = $repository(appInstances);
  deployments = $repository(deployments);
}
/**
 * Records what it is asked to dispatch, and fails when told to: a lost
 * dispatch, after the batch committed.
 */
class HeldQueue extends JobQueueProvider {
  public dispatched: string[] = [];
  public fail = false;
  public override async dispatch(_name: string, id: string) {
    if (this.fail) throw new AlephaError("Queue unavailable");
    this.dispatched.push(id);
  }
}

/**
 * Subscriptions (#Q3890): a member is told in their inbox or by email when an event
 * happens, with the event's fixed message.
 */
describe("Subscriptions", () => {
  let alepha: Alepha;
  let rows: Rows;
  let queue: HeldQueue;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let owner: UserAccountToken;
  let member: UserAccountToken;
  const controller = () => alepha.inject(SubscriptionController);
  const subscribe = (
    user: UserAccountToken,
    body: {
      event: string;
      filter?: string;
      memberId?: string;
      channels: ("inapp" | "email")[];
      notMine?: boolean;
      notMembers?: boolean;
    },
  ) =>
    controller().setSubscription.fetch(
      { params: { projectId: project.id }, body },
      { user },
    );
  const submit = () =>
    alepha.inject(FeedbackController).submitFeedback.fetch(
      {
        params: { projectId: project.id },
        body: { title: "Broken", description: "Steps" },
      },
      { user: owner },
    );
  /**
   * Runs every pending delivery job, then every notification it pushed.
   */
  const drain = async () => {
    const jobs = alepha.inject(JobProvider);
    for (const name of [ProjectEventDelivery.JOB, "system.notifications.send"])
      for (const job of await rows.jobs.findMany({
        where: { jobName: name, status: "pending" },
      }))
        await jobs.processExecution(job.jobName, job.id);
  };
  const inboxOf = (userId: string) =>
    rows.inbox.findMany({ where: { userId } });

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: HeldQueue })
      .with({
        provide: NotificationInboxRecipientProvider,
        use: LoreInboxRecipientProvider,
      });
    bootLore(alepha);
    rows = alepha.inject(Rows);
    queue = alepha.inject(HeldQueue);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "plan", options: { feedback: true } },
        { key: "ship", options: { deploy: true } },
      ],
    });
    await createPresetRanks(alepha, project.id);
    await rows.users.updateById(project.createdBy, { roles: ["user"] });
    owner = { id: project.createdBy, roles: ["user"] };
    const other = await rows.users.create({
      email: "member@example.test",
      roles: ["user"],
    });
    await createTestMember(alepha, project, other.id, { rank: "member" });
    member = { id: other.id, roles: ["user"] };
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("gives every event of the catalog a fixed English message, behind a function that takes the language", async ({
    expect,
  }) => {
    const catalog = alepha.inject(ProjectEventCatalog).all();
    expect(catalog.length).toBeGreaterThanOrEqual(15);
    for (const event of catalog) {
      const message = event.message({ title: "Thing", shortId: 3 }, "en");
      expect(message.title.trim(), event.name).not.toBe("");
      expect(message.text.trim(), event.name).not.toBe("");
      expect(`${message.title} ${message.text}`).not.toMatch(/undefined|\{\{/);
    }
  });

  it("refuses two identical unfiltered rows through the computed key", async ({
    expect,
  }) => {
    const body = { event: "feedback.created", channels: ["inapp" as const] };
    const first = await subscribe(member, body);
    const second = await subscribe(member, {
      ...body,
      channels: ["inapp", "email"],
    });
    expect(second.data.id).toBe(first.data.id);
    expect(second.data.channels).toEqual(["inapp", "email"]);
    expect(await rows.subscriptions.count({ projectId: project.id })).toBe(1);
    const stored = await rows.subscriptions.getById(first.data.id);
    await expect(
      rows.subscriptions.create({
        projectId: project.id,
        key: stored.key,
        event: "feedback.created",
        memberId: member.id,
        channels: ["inapp"],
      }),
    ).rejects.toThrow();
  });

  it("lets a member manage only their own rows, and a manager anyone's", async ({
    expect,
  }) => {
    await expect(
      subscribe(member, {
        event: "feedback.created",
        memberId: owner.id,
        channels: ["inapp"],
      }),
    ).rejects.toThrow(/subscription:manage/);
    const own = await subscribe(member, {
      event: "feedback.created",
      channels: ["inapp"],
    });
    const forMember = await subscribe(owner, {
      event: "release.published",
      memberId: member.id,
      channels: ["email"],
    });
    expect(forMember.data).toMatchObject({
      memberId: member.id,
      createdBy: owner.id,
    });
    const seen = await controller().listSubscriptions.fetch(
      { params: { projectId: project.id } },
      { user: member },
    );
    expect(seen.data.items).toHaveLength(2);
    await subscribe(owner, { event: "quest.created", channels: ["inapp"] });
    expect(
      (
        await controller().listSubscriptions.fetch(
          { params: { projectId: project.id } },
          { user: member },
        )
      ).data.items,
    ).toHaveLength(2);
    expect(
      (
        await controller().listSubscriptions.fetch(
          { params: { projectId: project.id } },
          { user: owner },
        )
      ).data.items,
    ).toHaveLength(3);
    const muted = await controller().muteSubscription.fetch(
      {
        params: { projectId: project.id, id: own.data.id },
        body: { muted: true },
      },
      { user: member },
    );
    expect(muted.data.mutedAt).toBeDefined();
    await expect(
      controller().muteSubscription.fetch(
        {
          params: { projectId: project.id, id: forMember.data.id },
          body: { muted: true },
        },
        { user: owner },
      ),
    ).rejects.toThrow(/Only the member/);
    await controller().deleteSubscription.fetch(
      { params: { projectId: project.id, id: forMember.data.id } },
      { user: owner },
    );
    expect(await rows.subscriptions.count({ projectId: project.id })).toBe(2);
  });

  it("writes no job row for an event nobody is subscribed to", async ({
    expect,
  }) => {
    const events = alepha.inject(ProjectEvents);
    const alone = await events.emit({
      projectId: project.id,
      name: "quest.created",
      fields: {},
    });
    expect(alone.statements).toHaveLength(1);
    await subscribe(member, { event: "quest.created", channels: ["inapp"] });
    const watched = await events.emit({
      projectId: project.id,
      name: "quest.created",
      fields: {},
    });
    expect(watched.statements).toHaveLength(2);
  });

  it("writes the delivery job with the change, and tells the member in their inbox with the fixed message", async ({
    expect,
  }) => {
    await subscribe(member, { event: "feedback.created", channels: ["inapp"] });
    await submit();
    const [job] = await rows.jobs.findMany({
      where: { jobName: ProjectEventDelivery.JOB },
    });
    const [event] = await rows.events.findMany({
      where: { projectId: project.id },
    });
    expect(job.payload).toEqual({ eventId: event.id });
    expect(queue.dispatched).toContain(job.id);
    await drain();
    const [received] = await inboxOf(member.id);
    expect(received.title).toMatch(/^New feedback #P\d+: Broken$/);
    expect(received.body).toBe("Steps");
    expect(await inboxOf(owner.id)).toHaveLength(0);
  });

  it("leaves a lost dispatch pending for the job sweep", async ({ expect }) => {
    await subscribe(member, { event: "feedback.created", channels: ["inapp"] });
    queue.fail = true;
    await submit();
    const [job] = await rows.jobs.findMany({
      where: { jobName: ProjectEventDelivery.JOB },
    });
    expect(job.status).toBe("pending");
    expect(queue.dispatched).toHaveLength(0);
    queue.fail = false;
    // Past the sweep's stale threshold, the sweep sends it again.
    await alepha.inject(DateTimeProvider).travel(1, "hour");
    await alepha.events.emit("serverless:cron:triggered", {
      name: "system.jobs.sweep",
    });
    expect(queue.dispatched).toContain(job.id);
  });

  it("narrows a subscription to one app through the catalog's filter field", async ({
    expect,
  }) => {
    await subscribe(member, {
      event: "deploy.failed",
      filter: "site",
      channels: ["inapp"],
    });
    for (const app of ["site", "admin"]) {
      const instance = await rows.instances.create({
        projectId: project.id,
        app,
        env: "production",
        createdBy: owner.id,
      });
      const deployment = await rows.deployments.create({
        projectId: project.id,
        instanceId: instance.id,
        app,
        tag: "latest",
        sha256: "a".repeat(64),
        status: "running",
      });
      await alepha.inject(DeployRegistry).failed(deployment.id, "Broken");
    }
    await drain();
    const received = await inboxOf(member.id);
    expect(received.map((it) => it.title)).toEqual([
      "site failed to deploy to production",
    ]);
  });

  it("sends each subscription and channel once across replays, and at most the step in flight again after a crash", async ({
    expect,
  }) => {
    await subscribe(member, {
      event: "feedback.created",
      channels: ["inapp", "email"],
    });
    queue.fail = true;
    await submit();
    queue.fail = false;
    const [event] = await rows.events.findMany({
      where: { projectId: project.id },
    });
    const delivery = alepha.inject(ProjectEventDelivery);
    const done = new Map<string, boolean>();
    let crash = true;
    const step = async (name: string, fn: () => Promise<boolean>) => {
      if (done.has(name)) return done.get(name)!;
      const result = await fn();
      // Dies after the second send, before it is recorded.
      if (crash && done.size === 1) {
        crash = false;
        throw new AlephaError("Worker died");
      }
      done.set(name, result);
      return result;
    };
    const pushed = () =>
      rows.jobs.count({ jobName: "system.notifications.send" });
    await expect(delivery.deliver(event, step)).rejects.toThrow("died");
    expect(await pushed()).toBe(2);
    await delivery.deliver(event, step);
    expect(await pushed()).toBe(3);
    await delivery.deliver(event, step);
    expect(await pushed()).toBe(3);
  });

  it("tells nobody who left, was disabled or lacks the event's read permission", async ({
    expect,
  }) => {
    const viewer = await rows.users.create({
      email: "viewer@example.test",
      roles: ["user"],
    });
    await createTestMember(alepha, project, viewer.id, { rank: "viewer" });
    const gone = await rows.users.create({
      email: "gone@example.test",
      roles: ["user"],
    });
    await createTestMember(alepha, project, gone.id);
    const disabled = await rows.users.create({
      email: "disabled@example.test",
      roles: ["user"],
    });
    await createTestMember(alepha, project, disabled.id);
    for (const id of [viewer.id, gone.id, disabled.id, member.id])
      await subscribe(owner, {
        event: "feedback.created",
        memberId: id,
        channels: ["inapp"],
      });
    // The viewer loses `feedback:read`; the other two leave or are disabled.
    const ranks = await rows.organizationRanks.findMany({
      where: { organizationId: project.organizationId!, key: "viewer" },
    });
    for (const rank of ranks)
      await rows.organizationRanks.updateById(rank.id, {
        permissions: rank.permissions.filter((it) => it !== "feedback:read"),
      });
    await rows.organizationMembers.deleteMany({
      organizationId: { eq: project.organizationId! },
      userId: { eq: gone.id },
    });
    await rows.users.updateById(disabled.id, { enabled: false });
    await submit();
    await drain();
    expect(await inboxOf(member.id)).toHaveLength(1);
    for (const id of [viewer.id, gone.id, disabled.id])
      expect(await inboxOf(id)).toHaveLength(0);
  });

  it("skips, with notMine, the report a member filed themselves, and tells them of everyone else's (#Q3916)", async ({
    expect,
  }) => {
    for (const user of [owner, member])
      await subscribe(user, {
        event: "feedback.created",
        channels: ["inapp"],
        notMine: true,
      });
    await submit();
    const [event] = await rows.events.findMany({
      where: { projectId: project.id },
    });
    expect(event.actorId).toBe(owner.id);
    await drain();
    expect(await inboxOf(owner.id)).toHaveLength(0);
    expect(await inboxOf(member.id)).toHaveLength(1);
    const row = (
      await controller().listSubscriptions.fetch(
        { params: { projectId: project.id } },
        { user: owner },
      )
    ).data.items.find((it) => it.memberId === owner.id);
    expect(row?.notMine).toBe(true);
  });

  it("skips, with notMembers, the reports of project members and tells those of outsiders (#Q4055)", async ({
    expect,
  }) => {
    await subscribe(member, {
      event: "feedback.created",
      channels: ["inapp"],
      notMembers: true,
    });
    // The owner, a member, files one: kept out.
    await submit();
    await drain();
    expect(await inboxOf(member.id)).toHaveLength(0);

    // Someone outside the project files one: told.
    const outsider = await rows.users.create({
      email: "outsider@example.test",
      roles: ["user"],
    });
    await alepha.inject(FeedbackController).submitFeedback.fetch(
      {
        params: { projectId: project.id },
        body: { title: "From outside", description: "Steps" },
      },
      {
        user: {
          id: outsider.id,
          email: outsider.email,
          roles: ["user"],
        } as UserAccountToken,
      },
    );
    await drain();
    expect(await inboxOf(member.id)).toHaveLength(1);

    const row = (
      await controller().listSubscriptions.fetch(
        { params: { projectId: project.id } },
        { user: member },
      )
    ).data.items.find((it) => it.memberId === member.id);
    expect(row?.notMembers).toBe(true);
  });
});
