import { AutomationCatalog } from "@lore/core/api";
import { AutomationPersistence } from "@lore/core/api";
import { DashboardMetricRegistry } from "@lore/core/api";
import type { AutomationRule } from "@lore/core/schemas";
import { DashboardMetricCatalog } from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { $hook, Alepha } from "alepha";
import { RankService } from "alepha/api/organizations";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  TestEntityRepositories,
  createTestFolio,
  createTestMember,
  createTestProject,
  createTestQuest,
} from "./fixtures/entities.ts";

/**
 * Cross-module contract: the core catalogue asks feature-owned validators and
 * the existing metric registry without importing any feature repository.
 */
class CatalogWriteRecorder {
  public readonly tables: string[] = [];
  protected readonly create = $hook({
    on: "repository:create:before",
    handler: ({ tableName }) => {
      this.tables.push(tableName);
    },
  });
  protected readonly update = $hook({
    on: "repository:update:before",
    handler: ({ tableName }) => {
      this.tables.push(tableName);
    },
  });
  protected readonly remove = $hook({
    on: "repository:delete:before",
    handler: ({ tableName }) => {
      this.tables.push(tableName);
    },
  });
}

describe("Automation catalogue", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;
  let catalog: AutomationCatalog;
  let persistence: AutomationPersistence;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;

  const rule = (): AutomationRule => ({
    version: 1,
    trigger: { kind: "event", event: "feedback.created" },
    select: null,
    guard: null,
    actions: [
      {
        kind: "notify",
        recipient: project.createdBy,
        channel: "inbox",
        title: "New feedback",
        text: "{{title}}",
        category: "automations",
      },
    ],
  });

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "error" },
    });
    bootLore(alepha, ["api"]);
    alepha.inject(CatalogWriteRecorder);
    entities = alepha.inject(TestEntityRepositories);
    catalog = alepha.inject(AutomationCatalog);
    persistence = alepha.inject(AutomationPersistence);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [
        {
          key: "work",
          options: {
            automations: true,
            epics: true,
            releases: true,
            reminder: true,
          },
        },
        { key: "knowledge" },
        { key: "support" },
        { key: "apps", options: { track: true, deploy: true } },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] } as UserAccountToken;
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("describes exactly the supported events and distinguishes cardinalities from progress objects", async ({
    expect,
  }) => {
    const result = await catalog.describe(project.id, user);
    expect(
      result.entries
        .filter((entry) => entry.type === "event")
        .map((entry) => entry.key)
        .sort(),
    ).toEqual([
      "deploy.failed",
      "deploy.succeeded",
      "epic.completed",
      "feedback.created",
      "quest.completed",
      "release.published",
    ]);
    expect(
      result.entries.some((entry) =>
        /uptime|blight\.threshold/.test(entry.key),
      ),
    ).toBe(false);
    expect(
      result.entries
        .filter((entry) => entry.type === "metric")
        .map((entry) => entry.key)
        .sort(),
    ).toEqual([
      "activeQuests",
      "heldQuests",
      "openBlights",
      "quality.coverage.branches",
      "quality.coverage.functions",
      "quality.coverage.lines",
      "quality.coverage.statements",
      "quality.tests.failed",
      "quality.tests.passed",
      "quality.tests.skipped",
      "quality.tests.total",
      "uniqueVisitors",
      "untriagedFeedback",
    ]);
    expect(
      result.entries.find((entry) => entry.key === "quests.open")?.result,
    ).toBe("rows");
    expect(
      result.entries.find((entry) => entry.key === "quests.tagged")?.result,
    ).toBe("collection");
    expect(
      result.entries.find((entry) => entry.key === "notify")?.slots.recipient
        .kind,
    ).toBe("member");
    expect(
      result.channels
        .filter((channel) => channel.available)
        .map((channel) => channel.key)
        .sort(),
    ).toEqual(["email", "inbox"]);
    expect(
      result.channels.some(
        (channel) => channel.key === "sms" || channel.key === "discord",
      ),
    ).toBe(false);
  });

  it("computes source access for the caller and redacts unauthorized variable values", async ({
    expect,
  }) => {
    const folio = await createTestFolio(alepha, project);
    await persistence.variables.create({
      projectId: project.id,
      key: "target",
      value: { kind: "folio", value: folio.id },
    });
    const reader = await entities.users.create({ roles: ["user"] });
    await alepha.inject(RankService).save(
      project.organizationId!,
      {
        key: "limited",
        name: "Limited",
        permissions: [
          "project:read",
          "automation:read",
          "member:read",
          "quest:read",
        ],
      },
      user,
    );
    await createTestMember(alepha, project, reader.id, { rank: "limited" });
    const limited = { id: reader.id, roles: ["user"] } as UserAccountToken;
    const result = await catalog.describe(project.id, limited);
    expect(
      result.entries.find((entry) => entry.key === "feedback.created"),
    ).toMatchObject({ available: false, reason: "Missing feedback:read" });
    expect(
      result.entries.find((entry) => entry.key === "quality.coverage.lines"),
    ).toMatchObject({ available: false, reason: "Missing quality:read" });
    await expect(
      catalog.resolveMetric(project.id, limited, "quality.coverage.lines", {}),
    ).rejects.toThrow("Missing quality:read");
    expect(result.variables[0]).toMatchObject({
      key: "target",
      available: false,
      reason: "Missing folio:read",
    });
    expect(result.variables[0]).not.toHaveProperty("value");
    await expect(catalog.validate(project.id, limited, rule())).rejects.toThrow(
      "feedback:read",
    );
    const key = {
      ...user,
      permissionScope: ["automation:read", "member:read"],
    };
    expect(
      (await catalog.describe(project.id, key)).entries.find(
        (entry) => entry.key === "feedback.created",
      )?.available,
    ).toBe(false);
  });

  it("never exposes a foreign resource as an authorized current variable value", async ({
    expect,
  }) => {
    const other = await createTestProject(alepha);
    const foreign = await createTestFolio(alepha, other);
    const closed = await entities.releases.create({
      projectId: project.id,
      number: 1,
      title: "Closed",
      releasedAt: "2026-10-01T00:00:00.000Z",
    });
    await persistence.variables.create({
      projectId: project.id,
      key: "foreign",
      value: { kind: "folio", value: foreign.id },
    });
    await persistence.variables.create({
      projectId: project.id,
      key: "closed",
      value: { kind: "release", value: closed.id },
    });
    await persistence.variables.create({
      projectId: project.id,
      key: "recipient",
      value: { kind: "member", value: other.createdBy },
    });
    const result = await catalog.describe(project.id, user);
    expect(
      result.variables.every(
        (variable) => !variable.available && !variable.value,
      ),
    ).toBe(true);
    expect(
      result.variables.find((variable) => variable.key === "closed")?.reason,
    ).toBe("Release is published");
    const bad = rule();
    bad.actions = [{ kind: "appendFolio", folio: foreign.id, text: "No" }];
    await expect(catalog.validate(project.id, user, bad)).rejects.toThrow(
      "Folio does not exist in this project",
    );
  });

  it("checks unknown slots, cardinalities, fields, comparators and native binding types", async ({
    expect,
  }) => {
    await expect(
      catalog.validate(project.id, user, rule()),
    ).resolves.toMatchObject({ version: 1 });
    const unknown = rule();
    unknown.trigger = {
      kind: "event",
      event: "feedback.created",
      app: "not-an-event-slot",
    };
    await expect(catalog.validate(project.id, user, unknown)).rejects.toThrow(
      "trigger.app: unknown slot",
    );
    const collection = rule();
    collection.trigger = { kind: "schedule", cron: "0 0 * * *" };
    collection.select = {
      kind: "rows",
      key: "quests.tagged",
      filters: { tag: "reminder" },
    };
    await expect(
      catalog.validate(project.id, user, collection),
    ).rejects.toThrow("select.kind must be 'collection'");
    const field = rule();
    field.guard = { field: "reporter.email", operator: "eq", value: "contact" };
    await expect(catalog.validate(project.id, user, field)).rejects.toThrow(
      "not exposed",
    );
    const comparator = rule();
    comparator.guard = { field: "title", operator: "gt", value: "x" };
    await expect(
      catalog.validate(project.id, user, comparator),
    ).rejects.toThrow("requires a numeric field");
    await persistence.variables.create({
      projectId: project.id,
      key: "threshold",
      value: { kind: "number", value: 2 },
    });
    const wrongType = rule();
    wrongType.actions = [
      {
        ...rule().actions[0],
        kind: "notify",
        recipient: "{{threshold}}",
        channel: "inbox",
        title: "x",
        text: "x",
        category: "automations",
      },
    ];
    await expect(catalog.validate(project.id, user, wrongType)).rejects.toThrow(
      "expected 'member'",
    );
  });

  it("accepts bounded array filters and delegates numeric reads to the existing dashboard resolver", async ({
    expect,
  }) => {
    await createTestQuest(alepha, project, { shortId: 1, area: "general" });
    await createTestQuest(alepha, project, { shortId: 2, area: "general" });
    const scheduled = rule();
    scheduled.trigger = { kind: "schedule", cron: "*/5 * * * *" };
    scheduled.select = {
      kind: "scalar",
      key: "activeQuests",
      filters: { statuses: ["todo"] },
    };
    scheduled.guard = { field: "value", operator: "gt", value: 1 };
    await expect(
      catalog.validate(project.id, user, scheduled),
    ).resolves.toBeDefined();
    const resolved = await catalog.resolveMetric(
      project.id,
      user,
      "activeQuests",
      { statuses: ["todo"] },
    );
    const [dashboard] = await alepha
      .inject(DashboardMetricRegistry)
      .resolveForProject(
        [
          {
            id: -1,
            metric: "activeQuests",
            scope: { kind: "projects", projectIds: [project.id] },
            filters: { statuses: ["todo"] },
            size: 1,
            position: 0,
          },
        ],
        user,
        project,
      );
    expect(resolved).toEqual({
      status: "value",
      value: dashboard.value,
      fields: {},
    });
    expect(resolved).toMatchObject({ value: 2 });
    await expect(
      catalog.resolveMetric(project.id, user, "epicProgress", {}),
    ).rejects.toThrow("unsupported");
    scheduled.select.filters = { query: "SELECT * FROM quests" };
    await expect(catalog.validate(project.id, user, scheduled)).rejects.toThrow(
      "unknown slot",
    );
    const metrics = alepha.inject(DashboardMetricCatalog);
    for (const key of ["epicProgress", "releaseProgress", "tagCompletion"])
      expect(metrics.get(key).automation).toBeUndefined();
  });

  it("validates placeholder names once and preserves text containing placeholders as data", async ({
    expect,
  }) => {
    await persistence.variables.create({
      projectId: project.id,
      key: "body",
      value: { kind: "text", value: "{{credentials}}" },
    });
    const custom = rule();
    custom.actions = [
      {
        kind: "notify",
        recipient: project.createdBy,
        channel: "inbox",
        title: "x",
        text: "{{ body }}",
        category: "automations",
      },
    ];
    await expect(
      catalog.validate(project.id, user, custom),
    ).resolves.toBeDefined();
    (
      custom.actions[0] as Extract<
        AutomationRule["actions"][number],
        { kind: "notify" }
      >
    ).text = "{{missing}}";
    await expect(catalog.validate(project.id, user, custom)).rejects.toThrow(
      "unknown placeholder 'missing'",
    );
    (
      custom.actions[0] as Extract<
        AutomationRule["actions"][number],
        { kind: "notify" }
      >
    ).text = "{{title.toString()}}";
    await expect(catalog.validate(project.id, user, custom)).rejects.toThrow(
      "no expressions or paths",
    );
  });

  it("treats inherited object names as unknown fields and slots", async ({
    expect,
  }) => {
    const unsafe = rule();
    unsafe.guard = { field: "constructor", operator: "eq", value: "x" };
    await expect(catalog.validate(project.id, user, unsafe)).rejects.toThrow(
      "not exposed",
    );
    unsafe.guard = null;
    const message = unsafe.actions[0] as Extract<
      AutomationRule["actions"][number],
      { kind: "notify" }
    >;
    message.text = "{{constructor}}";
    await expect(catalog.validate(project.id, user, unsafe)).rejects.toThrow(
      "unknown placeholder",
    );
    unsafe.trigger = { kind: "schedule", cron: "0 0 * * *" };
    unsafe.select = {
      kind: "scalar",
      key: "activeQuests",
      filters: { constructor: "x" },
    };
    await expect(catalog.validate(project.id, user, unsafe)).rejects.toThrow(
      "unknown slot",
    );
  });

  it("names missing options and leaves all repositories unchanged during catalogue, validation and metric reads", async ({
    expect,
  }) => {
    const disabled = await createTestProject(alepha, {
      capabilities: [
        { key: "work", options: { automations: true, releases: false } },
      ],
    });
    await entities.users.updateById(disabled.createdBy, { roles: ["user"] });
    const result = await catalog.describe(disabled.id, {
      id: disabled.createdBy,
      roles: ["user"],
    } as UserAccountToken);
    expect(
      result.entries.find((entry) => entry.key === "release.published"),
    ).toMatchObject({
      available: false,
      reason: "Missing work.releases option",
    });
    const writes = alepha.inject(CatalogWriteRecorder);
    writes.tables.length = 0;
    await catalog.describe(project.id, user);
    await catalog.validate(project.id, user, rule());
    await catalog.resolveMetric(project.id, user, "activeQuests", {});
    expect(writes.tables).toEqual([]);
  });

  it("does not mistake a rank name for source permission", async ({
    expect,
  }) => {
    await createPresetRanks(alepha, project.id);
    const reader = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, reader.id, { rank: "viewer" });
    const result = await catalog.describe(project.id, {
      id: reader.id,
      roles: ["user"],
    } as UserAccountToken);
    expect(
      result.entries.find((entry) => entry.key === "feedback.created")
        ?.available,
    ).toBe(true);
    expect(
      result.entries.find((entry) => entry.key === "appendFolio")?.available,
    ).toBe(false);
  });
});
