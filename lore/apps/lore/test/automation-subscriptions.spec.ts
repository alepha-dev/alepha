import {
  AutomationController,
  AutomationPersistence,
  AutomationService,
} from "@lore/core/api";
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

class SubscriptionQueue extends JobQueueProvider {
  public override async dispatch() {}
}

describe("Automation subscriptions (#Q3576)", () => {
  let alepha: Alepha;
  let api: AutomationController;
  let persistence: AutomationPersistence;
  let entities: TestEntityRepositories;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  const key = "feedback-created";
  const get = async () =>
    (
      await api.getAutomationSubscription.fetch(
        { params: { projectId: project.id }, query: { presets: key } },
        { user },
      )
    ).data;
  const set = async (subscribed: boolean, values?: Record<string, string>) =>
    (
      await api.setAutomationSubscription.fetch(
        {
          params: { projectId: project.id },
          body: { presets: [key], subscribed, ...(values ? { values } : {}) },
        },
        { user },
      )
    ).data;
  const live = () =>
    persistence.rules.findMany({
      where: { projectId: project.id, presetKey: key },
    });

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: SubscriptionQueue });
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    api = alepha.inject(AutomationController);
    persistence = alepha.inject(AutomationPersistence);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "plan", options: { feedback: true } }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("turns on as one enabled rule marked as the caller's subscription, and reads on after a reload", async ({
    expect,
  }) => {
    expect(await get()).toMatchObject({ subscribed: false, partial: false });

    const on = await set(true, { channel: "email" });
    expect(on).toMatchObject({
      subscribed: true,
      partial: false,
      channels: ["email"],
      events: [{ preset: key, node: `${key}.source`, enabled: true }],
      additions: false,
    });

    const rules = await live();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      id: on.automationId,
      enabled: true,
      subscription: true,
      authorUserId: user.id,
    });
    expect(
      rules[0].rule.nodes.find((node) => node.id === `${key}.action-1`)?.config,
    ).toMatchObject({ recipient: user.id, channels: ["email"] });

    // A reload asks the server again: the state is not the client's.
    expect(await get()).toEqual(on);
    // It stays an ordinary rule, listed with its marker.
    const listed = (
      await api.listAutomations.fetch(
        { params: { projectId: project.id }, query: {} },
        { user },
      )
    ).data.items;
    expect(listed.find((item) => item.id === on.automationId)).toMatchObject({
      subscription: true,
      enabled: true,
    });

    // On again changes nothing.
    expect(await set(true, { channel: "inbox" })).toEqual(on);
    expect(await live()).toHaveLength(1);
  });

  it("notifies on in-app and email at once from one automation, and changes channels in place, keeping nodes added on the canvas (#Q3602, #Q3808)", async ({
    expect,
  }) => {
    const channels = (subscribed: boolean, list: string[]) =>
      api.setAutomationSubscription.fetch(
        {
          params: { projectId: project.id },
          body: { presets: [key], subscribed, channels: list },
        },
        { user },
      );

    const both = (await channels(true, ["inbox", "email"])).data;
    expect(both).toMatchObject({
      subscribed: true,
      channels: ["email", "inbox"],
    });
    const [rule] = await live();
    expect(await live()).toHaveLength(1);
    expect(
      rule.rule.nodes.find((node) => node.id === `${key}.action-1`)?.config
        .channels,
    ).toEqual(["inbox", "email"]);
    // Reopening reads the same channels back.
    expect((await get()).channels).toEqual(["email", "inbox"]);

    // The same set again changes nothing, not even the revision.
    await channels(true, ["email", "inbox"]);
    expect((await live())[0].revision).toBe(rule.revision);

    // Its author adds a node of their own on the canvas.
    const added = {
      ...rule.rule,
      nodes: [
        ...rule.rule.nodes,
        {
          id: "mine",
          kind: "action" as const,
          type: "notify",
          config: {
            recipient: user.id,
            channels: ["inbox"],
            title: "Mine",
            text: "{{title}}",
            category: "automations",
          },
        },
      ],
      edges: [
        ...rule.rule.edges,
        { from: `${key}.source`, port: "out" as const, to: "mine" },
      ],
    };
    await alepha
      .inject(AutomationService)
      .update(project.id, rule.id, user, rule.revision, {
        title: rule.title,
        rule: added,
      });
    expect((await get()).additions).toBe(true);

    // Another set edits the bell's own nodes in place: same automation,
    // one revision, the added node untouched.
    const one = (await channels(true, ["inbox"])).data;
    expect(one).toMatchObject({ subscribed: true, channels: ["inbox"] });
    const [edited] = await live();
    expect(edited.id).toBe(rule.id);
    expect(edited.revision).toBe(rule.revision + 2);
    expect(
      edited.rule.nodes.find((node) => node.id === "mine")?.config.channels,
    ).toEqual(["inbox"]);
    expect(
      edited.rule.nodes.find((node) => node.id === `${key}.action-1`)?.config
        .channels,
    ).toEqual(["inbox"]);

    // An empty set is refused: at least one channel.
    await expect(channels(true, [])).rejects.toThrow();

    // Off deletes the automation, what was added included.
    expect(await set(false)).toMatchObject({ subscribed: false });
    expect(await live()).toHaveLength(0);
  });

  it("turns off by deleting the rule", async ({ expect }) => {
    await set(true);
    expect(await set(false)).toMatchObject({
      subscribed: false,
      partial: false,
    });
    expect(await get()).toMatchObject({ subscribed: false, partial: false });
    expect(await live()).toHaveLength(0);
  });

  it("ignores a rule made from the preset by hand, and reads a subscription disabled by hand as off", async ({
    expect,
  }) => {
    await api.createAutomationFromPreset.fetch(
      {
        params: { projectId: project.id },
        body: { key, values: { recipient: user.id }, enabled: true },
      },
      { user },
    );
    expect(await get()).toMatchObject({ subscribed: false, partial: false });

    const on = await set(true);
    const rule = (await live()).find((row) => row.id === on.automationId)!;
    await alepha
      .inject(AutomationService)
      .setEnabled(project.id, rule.id, user, false, rule.revision);
    expect(await get()).toMatchObject({ subscribed: false, partial: false });

    // On again switches the same automation back on (#Q3808).
    const again = await set(true);
    expect(again.subscribed).toBe(true);
    expect(again.automationId).toBe(on.automationId);
    const marked = (await live()).filter((row) => row.subscription);
    expect(marked.map((row) => row.id)).toEqual([again.automationId]);
    // The hand-made rule is left alone, by on and by off.
    await set(false);
    expect(await live()).toHaveLength(1);
  });

  it("never lets the caller pick another recipient", async ({ expect }) => {
    await expect(set(true, { recipient: "someone-else" })).rejects.toThrow(
      "setup.recipient",
    );
    expect(await live()).toHaveLength(0);
  });

  it("reads off and refuses to turn on when the preset's capability is off", async ({
    expect,
  }) => {
    // Automations are Core since #Q3629: the state reads without Plan, and
    // the preset's own need (Plan's feedback option) refuses the rule.
    await entities.capabilities.deleteMany({
      projectId: project.id,
      key: "plan",
    });
    expect(await get()).toMatchObject({ subscribed: false, partial: false });
    await expect(set(true)).rejects.toThrow("plan");
    expect(await live()).toHaveLength(0);
  });

  describe("a member whose rank authors no automation (#Q3648)", () => {
    const seat = async (key: string, permissions: string[]) => {
      await alepha
        .inject(RankService)
        .save(project.organizationId!, { key, name: key, permissions }, user);
      const account = await entities.users.create({ roles: ["user"] });
      await entities.members.create({
        organizationId: project.organizationId!,
        userId: account.id,
        rank: key,
      });
      return { id: account.id, roles: ["user"] } as UserAccountToken;
    };
    const setAs = (caller: UserAccountToken, subscribed: boolean) =>
      api.setAutomationSubscription.fetch(
        {
          params: { projectId: project.id },
          body: { presets: [key], subscribed },
        },
        { user: caller },
      );

    it("subscribes to what it reads, without automation:write, and switches it off", async ({
      expect,
    }) => {
      const reader = await seat("reader", ["project:read", "feedback:read"]);

      const on = (await setAs(reader, true)).data;
      expect(on.subscribed).toBe(true);
      const [rule] = await persistence.rules.findMany({
        where: { projectId: project.id, authorUserId: reader.id },
      });
      expect(rule).toMatchObject({
        enabled: true,
        subscription: true,
        health: "active",
        requiresApproval: false,
      });
      expect(
        rule.rule.nodes.find((node) => node.id === `${key}.action-1`)?.config,
      ).toMatchObject({ recipient: reader.id });

      // Its own rule, kept as the toggle made it: editing asks for
      // automation:write like any rule.
      await expect(
        api.updateAutomation.fetch(
          {
            params: { projectId: project.id, id: rule.id },
            body: {
              title: "Rewritten",
              rule: rule.rule,
              expectedRevision: rule.revision,
            },
          },
          { user: reader },
        ),
      ).rejects.toThrow("automation:write");

      expect((await setAs(reader, false)).data).toMatchObject({
        subscribed: false,
        partial: false,
      });
      expect(
        await persistence.rules.findMany({
          where: { projectId: project.id, authorUserId: reader.id },
        }),
      ).toHaveLength(0);
    });

    it("cannot subscribe to what its rank does not read", async ({
      expect,
    }) => {
      const viewer = await seat("peek", ["project:read", "quest:read"]);

      await expect(setAs(viewer, true)).rejects.toThrow();
      expect(
        await persistence.rules.findMany({
          where: { projectId: project.id, authorUserId: viewer.id },
        }),
      ).toHaveLength(0);
    });
  });
});
