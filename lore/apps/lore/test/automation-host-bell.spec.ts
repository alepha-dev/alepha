import { AutomationController, AutomationPersistence } from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha } from "alepha";
import { JobQueueProvider } from "alepha/api/jobs";
import { RankService } from "alepha/api/organizations";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class BellQueue extends JobQueueProvider {
  public override async dispatch() {}
}

/**
 * One bell, one automation (#Q3808): the host bell names four presets and
 * two channels, and makes a single automation with four sources, each
 * wired to its own notification on both channels.
 */
describe("The host bell", () => {
  let alepha: Alepha;
  let api: AutomationController;
  let persistence: AutomationPersistence;
  let entities: TestEntityRepositories;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let owner: UserAccountToken;
  const presets = [
    "host-credential-invalid",
    "host-expired",
    "host-offline",
    "host-online",
  ];
  const set = (
    caller: UserAccountToken,
    body: { subscribed: boolean; channels?: string[] },
  ) =>
    api.setAutomationSubscription
      .fetch(
        {
          params: { projectId: project.id },
          body: { presets, title: "Host alerts", ...body },
        },
        { user: caller },
      )
      .then((response) => response.data);

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: BellQueue });
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    api = alepha.inject(AutomationController);
    persistence = alepha.inject(AutomationPersistence);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "ship", options: { track: true } }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    owner = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("makes exactly one automation with four sources on two channels", async ({
    expect,
  }) => {
    const on = await set(owner, {
      subscribed: true,
      channels: ["inbox", "email"],
    });
    expect(on).toMatchObject({
      subscribed: true,
      channels: ["email", "inbox"],
    });
    const rules = await persistence.rules.findMany({
      where: { projectId: project.id },
    });
    expect(rules).toHaveLength(1);
    const [rule] = rules;
    expect(rule).toMatchObject({
      title: "Host alerts",
      presetKey: presets.join("+"),
      subscription: true,
      enabled: true,
    });
    expect(
      rule.rule.nodes
        .filter((node) => node.kind === "source")
        .map((node) => node.id),
    ).toEqual(presets.map((key) => `${key}.source`));
    const notifies = rule.rule.nodes.filter((node) => node.kind === "action");
    expect(notifies).toHaveLength(4);
    for (const node of notifies)
      expect(node.config).toMatchObject({
        recipient: owner.id,
        channels: ["inbox", "email"],
      });
    // Each event keeps its own wording.
    expect(new Set(notifies.map((node) => node.config.title)).size).toBe(4);
    expect(on.events.map((event) => event.title)).toEqual([
      "Host token invalid",
      "Host past its TTL",
      "Host offline",
      "Host back online",
    ]);
  });

  it("lets a member without automation:write change its channels and mute one event", async ({
    expect,
  }) => {
    await alepha.inject(RankService).save(
      project.organizationId!,
      {
        key: "watcher",
        name: "Watcher",
        permissions: ["project:read", "host:read"],
      },
      owner,
    );
    const account = await entities.users.create({ roles: ["user"] });
    await entities.members.create({
      organizationId: project.organizationId!,
      userId: account.id,
      rank: "watcher",
    });
    const member = { id: account.id, roles: ["user"] } as UserAccountToken;

    const on = await set(member, { subscribed: true, channels: ["inbox"] });
    expect(on.subscribed).toBe(true);
    const both = await set(member, {
      subscribed: true,
      channels: ["inbox", "email"],
    });
    expect(both).toMatchObject({
      automationId: on.automationId,
      channels: ["email", "inbox"],
    });
    const muted = (
      await api.setAutomationSourceEnabled.fetch(
        {
          params: { projectId: project.id, id: on.automationId! },
          body: {
            node: "host-online.source",
            enabled: false,
            expectedRevision: both.revision!,
          },
        },
        { user: member },
      )
    ).data;
    expect(muted.id).toBe(on.automationId);
    const state = (
      await api.getAutomationSubscription.fetch(
        {
          params: { projectId: project.id },
          query: { presets: presets.join(",") },
        },
        { user: member },
      )
    ).data;
    expect(state).toMatchObject({ subscribed: false, partial: true });
    expect(
      state.events
        .filter((event) => !event.enabled)
        .map((event) => event.preset),
    ).toEqual(["host-online"]);
    // Off deletes it.
    expect(await set(member, { subscribed: false })).toMatchObject({
      subscribed: false,
    });
    expect(await persistence.rules.count({ projectId: project.id })).toBe(0);
  });
});
