import {
  AutomationDatabase,
  AutomationTemplateRenderer,
  AutomationAccess,
  ProjectLimits,
  AutomationCatalog,
  AutomationClaims,
  AutomationContextBuilder,
  AutomationDomainActions,
  AutomationMutationContext,
  AutomationPersistence,
  AutomationRunEvidence,
} from "@lore/core/api";
import type { AutomationRule } from "@lore/core/schemas";
import { FolioController } from "@lore/knowledge/api";
import { folioRevisions } from "@lore/knowledge/schemas";
import { QuestController } from "@lore/work/api";
import { $hook, $inject, Alepha, AlephaError } from "alepha";
import { audits } from "alepha/api/audits";
import { RankService } from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class AdjustableQuestLimits extends ProjectLimits {
  public cap?: number;
  public override async maxQuestsPerProject() {
    return this.cap ?? super.maxQuestsPerProject();
  }
}
class DomainRaceDatabase extends AutomationDatabase {
  public before?: () => Promise<void>;
  public override async batch(
    ...args: Parameters<AutomationDatabase["batch"]>
  ) {
    if (this.before) {
      const task = this.before;
      this.before = undefined;
      await task();
    }
    return super.batch(...args);
  }
}
class DomainRows {
  audits = $repository(audits);
  revisions = $repository(folioRevisions);
}
class DomainMutationFaults {
  protected readonly mutations = $inject(AutomationMutationContext);
  public before?: { table: string; run: () => Promise<void> };
  public after?: string;
  protected readonly beforeWrite = $hook({
    on: "repository:update:before",
    handler: async ({ tableName }) => {
      if (!this.mutations.current || this.before?.table !== tableName) return;
      const task = this.before;
      this.before = undefined;
      await task.run();
    },
  });
  protected readonly afterCreate = $hook({
    on: "repository:create:after",
    handler: ({ tableName }) => this.crash(tableName),
  });
  protected readonly afterUpdate = $hook({
    on: "repository:update:after",
    handler: ({ tableName }) => this.crash(tableName),
  });
  protected crash(table: string): void {
    if (!this.mutations.current || this.after !== table) return;
    this.after = undefined;
    throw new AlephaError("Simulated crash after native domain commit");
  }
}

