import {
  AutomationCatalog,
  AutomationChannels,
  AutomationClaims,
  AutomationContextBuilder,
  AutomationNotifications,
  AutomationNotificationOutbox,
  AutomationOrigin,
  AutomationPersistence,
  AutomationRunEvidence,
  AutomationVariables,
  LoreInboxRecipientProvider,
  LoreNotificationPreferences,
  NotificationPreferenceController,
} from "@lore/core/api";
import {
  notificationPreferences,
  type AutomationRule,
} from "@lore/core/schemas";
import { $inject, Alepha, AlephaError } from "alepha";
import {
  JobQueueProvider,
  JobProvider,
  jobExecutionEntity,
} from "alepha/api/jobs";
import {
  notificationDeliveryEntity,
  notificationInboxEntity,
  NotificationInboxRecipientProvider,
  NotificationPreferenceProvider,
  NotificationSuppressionService,
} from "alepha/api/notifications";
import { RankService } from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { EmailProvider, MemoryEmailProvider } from "alepha/email";
import { $repository, sql } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import { currentUserAtom, type UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class PrimaryInboxRecipientProvider extends LoreInboxRecipientProvider {
  protected readonly alepha = $inject(Alepha);
  public primaryReads: boolean[] = [];
  public override async resolve(contact: string) {
    this.primaryReads.push(
      this.alepha.context.get("lore.automations.primary") === true,
    );
    return super.resolve(contact);
  }
}
class PausedNotificationDispatcher extends JobQueueProvider {
  public dispatched: string[] = [];
  public override async dispatch(_name: string, id: string) {
    this.dispatched.push(id);
  }
}
class RetryableEmailProvider extends MemoryEmailProvider {
  public failures = 0;
  public override async send(...args: Parameters<MemoryEmailProvider["send"]>) {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new AlephaError("Temporary transport refusal");
    }
    return super.send(...args);
  }
}
class SweepableJobProvider extends JobProvider {
  public sweepNow = this.sweep.bind(this);
}
class NotificationRows {
  jobs = $repository(jobExecutionEntity);
  inbox = $repository(notificationInboxEntity);
  deliveries = $repository(notificationDeliveryEntity);
  preferences = $repository(notificationPreferences);
}

