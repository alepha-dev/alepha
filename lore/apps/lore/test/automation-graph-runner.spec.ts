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
  createTestFolio,
  createTestProject,
  createTestQuest,
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
 * The graph runner on stored graphs (#Q3804's specs, run once storage holds
 * graphs, #Q3805): several sources in one automation, the same event on two
 * sources, and a failed branch beside one that runs.
 */
describe("Automation graphs, end to end", () => {
  let alepha: Alepha;
  let persistence: AutomationPersistence;
  let entities: TestEntityRepositories;
  let time: DateTimeProvider;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;

  const source = (
    id: string,
    type: string,
    config = {},
  ): AutomationGraphNode => ({
    id,
    kind: "source",
    type,
    config,
  });
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
  const graph = (
    nodes: AutomationGraphNode[],
    edges: [string, string][],
  ): AutomationGraphValue => ({
    version: 2,
    nodes,
    edges: edges.map(([from, to]) => ({ from, port: "out", to })),
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

  it("runs each of two sources of one automation on its own event, through one shared action", async ({
    expect,
  }) => {
    const rule = await create(
      graph(
        [
          source("offline", "host.offline"),
          source("online", "host.online"),
          notify("tell", "{{host}} changed since {{since}}"),
        ],
        [
          ["offline", "tell"],
          ["online", "tell"],
        ],
      ),
    );
    await record("host.offline", {
      host_id: "h1",
      host: "box",
      kind: "bay",
      since: "09:00",
    });
    const first = await dispatch(rule.id);
    expect(first.map((row) => row.occurrenceId)).toEqual([
      expect.stringMatching(/^event:.+:offline$/),
    ]);
    await record("host.online", {
      host_id: "h1",
      host: "box",
      kind: "bay",
      since: "09:05",
    });
    const second = await dispatch(rule.id);
    expect(second.map((row) => row.occurrenceId)).toEqual([
      expect.stringMatching(/^event:.+:online$/),
    ]);
    const runs = await persistence.runs.findMany({
      where: { automationId: rule.id },
      orderBy: "createdAt",
    });
    expect(runs.map((run) => [run.status, run.snapshot.sourceNode])).toEqual([
      ["succeeded", "offline"],
      ["succeeded", "online"],
    ]);
    // A run's snapshot holds what its source reaches, not the other source.
    expect(runs[0].snapshot.rule?.nodes.map((node) => node.id)).toEqual([
      "offline",
      "tell",
    ]);
  });

  it("reserves one occurrence per source when two sources listen to the same event", async ({
    expect,
  }) => {
    const rule = await create(
      graph(
        [
          source("any-host", "host.offline"),
          source("box-only", "host.offline"),
          source("other-only", "host.online"),
          notify("all", "any {{host}}"),
          notify("box", "box {{host}}"),
          notify("other", "other {{host}}"),
        ],
        [
          ["any-host", "all"],
          ["box-only", "box"],
          ["other-only", "other"],
        ],
      ),
    );
    await record("host.offline", {
      host_id: "h1",
      host: "box",
      kind: "bay",
      since: "09:00",
    });
    const ready = await dispatch(rule.id);
    // The third source listens to another event: no occurrence.
    expect(
      ready
        .map((row) => row.occurrenceId.split(":").at(-1) ?? "")
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["any-host", "box-only"]);
    const runs = await persistence.runs.findMany({
      where: { automationId: rule.id },
    });
    expect(runs.map((run) => run.status)).toEqual(["succeeded", "succeeded"]);
    expect(
      await persistence.receipts.count({
        automationId: rule.id,
        kind: "occurrence",
        status: "committed",
      }),
    ).toBe(2);
  });

  it("stops a refused branch alone: its sibling runs, what follows it is not reached", async ({
    expect,
  }) => {
    const folio = await createTestFolio(alepha, project, { content: "Log" });
    const quest = await createTestQuest(alepha, project, {
      title: "Tag me",
      area: "ops",
      shortId: 1001,
    });
    const rule = await create(
      graph(
        [
          source("offline", "host.offline"),
          {
            id: "a-log",
            kind: "action",
            type: "appendFolio",
            config: { folio: folio.id, text: "{{host}} went down" },
          },
          {
            id: "b-tag",
            kind: "action",
            type: "addTag",
            config: { quest: quest.id, tag: "outage" },
          },
          notify("c-tell", "{{host}} is down"),
          {
            id: "d-after",
            kind: "action",
            type: "createQuest",
            config: { title: "After the tag", description: "", area: "ops" },
          },
        ],
        [
          ["offline", "a-log"],
          ["a-log", "b-tag"],
          ["b-tag", "d-after"],
          ["offline", "c-tell"],
        ],
      ),
    );
    // The tag's quest goes between the folio write and the tag.
    alepha.inject(MidRunFault).after = async () => {
      await entities.quests.deleteById(quest.id);
    };
    await record("host.offline", {
      host_id: "h1",
      host: "box",
      kind: "bay",
      since: "09:00",
    });
    await dispatch(rule.id);
    const [run] = await persistence.runs.findMany({
      where: { automationId: rule.id },
    });
    expect(run.status).toBe("partial");
    expect(
      run.snapshot.actions.map((step) => [step.node, step.status, step.after]),
    ).toEqual([
      ["a-log", "succeeded", undefined],
      ["b-tag", "refused", undefined],
      ["c-tell", "queued", undefined],
      ["d-after", "not_reached", "b-tag"],
    ]);
    expect((await entities.folios.getById(folio.id)).content).toContain(
      "box went down",
    );
    expect(
      await entities.quests.count({
        projectId: project.id,
        title: "After the tag",
      }),
    ).toBe(0);
    // A refused step is not the author's loss: the automation stays on.
    expect(await persistence.rules.getById(rule.id)).toMatchObject({
      enabled: true,
      health: "active",
    });
  });
});
