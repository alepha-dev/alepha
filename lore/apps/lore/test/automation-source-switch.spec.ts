import {
  AutomationController,
  AutomationEvents,
  AutomationHealth,
  AutomationPersistence,
  AutomationService,
  AutomationWorker,
} from "@lore/core/api";
import type {
  AutomationGraphNode,
  AutomationGraphValue,
} from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha, AlephaError } from "alepha";
import { JobQueueProvider } from "alepha/api/jobs";
import { RankService } from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class HeldQueue extends JobQueueProvider {
  public override async dispatch() {}
}

/**
 * Each source of an automation has its own switch and its own health
 * (#Q3806): one switched off or broken stops alone, and only a refusal
 * about the author still pauses the whole automation.
 */
describe("Automation sources, one by one", () => {
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
      title: "Alert",
      text,
    },
  });
  // A host source and a feedback source, each with its own message.
  const twoSources = (): AutomationGraphValue => ({
    version: 2,
    nodes: [
      { id: "offline", kind: "source", type: "host.offline", config: {} },
      { id: "feedback", kind: "source", type: "feedback.created", config: {} },
      notify("tell-host", "{{host}} is offline"),
      notify("tell-feedback", "{{reference}} came in"),
    ],
    edges: [
      { from: "offline", port: "out", to: "tell-host" },
      { from: "feedback", port: "out", to: "tell-feedback" },
    ],
  });
  const create = () =>
    alepha.inject(AutomationService).create(project.id, user, {
      title: "Two sources",
      enabled: true,
      rule: twoSources(),
    });
  const record = (name: string, fields: Record<string, string | number>) =>
    persistence.events.create({
      projectId: project.id,
      identity: crypto.randomUUID(),
      name: name as never,
      occurredAt: time.nowISOString(),
      replayUntil: time.now().add(90, "days").toISOString(),
      payload: {
        fields: { project: "Acme", title: "x", url: "/acme", ...fields },
        omitted: [],
      },
    });
  const finish = async (receiptId: string) => {
    let next: { receiptId: string; token?: string } | undefined = {
      receiptId,
    };
    for (let step = 0; next && step < 40; step++)
      next = await alepha.inject(AutomationWorker).step(next, 3);
    if (next) throw new AlephaError("Worker exceeded the test's bounded steps");
  };
  const dispatch = async (automationId: string) => {
    await time.travel(1, "second");
    await alepha.inject(AutomationEvents).sweep(50);
    const ready = await persistence.receipts.findMany({
      where: { automationId, kind: "occurrence", status: "ready" },
    });
    for (const receipt of ready) await finish(receipt.id);
    return ready.map((row) => row.occurrenceId.split(":").at(-1));
  };
  const host = { host_id: "h1", host: "box", kind: "bay", since: "09:00" };
  const feedback = {
    feedback_id: 1,
    shortId: 1,
    reference: "#P1",
    description: "x",
  };
  const switchSource = (
    id: string,
    node: string,
    enabled: boolean,
    expectedRevision: number,
    caller = user,
  ) =>
    alepha
      .inject(AutomationController)
      .setAutomationSourceEnabled.fetch(
        {
          params: { projectId: project.id, id },
          body: { node, enabled, expectedRevision },
        },
        { user: caller },
      )
      .then((response) => response.data);

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
    await alepha.start();
    time.pause();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "plan", options: { feedback: true } },
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

  it("switches one source off and on through its own action, the other running throughout", async ({
    expect,
  }) => {
    const rule = await create();
    const off = await switchSource(rule.id, "offline", false, rule.revision);
    expect(off.revision).toBe(rule.revision + 1);
    expect(off.sources).toMatchObject([
      {
        node: "offline",
        type: "host.offline",
        enabled: false,
        health: "active",
      },
      {
        node: "feedback",
        type: "feedback.created",
        enabled: true,
        health: "active",
      },
    ]);
    const stored = await persistence.rules.getById(rule.id);
    // Off leaves activatedAt alone: an event recorded before still reaches
    // the other source.
    expect(stored.activatedAt).toBe(
      (await persistence.rules.getById(rule.id)).activatedAt,
    );
    const activated = stored.activatedAt;
    await record("host.offline", host);
    await record("feedback.created", feedback);
    expect(await dispatch(rule.id)).toEqual(["feedback"]);

    await time.travel(1, "minute");
    const on = await switchSource(rule.id, "offline", true, off.revision);
    expect(on.sources?.[0]).toMatchObject({ node: "offline", enabled: true });
    expect((await persistence.rules.getById(rule.id)).activatedAt).not.toBe(
      activated,
    );
    await record("host.offline", host);
    expect(await dispatch(rule.id)).toEqual(["offline"]);
    await expect(
      switchSource(rule.id, "tell-host", false, on.revision),
    ).rejects.toThrow("not a source");
    await expect(
      switchSource(rule.id, "offline", false, rule.revision),
    ).rejects.toThrow("revision");
  });

  it("lets a manager switch a foreign source off, and never on", async ({
    expect,
  }) => {
    const rule = await create();
    await alepha.inject(RankService).save(
      project.organizationId!,
      {
        key: "stopper",
        name: "Stopper",
        permissions: ["project:read", "automation:manage"],
      },
      user,
    );
    const account = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, account.id, { rank: "stopper" });
    const manager = { id: account.id, roles: ["user"] };
    const off = await switchSource(
      rule.id,
      "feedback",
      false,
      rule.revision,
      manager,
    );
    // A manager reads no source: the resource is redacted, the graph not.
    expect(off.redacted).toBe(true);
    expect(
      (await persistence.rules.getById(rule.id)).rule.nodes.find(
        (node) => node.id === "feedback",
      )?.enabled,
    ).toBe(false);
    await expect(
      switchSource(rule.id, "feedback", true, off.revision, manager),
    ).rejects.toThrow("immutable author");
  });

  it("breaks the source whose capability is gone, keeps the other running, and stores health outside the revision", async ({
    expect,
  }) => {
    const rule = await create();
    await entities.capabilities.updateMany(
      { projectId: { eq: project.id }, key: { eq: "plan" } },
      { options: {} },
    );
    await alepha.inject(AutomationHealth).project(project.id);
    const stored = await persistence.rules.getById(rule.id);
    expect(stored).toMatchObject({
      health: "active",
      requiresApproval: false,
      revision: rule.revision,
      sourceHealth: {
        offline: { health: "active" },
        feedback: { health: "broken", reason: "Missing plan.feedback option" },
      },
    });
    expect(stored.reason).toContain("source 'feedback'");
    const read = await alepha
      .inject(AutomationService)
      .get(project.id, rule.id, user);
    expect(read).toMatchObject({ displayState: "active", partial: true });
    expect(read.sources?.[1]).toMatchObject({
      node: "feedback",
      health: "broken",
      reason: "Missing plan.feedback option",
    });
    // One record of the source's change, naming it.
    const transitions = await persistence.runs.findMany({
      where: { automationId: rule.id, occurrenceId: { like: "health:%" } },
    });
    expect(transitions.map((run) => run.reason)).toContain(stored.reason);

    await record("host.offline", host);
    await record("feedback.created", feedback);
    expect(await dispatch(rule.id)).toEqual(["offline"]);
    const [run] = await persistence.runs.findMany({
      where: { automationId: rule.id, occurrenceId: { notLike: "health:%" } },
    });
    expect(run.status).toBe("succeeded");

    // Every enabled source broken: the automation is.
    await entities.capabilities.updateMany(
      { projectId: { eq: project.id }, key: { eq: "ship" } },
      { options: {} },
    );
    await entities.capabilities.deleteMany({
      projectId: { eq: project.id },
      key: { eq: "ship" },
    });
    await alepha.inject(AutomationHealth).project(project.id);
    expect(await persistence.rules.getById(rule.id)).toMatchObject({
      health: "broken",
      requiresApproval: false,
    });
  });

  it("still pauses the whole automation, with its review flag, when the author loses a permission", async ({
    expect,
  }) => {
    const rule = await create();
    await entities.organizationMembers.deleteMany({
      organizationId: project.organizationId!,
      userId: user.id,
    });
    await alepha.inject(AutomationHealth).project(project.id);
    expect(await persistence.rules.getById(rule.id)).toMatchObject({
      health: "paused",
      requiresApproval: true,
    });
  });
});
