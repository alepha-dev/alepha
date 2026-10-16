import {
  AutomationNotifications,
  AutomationController,
  AutomationContextBuilder,
  AutomationSelections,
  AutomationAdoptionService,
  AutomationAdoptionRegistry,
  AutomationLegacyJobProvider,
  AutomationLegacyQueue,
  AutomationLegacyDispatch,
  AutomationPersistence,
  AutomationService,
  AutomationEvents,
  AutomationWorker,
  AutomationClaims,
  AutomationEvaluator,
  AutomationNotificationOutbox,
  LoreInboxRecipientProvider,
  LoreNotificationPreferences,
} from "@lore/core/api";
import { notificationPreferences } from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { QuestNotifications, ReleaseController } from "@lore/work/api";
import { Alepha, AlephaError } from "alepha";
import {
  JobProvider,
  JobQueueProvider,
  jobExecutionEntity,
} from "alepha/api/jobs";
import {
  notificationDeliveryEntity,
  notificationInboxEntity,
  NotificationInboxRecipientProvider,
  NotificationPreferenceProvider,
} from "alepha/api/notifications";
import { organizationRanks } from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { EmailProvider, MemoryEmailProvider } from "alepha/email";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { beforeEach, afterEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  createTestMember,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class AdoptionQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class AdoptionRows {
  ranks = $repository(organizationRanks);
  jobs = $repository(jobExecutionEntity);
  deliveries = $repository(notificationDeliveryEntity);
  inbox = $repository(notificationInboxEntity);
  preferences = $repository(notificationPreferences);
}
class InterruptedAdoption extends AutomationAdoptionService {
  public interrupt = false;
  public afterCutover = false;
  protected override async cutover(
    ...args: Parameters<AutomationAdoptionService["cutover"]>
  ) {
    if (this.interrupt) {
      this.interrupt = false;
      throw new AlephaError("Interrupted before cutover");
    }
    await super.cutover(...args);
    if (this.afterCutover) {
      this.afterCutover = false;
      throw new AlephaError("Interrupted after committed cutover");
    }
  }
}
class AdoptionNotificationFault extends AutomationNotifications {
  public crash = false;
  public override async enqueue(
    ...args: Parameters<AutomationNotifications["enqueue"]>
  ) {
    const result = await super.enqueue(...args);
    if (this.crash) {
      this.crash = false;
      throw new AlephaError("Interrupted after committed enqueue");
    }
    return result;
  }
}
class AdoptionClaimFault extends AutomationClaims {
  public crash = false;
  public override async continueReminderSelection(
    ...args: Parameters<AutomationClaims["continueReminderSelection"]>
  ) {
    const receipt = await super.continueReminderSelection(...args);
    if (this.crash) {
      this.crash = false;
      throw new AlephaError("Interrupted after committed reminder page");
    }
    return receipt;
  }
}
class AdoptionOutbox extends AutomationNotificationOutbox {
  public override async dispatch() {}
}

describe("Explicit policy adoption and legacy parity", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let persistence: AutomationPersistence;
  let service: AutomationService;
  let adoption: InterruptedAdoption;
  let rows: AdoptionRows;
  let time: DateTimeProvider;
  const finish = async (receiptId: string, token?: string) => {
    let input: { receiptId: string; token?: string } | undefined = {
      receiptId,
      token,
    };
    for (let count = 0; input && count < 150; count++)
      input = await alepha.inject(AutomationWorker).step(input, 3);
    if (input)
      throw new AlephaError(
        "Compatibility worker exceeded bounded continuation budget",
      );
  };
  const publish = async (tag = "1.0.0") => {
    const controller = alepha.inject(ReleaseController);
    const release = (
      await controller.createRelease.fetch(
        {
          params: { projectId: project.id },
          body: { tag, title: `Release ${tag}` },
        },
        { user },
      )
    ).data;
    await controller.publishRelease.fetch(
      { params: { id: release.id }, body: {} },
      { user },
    );
    return release;
  };
  const dispatch = async (id: string) => {
    await alepha.inject(AutomationEvents).sweep(50);
    for (const receipt of await persistence.receipts.findMany({
      where: { automationId: id, kind: "occurrence", status: "ready" },
    }))
      await finish(receipt.id);
  };
  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobProvider, use: AutomationLegacyJobProvider })
      .with({ provide: JobQueueProvider, use: AdoptionQueue })
      .with({
        provide: AutomationNotifications,
        use: AdoptionNotificationFault,
      })
      .with({ provide: AutomationClaims, use: AdoptionClaimFault })
      .with({ provide: AutomationAdoptionService, use: InterruptedAdoption })
      .with({ provide: AutomationNotificationOutbox, use: AdoptionOutbox })
      .with({
        provide: NotificationInboxRecipientProvider,
        use: LoreInboxRecipientProvider,
      })
      .with({
        provide: NotificationPreferenceProvider,
        use: LoreNotificationPreferences,
      })
      .with({ provide: EmailProvider, use: MemoryEmailProvider });
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    persistence = alepha.inject(AutomationPersistence);
    service = alepha.inject(AutomationService);
    adoption = alepha.inject(AutomationAdoptionService) as InterruptedAdoption;
    rows = alepha.inject(AdoptionRows);
    time = alepha.inject(DateTimeProvider);
    await alepha.start();
    time.pause();
    project = await createTestProject(alepha, {
      capabilities: [
        {
          key: "work",
          options: { automations: true, reminder: true, releases: true },
        },
      ],
    });
    await entities.users.updateById(project.createdBy, {
      roles: ["user"],
      email: `author-${project.id}@example.test`,
    });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("previews without writes and resumes a named pending adoption without a duplicate rule", async ({
    expect,
  }) => {
    const before = await persistence.rules.count({});
    const preview = await adoption.preview(project.id, "quest-reminders", user);
    expect(preview).toMatchObject({
      state: "legacy",
      ready: true,
      author: { id: user.id },
      channels: ["email"],
    });
    expect(await persistence.rules.count({})).toBe(before);
    expect(await persistence.adoptions.count({})).toBe(0);
    adoption.interrupt = true;
    await expect(
      adoption.adopt(project.id, "quest-reminders", user, { confirm: true }),
    ).rejects.toThrow("Interrupted");
    const pending = await adoption.preview(project.id, "quest-reminders", user);
    expect(pending.state).toBe("pending");
    expect(pending.candidate?.enabled).toBe(false);
    expect(
      await alepha
        .inject(AutomationLegacyQueue)
        .adopted(project.id, "quest-reminders"),
    ).toBe(false);
    const adopted = await adoption.adopt(project.id, "quest-reminders", user, {
      confirm: true,
    });
    expect(adopted.state).toBe("adopted");
    expect(adopted.replacementId).toBe(pending.replacementId);
    expect(adopted.candidate?.enabled).toBe(true);
    expect(await persistence.rules.count({})).toBe(before + 1);
    const repeated = await adoption.adopt(project.id, "quest-reminders", user, {
      confirm: true,
    });
    expect(repeated.candidate?.revision).toBe(adopted.candidate?.revision);
  });
  it("adopts an existing compatible rule and keeps disable/delete as permanent opt-out", async ({
    expect,
  }) => {
    const rule = await service.create(project.id, user, {
      title: "My release policy",
      rule: alepha
        .inject(AutomationAdoptionRegistry)
        .get("release-notifications")
        .build(),
    });
    await expect(
      service.setEnabled(project.id, rule.id, user, true, rule.revision),
    ).rejects.toThrow("explicit policy adoption");
    const adopted = await adoption.adopt(
      project.id,
      "release-notifications",
      user,
      { confirm: true, automationId: rule.id, expectedRevision: rule.revision },
    );
    expect(adopted.replacementId).toBe(rule.id);
    expect(await persistence.rules.count({})).toBe(1);
    const disabled = await service.setEnabled(
      project.id,
      rule.id,
      user,
      false,
      adopted.candidate!.revision,
    );
    expect(
      (
        await adoption.adopt(project.id, "release-notifications", user, {
          confirm: true,
        })
      ).state,
    ).toBe("opted_out");
    await service.remove(project.id, rule.id, user, disabled.revision);
    expect(
      (
        await adoption.adopt(project.id, "release-notifications", user, {
          confirm: true,
        })
      ).state,
    ).toBe("opted_out");
    expect(
      await alepha
        .inject(AutomationLegacyQueue)
        .adopted(project.id, "release-notifications"),
    ).toBe(true);
    const before = await rows.jobs.count({
      jobName: "system.notifications.send",
    });
    await publish();
    expect(
      await rows.jobs.count({ jobName: "system.notifications.send" }),
    ).toBe(before);
  });
  it("retires queued legacy release messages at dispatch after atomic cutover", async ({
    expect,
  }) => {
    const recipient = await entities.users.create({
      email: "recipient@example.test",
      roles: ["user"],
    });
    await createTestMember(alepha, project, recipient.id);
    await publish();
    const queued = await rows.jobs.findMany({
      where: { jobName: "system.notifications.send" },
    });
    expect(queued).toHaveLength(2);
    expect(
      await alepha
        .inject(AutomationLegacyDispatch)
        .allowed(queued[0].payload as any),
    ).toBe(true);
    await adoption.adopt(project.id, "release-notifications", user, {
      confirm: true,
    });
    for (const job of queued)
      await alepha.inject(JobProvider).processExecution(job.jobName, job.id);
    expect(await rows.inbox.count({})).toBe(0);
    expect(await rows.deliveries.count({ status: "skipped" })).toBe(2);
    expect(alepha.inject(MemoryEmailProvider).records).toHaveLength(0);
    expect(
      await alepha
        .inject(AutomationLegacyQueue)
        .adopted(project.id, "quest-reminders"),
    ).toBe(false);
  });
  it("notifies the full current roster except publisher with both channels and live preferences", async ({
    expect,
  }) => {
    for (let index = 0; index < 101; index++) {
      const member = await entities.users.create({
        email: `member-${index}@example.test`,
        roles: ["user"],
      });
      await createTestMember(alepha, project, member.id);
      if (index === 0)
        await rows.preferences.create({
          userId: member.id,
          emailEnabled: false,
          mutedCategories: [],
        });
    }
    const adopted = await adoption.adopt(
      project.id,
      "release-notifications",
      user,
      { confirm: true },
    );
    expect(adopted.recipientsHasMore).toBe(true);
    expect(adopted.recipients).toHaveLength(50);
    await publish();
    await dispatch(adopted.replacementId!);
    const occurrence = await persistence.receipts.getOne({
      where: { automationId: adopted.replacementId!, kind: "occurrence" },
    });
    expect(occurrence.status, occurrence.reason).toBe("committed");
    const jobs = await rows.jobs.findMany({
      where: { jobName: "system.notifications.send" },
      limit: 300,
    });
    expect(jobs).toHaveLength(202);
    expect(
      jobs.every(
        (job) => (job.payload as any).variables.recipientUserId !== user.id,
      ),
    ).toBe(true);
    const runs = await persistence.runs.findMany({
      where: { automationId: adopted.replacementId! },
    });
    expect(runs.every((run) => run.snapshot.counts.deliveries <= 100)).toBe(
      true,
    );
    expect(
      runs.filter((run) => run.snapshot.counts.deliveries > 0),
    ).toHaveLength(4);
    for (const job of jobs)
      await alepha.inject(JobProvider).processExecution(job.jobName, job.id);
    expect(await rows.inbox.count({})).toBe(101);
    expect(await rows.deliveries.count({ status: "sent" })).toBe(201);
    expect(await rows.deliveries.count({ status: "skipped" })).toBe(1);
    await dispatch(adopted.replacementId!);
    expect(
      await rows.jobs.count({ jobName: "system.notifications.send" }),
    ).toBe(202);
    // This joins 202 native enqueues and deliveries; the shared CI runner exceeded 30 seconds.
  }, 60_000);
  it("progresses beyond fifty due reminders without duplicating history or the interval", async ({
    expect,
  }) => {
    const due = time.now().subtract(1, "hour").toISOString();
    for (let index = 0; index < 51; index++)
      await createTestQuest(alepha, project, {
        acceptedBy: user.id,
        acceptedAt: time.now().subtract(2, "days").toISOString(),
        reminderInterval: "daily",
        reminderNextAt: due,
      });
    const preview = await adoption.preview(project.id, "quest-reminders", user);
    expect(preview.reminderCount).toBe(51);
    expect(preview.reminders).toHaveLength(50);
    const adopted = await adoption.adopt(project.id, "quest-reminders", user, {
      confirm: true,
    });
    const stored = await persistence.rules.getById(adopted.replacementId!);
    const evaluation = await alepha
      .inject(AutomationEvaluator)
      .evaluate({ rule: stored, evaluatedAt: time.nowISOString() });
    expect(evaluation.refusal).toBeUndefined();
    expect(evaluation.prepared!.snapshot.selectionNext).toBeDefined();
    const claim = await alepha.inject(AutomationClaims).claim({
      automationId: stored.id,
      revision: stored.revision,
      source: { kind: "schedule", scheduledAt: time.nowISOString() },
      prepared: evaluation.prepared!,
    });
    expect(claim.state).toBe("claimed");
    await finish(claim.receipt!.id, claim.receipt!.leaseToken);
    const quests = await entities.quests.findMany({
      where: { projectId: project.id },
      limit: 100,
    });
    expect(quests).toHaveLength(51);
    expect(
      (await persistence.receipts.getById(claim.receipt!.id)).status,
      (await persistence.receipts.getById(claim.receipt!.id)).reason,
    ).toBe("committed");
    expect(
      quests.every(
        (quest) =>
          quest.history.filter((event) => event.action === "reminder_sent")
            .length === 1,
      ),
    ).toBe(true);
    expect(
      quests.every(
        (quest) =>
          quest.reminderNextAt === time.now().add(1, "day").toISOString(),
      ),
    ).toBe(true);
    expect(
      await rows.jobs.count({ jobName: "system.notifications.send" }),
    ).toBe(51);
    await finish(claim.receipt!.id, claim.receipt!.leaseToken);
    expect(
      await rows.jobs.count({ jobName: "system.notifications.send" }),
    ).toBe(51);
  }, 30_000);
  it("refuses missing author grants without changing capabilities, ranks or legacy eligibility", async ({
    expect,
  }) => {
    const viewer = await entities.users.create({
      roles: ["user"],
      email: "viewer@example.test",
    });
    await createTestMember(alepha, project, viewer.id, { rank: "Viewer" });
    const ranks = await rows.ranks.findMany({});
    const caps = await entities.capabilities.findMany({});
    const actor = { id: viewer.id, roles: ["user"] };
    await expect(
      alepha.inject(AutomationController).adoptAutomationPolicy.fetch(
        {
          params: { projectId: project.id, policy: "release-notifications" },
          body: { confirm: true },
        },
        { user: actor },
      ),
    ).rejects.toThrow();
    expect(await rows.ranks.findMany({})).toEqual(ranks);
    expect(await entities.capabilities.findMany({})).toEqual(caps);
    expect(await persistence.adoptions.count({})).toBe(0);
    expect(await persistence.rules.count({})).toBe(0);
  });
  it("atomically rejects a legacy enqueue that loses the cutover race without advancing reminder state", async ({
    expect,
  }) => {
    const due = time.now().subtract(1, "hour").toISOString();
    const quest = await createTestQuest(alepha, project, {
      acceptedBy: user.id,
      acceptedAt: due,
      reminderInterval: "daily",
      reminderNextAt: due,
    });
    const context = await alepha
      .inject(AutomationContextBuilder)
      .source(project.id, "quests.remindersDue", {
        quest_id: quest.id,
        assignee_id: user.id,
        reminder_interval: "daily",
        reminder_next_at: due,
      });
    const settlement = alepha
      .inject(AutomationSelections)
      .settlement(
        "quests.remindersDue",
        project.id,
        context,
        time.nowISOString(),
      )!;
    const template = alepha.inject(QuestNotifications).questReminder;
    await alepha.inject(AutomationLegacyQueue).run(
      {
        projectId: project.id,
        policy: "quest-reminders",
        identity: `reminder:${quest.id}:${due}`,
        template: template.name,
        ...settlement,
      },
      async () => {
        await adoption.adopt(project.id, "quest-reminders", user, {
          confirm: true,
        });
        await template.push({
          contact: `author-${project.id}@example.test`,
          variables: {
            projectId: project.id,
            recipientName: "Author",
            projectTitle: project.title,
            questTitle: quest.title,
            shortId: quest.shortId,
            questUrl: `/${project.slug}/quests/${quest.shortId}`,
          },
        });
      },
    );
    expect(
      await rows.jobs.count({ jobName: "system.notifications.send" }),
    ).toBe(0);
    expect((await entities.quests.getById(quest.id)).reminderNextAt).toBe(due);
    expect((await entities.quests.getById(quest.id)).history).toEqual(
      quest.history,
    );
  });
  it("keeps legacy hourly reminders retry-safe and preserves queued old payload identification", async ({
    expect,
  }) => {
    const due = time.now().subtract(1, "hour").toISOString();
    const quest = await createTestQuest(alepha, project, {
      acceptedBy: user.id,
      acceptedAt: due,
      reminderInterval: "daily",
      reminderNextAt: due,
    });
    const jobs = alepha.inject(JobProvider);
    await jobs.trigger("quests.send-due-reminders");
    expect(
      await rows.jobs.count({ jobName: "system.notifications.send" }),
      JSON.stringify(await rows.jobs.findMany({})),
    ).toBe(1);
    const sent = await entities.quests.getById(quest.id);
    expect(
      sent.history.filter((entry) => entry.action === "reminder_sent"),
    ).toHaveLength(1);
    expect(sent.reminderNextAt).toBe(time.now().add(1, "day").toISOString());
    await jobs.trigger("quests.send-due-reminders");
    expect(
      await rows.jobs.count({ jobName: "system.notifications.send" }),
    ).toBe(1);
    const queued = await rows.jobs.getOne({
      where: { jobName: "system.notifications.send" },
    });
    const oldPayload = structuredClone(queued.payload) as any;
    delete oldPayload.variables.projectId;
    expect(
      await alepha.inject(AutomationLegacyDispatch).allowed(oldPayload),
    ).toBe(true);
    await adoption.adopt(project.id, "quest-reminders", user, {
      confirm: true,
    });
    expect(
      await alepha.inject(AutomationLegacyDispatch).allowed(oldPayload),
    ).toBe(false);
    await jobs.processExecution(queued.jobName, queued.id);
    expect(alepha.inject(MemoryEmailProvider).records).toHaveLength(0);
  });
  it("reconciles a committed cutover whose response was interrupted", async ({
    expect,
  }) => {
    adoption.afterCutover = true;
    await expect(
      adoption.adopt(project.id, "release-notifications", user, {
        confirm: true,
      }),
    ).rejects.toThrow("Interrupted after committed cutover");
    expect(
      await alepha
        .inject(AutomationLegacyQueue)
        .adopted(project.id, "release-notifications"),
    ).toBe(true);
    const before = await persistence.rules.getOne({
      where: { projectId: project.id },
    });
    const repeated = await adoption.adopt(
      project.id,
      "release-notifications",
      user,
      { confirm: true },
    );
    expect(repeated.candidate?.revision).toBe(before.revision);
    expect(await persistence.rules.count({})).toBe(1);
  });
  it("reconciles an enqueue committed before its roster acknowledgement", async ({
    expect,
  }) => {
    for (let index = 0; index < 2; index++) {
      const member = await entities.users.create({
        email: `crash-member-${index}@example.test`,
        roles: ["user"],
      });
      await createTestMember(alepha, project, member.id);
    }
    const adopted = await adoption.adopt(
      project.id,
      "release-notifications",
      user,
      { confirm: true },
    );
    await publish();
    await alepha.inject(AutomationEvents).sweep(50);
    const ready = await persistence.receipts.getOne({
      where: {
        automationId: adopted.replacementId!,
        kind: "occurrence",
        status: "ready",
      },
    });
    (
      alepha.inject(AutomationNotifications) as AdoptionNotificationFault
    ).crash = true;
    await expect(
      alepha.inject(AutomationWorker).step({ receiptId: ready.id }),
    ).rejects.toThrow("Interrupted after committed enqueue");
    const interrupted = await persistence.receipts.getById(ready.id);
    expect(
      await rows.jobs.count({ jobName: "system.notifications.send" }),
    ).toBe(1);
    await finish(ready.id, interrupted.leaseToken);
    expect((await persistence.receipts.getById(ready.id)).status).toBe(
      "committed",
    );
    expect(
      await rows.jobs.count({ jobName: "system.notifications.send" }),
    ).toBe(4);
    const runs = await persistence.runs.findMany({
      where: { automationId: adopted.replacementId! },
    });
    expect(
      runs.reduce((count, run) => count + run.snapshot.counts.deliveries, 0),
    ).toBe(4);
  });
  it("resumes the next reminder page after its native cursor witness committed", async ({
    expect,
  }) => {
    const due = time.now().subtract(1, "hour").toISOString();
    for (let index = 0; index < 51; index++)
      await createTestQuest(alepha, project, {
        acceptedBy: user.id,
        acceptedAt: due,
        reminderInterval: "daily",
        reminderNextAt: due,
      });
    const adopted = await adoption.adopt(project.id, "quest-reminders", user, {
      confirm: true,
    });
    const stored = await persistence.rules.getById(adopted.replacementId!);
    const evaluation = await alepha
      .inject(AutomationEvaluator)
      .evaluate({ rule: stored, evaluatedAt: time.nowISOString() });
    const claimed = await alepha.inject(AutomationClaims).claim({
      automationId: stored.id,
      revision: stored.revision,
      source: { kind: "schedule", scheduledAt: time.nowISOString() },
      prepared: evaluation.prepared!,
    });
    (alepha.inject(AutomationClaims) as AdoptionClaimFault).crash = true;
    let input: { receiptId: string; token?: string } | undefined = {
      receiptId: claimed.receipt!.id,
      token: claimed.receipt!.leaseToken,
    };
    let interrupted = false;
    for (let count = 0; input && count < 20; count++) {
      try {
        input = await alepha.inject(AutomationWorker).step(input);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("Interrupted after committed reminder page")
        )
          throw error;
        interrupted = true;
        break;
      }
    }
    expect(interrupted).toBe(true);
    expect(
      await rows.jobs.count({ jobName: "system.notifications.send" }),
    ).toBe(50);
    const receipt = await persistence.receipts.getById(claimed.receipt!.id);
    await finish(receipt.id, receipt.leaseToken);
    expect(
      await rows.jobs.count({ jobName: "system.notifications.send" }),
    ).toBe(51);
    const quests = await entities.quests.findMany({
      where: { projectId: project.id },
      limit: 100,
    });
    expect(
      quests.every(
        (quest) =>
          quest.history.filter((entry) => entry.action === "reminder_sent")
            .length === 1,
      ),
    ).toBe(true);
  }, 30_000);

  it("resumes explicit consent after the disabled pending rule was deleted", async ({
    expect,
  }) => {
    adoption.interrupt = true;
    await expect(
      adoption.adopt(project.id, "quest-reminders", user, { confirm: true }),
    ).rejects.toThrow("Interrupted");
    const pending = await adoption.preview(project.id, "quest-reminders", user);
    expect(pending.candidate?.canEnable).toBe(false);
    await service.remove(
      project.id,
      pending.replacementId!,
      user,
      pending.candidate!.revision,
    );
    expect(
      await alepha
        .inject(AutomationLegacyQueue)
        .adopted(project.id, "quest-reminders"),
    ).toBe(false);
    const resumed = await adoption.adopt(project.id, "quest-reminders", user, {
      confirm: true,
    });
    expect(resumed.state).toBe("adopted");
    expect(resumed.replacementId).not.toBe(pending.replacementId);
    expect(resumed.candidate?.canEnable).toBe(true);
    expect(await persistence.adoptions.count({})).toBe(1);
    expect(await persistence.rules.count({})).toBe(1);
  });
});
