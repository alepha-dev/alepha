import {
  AutomationEvents,
  AutomationMutationContext,
  AutomationPersistence,
  AutomationService,
  AutomationWorker,
} from "@lore/core/api";
import type {
  AutomationGraphNode,
  AutomationGraphValue,
} from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { $hook, $inject, Alepha, AlephaError } from "alepha";
import { JobQueueProvider } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class HeldQueue extends JobQueueProvider {
  public override async dispatch() {}
}
/**
 * Runs `after` once, right after the first folio write of an automation
 * effect: what lets a later step's target vanish mid-run.
 */
class MidRunFault {
  protected readonly mutations = $inject(AutomationMutationContext);
  public after?: () => Promise<void>;
  protected readonly hook = $hook({
    on: "repository:update:after",
    handler: async ({ tableName }) => {
      if (tableName !== "folios" || !this.mutations.current || !this.after)
        return;
      const run = this.after;
      this.after = undefined;
      await run();
    },
  });
}

/**
 * Run history and Run test name the source and the path a run walked
 * (#Q3807): a source column the run list filters on, and what each node
 * did, derived from the plan frozen with the run.
 */
describe("Automation run paths", () => {
  let alepha: Alepha;
  let persistence: AutomationPersistence;
  let entities: TestEntityRepositories;
  let time: DateTimeProvider;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;

  const notify = (id: string, text: string): AutomationGraphNode => ({
    id,
    kind: "action",
    type: "notify",
    config: {
      recipient: user.id,
      channels: ["inbox"],
      category: "automations",
      title: "Host",
      text,
    },
  });
  const create = (rule: AutomationGraphValue) =>
    alepha.inject(AutomationService).create(project.id, user, {
      title: "Hosts",
      enabled: true,
      rule,
    });
  const record = (name: string, fields: Record<string, string>) =>
    persistence.events.create({
      projectId: project.id,
      identity: crypto.randomUUID(),
      name: name as never,
      occurredAt: time.nowISOString(),
      replayUntil: time.now().add(90, "days").toISOString(),
      payload: {
        fields: {
          project: "Acme",
          title: fields.host ?? "",
          url: "/acme",
          ...fields,
        },
        omitted: [],
      },
    });
  const finish = async (receiptId: string) => {
    let next: { receiptId: string; token?: string } | undefined = { receiptId };
    for (let step = 0; next && step < 40; step++)
      next = await alepha.inject(AutomationWorker).step(next, 3);
    if (next) throw new AlephaError("Worker exceeded the test's bounded steps");
  };
  const dispatch = async (automationId: string) => {
    await time.travel(1, "second");
    await alepha.inject(AutomationEvents).sweep(50);
    const ready = await persistence.receipts.findMany({
      where: { automationId, kind: "occurrence", status: "ready" },
      orderBy: "occurrenceId",
    });
    for (const receipt of ready) await finish(receipt.id);
    return ready;
  };

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: HeldQueue });
    bootLore(alepha);
    persistence = alepha.inject(AutomationPersistence);
    entities = alepha.inject(TestEntityRepositories);
    time = alepha.inject(DateTimeProvider);
    alepha.inject(MidRunFault);
    await alepha.start();
    time.pause();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "plan" },
        { key: "remember" },
        { key: "ship", options: { track: true } },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  const branching = (): AutomationGraphValue => ({
    version: 2,
    nodes: [
      { id: "offline", kind: "source", type: "host.offline", config: {} },
      { id: "online", kind: "source", type: "host.online", config: {} },
      {
        id: "bay",
        kind: "condition",
        type: "compare",
        config: { field: "kind", operator: "eq", value: "bay" },
      },
      notify("yes", "{{host}} is a Bay host"),
      notify("no", "{{host}} is something else"),
      notify("back", "{{host}} is back"),
    ],
    edges: [
      { from: "offline", port: "out", to: "bay" },
      { from: "bay", port: "true", to: "yes" },
      { from: "bay", port: "false", to: "no" },
      { from: "online", port: "out", to: "back" },
    ],
  });
  const host = { host_id: "h1", host: "box", kind: "bay", since: "09:00" };

  it("records the source that started a run and what each node did, ports included", async ({
    expect,
  }) => {
    const rule = await create(branching());
    await record("host.offline", host);
    await dispatch(rule.id);
    const [stored] = await persistence.runs.findMany({
      where: { automationId: rule.id, occurrenceId: { notLike: "health:%" } },
    });
    expect(stored.sourceNode).toBe("offline");
    const run = await alepha
      .inject(AutomationService)
      .run(project.id, stored.id, user);
    expect(run.sourceNode).toBe("offline");
    expect(run.nodes).toEqual([
      { node: "offline", outcome: "ran" },
      { node: "bay", outcome: "ran", port: "true" },
      { node: "no", outcome: "skipped" },
      { node: "yes", outcome: "ran" },
    ]);
  });

  it("filters the run list by source, on the column", async ({ expect }) => {
    const rule = await create(branching());
    await record("host.offline", host);
    await dispatch(rule.id);
    await record("host.online", host);
    await dispatch(rule.id);
    const service = alepha.inject(AutomationService);
    const all = await service.runs(project.id, rule.id, user);
    expect(all.items.filter((run) => run.sourceNode)).toHaveLength(2);
    const online = await service.runs(project.id, rule.id, user, {
      source: "online",
    });
    expect(online.items.map((run) => run.sourceNode)).toEqual(["online"]);
    expect(online.items[0].nodes).toEqual([
      { node: "online", outcome: "ran" },
      { node: "back", outcome: "ran" },
    ]);
  });

  it("tests from a chosen source, reports the walked path, and writes nothing", async ({
    expect,
  }) => {
    const rule = await create(branching());
    const event = await record("host.offline", { ...host, kind: "cloudflare" });
    const service = alepha.inject(AutomationService);
    await expect(
      service.test(project.id, rule.id, user, { kind: "event", id: event.id }),
    ).rejects.toThrow("Choose the source to start from: offline, online");
    const before = {
      runs: await persistence.runs.count({ automationId: rule.id }),
      receipts: await persistence.receipts.count({ automationId: rule.id }),
    };
    const report = await service.test(
      project.id,
      rule.id,
      user,
      { kind: "event", id: event.id },
      "offline",
    );
    expect(report.sourceNode).toBe("offline");
    expect(report.nodes).toEqual([
      { node: "offline", outcome: "ran" },
      { node: "bay", outcome: "ran", port: "false" },
      { node: "no", outcome: "ran" },
      { node: "yes", outcome: "skipped" },
    ]);
    expect(report.operations.map((operation) => operation.node)).toEqual([
      "no",
    ]);
    expect(await persistence.runs.count({ automationId: rule.id })).toBe(
      before.runs,
    );
    expect(await persistence.receipts.count({ automationId: rule.id })).toBe(
      before.receipts,
    );
  });

  it("tests a past run from that run's source and refuses another", async ({
    expect,
  }) => {
    const rule = await create({
      version: 2,
      nodes: [
        { id: "first", kind: "source", type: "host.offline", config: {} },
        { id: "second", kind: "source", type: "host.offline", config: {} },
        notify("tell-first", "{{host}} one"),
        notify("tell-second", "{{host}} two"),
      ],
      edges: [
        { from: "first", port: "out", to: "tell-first" },
        { from: "second", port: "out", to: "tell-second" },
      ],
    });
    await record("host.offline", host);
    await dispatch(rule.id);
    const service = alepha.inject(AutomationService);
    const runs = await service.runs(project.id, rule.id, user, {
      source: "first",
    });
    const run = { kind: "run" as const, id: runs.items[0].id };
    const report = await service.test(project.id, rule.id, user, run, "first");
    expect(report.status).toBe("preview");
    const refused = await service.test(
      project.id,
      rule.id,
      user,
      run,
      "second",
    );
    expect(refused).toMatchObject({ status: "refused" });
    expect(refused.reason).toContain("does not match");
  });
});