describe("Idempotent automation domain actions through normal controllers", () => {
  let alepha: Alepha;
  let persistence: AutomationPersistence;
  let entities: TestEntityRepositories;
  let rows: DomainRows;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let time: DateTimeProvider;
  let claims: AutomationClaims;
  let actions: AutomationDomainActions;
  let faults: DomainMutationFaults;
  const createAction = (): AutomationRule["actions"][number] => ({
    kind: "createQuest",
    title: "Created {{value}}",
    description: "Original <TypeScript<T>> Markdown",
    area: "automation-tests",
  });
  const open = async (steps: AutomationRule["actions"], author = user) => {
    const ast: AutomationRule = {
      version: 1,
      trigger: { kind: "schedule", cron: "*/5 * * * *" },
      select: { kind: "scalar", key: "activeQuests", filters: {} },
      guard: null,
      actions: steps,
    };
    await alepha.inject(AutomationCatalog).validate(project.id, author, ast);
    const created = await persistence.rules.create({
      projectId: project.id,
      authorUserId: author.id,
      title: "Domain",
      rule: ast,
    });
    const rule = await persistence.rules.updateById(created.id, {
      enabled: true,
    });
    const context = await alepha
      .inject(AutomationContextBuilder)
      .source(project.id, "activeQuests", { value: 3 });
    const at = time.now().subtract(1, "minute").toISOString();
    const prepared = await alepha.inject(AutomationRunEvidence).prepare({
      rule,
      occurrenceId: `schedule:${at}`,
      triggeredAt: at,
      inputs: context.values,
      selected: [context.values],
      matched: 1,
      planned: steps.map((_, index) => ({ index })),
    });
    const claimed = await claims.claim({
      automationId: rule.id,
      revision: rule.revision,
      source: { kind: "schedule", scheduledAt: at },
      prepared,
    });
    if (claimed.state !== "claimed")
      throw new AlephaError(claimed.receipt?.reason ?? "Missing domain claim");
    return { rule, context, occurrence: claimed.receipt! };
  };
  const execute = (opened: Awaited<ReturnType<typeof open>>, index = 0) =>
    actions.execute({
      occurrenceId: opened.occurrence.id,
      token: opened.occurrence.leaseToken!,
      index,
      context: opened.context,
    });
  const createFolio = (content = "Original") =>
    alepha
      .inject(FolioController)
      .create(
        { body: { projectId: project.id, title: "Log", content } },
        { user },
      );
  const nativeAudits = async (automationId: string) =>
    (
      await rows.audits.findMany({
        where: { scopeType: "project", scopeId: String(project.id) },
      })
    ).filter(
      (row) =>
        (row.metadata as Record<string, unknown> | undefined)?.automationId ===
        automationId,
    );
  const isolated = <T>(task: () => Promise<T>) =>
    alepha.context.nest(() => {
      alepha.context.set("lore.automations.origin", undefined);
      alepha.context.set("lore.automations.mutation", undefined);
      return task();
    });
  let releaseNumber = 0;
  const release = (releasedAt?: string) =>
    entities.releases.create({
      projectId: project.id,
      number: ++releaseNumber,
      tag: `0.0.${releaseNumber}`,
      title: `Release ${releaseNumber}`,
      description: "",
      ...(releasedAt ? { releasedAt } : {}),
    });

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    });
    alepha.with({ provide: CronProvider, use: ManualCronProvider });
    alepha.with({ provide: AutomationDatabase, use: DomainRaceDatabase });
    alepha.with({ provide: ProjectLimits, use: AdjustableQuestLimits });
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    persistence = alepha.inject(AutomationPersistence);
    rows = alepha.inject(DomainRows);
    faults = alepha.inject(DomainMutationFaults);
    actions = alepha.inject(AutomationDomainActions);
    claims = alepha.inject(AutomationClaims);
    time = alepha.inject(DateTimeProvider);
    await alepha.start();
    time.pause();
    releaseNumber = 0;
    project = await createTestProject(alepha, {
      capabilities: [
        {
          key: "work",
          options: { automations: true, epics: true, releases: true },
        },
        { key: "knowledge" },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] } as UserAccountToken;
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("creates a quest through normal defaults and reconciles a crash with one row, identity and author audit", async ({
    expect,
  }) => {
    const opened = await open([createAction()]);
    faults.after = "quests";
    await expect(execute(opened)).rejects.toThrow("Simulated crash");
    const receipt = await persistence.receipts.getOne({
      where: { parentId: opened.occurrence.id, kind: "action" },
    });
    expect(receipt).toMatchObject({
      status: "committed",
      result: { changed: true, audit_recorded: true, shortId: 1 },
    });
    expect(await entities.quests.count({ projectId: project.id })).toBe(1);
    const quest = await entities.quests.getById(
      Number(receipt.result!.quest_id),
    );
    expect(quest).toMatchObject({
      title: "Created 3",
      createdBy: user.id,
      priority: "medium",
      size: 3,
      description: "Original <TypeScript<T>> Markdown",
      area: "automation-tests",
    });
    expect(quest.releaseId).toBeUndefined();
    expect(await execute(opened)).toMatchObject({
      id: receipt.id,
      result: { quest_id: quest.id },
    });
    expect(await entities.quests.count({ projectId: project.id })).toBe(1);
    const audit = await nativeAudits(opened.rule.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      type: "quest",
      action: "create",
      userId: user.id,
      resourceId: "1",
      metadata: {
        automationId: opened.rule.id,
        runId: opened.occurrence.runId,
        operationId: receipt.id,
      },
    });
  });
  it("appends once with the folio CAS, pinned history and audit in the same commit", async ({
    expect,
  }) => {
    const folio = await createFolio();
    const head = await rows.revisions.getOne({ where: { folioId: folio.id } });
    await rows.revisions.updateById(head.id, { pinned: true });
    const opened = await open([
      {
        kind: "appendFolio",
        folio: folio.id,
        text: "Append <verbatim> {{value}}",
      },
    ]);
    faults.after = "folios";
    await expect(execute(opened)).rejects.toThrow("Simulated crash");
    const receipt = await execute(opened);
    expect(receipt.result).toMatchObject({
      folio_id: folio.id,
      changed: true,
      revision: 1,
      audit_recorded: true,
    });
    expect((await entities.folios.getById(folio.id)).content).toBe(
      "Original\n\nAppend <verbatim> 3",
    );
    const revisions = await rows.revisions.findMany({
      where: { folioId: folio.id },
    });
    expect(revisions).toHaveLength(2);
    expect(revisions.find((row) => row.id === head.id)).toMatchObject({
      pinned: true,
      snapshotIsLive: false,
      contentSnapshot: "Original",
    });
    expect(revisions.filter((row) => row.snapshotIsLive)).toHaveLength(1);
    expect(await nativeAudits(opened.rule.id)).toHaveLength(1);
  });
  it("rolls back an append and deferred history when a human edit wins, then safely retries against the new head", async ({
    expect,
  }) => {
    const folio = await createFolio();
    const human = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, human.id, { rank: "owner" });
    let humanHistory: Awaited<ReturnType<typeof rows.revisions.findMany>> = [];
    faults.before = {
      table: "folios",
      run: () =>
        isolated(async () => {
          await alepha
            .inject(FolioController)
            .update(
              { params: { id: folio.id }, body: { content: "Human edit" } },
              { user: { id: human.id, roles: ["user"] } },
            );
          humanHistory = await rows.revisions.findMany({
            where: { folioId: folio.id },
          });
        }),
    };
    const opened = await open([
      { kind: "appendFolio", folio: folio.id, text: "Automation" },
    ]);
    await expect(execute(opened)).rejects.toThrow(
      "Atomic automation batch failed",
    );
    expect((await entities.folios.getById(folio.id)).content).toBe(
      "Human edit",
    );
    expect(
      await rows.revisions.findMany({ where: { folioId: folio.id } }),
    ).toEqual(humanHistory);
    expect(await nativeAudits(opened.rule.id)).toHaveLength(0);
    expect((await execute(opened)).result).toMatchObject({ changed: true });
    expect((await entities.folios.getById(folio.id)).content).toBe(
      "Human edit\n\nAutomation",
    );
    expect(await nativeAudits(opened.rule.id)).toHaveLength(1);
  });
  it("does not fold into a revision pinned after preparation", async ({
    expect,
  }) => {
    const folio = await createFolio();
    const head = await rows.revisions.getOne({ where: { folioId: folio.id } });
    faults.before = {
      table: "folios",
      run: () =>
        isolated(async () => {
          await rows.revisions.updateById(head.id, { pinned: true });
        }),
    };
    const opened = await open([
      { kind: "appendFolio", folio: folio.id, text: "Appended" },
    ]);
    await expect(execute(opened)).rejects.toThrow(
      "Atomic automation batch failed",
    );
    expect((await entities.folios.getById(folio.id)).content).toBe("Original");
    expect(await rows.revisions.count({ folioId: folio.id })).toBe(1);
    await execute(opened);
    expect(await rows.revisions.getById(head.id)).toMatchObject({
      pinned: true,
      snapshotIsLive: false,
      contentSnapshot: "Original",
    });
    expect(await rows.revisions.count({ folioId: folio.id })).toBe(2);
  });
  it("adds tags as a set union and cannot overwrite tags from a concurrent human", async ({
    expect,
  }) => {
    const quest = await createTestQuest(alepha, project, { tags: ["initial"] });
    const opened = await open([
      { kind: "addTag", quest: quest.id, tag: "auto" },
    ]);
    faults.before = {
      table: "quests",
      run: () =>
        isolated(async () => {
          await alepha.inject(QuestController).updateQuestById(
            {
              params: { id: quest.id },
              body: { tags: ["initial", "human"] },
            },
            { user },
          );
        }),
    };
    await expect(execute(opened)).rejects.toThrow(
      "Atomic automation batch failed",
    );
    expect((await entities.quests.getById(quest.id)).tags).toEqual([
      "initial",
      "human",
    ]);
    const result = await execute(opened);
    expect(new Set((await entities.quests.getById(quest.id)).tags)).toEqual(
      new Set(["initial", "human", "auto"]),
    );
    const history = (await entities.quests.getById(quest.id)).history;
    expect(history.at(-1)).toMatchObject({ by: user.id, action: "updated" });
    expect((await execute(opened)).id).toBe(result.id);
    expect((await entities.quests.getById(quest.id)).history).toEqual(history);
    const noop = await execute(
      await open([{ kind: "addTag", quest: quest.id, tag: "auto" }]),
    );
    expect(noop.result?.changed).toBe(false);
    expect((await entities.quests.getById(quest.id)).history).toEqual(history);
  });
  it("assigns only an open same-project release, preserves history and refuses conflicting explicit assignments", async ({
    expect,
  }) => {
    const quest = await createTestQuest(alepha, project);
    const first = await release();
    const second = await release();
    const opened = await open([
      { kind: "assignRelease", quest: quest.id, release: first.id },
    ]);
    const result = await execute(opened);
    expect(result.result).toMatchObject({
      quest_id: quest.id,
      release_id: first.id,
      changed: true,
    });
    expect((await entities.quests.getById(quest.id)).releaseId).toBe(first.id);
    const history = (await entities.quests.getById(quest.id)).history;
    expect(history.at(-1)?.changes).toContainEqual(
      expect.objectContaining({ field: "release" }),
    );
    expect(
      (
        await execute(
          await open([
            { kind: "assignRelease", quest: quest.id, release: first.id },
          ]),
        )
      ).result?.changed,
    ).toBe(false);
    await expect(
      execute(
        await open([
          { kind: "assignRelease", quest: quest.id, release: second.id },
        ]),
      ),
    ).rejects.toThrow("conflicting explicit");
    expect((await entities.quests.getById(quest.id)).history).toEqual(history);
    expect(await nativeAudits(opened.rule.id)).toHaveLength(1);
  });
  it("binds release openness to the native write rather than its earlier validation read", async ({
    expect,
  }) => {
    const quest = await createTestQuest(alepha, project);
    const target = await release();
    const opened = await open([
      { kind: "assignRelease", quest: quest.id, release: target.id },
    ]);
    faults.before = {
      table: "quests",
      run: async () => {
        alepha.inject(DomainRaceDatabase).before = () =>
          isolated(async () => {
            await entities.releases.updateById(target.id, {
              releasedAt: time.nowISOString(),
            });
          });
      },
    };
    await expect(execute(opened)).rejects.toThrow(
      "Atomic automation batch failed",
    );
    expect((await entities.quests.getById(quest.id)).releaseId).toBeUndefined();
    expect(await nativeAudits(opened.rule.id)).toHaveLength(0);
  });
  it("keeps protected folios and foreign project resources outside the write adapters", async ({
    expect,
  }) => {
    const folio = await createFolio();
    const opened = await open([
      { kind: "appendFolio", folio: folio.id, text: "No" },
    ]);
    await entities.folios.updateById(folio.id, {
      protected: true,
      content: "ciphertext",
      searchText: "",
    });
    await expect(execute(opened)).rejects.toThrow("protected");
    expect((await entities.folios.getById(folio.id)).content).toBe(
      "ciphertext",
    );
    const other = await createTestProject(alepha);
    const foreign = await createTestQuest(alepha, other);
    await expect(
      open([{ kind: "addTag", quest: foreign.id, tag: "no" }]),
    ).rejects.toThrow("does not exist in this project");
  });
  it("stops later program steps on refusal and retains the prior committed append and audit", async ({
    expect,
  }) => {
    const writer = await entities.users.create({ roles: ["user"] });
    await alepha.inject(RankService).save(
      project.organizationId!,
      {
        key: "automation-writer",
        name: "Automation writer",
        permissions: [
          "project:read",
          "automation:read",
          "automation:write",
          "member:read",
          "quest:read",
          "quest:create",
          "quest:update",
          "folio:read",
          "folio:write",
        ],
      },
      user,
    );
    await createTestMember(alepha, project, writer.id, {
      rank: "automation-writer",
    });
    const folio = await createFolio();
    const otherQuest = await createTestQuest(alepha, project);
    const opened = await open(
      [
        { kind: "appendFolio", folio: folio.id, text: "First committed" },
        { kind: "addTag", quest: otherQuest.id, tag: "refused" },
        createAction(),
      ],
      { id: writer.id, roles: ["user"] } as UserAccountToken,
    );
    const first = await execute(opened);
    await claims.advance(opened.occurrence.id, opened.occurrence.leaseToken!, {
      index: 0,
      receiptId: first.id,
    });
    await expect(execute(opened, 1)).rejects.toThrow("Only the quest creator");
    await expect(execute(opened, 2)).rejects.toThrow(
      "next planned program step",
    );
    expect((await entities.folios.getById(folio.id)).content).toBe(
      "Original\n\nFirst committed",
    );
    expect(await entities.quests.count({ projectId: project.id })).toBe(1);
    expect((await entities.quests.getById(otherQuest.id)).tags).not.toContain(
      "refused",
    );
    expect(await nativeAudits(opened.rule.id)).toHaveLength(1);
  });
  it("rolls content, revision and receipt back if the required native audit cannot be written", async ({
    expect,
  }) => {
    const folio = await createFolio();
    const before = await rows.revisions.findMany({
      where: { folioId: folio.id },
    });
    const opened = await open([
      { kind: "appendFolio", folio: folio.id, text: "Audited" },
    ]);
    const database = alepha.inject(DatabaseProvider);
    await database.execute(
      "CREATE TRIGGER automation_test_audit_refusal BEFORE INSERT ON audits WHEN json_extract(NEW.metadata, '$.automationId') IS NOT NULL BEGIN SELECT RAISE(ABORT, 'test audit refusal'); END",
    );
    await expect(execute(opened)).rejects.toThrow(
      "Atomic automation batch failed",
    );
    expect((await entities.folios.getById(folio.id)).content).toBe("Original");
    expect(
      await rows.revisions.findMany({ where: { folioId: folio.id } }),
    ).toEqual(before);
    expect(await nativeAudits(opened.rule.id)).toHaveLength(0);
    await database.execute("DROP TRIGGER automation_test_audit_refusal");
    await execute(opened);
    expect((await entities.folios.getById(folio.id)).content).toBe(
      "Original\n\nAudited",
    );
    expect(await nativeAudits(opened.rule.id)).toHaveLength(1);
  });
  it("preflights the same targets without reserving quest counters, areas, audits or execution evidence", async ({
    expect,
  }) => {
    const opened = await open([createAction()]);
    const author = await alepha.inject(AutomationAccess).author(opened.rule);
    const rendered = alepha
      .inject(AutomationTemplateRenderer)
      .render(opened.rule.rule.actions[0], opened.context, []);
    if (rendered.raw.kind === "notify")
      throw new AlephaError("Expected domain action");
    const before = {
      rules: await persistence.rules.findMany({}),
      receipts: await persistence.receipts.findMany({}),
      runs: await persistence.runs.findMany({}),
      audits: await rows.audits.findMany({}),
      quests: await entities.quests.findMany({}),
      areas: await entities.areas.findMany({}),
    };
    expect(
      await actions.preview({
        rule: opened.rule,
        user: author,
        action: rendered.raw,
      }),
    ).toEqual({ changed: true });
    expect({
      rules: await persistence.rules.findMany({}),
      receipts: await persistence.receipts.findMany({}),
      runs: await persistence.runs.findMany({}),
      audits: await rows.audits.findMany({}),
      quests: await entities.quests.findMany({}),
      areas: await entities.areas.findMany({}),
    }).toEqual(before);
    alepha.inject(AdjustableQuestLimits).cap = 0;
    await expect(
      actions.preview({
        rule: opened.rule,
        user: author,
        action: rendered.raw,
      }),
    ).rejects.toThrow("maximum number of quests");
    expect(await entities.quests.count()).toBe(0);
    expect(await entities.areas.count()).toBe(0);
    alepha.inject(AdjustableQuestLimits).cap = undefined;
    expect((await execute(opened)).result?.shortId).toBe(1);
  });
  it("appends to a large target without copying its private body into the bounded run snapshot", async ({
    expect,
  }) => {
    const body = "Private target text. ".repeat(6000);
    const folio = await createFolio(body);
    const head = await rows.revisions.getOne({ where: { folioId: folio.id } });
    await rows.revisions.updateById(head.id, { pinned: true });
    const opened = await open([
      { kind: "appendFolio", folio: folio.id, text: "Small append" },
    ]);
    await execute(opened);
    expect((await entities.folios.getById(folio.id)).content).toBe(
      `${body}\n\nSmall append`,
    );
    expect(
      JSON.stringify(
        (await persistence.runs.getById(opened.occurrence.runId!)).snapshot,
      ),
    ).not.toContain("Private target text");
    expect((await rows.revisions.getById(head.id)).contentSnapshot).toBe(body);
  });
  it("rechecks the immutable author's permissions immediately before the root write", async ({
    expect,
  }) => {
    const folio = await createFolio();
    const opened = await open([
      { kind: "appendFolio", folio: folio.id, text: "No" },
    ]);
    faults.before = {
      table: "folios",
      run: () =>
        isolated(async () => {
          await entities.organizationMembers.deleteMany({
            organizationId: project.organizationId!,
            userId: user.id,
          });
        }),
    };
    await expect(execute(opened)).rejects.toThrow("current member");
    expect((await entities.folios.getById(folio.id)).content).toBe("Original");
    expect(await nativeAudits(opened.rule.id)).toHaveLength(0);
  });
});