describe("Automation configured notifications and durable outbox", () => {
  let alepha: Alepha;
  let persistence: AutomationPersistence;
  let entities: TestEntityRepositories;
  let rows: NotificationRows;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let time: DateTimeProvider;
  let notify: AutomationNotifications;
  let claims: AutomationClaims;
  let jobs: SweepableJobProvider;
  let mail: RetryableEmailProvider;
  const config = (
    channel = "inbox",
    category: "automations" | "releases" | "reminders" = "automations",
    recipient = project.createdBy,
  ): AutomationRule => ({
    version: 1,
    trigger:
      category === "releases"
        ? { kind: "event", event: "release.published" }
        : { kind: "schedule", cron: "*/5 * * * *" },
    select:
      category === "releases"
        ? null
        : {
            kind: category === "reminders" ? "rows" : "scalar",
            key:
              category === "reminders" ? "quests.remindersDue" : "activeQuests",
            filters: {},
          },
    guard: null,
    actions: [
      {
        kind: "notify",
        recipient,
        channel,
        title: "A <custom> & title",
        text: "<b>Keep & quotes</b>\nSecond line",
        category,
      },
    ],
  });
  const open = async (ast = config()) => {
    await alepha.inject(AutomationCatalog).validate(project.id, user, ast);
    const row = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Notify",
      rule: ast,
    });
    let rule = await persistence.rules.updateById(row.id, { enabled: true });
    const sourceKey =
      ast.trigger.kind === "event" ? ast.trigger.event : ast.select!.key;
    const context =
      ast.select?.kind === "collection"
        ? await alepha
            .inject(AutomationContextBuilder)
            .collection(project.id, ast.select!.key, {
              items: [],
              total: 0,
              totalIsExact: true,
            })
        : await alepha
            .inject(AutomationContextBuilder)
            .source(project.id, sourceKey, {
              value: 3,
              url: `/${project.slug}/quests`,
            });
    const at = time.now().subtract(1, "minute").toISOString();
    const variables = await alepha
      .inject(AutomationVariables)
      .snapshot(rule, user);
    if (variables.length)
      rule = await persistence.rules.updateById(rule.id, {
        approvedVariables: variables.map((value) => ({
          id: value.id!,
          key: value.key,
          version: value.version,
        })),
      });
    const prepared = await alepha.inject(AutomationRunEvidence).prepare({
      rule,
      occurrenceId: `schedule:${at}`,
      triggeredAt: at,
      inputs: context.values,
      selected: [context.values],
      variables,
      matched: 1,
      planned: ast.actions.map((_, index) => ({
        index,
        ...(ast.select?.kind === "rows" ? { row: 0 } : {}),
      })),
    });
    const event =
      ast.trigger.kind === "event"
        ? await persistence.events.create({
            projectId: project.id,
            name: ast.trigger.event,
            identity: crypto.randomUUID(),
            occurredAt: at,
            replayUntil: time.now().add(90, "days").toISOString(),
            payload: { fields: context.values, omitted: [] },
          })
        : undefined;
    const claimed = await claims.claim({
      automationId: rule.id,
      revision: rule.revision,
      source: event
        ? { kind: "event", eventId: event.id }
        : { kind: "schedule", scheduledAt: at },
      prepared,
    });
    if (claimed.state !== "claimed")
      throw new AlephaError(claimed.receipt?.reason ?? "No test claim");
    return { rule, context, variables, occurrence: claimed.receipt! };
  };
  const enqueue = (
    opened: Awaited<ReturnType<typeof open>>,
    index = 0,
    extra: Partial<Parameters<AutomationNotifications["enqueue"]>[0]> = {},
  ) =>
    notify.enqueue({
      occurrenceId: opened.occurrence.id,
      token: opened.occurrence.leaseToken!,
      index,
      ...(opened.rule.rule.select?.kind === "rows" ? { row: 0 } : {}),
      context: opened.context,
      ...extra,
    });
  const deliver = async (id: string) => {
    const row = await rows.jobs.getById(id);
    if (!jobs.getRegisteredJobs().has(row.jobName))
      throw new AlephaError("Notification job registration is missing");
    await jobs.processExecution(row.jobName, id);
    return alepha.inject(AutomationNotificationOutbox).status(id);
  };
  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    });
    alepha.with({ provide: CronProvider, use: ManualCronProvider });
    alepha.with({
      provide: JobQueueProvider,
      use: PausedNotificationDispatcher,
    });
    alepha.with({ provide: JobProvider, use: SweepableJobProvider });
    alepha.with({ provide: EmailProvider, use: RetryableEmailProvider });
    alepha.with({
      provide: NotificationInboxRecipientProvider,
      use: PrimaryInboxRecipientProvider,
    });
    alepha.with({
      provide: NotificationPreferenceProvider,
      use: LoreNotificationPreferences,
    });
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    persistence = alepha.inject(AutomationPersistence);
    rows = alepha.inject(NotificationRows);
    notify = alepha.inject(AutomationNotifications);
    claims = alepha.inject(AutomationClaims);
    jobs = alepha.inject(JobProvider) as SweepableJobProvider;
    mail = alepha.inject(EmailProvider) as RetryableEmailProvider;
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
      email: "Member@Example.test",
    });
    user = { id: project.createdBy, roles: ["user"] } as UserAccountToken;
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("enqueues one chosen channel atomically with its receipt, with English language and no false delivery claim", async ({
    expect,
  }) => {
    const opened = await open();
    const result = await alepha.context.run(() => {
      alepha.store.set("alepha.http.request", {
        headers: { cookie: "lang=fr" },
      } as never);
      return enqueue(opened);
    });
    expect(result.status).toBe("queued");
    expect(result.receipt.result).toMatchObject({
      enqueued: true,
      delivered: false,
    });
    const id = String(result.receipt.result!.outbox_id);
    expect(await rows.jobs.getById(id)).toMatchObject({
      jobName: "system.notifications.send",
      status: "pending",
      maxAttempts: 4,
      payload: {
        type: "inbox",
        contact: "member@example.test",
        lang: "en",
        category: "automations",
      },
    });
    expect(
      await persistence.receipts.getById(`job-origin:${id}`),
    ).toMatchObject({ kind: "job_origin", automationId: opened.rule.id });
    expect(
      await alepha.inject(AutomationNotificationOutbox).status(id),
    ).toEqual({ status: "queued" });
    expect(await rows.inbox.count()).toBe(0);
    expect(mail.records).toHaveLength(0);
    expect(await deliver(id)).toMatchObject({ status: "delivered" });
    expect(await rows.inbox.getOne({})).toMatchObject({
      userId: user.id,
      category: "automations",
      title: "A <custom> & title",
      body: "<b>Keep & quotes</b>\nSecond line",
      scope: `project:${project.id}`,
    });
    expect(alepha.inject(PrimaryInboxRecipientProvider).primaryReads).toEqual([
      true,
      true,
    ]);
    const repeated = await enqueue(opened);
    expect(repeated.receipt.id).toBe(result.receipt.id);
    expect(await rows.jobs.count()).toBe(1);
    expect(await rows.inbox.count()).toBe(1);
  });
  it("delivers email through the existing sender with one HTML escape and verbatim plain text", async ({
    expect,
  }) => {
    await persistence.variables.create({
      projectId: project.id,
      key: "message",
      value: {
        kind: "text",
        value: '<script>Keep & "quotes"</script> {{never_reparse}}',
      },
    });
    const ast = config("email");
    ast.actions[0] = {
      ...ast.actions[0],
      text: "{{message}}",
    } as (typeof ast.actions)[0];
    const opened = await open(ast);
    const result = await enqueue(opened);
    const id = String(result.receipt.result!.outbox_id);
    expect(await deliver(id)).toMatchObject({ status: "sent" });
    expect(mail.last).toMatchObject({
      to: "member@example.test",
      subject: "A <custom> & title",
      text: '<script>Keep & "quotes"</script> {{never_reparse}}',
    });
    expect(mail.last!.body).toContain(
      "&lt;script&gt;Keep &amp; &quot;quotes&quot;&lt;/script&gt; {{never_reparse}}",
    );
    expect(mail.last!.body).not.toContain("&amp;lt;");
    expect(await rows.inbox.count()).toBe(0);
  });
  it("keeps category preferences and the global email switch authoritative at send time", async ({
    expect,
  }) => {
    const first = await open(config("email"));
    const email = await enqueue(first);
    await rows.preferences.create({ userId: user.id, emailEnabled: false });
    expect(
      await deliver(String(email.receipt.result!.outbox_id)),
    ).toMatchObject({ status: "skipped", reason: "declined" });
    const inbox = await enqueue(await open());
    expect(
      await deliver(String(inbox.receipt.result!.outbox_id)),
    ).toMatchObject({ status: "delivered" });
    const preference = await rows.preferences.getOne({});
    await rows.preferences.updateById(preference.id, {
      emailEnabled: true,
      mutedCategories: ["automations", "releases", "tasks"],
    });
    for (const category of ["automations", "releases", "reminders"] as const)
      for (const channel of ["email", "inbox"]) {
        const result = await enqueue(await open(config(channel, category)));
        const id = String(result.receipt.result!.outbox_id);
        expect((await rows.jobs.getById(id)).payload!.category).toBe(
          category === "reminders" ? "tasks" : category,
        );
        expect(await deliver(id)).toMatchObject({
          status: "skipped",
          reason: "declined",
        });
      }
    expect(mail.records).toHaveLength(0);
  });
  it("honors suppressions added after enqueue on each channel", async ({
    expect,
  }) => {
    for (const channel of ["inbox", "email"]) {
      const result = await enqueue(await open(config(channel)));
      await alepha.inject(NotificationSuppressionService).suppress({
        contact: "member@example.test",
        channel,
        reason: "complained",
        source: "test",
      });
      expect(
        await deliver(String(result.receipt.result!.outbox_id)),
      ).toMatchObject({ status: "skipped", reason: "suppressed" });
    }
    expect(mail.records).toHaveLength(0);
    expect(await rows.inbox.count()).toBe(0);
  });
  it("resolves an inbox account without an email and still honors its category preferences", async ({
    expect,
  }) => {
    await entities.users.updateById(user.id, { email: null });
    const result = await enqueue(await open());
    expect(
      (await rows.jobs.getById(String(result.receipt.result!.outbox_id)))
        .payload!.contact,
    ).toBe(`lore-user:${user.id}`);
    expect(
      await deliver(String(result.receipt.result!.outbox_id)),
    ).toMatchObject({ status: "delivered" });
    await rows.preferences.create({
      userId: user.id,
      mutedCategories: ["automations"],
    });
    const muted = await enqueue(await open());
    expect(
      await deliver(String(muted.receipt.result!.outbox_id)),
    ).toMatchObject({ status: "skipped", reason: "declined" });
    const email = await enqueue(await open(config("email")));
    expect(email).toMatchObject({
      status: "skipped",
      receipt: { result: { skipped: true, reason: "recipient_has_no_email" } },
    });
    expect(await rows.jobs.count()).toBe(2);
  });
  it("refuses unauthorized recipients and skips deferred disclosure after a member is removed or their address changes", async ({
    expect,
  }) => {
    const recipient = await entities.users.create({
      roles: ["user"],
      email: "reader@example.test",
    });
    await createTestMember(alepha, project, recipient.id, { rank: "owner" });
    const opened = await open(config("email", "automations", recipient.id));
    const result = await enqueue(opened);
    await entities.organizationMembers.deleteMany({
      organizationId: project.organizationId!,
      userId: recipient.id,
    });
    expect(
      await deliver(String(result.receipt.result!.outbox_id)),
    ).toMatchObject({ status: "skipped", reason: "unavailable" });
    expect((await persistence.rules.getById(opened.rule.id)).health).toBe(
      "active",
    );
    const changed = await enqueue(await open(config("email")));
    await entities.users.updateById(user.id, { email: "new@example.test" });
    expect(
      await deliver(String(changed.receipt.result!.outbox_id)),
    ).toMatchObject({ status: "skipped", reason: "unavailable" });
    await alepha
      .inject(RankService)
      .save(
        project.organizationId!,
        { key: "limited", name: "Limited", permissions: ["project:read"] },
        user,
      );
    await createTestMember(alepha, project, recipient.id, { rank: "limited" });
    await expect(
      open(config("inbox", "automations", recipient.id)),
    ).rejects.toThrow("Recipient lacks source permission");
    expect(mail.records).toHaveLength(0);
  });
  it("prevents a deferred send after author disable and preserves normal notification retry policy", async ({
    expect,
  }) => {
    const opened = await open(config("email"));
    const result = await enqueue(opened);
    await persistence.rules.updateById(opened.rule.id, { enabled: false });
    expect(
      await deliver(String(result.receipt.result!.outbox_id)),
    ).toMatchObject({ status: "skipped", reason: "unavailable" });
    const retry = await enqueue(await open(config("email")));
    const id = String(retry.receipt.result!.outbox_id);
    mail.failures = 1;
    expect(await deliver(id)).toMatchObject({
      status: "queued",
      lastAttempt: "failed",
    });
    expect(await rows.jobs.getById(id)).toMatchObject({
      status: "scheduled",
      attempt: 1,
      maxAttempts: 4,
    });
    await time.travel([1, "hour"]);
    await jobs.sweepNow();
    expect(await deliver(id)).toMatchObject({ status: "sent" });
    expect(mail.records).toHaveLength(1);
    expect(await rows.deliveries.count({ executionId: id })).toBe(1);
  });
  it("rolls back enqueue, origin and receipt together, then resumes without a duplicate", async ({
    expect,
  }) => {
    const opened = await open();
    await expect(
      enqueue(opened, 0, {
        settlement: {
          condition: sql`FALSE`,
          statements: [],
          changedTables: [],
        },
      }),
    ).rejects.toThrow("Atomic automation batch failed");
    expect(await rows.jobs.count()).toBe(0);
    expect(await persistence.receipts.count({ kind: "job_origin" })).toBe(0);
    const result = await enqueue(opened);
    expect(await rows.jobs.count()).toBe(1);
    const id = String(result.receipt.result!.outbox_id);
    expect(
      await alepha
        .inject(AutomationOrigin)
        .forJob(id, () => alepha.inject(AutomationOrigin).current),
    ).toMatchObject({ automationId: opened.rule.id });
    expect(await deliver(id)).toMatchObject({ status: "delivered" });
  });
  it("suppresses empty collections and publisher exclusions without enqueue, and makes preview write nothing", async ({
    expect,
  }) => {
    const ast = config();
    ast.select = {
      kind: "collection",
      key: "quests.tagged",
      filters: { tag: "daily" },
    };
    const opened = await open(ast);
    const beforePreview = {
      rules: await persistence.rules.findMany({}),
      runs: await persistence.runs.findMany({}),
      receipts: await persistence.receipts.findMany({}),
    };
    const preview = await notify.prepare({
      rule: opened.rule,
      index: 0,
      action: ast.actions[0],
      context: opened.context,
      variables: [],
    });
    expect(preview).toMatchObject({
      skipped: true,
      reason: "empty_collection",
    });
    expect({
      rules: await persistence.rules.findMany({}),
      runs: await persistence.runs.findMany({}),
      receipts: await persistence.receipts.findMany({}),
    }).toEqual(beforePreview);
    expect(await enqueue(opened)).toMatchObject({
      status: "skipped",
      receipt: { result: { reason: "empty_collection" } },
    });
    const publisher = await enqueue(
      await open(config("inbox", "releases")),
      0,
      { excludeUserId: user.id },
    );
    expect(publisher).toMatchObject({
      status: "skipped",
      receipt: { result: { reason: "excluded_publisher" } },
    });
    expect(await rows.jobs.count()).toBe(0);
    expect(await rows.deliveries.count()).toBe(0);
  });
  it("offers only configured adapters and surfaces automations in the account's real preference list", async ({
    expect,
  }) => {
    const channels = alepha.inject(AutomationChannels);
    channels.register("discord", {
      addressable: false,
      target: "discord",
      configured: async () => false,
      templates: {
        automations: "absent",
        releases: "absent",
        reminders: "absent",
      },
    });
    expect((await channels.all(project.id)).map((entry) => entry.key)).toEqual([
      "inbox",
      "email",
    ]);
    expect(
      (await channels.all(project.id)).every((entry) => entry.available),
    ).toBe(true);
    const preferences = await alepha.context.run(() => {
      alepha.store.set(currentUserAtom, user);
      return alepha
        .inject(NotificationPreferenceController)
        .getMyNotificationPreferences({});
    });
    expect(preferences.categories).toContain("automations");
    expect(preferences.categories).toContain("releases");
    expect(preferences.categories).toContain("tasks");
    expect(preferences.categories).not.toContain("reminders");
  });
  it("reserves the final HTML wrapper bytes and shortens a collection by whole rows", async ({
    expect,
  }) => {
    const ast = config("email");
    ast.select = {
      kind: "collection",
      key: "quests.tagged",
      filters: { tag: "daily" },
    };
    ast.actions[0] = {
      ...ast.actions[0],
      text: "{{summary}}",
    } as (typeof ast.actions)[0];
    const opened = await open(ast);
    const context = await alepha.inject(AutomationContextBuilder).collection(
      project.id,
      "quests.tagged",
      {
        items: Array.from({ length: 50 }, (_, index) => ({
          shortId: index + 1,
          title: "🐱".repeat(100),
        })),
        total: 50,
        totalIsExact: true,
      },
      { tag: "daily" },
    );
    const prepared = await notify.prepare({
      rule: opened.rule,
      index: 0,
      action: ast.actions[0],
      context,
      variables: [],
    });
    expect(prepared.skipped).toBe(false);
    if (prepared.skipped) return;
    expect(prepared.rendered.truncated).toBe(true);
    expect(prepared.rendered.shown).toBeLessThan(50);
    expect(
      new TextEncoder().encode(JSON.stringify(prepared.rendered.action))
        .byteLength +
        new TextEncoder().encode('<div style="white-space: pre-wrap"></div>')
          .byteLength,
    ).toBeLessThanOrEqual(16_384);
    expect(prepared.payload.variables.html).toContain("selected quests shown.");
  });
  it("caps run fan-out at 100 delivery intents without creating a hidden 101st job", async ({
    expect,
  }) => {
    const opened = await open();
    for (let index = 0; index < 100; index += 1)
      await enqueue(opened, 0, {
        delivery: {
          recipient: user.id,
          channel: "inbox",
          key: `recipient:${index}`,
        },
      });
    await expect(
      enqueue(opened, 0, {
        delivery: { recipient: user.id, channel: "inbox", key: "overflow" },
      }),
    ).rejects.toThrow("delivery budget");
    expect(await rows.jobs.count()).toBe(100);
  }, 30_000);
});
