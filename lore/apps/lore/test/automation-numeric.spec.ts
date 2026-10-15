import {
  AutomationCatalog,
  AutomationClaims,
  AutomationGuards,
  AutomationPersistence,
  AutomationRunEvidence,
  AutomationSelections,
  AutomationVariables,
  DashboardMetricRegistry,
} from "@lore/core/api";
import {
  dashboardCardValueSchema,
  type AutomationRule,
} from "@lore/core/schemas";
import { QualityController } from "@lore/deploy/api";
import { qualityRuns } from "@lore/deploy/schemas";
import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import { currentUserAtom, type UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class NumericRepositories {
  quality = $repository(qualityRuns);
}

describe("Automation numeric guards and shared quality metrics", () => {
  let alepha: Alepha;
  let persistence: AutomationPersistence;
  let repositories: NumericRepositories;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let time: DateTimeProvider;
  let guards: AutomationGuards;
  const ast = (
    key = "quality.coverage.lines",
    operator: NonNullable<AutomationRule["guard"]>["operator"] = "delta",
    threshold: string | number = 5,
  ): AutomationRule => ({
    version: 1,
    trigger: { kind: "schedule", cron: "10 0 * * *" },
    select: {
      kind: "scalar",
      key,
      filters: key.startsWith("quality.") ? { branch: "main" } : {},
    },
    guard: { field: "value", operator, value: threshold },
    actions: [
      {
        kind: "notify",
        recipient: user.id,
        channel: "inbox",
        title: "Quality",
        text: "{{value}}",
        category: "automations",
      },
    ],
  });
  const create = async (rule = ast()) => {
    await alepha.inject(AutomationCatalog).validate(project.id, user, rule);
    const row = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Numeric",
      rule,
    });
    return persistence.rules.updateById(row.id, { enabled: true });
  };
  const sample = (
    day: string,
    value: number,
    branch = "main",
    projectId = project.id,
  ) =>
    repositories.quality.create({
      projectId,
      branch,
      day,
      commitSha: day.replaceAll("-", ""),
      coverageLines: value,
      coverageStatements: value - 1,
      coverageFunctions: value - 2,
      coverageBranches: value - 3,
      testsTotal: 100,
      testsPassed: 90,
      testsFailed: 7,
      testsSkipped: 3,
      durationMs: 1000,
    });
  const selected = (rule: Awaited<ReturnType<typeof create>>) =>
    alepha.inject(AutomationSelections).evaluate({
      rule,
      user,
      variables: [],
      evaluatedAt: "2026-10-15T00:10:00.000Z",
    });
  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    });
    alepha.with({ provide: CronProvider, use: ManualCronProvider });
    bootLore(alepha);
    persistence = alepha.inject(AutomationPersistence);
    repositories = alepha.inject(NumericRepositories);
    const entities = alepha.inject(TestEntityRepositories);
    guards = alepha.inject(AutomationGuards);
    time = alepha.inject(DateTimeProvider);
    await alepha.start();
    time.pause();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "work", options: { automations: true } },
        { key: "apps", options: { track: true } },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] } as UserAccountToken;
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("exposes exactly eight quality scalars and preserves decimal data and exact provenance through both resolvers", async ({
    expect,
  }) => {
    const previous = await sample("2026-10-13", 90.75);
    const current = await sample("2026-10-14", 84.5);
    await sample("2026-10-15", 100);
    await sample("2026-10-14", 20, "topic");
    const catalog = alepha.inject(AutomationCatalog);
    const metrics = catalog
      .entries()
      .filter((entry) => entry.key.startsWith("quality."));
    expect(metrics.map((entry) => entry.key)).toEqual([
      "quality.coverage.lines",
      "quality.coverage.statements",
      "quality.coverage.functions",
      "quality.coverage.branches",
      "quality.tests.total",
      "quality.tests.passed",
      "quality.tests.failed",
      "quality.tests.skipped",
    ]);
    const row = await create();
    const result = await selected(row);
    expect(result.noData).toBe(false);
    expect(result.items[0]).toMatchObject({
      value: 84.5,
      previous: 90.75,
      day: "2026-10-14",
      previous_day: "2026-10-13",
      branch: "main",
      commit_sha: current.commitSha,
      previous_commit_sha: previous.commitSha,
      updated_at: current.updatedAt,
      previous_updated_at: previous.updatedAt,
    });
    expect(
      await guards.evaluate({
        rule: row,
        context: result.items[0],
        variables: [],
      }),
    ).toEqual({ matched: true, noData: false });
    const cards = await alepha
      .inject(DashboardMetricRegistry)
      .resolveForProject(
        metrics.map((entry, index) => ({
          id: index + 1,
          metric: entry.key,
          scope: { kind: "projects", projectIds: [project.id] },
          filters: { branch: "main" },
          size: 1,
          position: index,
        })),
        user,
        project,
        undefined,
        undefined,
        "2026-10-15T00:10:00.000Z",
      );
    expect(cards.map((card) => card.value)).toEqual([
      84.5, 83.5, 82.5, 81.5, 100, 90, 7, 3,
    ]);
    expect(dashboardCardValueSchema.parse(cards[0])).toMatchObject({
      value: 84.5,
      unit: "percent",
      link: {
        route: "reportsQuality",
        params: { projectSlug: project.slug },
        query: { branch: "main" },
      },
    });
    expect(cards[4].unit).toBeUndefined();
  });
  it("refuses missing closed samples without substituting today's run, another branch, another project or the nearest earlier day", async ({
    expect,
  }) => {
    const row = await create();
    await sample("2026-10-12", 95);
    await sample("2026-10-13", 99, "topic");
    await sample("2026-10-15", 100);
    const other = await createTestProject(alepha);
    await sample("2026-10-14", 100, "main", other.id);
    let result = await selected(row);
    expect(result.noData).toBe(true);
    expect(
      await guards.evaluate({
        rule: row,
        context: result.items[0],
        variables: [],
      }),
    ).toEqual({ matched: false, noData: true });
    await sample("2026-10-14", 80);
    result = await selected(row);
    expect(result.items[0].value).toBe(80);
    expect(
      await guards.evaluate({
        rule: row,
        context: result.items[0],
        variables: [],
      }),
    ).toEqual({ matched: false, noData: true });
  });
  it("keeps the quality drill-through on the explicitly requested branch without a cross-branch fallback", async ({
    expect,
  }) => {
    await sample("2026-10-14", 80, "main");
    await sample("2026-10-14", 60, "topic");
    const api = alepha.inject(QualityController);
    const read = (branch: string) =>
      alepha.context.run(() => {
        alepha.store.set(currentUserAtom, user);
        return api.getQualityRuns({
          params: { projectId: project.id },
          query: { branch },
        });
      });
    expect((await read("topic")).runs.map((run) => run.branch)).toEqual([
      "topic",
    ]);
    expect((await read("topic")).latest?.coverageLines).toBe(60);
    expect(await read("absent")).toMatchObject({ runs: [] });
    expect((await read("absent")).latest).toBeUndefined();
  });

  it("uses a strict drop in percentage points, retaining a measured zero", async ({
    expect,
  }) => {
    const row = await create();
    for (const [current, previous, matched] of [
      [85, 90, false],
      [84.99, 90, true],
      [90, 85, false],
      [0, 5, false],
      [0, 5.01, true],
    ] as const) {
      expect(
        await guards.evaluate({
          rule: row,
          context: { value: current, previous },
          variables: [],
        }),
      ).toEqual({ matched, noData: false });
    }
  });
  it("type checks comparisons and rejects delta on counts and numeric operators on text", async ({
    expect,
  }) => {
    const catalog = alepha.inject(AutomationCatalog);
    await expect(create(ast("quality.tests.total", "delta"))).rejects.toThrow(
      "not supported",
    );
    for (const operator of ["eq", "ne", "lt", "lte", "gt", "gte"] as const) {
      await expect(
        catalog.validate(
          project.id,
          user,
          ast("quality.coverage.lines", operator, "5"),
        ),
      ).rejects.toThrow();
      const row = await create(ast("quality.coverage.lines", operator));
      const result = await guards.evaluate({
        rule: row,
        context: { value: 5 },
        variables: [],
      });
      expect(result.matched).toBe(["eq", "lte", "gte"].includes(operator));
    }
    const text = ast();
    text.guard!.field = "branch";
    text.guard!.operator = "gt";
    text.guard!.value = "main";
    await expect(catalog.validate(project.id, user, text)).rejects.toThrow(
      "requires a numeric",
    );
  });
  it("stores crossing observations exactly once, rearms on falling values and resumes the original decision after a crash", async ({
    expect,
  }) => {
    const row = await create(ast("openBlights", "crossesAbove", 5));
    const claims = alepha.inject(AutomationClaims);
    let index = 0;
    const observe = async (value: number | null) => {
      const live = await persistence.rules.getById(row.id);
      const at = time
        .now()
        .subtract(1, "day")
        .add(++index * 5, "minutes")
        .toISOString();
      const prepared = await alepha.inject(AutomationRunEvidence).prepare({
        rule: live,
        occurrenceId: `schedule:${at}`,
        triggeredAt: at,
        inputs: { value },
        selected: [{ value }],
      });
      const claimed = await claims.claim({
        automationId: row.id,
        revision: live.revision,
        source: { kind: "schedule", scheduledAt: at },
        prepared,
      });
      expect(claimed.state, claimed.receipt?.reason).toBe("claimed");
      const receipt = claimed.receipt!;
      const decision = await guards.observe({
        occurrenceId: receipt.id,
        token: receipt.leaseToken!,
      });
      // A resumed worker must not re-evaluate against the newly advanced baseline.
      expect(
        await guards.observe({
          occurrenceId: receipt.id,
          token: receipt.leaseToken!,
        }),
      ).toEqual(decision);
      await claims.complete(receipt.id, receipt.leaseToken!);
      return decision;
    };
    expect(await observe(7)).toMatchObject({ matched: false });
    expect(await observe(8)).toMatchObject({ matched: false });
    expect(await observe(5)).toMatchObject({ matched: false });
    const baseline = (await persistence.rules.getById(row.id)).baseline;
    expect(await observe(null)).toEqual({ matched: false, noData: true });
    expect((await persistence.rules.getById(row.id)).baseline).toEqual(
      baseline,
    );
    expect(await observe(6)).toMatchObject({ matched: true });
    expect(await observe(7)).toMatchObject({ matched: false });
    await persistence.rules.updateById(row.id, {
      rule: ast("openBlights", "crossesAbove", 6),
      revision: row.revision + 1,
    });
    expect(await observe(8)).toMatchObject({ matched: false });
  });
  it("makes dry comparisons write nothing and signs effective predicates rather than recipients, prose or cron", async ({
    expect,
  }) => {
    const row = await create(ast("openBlights", "crossesAbove", 5));
    const first = await guards.evaluate({
      rule: row,
      context: { value: 4 },
      variables: [],
    });
    const withBaseline = {
      ...row,
      baseline: { signature: first.signature!, value: 4 },
    };
    const changed = structuredClone(row.rule);
    changed.trigger = { kind: "schedule", cron: "0 * * * *" };
    changed.actions[0] = {
      ...changed.actions[0],
      title: "Changed",
    } as (typeof changed.actions)[0];
    const next = await guards.evaluate({
      rule: { ...withBaseline, rule: changed },
      context: { value: 6 },
      variables: [],
    });
    expect(next).toMatchObject({ matched: true, signature: first.signature });
    expect(await guards.configurationChanged(row.rule, changed)).toBe(false);
    changed.guard!.value = 6;
    expect(await guards.configurationChanged(row.rule, changed)).toBe(true);
    expect(
      await guards.evaluate({
        rule: { ...withBaseline, rule: changed },
        context: { value: 7 },
        variables: [],
      }),
    ).toMatchObject({ matched: false });
    expect((await persistence.rules.getById(row.id)).baseline).toBeUndefined();
    expect(await persistence.receipts.count()).toBe(0);
    expect(await persistence.runs.count()).toBe(0);
  });
  it("preserves baselines on prose and cron variable edits but resets predicate variables", async ({
    expect,
  }) => {
    const variables = alepha.inject(AutomationVariables);
    for (const [key, value] of [
      ["message", "One"],
      ["cadence", "*/5 * * * *"],
      ["threshold", 5],
    ] as const)
      await variables.set(project.id, user, {
        key,
        value: { kind: typeof value === "number" ? "number" : "text", value },
      });
    const config = ast("openBlights", "crossesAbove", "{{threshold}}");
    config.trigger = { kind: "schedule", cron: "{{cadence}}" };
    config.actions[0] = {
      ...config.actions[0],
      text: "{{message}}",
    } as (typeof config.actions)[0];
    const row = await create(config);
    await persistence.rules.updateById(row.id, {
      baseline: { signature: "kept", value: 3 },
    });
    await variables.set(project.id, user, {
      key: "message",
      version: 0,
      value: { kind: "text", value: "Two" },
    });
    await variables.set(project.id, user, {
      key: "cadence",
      version: 0,
      value: { kind: "text", value: "0 * * * *" },
    });
    expect((await persistence.rules.getById(row.id)).baseline?.signature).toBe(
      "kept",
    );
    await variables.set(project.id, user, {
      key: "threshold",
      version: 0,
      value: { kind: "number", value: 6 },
    });
    expect((await persistence.rules.getById(row.id)).baseline).toBeUndefined();
  });
});
