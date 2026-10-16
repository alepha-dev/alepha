import {
  AutomationLegacyJobProvider,
  LoreInboxRecipientProvider,
  LoreNotificationPreferences,
  AutomationEvents,
  AutomationClaims,
  AutomationRunEvidence,
  AutomationWorker,
  AutomationNotificationOutbox,
  AutomationPersistence,
  AutomationService,
} from "@lore/core/api";
import type { AutomationResource, AutomationRule } from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { ReleaseController } from "@lore/work/api";
import { Alepha, AlephaError } from "alepha";
import { audits } from "alepha/api/audits";
import {
  JobProvider,
  JobQueueProvider,
  jobExecutionEntity,
} from "alepha/api/jobs";
import { ApiKeyService } from "alepha/api/keys";
import {
  NotificationInboxRecipientProvider,
  NotificationPreferenceProvider,
  notificationDeliveryEntity,
  notificationInboxEntity,
} from "alepha/api/notifications";
import { DateTimeProvider } from "alepha/datetime";
import { EmailProvider, MemoryEmailProvider } from "alepha/email";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import { NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestFolio,
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class McpPausedQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class McpOutcomeReader extends AutomationNotificationOutbox {
  public reads: string[][] = [];
  public override async statuses(ids: string[]) {
    if (ids.length) this.reads.push(ids);
    return super.statuses(ids);
  }
}
class McpCrashAfterAdvance extends AutomationClaims {
  public crash = false;
  public override async advance(
    ...args: Parameters<AutomationClaims["advance"]>
  ) {
    const next = await super.advance(...args);
    if (this.crash && args[2].index === 0) {
      this.crash = false;
      throw new AlephaError("Exit after committed append cursor");
    }
    return next;
  }
}
class McpEvidenceRows {
  public readonly jobs = $repository(jobExecutionEntity);
  public readonly audits = $repository(audits);
  public readonly deliveries = $repository(notificationDeliveryEntity);
  public readonly inbox = $repository(notificationInboxEntity);
}

interface McpReply {
  result?: {
    structuredContent?: Record<string, any>;
    isError?: boolean;
    content?: Array<{ text?: string }>;
    tools?: Array<{ name: string }>;
  };
  error?: { message: string };
}

describe("Automation MCP transport uses shared application policy", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;
  let persistence: AutomationPersistence;
  let rows: McpEvidenceRows;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: { id: string; roles: string[] };
  let token: string;
  let url: string;
  const request = async (
    method: string,
    params: Record<string, unknown>,
    credential = token,
  ): Promise<McpReply> => {
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credential}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return response.json();
  };
  const call = (
    name: string,
    args: Record<string, unknown> = {},
    credential = token,
  ) =>
    request(
      "tools/call",
      { name, arguments: { project: project.id, ...args } },
      credential,
    );
  const value = (reply: McpReply) => {
    if (reply.error || reply.result?.isError)
      throw new AlephaError(
        reply.error?.message ??
          reply.result?.content?.[0]?.text ??
          "MCP tool refused",
      );
    return reply.result?.structuredContent ?? {};
  };
  const failed = (reply: McpReply) =>
    reply.error?.message ??
    (reply.result?.isError ? reply.result.content?.[0]?.text : undefined);
  const rule = (): AutomationRule => ({
    version: 1,
    trigger: { kind: "event", event: "quest.completed" },
    select: null,
    guard: null,
    actions: [
      {
        kind: "notify",
        recipient: user.id,
        channel: "inbox",
        title: "Quest",
        text: "{{title}}",
        category: "automations",
      },
    ],
  });
  const create = async (ast = rule(), extra: Record<string, unknown> = {}) =>
    value(
      await call("automation_create", {
        title: "MCP rule",
        rule: ast,
        ...extra,
      }),
    ) as AutomationResource;
  const key = async (userId = user.id, permissions?: string[]) =>
    (
      await alepha.inject(ApiKeyService).create({
        userId,
        name: `Automation MCP ${crypto.randomUUID()}`,
        roles: ["user"],
        ...(permissions ? { permissions } : {}),
      })
    ).token;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: JobProvider, use: AutomationLegacyJobProvider })
      .with({ provide: AutomationClaims, use: McpCrashAfterAdvance })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: McpPausedQueue })
      .with({
        provide: NotificationInboxRecipientProvider,
        use: LoreInboxRecipientProvider,
      })
      .with({
        provide: NotificationPreferenceProvider,
        use: LoreNotificationPreferences,
      })
      .with({ provide: EmailProvider, use: MemoryEmailProvider })
      .with({ provide: AutomationNotificationOutbox, use: McpOutcomeReader });
    bootLore(alepha, ["api", "mcp"]);
    entities = alepha.inject(TestEntityRepositories);
    rows = alepha.inject(McpEvidenceRows);
    persistence = alepha.inject(AutomationPersistence);
    await alepha.start();
    alepha.inject(DateTimeProvider).pause();
    url = alepha.inject(NodeHttpServerProvider).hostname;
    project = await createTestProject(alepha, {
      title: "MCP Automations",
      capabilities: [
        { key: "work", options: { automations: true, releases: true } },
        { key: "knowledge" },
      ],
    });
    await entities.users.updateById(project.createdBy, {
      roles: ["user"],
      email: "owner@example.test",
      emailVerified: true,
    });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
    token = await key();
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("discovers, creates, previews and enables a release append and notification using typed bindings", async ({
    expect,
  }) => {
    const tools = await request("tools/list", {});
    expect(tools.result?.tools?.map((it) => it.name)).toContain(
      "automation_create",
    );
    const catalogue = value(
      await call("automation_catalog", {
        project: undefined,
        project_name: "mcp-automations",
      }),
    );
    expect(catalogue.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "release.published", available: true }),
        expect.objectContaining({ key: "appendFolio", available: true }),
      ]),
    );
    const folio = await createTestFolio(alepha, project);
    const recipient = value(
      await call("automation_variable_set", {
        key: "recipient",
        variable: { value: { kind: "member", value: user.id } },
      }),
    );
    expect(recipient.variable.value).toEqual({
      kind: "member",
      value: user.id,
    });
    const ast: AutomationRule = {
      version: 1,
      trigger: { kind: "event", event: "release.published" },
      select: null,
      guard: null,
      actions: [
        {
          kind: "appendFolio",
          folio: folio.id,
          text: "## {{release_tag}}\n{{changelog}}",
        },
        {
          kind: "notify",
          recipient: "{{recipient}}",
          channel: "inbox",
          title: "Release {{release_tag}}",
          text: "{{title}}: {{url}}",
          category: "releases",
        },
      ],
    };
    const made = await create(ast);
    expect(made).toMatchObject({
      enabled: false,
      authorUserId: user.id,
      revision: 0,
      rule: ast,
    });
    expect(made).not.toHaveProperty("authorKeyId");
    const release = (
      await alepha.inject(ReleaseController).createRelease.fetch(
        {
          params: { projectId: project.id },
          body: { tag: "1.2.3", title: "MCP publication" },
        },
        { user },
      )
    ).data;
    const before = JSON.stringify(await persistence.rules.findMany());
    const preview = value(
      await call("automation_test", {
        id: made.id,
        source: { kind: "subject", id: release.id },
      }),
    );
    expect(preview).toMatchObject({
      preview: true,
      status: "preview",
      operations: [
        expect.objectContaining({ index: 0 }),
        expect.objectContaining({ index: 1 }),
      ],
    });
    expect(JSON.stringify(await persistence.rules.findMany())).toBe(before);
    expect(await persistence.runs.findMany()).toHaveLength(0);
    const armed = value(
      await call("automation_update", {
        id: made.id,
        expectedRevision: 0,
        enabled: true,
      }),
    );
    expect(armed).toMatchObject({ enabled: true, revision: 1 });
    expect(value(await call("automation_get", { id: made.id }))).toMatchObject({
      enabled: true,
      rule: ast,
    });
    const page = value(
      await call("automation_list", { limit: 1, search: "MCP" }),
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe(made.id);
    expect((await persistence.rules.getById(made.id)).authorKeyId).toBeTruthy();
  });

  it("fences revisions, refuses spoofed identity and restricts managers to stopping foreign rules", async ({
    expect,
  }) => {
    const made = await create();
    expect(
      failed(
        await call("automation_create", {
          title: "Spoofed",
          rule: rule(),
          authorUserId: user.id,
        }),
      ),
    ).toBeTruthy();
    const changed = value(
      await call("automation_update", {
        id: made.id,
        expectedRevision: 0,
        title: "Changed",
        rule: rule(),
      }),
    );
    expect(changed.revision).toBe(1);
    expect(
      failed(
        await call("automation_update", {
          id: made.id,
          expectedRevision: 0,
          enabled: true,
        }),
      ),
    ).toMatch(/revision|changed/i);
    const member = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, member.id, { rank: "admin" });
    const manager = await key(member.id);
    expect(
      failed(
        await call(
          "automation_update",
          { id: made.id, expectedRevision: 1, title: "Foreign", rule: rule() },
          manager,
        ),
      ),
    ).toBeTruthy();
    expect(
      failed(
        await call(
          "automation_update",
          { id: made.id, expectedRevision: 1, enabled: true },
          manager,
        ),
      ),
    ).toBeTruthy();
    const armed = value(
      await call("automation_update", {
        id: made.id,
        expectedRevision: 1,
        enabled: true,
      }),
    );
    const stopped = value(
      await call(
        "automation_update",
        { id: made.id, expectedRevision: armed.revision, enabled: false },
        manager,
      ),
    );
    expect(stopped.enabled).toBe(false);
    expect(
      value(
        await call(
          "automation_delete",
          { id: made.id, expectedRevision: stopped.revision },
          manager,
        ),
      ),
    ).toEqual({ ok: true });
  });

  it("reports variable consumers and requires matching identity and version for changes and unused deletion", async ({
    expect,
  }) => {
    const variable = value(
      await call("automation_variable_set", {
        key: "recipient",
        variable: { value: { kind: "member", value: user.id } },
      }),
    ).variable;
    const ast = rule();
    if (ast.actions[0].kind === "notify")
      ast.actions[0].recipient = "{{recipient}}";
    const made = await create(ast);
    const usage = value(
      await call("automation_variable_dependents", {
        key: "recipient",
        limit: 1,
      }),
    );
    expect(usage.items[0].id).toBe(made.id);
    expect(
      failed(
        await call("automation_variable_set", {
          key: "recipient",
          variable: { value: variable.value },
        }),
      ),
    ).toMatch(/identity|version/i);
    expect(
      failed(
        await call("automation_variable_delete", {
          key: "recipient",
          id: variable.id,
          version: variable.version,
        }),
      ),
    ).toMatch(/used|referenc|consumer/i);
    expect(
      value(await call("automation_variable_list", { limit: 1 })).items[0],
    ).toMatchObject(variable);
    value(
      await call("automation_delete", { id: made.id, expectedRevision: 0 }),
    );
    expect(
      value(
        await call("automation_variable_delete", {
          key: "recipient",
          id: variable.id,
          version: variable.version,
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects invalid slots, foreign targets and scoped keys without the source grant", async ({
    expect,
  }) => {
    const invalid = rule();
    invalid.trigger = { kind: "schedule", cron: "0 0 * * *" };
    invalid.select = {
      kind: "rows",
      key: "unknown",
      filters: {},
    } as AutomationRule["select"];
    expect(
      failed(
        await call("automation_create", { title: "Invalid", rule: invalid }),
      ),
    ).toMatch(/select|unknown|key/i);
    const foreignProject = await createTestProject(alepha);
    const foreign = await createTestFolio(alepha, foreignProject);
    const ast = rule();
    ast.actions = [{ kind: "appendFolio", folio: foreign.id, text: "No" }];
    expect(
      failed(await call("automation_create", { title: "Foreign", rule: ast })),
    ).toMatch(/folio|project|found/i);
    const scoped = await key(user.id, [
      "project:read",
      "automation:read",
      "automation:write",
      "member:read",
    ]);
    expect(
      failed(
        await call(
          "automation_create",
          { title: "No source", rule: rule() },
          scoped,
        ),
      ),
    ).toMatch(/quest:read|permission|grant/i);
    const made = await create(rule(), { enabled: true });
    expect(made.enabled).toBe(true);
    await alepha
      .inject(AutomationService)
      .setEnabled(project.id, made.id, user, false, made.revision);
  });
  it("joins MCP authority, competing workers, a committed-cursor crash, receipt delivery and detail pruning", async ({
    expect,
  }) => {
    const folio = await createTestFolio(alepha, project);
    const ast: AutomationRule = {
      version: 1,
      trigger: { kind: "event", event: "release.published" },
      select: null,
      guard: null,
      actions: [
        {
          kind: "appendFolio",
          folio: folio.id,
          text: "Final join {{release_tag}}",
        },
        {
          kind: "notify",
          recipient: user.id,
          channel: "inbox",
          title: "Final publication",
          text: "{{release_tag}}",
          category: "releases",
        },
      ],
    };
    const made = await create(ast, { enabled: true });
    const release = (
      await alepha.inject(ReleaseController).createRelease.fetch(
        {
          params: { projectId: project.id },
          body: { tag: "9.4.5", title: "Final integration" },
        },
        { user },
      )
    ).data;
    const before = JSON.stringify(
      await Promise.all([
        persistence.rules.findMany(),
        persistence.runs.findMany(),
        persistence.receipts.findMany(),
        entities.folios.findMany(),
        rows.audits.findMany(),
        rows.jobs.findMany(),
        rows.inbox.findMany(),
        rows.deliveries.findMany(),
      ]),
    );
    const preview = value(
      await call("automation_test", {
        id: made.id,
        source: { kind: "subject", id: release.id },
      }),
    );
    expect(preview.operations).toHaveLength(2);
    expect(
      JSON.stringify(
        await Promise.all([
          persistence.rules.findMany(),
          persistence.runs.findMany(),
          persistence.receipts.findMany(),
          entities.folios.findMany(),
          rows.audits.findMany(),
          rows.jobs.findMany(),
          rows.inbox.findMany(),
          rows.deliveries.findMany(),
        ]),
      ),
    ).toBe(before);
    await alepha.inject(DateTimeProvider).travel([1, "second"]);
    await alepha
      .inject(ReleaseController)
      .publishRelease.fetch({ params: { id: release.id }, body: {} }, { user });
    await Promise.all([
      alepha.inject(AutomationEvents).sweep(50),
      alepha.inject(AutomationEvents).sweep(50),
    ]);
    const occurrence = await persistence.receipts.getOne({
      where: { automationId: made.id, kind: "occurrence" },
    });
    expect(
      await persistence.receipts.count({
        automationId: made.id,
        kind: "occurrence",
      }),
    ).toBe(1);
    alepha.inject(McpCrashAfterAdvance).crash = true;
    const competing = await Promise.allSettled([
      alepha.inject(AutomationWorker).step({ receiptId: occurrence.id }),
      alepha.inject(AutomationWorker).step({ receiptId: occurrence.id }),
    ]);
    expect(
      competing.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    const interrupted = await persistence.receipts.getById(occurrence.id);
    expect(interrupted.cursor).toBe(1);
    expect(
      (await entities.folios.getById(folio.id)).content?.split(
        "Final join 9.4.5",
      ),
    ).toHaveLength(2);
    let next: { receiptId: string; token?: string } | undefined = {
      receiptId: occurrence.id,
      token: interrupted.leaseToken!,
    };
    for (let step = 0; next && step < 20; step++)
      next = await alepha.inject(AutomationWorker).step(next, 3);
    expect(next).toBeUndefined();
    expect(
      (await entities.folios.getById(folio.id)).content?.split(
        "Final join 9.4.5",
      ),
    ).toHaveLength(2);
    expect(
      await persistence.receipts.count({
        automationId: made.id,
        kind: "action",
        status: "committed",
      }),
    ).toBe(2);
    const evidence = value(
      await call("automation_runs", { id: made.id, limit: 50 }),
    ).items.find(
      (run: { occurrenceId: string }) =>
        run.occurrenceId === occurrence.occurrenceId,
    );
    expect(
      evidence.snapshot.actions.map(
        (action: { status: string }) => action.status,
      ),
    ).toEqual(["succeeded", "queued"]);
    const outbox = evidence.notifications[0].outboxId;
    const job = await rows.jobs.getById(outbox);
    await alepha.inject(JobProvider).processExecution(job.jobName, outbox);
    expect(
      value(await call("automation_runs", { id: made.id })).items.find(
        (run: { id: string }) => run.id === evidence.id,
      ).notifications[0].status,
    ).toBe("delivered");
    const old = alepha
      .inject(DateTimeProvider)
      .now()
      .subtract(31, "days")
      .toISOString();
    await persistence.runs.updateById(evidence.id, { finishedAt: old });
    expect(await alepha.inject(AutomationRunEvidence).prune()).toBe(1);
    const jobsBefore = await rows.jobs.count({
      jobName: "system.notifications.send",
    });
    await alepha.inject(AutomationEvents).sweep(50);
    await alepha
      .inject(AutomationWorker)
      .step({ receiptId: occurrence.id, token: interrupted.leaseToken! });
    expect(
      await rows.jobs.count({ jobName: "system.notifications.send" }),
    ).toBe(jobsBefore);
    expect(
      await persistence.receipts.count({
        automationId: made.id,
        kind: "action",
        status: "committed",
      }),
    ).toBe(2);
    expect(
      (await entities.folios.getById(folio.id)).content?.split(
        "Final join 9.4.5",
      ),
    ).toHaveLength(2);
    const expiredPreview = value(
      await call("automation_test", {
        id: made.id,
        source: { kind: "run", id: evidence.id },
      }),
    );
    expect(expiredPreview.status).toBe("refused");
    expect(expiredPreview.reason).toMatch(
      /retained|expired|not found|unavailable/i,
    );
  });

  for (const channel of ["inbox", "email"] as const)
    it(`paginates immutable runs and joins live ${channel} receipts without changing the enqueue snapshot`, async ({
      expect,
    }) => {
      const ast = rule();
      if (ast.actions[0].kind === "notify") ast.actions[0].channel = channel;
      ast.trigger = { kind: "event", event: "release.published" };
      const made = await create(ast, { enabled: true });
      for (const tag of ["2.0.0", "2.1.0"]) {
        await alepha.inject(DateTimeProvider).travel([1, "second"]);
        const release = (
          await alepha.inject(ReleaseController).createRelease.fetch(
            {
              params: { projectId: project.id },
              body: { tag, title: `Release ${tag}` },
            },
            { user },
          )
        ).data;
        await alepha
          .inject(ReleaseController)
          .publishRelease.fetch(
            { params: { id: release.id }, body: {} },
            { user },
          );
        await alepha.inject(AutomationEvents).sweep(50);
        const ready = await persistence.receipts.findMany({
          where: { automationId: made.id, kind: "occurrence", status: "ready" },
        });
        for (const occurrence of ready) {
          let next: { receiptId: string; token?: string } | undefined = {
            receiptId: occurrence.id,
          };
          for (let step = 0; next && step < 20; step++)
            next = await alepha.inject(AutomationWorker).step(next, 3);
          expect(next).toBeUndefined();
        }
      }
      const first = value(
        await call("automation_runs", { id: made.id, limit: 1 }),
      );
      expect(first).toMatchObject({ hasMore: true, nextOffset: 1 });
      expect(first.items[0].snapshot.actions[0]).toMatchObject({
        status: "queued",
        result: { enqueued: true, delivered: false },
      });
      expect(first.items[0].notifications[0]).toMatchObject({
        index: 0,
        status: "queued",
      });
      const second = value(
        await call("automation_runs", {
          id: made.id,
          limit: 1,
          offset: first.nextOffset,
        }),
      );
      const total = (
        await persistence.runs.findMany({ where: { automationId: made.id } })
      ).length;
      expect(second.hasMore).toBe(total > 2);
      expect(
        value(
          await call("automation_runs", {
            id: made.id,
            limit: 1,
            offset: total - 1,
          }),
        ).hasMore,
      ).toBe(false);
      expect(second.items[0].id).not.toBe(first.items[0].id);
      const outboxId = first.items[0].notifications[0].outboxId;
      const execution = await rows.jobs.getById(outboxId);
      await alepha
        .inject(JobProvider)
        .processExecution(execution.jobName, outboxId);
      const delivered = value(
        await call("automation_runs", { id: made.id, limit: 1 }),
      );
      expect(delivered.items[0].notifications[0].reason).toBeUndefined();
      expect(delivered.items[0].notifications[0]).toMatchObject({
        outboxId,
        status: channel === "inbox" ? "delivered" : "sent",
        receiptId: expect.any(String),
      });
      expect(delivered.items[0].snapshot).toEqual(first.items[0].snapshot);
      const reader = alepha.inject(McpOutcomeReader);
      reader.reads = [];
      const scoped = await key(user.id, ["project:read", "automation:read"]);
      const redacted = value(
        await call("automation_runs", { id: made.id }, scoped),
      );
      expect(redacted.items[0]).toMatchObject({
        redacted: true,
        snapshot: null,
        notifications: [],
      });
      expect(reader.reads).toHaveLength(0);
      const foreign = await createTestProject(alepha);
      expect(
        failed(
          await call("automation_runs", { project: foreign.id, id: made.id }),
        ),
      ).toBeTruthy();
    });

  it("keeps successful and refused typed previews free of automation, domain, audit and notification writes", async ({
    expect,
  }) => {
    const made = await create();
    const quest = await createTestQuest(alepha, project, {
      title: "Preview source",
    });
    const state = async () =>
      JSON.stringify(
        await Promise.all([
          persistence.rules.findMany(),
          persistence.variables.findMany(),
          persistence.events.findMany(),
          persistence.receipts.findMany(),
          persistence.runs.findMany(),
          rows.audits.findMany(),
          rows.jobs.findMany(),
          rows.deliveries.findMany(),
          rows.inbox.findMany(),
          entities.quests.findMany(),
          entities.folios.findMany(),
        ]),
      );
    const before = await state();
    const preview = value(
      await call("automation_test", {
        id: made.id,
        source: { kind: "subject", id: quest.id },
      }),
    );
    expect(preview).toMatchObject({
      preview: true,
      status: "preview",
      evaluatedAt: expect.any(String),
      inputs: { title: "Preview source" },
    });
    expect(await state()).toBe(before);
    const refused = value(
      await call("automation_test", {
        id: made.id,
        source: { kind: "event", id: crypto.randomUUID() },
      }),
    );
    expect(refused.status).toBe("refused");
    expect(await state()).toBe(before);
    const scoped = await key(user.id, ["project:read", "automation:read"]);
    const deniedBefore = await state();
    const denied = await call(
      "automation_test",
      { id: made.id, source: { kind: "subject", id: quest.id } },
      scoped,
    );
    expect(failed(denied)).toMatch(/source access|quest:read/i);
    expect(await state()).toBe(deniedBefore);
    expect(
      failed(
        await call("automation_test", {
          id: made.id,
          source: {
            kind: "subject",
            id: quest.id,
            fields: { title: "Injected" },
          },
        }),
      ),
    ).toBeTruthy();
  });

  it("describes authorized variables, cardinalities, operators and configured channels under the current key ceiling", async ({
    expect,
  }) => {
    value(
      await call("automation_variable_set", {
        key: "recipient",
        variable: { value: { kind: "member", value: user.id } },
      }),
    );
    const catalogue = value(await call("automation_catalog"));
    expect(catalogue.variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "recipient",
          available: true,
          value: { kind: "member", value: user.id },
        }),
      ]),
    );
    expect(catalogue.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "quests.tagged",
          result: "collection",
          itemFields: expect.any(Object),
        }),
        expect.objectContaining({
          key: "activeQuests",
          result: "scalar",
          operators: expect.arrayContaining(["crossesAbove"]),
        }),
        expect.objectContaining({
          key: "release.published",
          fields: expect.objectContaining({ release_tag: "text" }),
          permissions: expect.any(Array),
        }),
      ]),
    );
    expect(catalogue.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "inbox", available: true }),
        expect.objectContaining({ key: "email", available: true }),
      ]),
    );
    expect(catalogue.limits).toMatchObject({
      selectedRows: 50,
      deliveries: 100,
      detailDays: 30,
      receiptDays: 90,
    });
    const scoped = await key(user.id, ["project:read", "automation:read"]);
    const limited = value(await call("automation_catalog", {}, scoped));
    expect(
      limited.entries.find(
        (entry: { key: string }) => entry.key === "release.published",
      ),
    ).toMatchObject({
      available: false,
      reason: expect.stringMatching(/release:read|permission|grant/i),
    });
    expect(limited.variables[0]).toMatchObject({
      key: "recipient",
      available: false,
    });
    expect(limited.variables[0]).not.toHaveProperty("value");
  });
  it("previews and explicitly adopts a policy through MCP without restoring an opted-out replacement", async ({
    expect,
  }) => {
    const preview = value(
      await call("automation_adoption_preview", {
        policy: "release-notifications",
      }),
    );
    expect(preview).toMatchObject({
      state: "legacy",
      ready: true,
      author: { id: user.id },
    });
    expect(await persistence.adoptions.count({})).toBe(0);
    expect(
      failed(
        await call("automation_adopt", {
          policy: "release-notifications",
          confirm: false,
        }),
      ),
    ).toBeTruthy();
    const adopted = value(
      await call("automation_adopt", {
        policy: "release-notifications",
        confirm: true,
      }),
    );
    expect(adopted).toMatchObject({
      state: "adopted",
      candidate: { enabled: true, authorUserId: user.id },
    });
    await call("automation_update", {
      id: adopted.replacementId,
      expectedRevision: adopted.candidate.revision,
      enabled: false,
    });
    const repeated = value(
      await call("automation_adopt", {
        policy: "release-notifications",
        confirm: true,
      }),
    );
    expect(repeated.state).toBe("opted_out");
    expect(repeated.candidate.enabled).toBe(false);
    expect(await persistence.rules.count({})).toBe(1);
  });
});
