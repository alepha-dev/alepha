import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AutomationAdoptionService,
  AutomationLegacyJobProvider,
  AutomationLegacyQueue,
  AutomationAtomic,
  AutomationService,
  AutomationVariableService,
  AutomationDomainActions,
  AutomationWorker,
  AutomationEvaluator,
  AutomationNotifications,
  AutomationNotificationOutbox,
  AutomationContextBuilder,
  LoreInboxRecipientProvider,
  AutomationSchedules,
  AutomationClaims,
  AutomationD1Provider,
  AutomationEvents,
  AutomationPersistence,
  AutomationRoster,
  AutomationRunEvidence,
} from "@lore/core/api";
import type { AutomationRule } from "@lore/core/schemas";
import { FolioController } from "@lore/knowledge/api";
import { FeedbackController } from "@lore/work/api";
import { Alepha, AlephaError } from "alepha";
import { JobProvider } from "alepha/api/jobs";
import { NotificationInboxRecipientProvider } from "alepha/api/notifications";
import { DateTimeProvider } from "alepha/datetime";
import { DatabaseProvider, sql, type D1Database } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import { afterEach, beforeAll, describe, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  TestEntityRepositories,
  createTestProject,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class FixtureD1Provider extends AutomationD1Provider {
  public schemaStatements: string[] = [];
  public override async migrate(): Promise<void> {
    for (let index = 0; index < this.schemaStatements.length; index += 50)
      await this.atomicBatch(this.schemaStatements.slice(index, index + 50));
  }
}

class UndispatchedNotificationOutbox extends AutomationNotificationOutbox {
  public override async dispatch(_id: string): Promise<void> {}
}

describe("Durable automation primitives on local D1", () => {
  let schemaStatements: string[];
  let directory: string | undefined;
  let proxy:
    | Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>
    | undefined;
  let alepha: Alepha | undefined;

  beforeAll(async () => {
    // Build the complete real model once, then apply that same SQLite DDL to
    // Wrangler's D1 binding. These tests exercise D1 batch, not a fake driver.
    const template = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "error" },
    });
    bootLore(template, ["api"]);
    template.inject(TestEntityRepositories);
    const provider = template.inject(DatabaseProvider);
    await template.start();
    try {
      const rows = await provider.execute(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
      );
      schemaStatements = rows.map((row) => String(row.sql));
    } finally {
      await template.stop();
    }
  });
  afterEach(async () => {
    try {
      await alepha?.stop();
    } finally {
      await proxy?.dispose();
      if (directory) await rm(directory, { recursive: true, force: true });
      alepha = undefined;
      proxy = undefined;
      directory = undefined;
    }
  });

  for (const mode of ["primary", "sessions"] as const) {
    it(`preserves atomic intents, claims, effects and full roster snapshots with ${mode} reads`, async ({
      expect,
    }) => {
      directory = await mkdtemp(join(tmpdir(), "lore-durable-d1-"));
      const path = join(directory, "wrangler.json");
      await writeFile(
        path,
        JSON.stringify({
          name: "lore-durable-d1-test",
          compatibility_date: "2026-01-01",
          d1_databases: [
            {
              binding: "DB",
              database_name: "automation-test",
              database_id: crypto.randomUUID(),
            },
          ],
        }),
      );
      proxy = await getPlatformProxy<{ DB: D1Database }>({
        configPath: path,
        persist: false,
        remoteBindings: false,
      });
      alepha = Alepha.create({
        env: {
          DATABASE_URL: "d1://DB",
          DATABASE_D1_MODE: mode,
          SERVER_PORT: 0,
          LOG_LEVEL: "error",
        },
      }).with({ provide: DatabaseProvider, use: FixtureD1Provider });
      alepha.set("cloudflare.env", proxy.env);
      alepha.with({ provide: CronProvider, use: ManualCronProvider });
      alepha.with({ provide: JobProvider, use: AutomationLegacyJobProvider });
      alepha.with({
        provide: NotificationInboxRecipientProvider,
        use: LoreInboxRecipientProvider,
      });
      alepha.with({
        provide: AutomationNotificationOutbox,
        use: UndispatchedNotificationOutbox,
      });
      bootLore(alepha, ["api"]);
      const provider = alepha.inject(DatabaseProvider) as FixtureD1Provider;
      provider.schemaStatements = schemaStatements;
      const entities = alepha.inject(TestEntityRepositories);
      const persistence = alepha.inject(AutomationPersistence);
      const events = alepha.inject(AutomationEvents);
      const claims = alepha.inject(AutomationClaims);
      const evidence = alepha.inject(AutomationRunEvidence);
      const atomic = alepha.inject(AutomationAtomic);
      const rosterService = alepha.inject(AutomationRoster);
      const notifications = alepha.inject(AutomationNotifications);
      const contexts = alepha.inject(AutomationContextBuilder);
      await alepha.start();
      const project = await createTestProject(alepha, {
        capabilities: [
          { key: "work", options: { automations: true } },
          { key: "support" },
          { key: "knowledge" },
        ],
      });
      await entities.users.updateById(project.createdBy, { roles: ["user"] });
      await provider.execute(
        "CREATE TABLE automation_d1_effects (id TEXT PRIMARY KEY NOT NULL, hits INTEGER NOT NULL)",
      );
      const submitted = await alepha
        .inject(FeedbackController)
        .submitFeedback.fetch(
          {
            params: { projectId: project.id },
            body: {
              title: "Native D1 feedback",
              description: "Source adapter proof",
            },
          },
          { user: { id: project.createdBy, roles: ["user"] } },
        );
      const captured = await persistence.events.getOne({
        where: { name: "feedback.created" },
      });
      expect(captured.payload.fields).toMatchObject({
        feedback_id: submitted.data.id,
        title: "Native D1 feedback",
      });
      const rule: AutomationRule = {
        version: 1,
        trigger: { kind: "event", event: "feedback.created" },
        select: null,
        guard: null,
        actions: [
          {
            kind: "notify",
            recipient: project.createdBy,
            channel: "inbox",
            title: "Source",
            text: "{{title}}",
            category: "automations",
          },
        ],
      };
      const created = await persistence.rules.create({
        projectId: project.id,
        authorUserId: project.createdBy,
        title: "D1 rule",
        rule,
      });
      const enabled = await persistence.rules.updateById(created.id, {
        enabled: true,
      });
      await expect(
        atomic.guarded(project.id, sql`FALSE`, [
          sql`INSERT INTO automation_d1_effects VALUES ('lost-claim', 1)`,
        ]),
      ).rejects.toThrow("Atomic automation batch failed");
      const source = await events.transition({
        projectId: project.id,
        identity: "d1-source",
        name: "feedback.created",
        fields: { title: "Safe", reporter_email: "private@example.test" },
        condition: sql`NOT EXISTS (SELECT 1 FROM automation_d1_effects WHERE id = 'source')`,
        mutation: sql`INSERT INTO automation_d1_effects VALUES ('source', 1) RETURNING id`,
        changedTables: ["automation_d1_effects"],
      });
      if (!source.event) throw new AlephaError("Expected a recorded event");
      expect(source.event.payload.fields).toEqual({ title: "Safe" });
      const prepared = await evidence.prepare({
        rule: enabled,
        occurrenceId: `event:${source.event.id}`,
        triggeredAt: source.event.occurredAt,
        inputs: source.event.payload.fields,
        selected: [source.event.payload.fields],
        matched: 1,
        planned: [{ index: 0 }],
      });
      const request = {
        automationId: enabled.id,
        revision: 0,
        source: { kind: "event" as const, eventId: source.event.id },
        prepared,
      };
      const reserved = await claims.reserve({
        automationId: enabled.id,
        revision: 0,
        source: { kind: "event", eventId: source.event.id },
      });
      expect(reserved.status).toBe("ready");
      const first = await claims.claim(request);
      expect(first.state).toBe("claimed");
      let occurrence = first.receipt!;
      expect((await claims.claim(request)).state).toBe("busy");
      await persistence.receipts.updateById(occurrence.id, {
        leaseUntil: alepha
          .inject(DateTimeProvider)
          .now()
          .subtract(3, "minutes")
          .toISOString(),
      });
      const oldToken = occurrence.leaseToken!;
      occurrence = (await claims.claim(request)).receipt!;
      const action = {
        kind: "notify" as const,
        recipient: project.createdBy,
        channel: "inbox",
        title: "Source",
        text: "Safe",
        category: "automations" as const,
      };
      await expect(
        claims.atomicEffect(occurrence.id, oldToken, {
          index: 0,
          action,
          statements: [
            sql`INSERT INTO automation_d1_effects VALUES ('old-worker', 1)`,
          ],
          result: { changed: true },
        }),
      ).rejects.toThrow("lease");
      const effect = {
        index: 0,
        action,
        statements: [
          sql`INSERT INTO automation_d1_effects VALUES ('effect', 1) ON CONFLICT (id) DO UPDATE SET hits = automation_d1_effects.hits + 1`,
        ],
        result: { changed: true },
      };
      await expect(
        claims.atomicEffect(occurrence.id, occurrence.leaseToken!, {
          ...effect,
          statements: [
            ...effect.statements,
            sql`INSERT INTO automation_d1_effects VALUES ('source', 99)`,
          ],
        }),
      ).rejects.toThrow("Atomic automation batch failed");
      expect(
        await provider.execute(
          "SELECT COUNT(*) AS n FROM automation_d1_effects WHERE id = 'effect'",
        ),
      ).toEqual([{ n: 0 }]);
      const committed = await claims.atomicEffect(
        occurrence.id,
        occurrence.leaseToken!,
        effect,
      );
      expect(
        (
          await claims.atomicEffect(
            occurrence.id,
            occurrence.leaseToken!,
            effect,
          )
        ).id,
      ).toBe(committed.id);
      expect(
        await provider.execute(
          "SELECT hits FROM automation_d1_effects WHERE id = 'effect'",
        ),
      ).toEqual([{ hits: 1 }]);
      // Freezing targets is independent of transport execution. A later member
      // is excluded from the already-frozen recipient/channel cross product.
      const schedule = await persistence.rules.create({
        projectId: project.id,
        authorUserId: project.createdBy,
        title: "D1 schedule",
        scheduleCron: "*/5 * * * *",
        rule: {
          ...rule,
          trigger: { kind: "schedule", cron: "*/5 * * * *" },
          select: { kind: "rows", key: "quests.open", filters: {} },
        },
      });
      await persistence.rules.updateById(schedule.id, {
        enabled: true,
        nextRunAt: alepha
          .inject(DateTimeProvider)
          .now()
          .subtract(1, "hour")
          .toISOString(),
      });
      expect(await alepha.inject(AutomationSchedules).sweep()).toBe(1);
      expect(await alepha.inject(AutomationSchedules).sweep()).toBe(0);
      expect(
        await persistence.receipts.getOne({
          where: { automationId: schedule.id, kind: "occurrence" },
        }),
      ).toMatchObject({ status: "ready", ruleRevision: 0 });
      expect(
        new Date(
          (await persistence.rules.getById(schedule.id)).nextRunAt!,
        ).getTime(),
      ).toBeGreaterThan(alepha.inject(DateTimeProvider).nowMillis());
      const member = await entities.users.create({ roles: ["user"] });
      await entities.organizationMembers.create({
        organizationId: project.organizationId!,
        userId: member.id,
        rank: "owner",
      });
      const roster = await rosterService.freeze(
        occurrence.id,
        occurrence.leaseToken!,
        {
          index: 0,
          channels: ["inbox", "email"],
          excludeUserId: project.createdBy,
        },
      );
      const late = await entities.users.create({ roles: ["user"] });
      await entities.organizationMembers.create({
        organizationId: project.organizationId!,
        userId: late.id,
        rank: "owner",
      });
      const page = await rosterService.page(roster.id, occurrence.leaseToken!);
      expect(page.total).toBe(2);
      expect(
        page.recipients.map((recipient) => recipient.recipientUserId),
      ).toEqual([member.id, member.id]);
      expect(
        new Set(page.recipients.map((recipient) => recipient.recipientChannel)),
      ).toEqual(new Set(["email", "inbox"]));
      // An outbox enqueue uses the same native D1 batch as its automation
      // receipt and trusted origin. Losing dispatch after commit leaves a
      // normal pending notification job, not another automation send.
      const notificationRule = await persistence.rules.create({
        projectId: project.id,
        authorUserId: project.createdBy,
        title: "D1 notify",
        rule,
      });
      const notifyEnabled = await persistence.rules.updateById(
        notificationRule.id,
        { enabled: true },
      );
      const notificationContext = await contexts.source(
        project.id,
        "feedback.created",
        captured.payload.fields,
      );
      const notificationEvidence = await evidence.prepare({
        rule: notifyEnabled,
        occurrenceId: `event:${captured.id}`,
        triggeredAt: captured.occurredAt,
        inputs: notificationContext.values,
        selected: [notificationContext.values],
        matched: 1,
        planned: [{ index: 0 }],
      });
      const notificationClaim = await claims.claim({
        automationId: notifyEnabled.id,
        revision: notifyEnabled.revision,
        source: { kind: "event", eventId: captured.id },
        prepared: notificationEvidence,
      });
      expect(notificationClaim.state).toBe("claimed");
      const notifyInput = {
        occurrenceId: notificationClaim.receipt!.id,
        token: notificationClaim.receipt!.leaseToken!,
        index: 0,
        context: notificationContext,
      };
      await expect(
        notifications.enqueue({
          ...notifyInput,
          settlement: {
            condition: sql`FALSE`,
            statements: [],
            changedTables: [],
          },
        }),
      ).rejects.toThrow("Atomic automation batch failed");
      expect(
        await persistence.receipts.count({
          automationId: notificationRule.id,
          kind: "job_origin",
        }),
      ).toBe(0);
      const enqueued = await notifications.enqueue(notifyInput);
      expect(enqueued.status).toBe("queued");
      const jobId = enqueued.receipt.result!.outbox_id;
      const [pendingJob] = await provider.execute(
        sql`SELECT status, max_attempts, payload FROM job_executions WHERE id = ${jobId}`,
      );
      expect(pendingJob).toMatchObject({ status: "pending", max_attempts: 4 });
      const payload =
        typeof pendingJob.payload === "string"
          ? JSON.parse(pendingJob.payload)
          : pendingJob.payload;
      expect(payload).toMatchObject({
        type: "inbox",
        lang: "en",
        variables: { automationId: notificationRule.id },
      });
      expect((await notifications.enqueue(notifyInput)).receipt.id).toBe(
        enqueued.receipt.id,
      );
      expect(
        await persistence.receipts.count({
          automationId: notificationRule.id,
          kind: "job_origin",
        }),
      ).toBe(1);
      await alepha
        .inject(JobProvider)
        .processExecution("system.notifications.send", String(jobId));
      expect(
        await alepha.inject(AutomationNotificationOutbox).status(String(jobId)),
      ).toMatchObject({ status: "delivered" });

      const domainAuthor = { id: project.createdBy, roles: ["user"] };
      const domainFolio = await alepha.inject(FolioController).create(
        {
          body: {
            projectId: project.id,
            title: "D1 append log",
            content: "D1 baseline",
          },
        },
        { user: domainAuthor },
      );
      const domainAst: AutomationRule = {
        version: 1,
        trigger: { kind: "schedule", cron: "*/5 * * * *" },
        select: { kind: "scalar", key: "activeQuests", filters: {} },
        guard: null,
        actions: [
          { kind: "appendFolio", folio: domainFolio.id, text: "D1 append" },
          {
            kind: "createQuest",
            title: "Native domain quest",
            description: "Bounded",
            area: "native-domain",
          },
        ],
      };
      const domainCreated = await persistence.rules.create({
        projectId: project.id,
        authorUserId: project.createdBy,
        title: "D1 domain effects",
        rule: domainAst,
      });
      const domainEnabled = await persistence.rules.updateById(
        domainCreated.id,
        { enabled: true },
      );
      const domainContext = await contexts.source(project.id, "activeQuests", {
        value: 1,
      });
      const domainAt = alepha.inject(DateTimeProvider).nowISOString();
      const domainEvidence = await evidence.prepare({
        rule: domainEnabled,
        occurrenceId: `schedule:${domainAt}`,
        triggeredAt: domainAt,
        inputs: domainContext.values,
        selected: [domainContext.values],
        matched: 1,
        planned: [{ index: 0 }, { index: 1 }],
      });
      const domainClaim = await claims.claim({
        automationId: domainEnabled.id,
        revision: domainEnabled.revision,
        source: { kind: "schedule", scheduledAt: domainAt },
        prepared: domainEvidence,
      });
      expect(domainClaim.state).toBe("claimed");
      const domainInput = {
        occurrenceId: domainClaim.receipt!.id,
        token: domainClaim.receipt!.leaseToken!,
        context: domainContext,
      };
      const domainActions = alepha.inject(AutomationDomainActions);
      const appended = await domainActions.execute({
        ...domainInput,
        index: 0,
      });
      expect(appended.result).toMatchObject({
        folio_id: domainFolio.id,
        revision: 1,
        changed: true,
        audit_recorded: true,
      });
      expect((await entities.folios.getById(domainFolio.id)).content).toBe(
        "D1 baseline\n\nD1 append",
      );
      expect(
        (await domainActions.execute({ ...domainInput, index: 0 })).id,
      ).toBe(appended.id);
      await claims.advance(domainInput.occurrenceId, domainInput.token, {
        index: 0,
        receiptId: appended.id,
      });
      const questCreated = await domainActions.execute({
        ...domainInput,
        index: 1,
      });
      expect(questCreated.result).toMatchObject({
        changed: true,
        audit_recorded: true,
      });
      const createdQuest = await entities.quests.getById(
        Number(questCreated.result!.quest_id),
      );
      expect(createdQuest).toMatchObject({
        title: "Native domain quest",
        createdBy: project.createdBy,
        area: "native-domain",
      });
      expect(
        (await domainActions.execute({ ...domainInput, index: 1 })).id,
      ).toBe(questCreated.id);
      const [nativeAuditCount] = await provider.execute(
        sql`SELECT COUNT(*) AS count FROM audits WHERE scope_type = 'project' AND scope_id = ${String(project.id)} AND json_extract(metadata, '$.automationId') = ${domainEnabled.id}`,
      );
      expect(Number(nativeAuditCount.count)).toBe(2);

      const workerAst: AutomationRule = {
        ...domainAst,
        actions: [
          {
            kind: "appendFolio",
            folio: domainFolio.id,
            text: "D1 worker append",
          },
          {
            kind: "createQuest",
            title: "D1 worker quest",
            description: "Bounded",
            area: "native-domain",
          },
        ],
      };
      const workerRule = await persistence.rules.create({
        projectId: project.id,
        authorUserId: project.createdBy,
        title: "D1 shared evaluator worker",
        rule: workerAst,
      });
      const countBeforePreview = await persistence.runs.count({
        projectId: project.id,
      });
      expect(
        (
          await alepha
            .inject(AutomationEvaluator)
            .test(workerRule.id, domainAuthor)
        ).status,
      ).toBe("preview");
      expect(await persistence.runs.count({ projectId: project.id })).toBe(
        countBeforePreview,
      );
      await persistence.rules.updateById(workerRule.id, { enabled: true });
      const workerReady = await claims.reserve({
        automationId: workerRule.id,
        revision: 0,
        source: { kind: "schedule", scheduledAt: domainAt },
      });
      await alepha
        .inject(AutomationWorker)
        .step({ receiptId: workerReady.id }, 3);
      expect((await persistence.receipts.getById(workerReady.id)).status).toBe(
        "committed",
      );
      expect((await entities.folios.getById(domainFolio.id)).content).toBe(
        "D1 baseline\n\nD1 append\n\nD1 worker append",
      );
      expect(
        (
          await persistence.runs.getOne({
            where: { automationId: workerRule.id },
          })
        ).snapshot.counts.executed,
      ).toBe(2);

      const application = alepha.inject(AutomationService);
      const variables = alepha.inject(AutomationVariableService);
      const shared = await variables.set(
        project.id,
        domainAuthor,
        "native_message",
        {
          value: { kind: "text", value: "Approved D1 value" },
        },
      );
      const approved = await application.create(project.id, domainAuthor, {
        title: "D1 native approval fence",
        rule: {
          ...workerAst,
          actions: [
            {
              kind: "appendFolio",
              folio: domainFolio.id,
              text: "{{native_message}}",
            },
          ],
        },
      });
      const activated = await application.setEnabled(
        project.id,
        approved.id,
        domainAuthor,
        true,
        0,
      );
      expect(
        (await persistence.rules.getById(approved.id)).approvedVariables,
      ).toEqual([
        { id: shared.variable.id, key: "native_message", version: 0 },
      ]);
      const approvedReady = await claims.reserve({
        automationId: approved.id,
        revision: activated.revision,
        source: {
          kind: "schedule",
          scheduledAt: alepha.inject(DateTimeProvider).nowISOString(),
        },
      });
      await alepha
        .inject(AutomationWorker)
        .step({ receiptId: approvedReady.id }, 3);
      expect(
        (await persistence.receipts.getById(approvedReady.id)).status,
      ).toBe("committed");
      expect((await entities.folios.getById(domainFolio.id)).content).toContain(
        "Approved D1 value",
      );
      await variables.set(project.id, domainAuthor, "native_message", {
        id: shared.variable.id,
        version: 0,
        value: { kind: "text", value: "New approved D1 value" },
      });
      expect(
        (await persistence.rules.getById(approved.id)).approvedVariables,
      ).toEqual([
        { id: shared.variable.id, key: "native_message", version: 1 },
      ]);

      const adoptionProject = await createTestProject(alepha, {
        capabilities: [
          {
            key: "work",
            options: { automations: true, reminder: true, releases: true },
          },
        ],
      });
      await entities.users.updateById(adoptionProject.createdBy, {
        roles: ["user"],
      });
      const adoptionAuthor = { id: adoptionProject.createdBy, roles: ["user"] };
      const adoption = alepha.inject(AutomationAdoptionService);
      const adopted = await adoption.adopt(
        adoptionProject.id,
        "quest-reminders",
        adoptionAuthor,
        { confirm: true },
      );
      expect(adopted.state).toBe("adopted");
      expect(adopted.candidate?.enabled).toBe(true);
      expect(
        await alepha
          .inject(AutomationLegacyQueue)
          .adopted(adoptionProject.id, "quest-reminders"),
      ).toBe(true);
      const disabled = await application.setEnabled(
        adoptionProject.id,
        adopted.replacementId!,
        adoptionAuthor,
        false,
        adopted.candidate!.revision,
      );
      expect(
        (
          await adoption.adopt(
            adoptionProject.id,
            "quest-reminders",
            adoptionAuthor,
            { confirm: true },
          )
        ).state,
      ).toBe("opted_out");
      await application.remove(
        adoptionProject.id,
        disabled.id,
        adoptionAuthor,
        disabled.revision,
      );
      expect(
        (
          await adoption.preview(
            adoptionProject.id,
            "quest-reminders",
            adoptionAuthor,
          )
        ).state,
      ).toBe("opted_out");
      expect(
        await persistence.adoptions.count({ projectId: adoptionProject.id }),
      ).toBe(1);

      await entities.organizationMembers.deleteMany({
        organizationId: project.organizationId!,
        userId: project.createdBy,
      });
      await expect(
        claims.lease(occurrence.id, occurrence.leaseToken!),
      ).rejects.toThrow("current member");
      expect(await persistence.rules.getById(enabled.id)).toMatchObject({
        health: "paused",
        requiresApproval: true,
      });
    }, 120_000);
  }
});
