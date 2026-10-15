import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AutomationCatalog,
  AutomationClaims,
  AutomationPersistence,
  AutomationPresetService,
  AutomationService,
  AutomationSchedules,
  AutomationWorker,
} from "@lore/core/api";
import type { AutomationResource } from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { blights, qualityRuns, sigils } from "@lore/deploy/schemas";
import { Alepha, AlephaError } from "alepha";
import { JobQueueProvider, jobExecutionEntity } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class NumericPresetQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class NumericPresetRows {
  public readonly quality = $repository(qualityRuns);
  public readonly blights = $repository(blights);
  public readonly sigils = $repository(sigils);
  public readonly jobs = $repository(jobExecutionEntity);
}

describe("Numeric automation presets through actual registered metrics", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;
  let rows: NumericPresetRows;
  let persistence: AutomationPersistence;
  let service: AutomationService;
  let time: DateTimeProvider;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let directory: string;
  const boot = async (resume = false) => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: join(directory, "presets.sqlite"),
        // The first boot creates every table; restart reconnects to that schema.
        DATABASE_SYNC: !resume,
        SERVER_PORT: 0,
        LOG_LEVEL: "silent",
      },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: NumericPresetQueue });
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    rows = alepha.inject(NumericPresetRows);
    persistence = alepha.inject(AutomationPersistence);
    service = alepha.inject(AutomationService);
    time = alepha.inject(DateTimeProvider);
    await alepha.start();
    time.pause();
  };
  const arm = async (key: string, values: Record<string, string | number>) => {
    const rule = await alepha
      .inject(AutomationPresetService)
      .create(project.id, user, {
        key,
        values: { recipient: user.id, ...values },
      });
    return service.setEnabled(project.id, rule.id, user, true, 0);
  };
  const finish = async (id: string) => {
    let next: { receiptId: string; token?: string } | undefined = {
      receiptId: id,
    };
    for (let index = 0; next && index < 20; index++)
      next = await alepha.inject(AutomationWorker).step(next, 3);
    if (next)
      throw new AlephaError("Numeric preset worker exceeded its budget");
  };
  const sample = async (rule: AutomationResource) => {
    const ready = await alepha.inject(AutomationClaims).reserve({
      automationId: rule.id,
      revision: rule.revision,
      source: { kind: "schedule", scheduledAt: time.nowISOString() },
    });
    await finish(ready.id);
    return persistence.runs.getOne({
      where: { automationId: rule.id, occurrenceId: ready.occurrenceId },
    });
  };
  const quality = (
    day: string,
    value: number,
    branch = "main",
    projectId = project.id,
  ) =>
    rows.quality.create({
      projectId,
      day,
      branch,
      commitSha: day.replaceAll("-", ""),
      coverageLines: value,
      coverageStatements: value,
      coverageFunctions: value,
      coverageBranches: value,
      testsTotal: 10,
      testsPassed: 10,
      testsFailed: 0,
      testsSkipped: 0,
      durationMs: 100,
    });
  const addBlight = () =>
    rows.blights.create({
      projectId: project.id,
      fingerprint: crypto.randomUUID(),
      name: "Error",
      message: "Safe aggregate fixture",
      count: 1000,
      firstSeenAt: time.nowISOString(),
      lastSeenAt: time.nowISOString(),
    });
  const notificationCount = () =>
    rows.jobs.count({ jobName: "system.notifications.send" });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "lore-numeric-presets-"));
    await boot();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "work", options: { automations: true } },
        { key: "apps", options: { track: true } },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
    await rm(directory, { recursive: true, force: true });
  });

  it("uses exact closed UTC days and branch at 00:10 and renders the observed coverage", async ({
    expect,
  }) => {
    const catalog = await alepha
      .inject(AutomationCatalog)
      .describe(project.id, user);
    expect(
      catalog.presets.find((preset) => preset.key === "coverage-regression"),
    ).toMatchObject({
      permissions: expect.arrayContaining(["quality:read"]),
      slots: {
        branch: { default: "main" },
        threshold: { kind: "number", required: true },
      },
    });
    expect(
      catalog.presets.find((preset) => preset.key === "blight-crossing"),
    ).toMatchObject({
      permissions: expect.arrayContaining(["blight:read"]),
      needs: expect.arrayContaining([{ capability: "apps", option: "track" }]),
    });
    const rule = await arm("coverage-regression", { threshold: 5 });
    const next = (await persistence.rules.getById(rule.id)).nextRunAt!;
    expect(next.slice(11)).toBe("00:10:00.000Z");
    expect(rule.rule).toMatchObject({
      select: { key: "quality.coverage.lines", filters: { branch: "main" } },
      guard: { operator: "delta", value: 5 },
    });
    const day = time.of(next).subtract(1, "day").toISOString().slice(0, 10);
    const previous = time
      .of(next)
      .subtract(2, "days")
      .toISOString()
      .slice(0, 10);
    await quality(previous, 90.75);
    await quality(day, 84.5);
    await quality(day, 10, "topic");
    await quality(next.slice(0, 10), 100);
    await time.travel(new Date(next).getTime() - time.nowMillis());
    expect(await alepha.inject(AutomationSchedules).sweep()).toBe(1);
    const ready = await persistence.receipts.getOne({
      where: { automationId: rule.id, status: "ready" },
    });
    await finish(ready.id);
    const run = await persistence.runs.getOne({
      where: { automationId: rule.id, occurrenceId: ready.occurrenceId },
    });
    expect(run).toMatchObject({
      status: "succeeded",
      snapshot: {
        selected: [
          {
            value: 84.5,
            previous: 90.75,
            day,
            previous_day: previous,
            branch: "main",
          },
        ],
      },
    });
    expect(await notificationCount()).toBe(1);
    const notification = await rows.jobs.getOne({
      where: { jobName: "system.notifications.send" },
    });
    const text = JSON.stringify(notification.payload!.variables);
    expect(text).toContain("84.5%");
    expect(text).toContain("90.75%");
    expect(text).toContain(day);
    expect(text).toContain(previous);
    expect(text).not.toContain("100%");
    const preview = await service.test(project.id, rule.id, user);
    expect(preview).toMatchObject({
      status: "preview",
      noData: false,
      guards: [{ matched: true }],
      selected: [{ previous: 90.75, value: 84.5 }],
    });
  });
  it("requires a strict greater-than drop and does not substitute another branch", async ({
    expect,
  }) => {
    const rule = await arm("coverage-regression", {
      threshold: 5,
      branch: "topic",
    });
    const day = time.now().subtract(1, "day").toISOString().slice(0, 10);
    const previous = time.now().subtract(2, "days").toISOString().slice(0, 10);
    await quality(previous, 90, "topic");
    await quality(day, 85, "topic");
    await quality(previous, 100);
    await quality(day, 0);
    const run = await sample(rule);
    expect(run).toMatchObject({
      status: "skipped",
      snapshot: {
        selected: [{ value: 85, previous: 90, branch: "topic" }],
        counts: { matched: 0, deliveries: 0 },
      },
    });
    expect(await notificationCount()).toBe(0);
  });
  it("records no_data when either exact day is missing instead of using an older/project/branch sample", async ({
    expect,
  }) => {
    const rule = await arm("coverage-regression", { threshold: 1 });
    const day = time.now().subtract(1, "day").toISOString().slice(0, 10);
    const previous = time.now().subtract(2, "days").toISOString().slice(0, 10);
    await quality(day, 80);
    await quality(
      time.now().subtract(3, "days").toISOString().slice(0, 10),
      100,
    );
    await quality(previous, 100, "topic");
    const other = await createTestProject(alepha, {
      capabilities: [{ key: "apps" }],
    });
    await quality(previous, 100, "main", other.id);
    const before = await persistence.runs.count();
    expect(await service.test(project.id, rule.id, user)).toMatchObject({
      noData: true,
      counts: { matched: 0 },
    });
    expect(await persistence.runs.count()).toBe(before);
    expect(await sample(rule)).toMatchObject({
      status: "skipped",
      snapshot: { noData: true, counts: { deliveries: 0 } },
    });
    expect(await notificationCount()).toBe(0);
  });
  it("persists aggregate crossing across restart/retry, rearms, and clears changed thresholds/scopes", async ({
    expect,
  }) => {
    await rows.sigils.create({
      projectId: project.id,
      name: "fixture/production",
      tokenHash: "fixture",
      tokenPrefix: "fixture",
      lastSeenAt: time.nowISOString(),
    });
    const first = await addBlight();
    const second = await addBlight();
    let rule = await arm("blight-crossing", { threshold: 2 });
    expect((await persistence.rules.getById(rule.id)).scheduleCron).toBe(
      "*/5 * * * *",
    );
    expect(await sample(rule)).toMatchObject({
      status: "skipped",
      snapshot: { selected: [{ value: 2 }] },
    });
    expect((await persistence.rules.getById(rule.id)).baseline).toMatchObject({
      value: 2,
    });
    await addBlight();
    expect(await persistence.events.count()).toBe(0);
    await time.travel([5, "minutes"]);
    const crossed = await sample(rule);
    expect(crossed).toMatchObject({
      status: "succeeded",
      snapshot: { selected: [{ value: 3 }] },
    });
    expect(await notificationCount()).toBe(1);
    const resumeAt = time.nowISOString();
    await alepha.stop();
    await boot(true);
    await time.travel(new Date(resumeAt).getTime() - time.nowMillis());
    await finish(
      (
        await persistence.receipts.getOne({
          where: {
            automationId: rule.id,
            occurrenceId: crossed.occurrenceId,
            kind: "occurrence",
          },
        })
      ).id,
    );
    expect(await notificationCount()).toBe(1);
    await time.travel([5, "minutes"]);
    expect((await sample(rule)).status).toBe("skipped");
    await addBlight();
    await time.travel([5, "minutes"]);
    expect((await sample(rule)).status).toBe("skipped");
    await rows.blights.updateById(first.id, { status: "resolved" });
    await rows.blights.updateById(second.id, { status: "resolved" });
    await time.travel([5, "minutes"]);
    expect((await sample(rule)).status).toBe("skipped");
    expect((await persistence.rules.getById(rule.id)).baseline).toMatchObject({
      value: 2,
    });
    await rows.blights.updateById(first.id, { status: "open" });
    await time.travel([5, "minutes"]);
    expect((await sample(rule)).status).toBe("succeeded");
    expect(await notificationCount()).toBe(2);
    rule = await service.update(project.id, rule.id, user, rule.revision, {
      title: rule.title,
      rule: { ...rule.rule!, guard: { ...rule.rule!.guard!, value: 3 } },
    });
    expect((await persistence.rules.getById(rule.id)).baseline).toBeUndefined();
    await time.travel([5, "minutes"]);
    expect((await sample(rule)).status).toBe("skipped");
    await addBlight();
    await time.travel([5, "minutes"]);
    expect((await sample(rule)).status).toBe("succeeded");
    expect(await notificationCount()).toBe(3);
    rule = await service.update(project.id, rule.id, user, rule.revision, {
      title: rule.title,
      rule: {
        ...rule.rule!,
        select: {
          kind: "scalar",
          key: "openBlights",
          filters: { status: "all" },
        },
      },
    });
    expect((await persistence.rules.getById(rule.id)).baseline).toBeUndefined();
    await time.travel([5, "minutes"]);
    expect((await sample(rule)).status).toBe("skipped");
    expect(await notificationCount()).toBe(3);
  });
});
