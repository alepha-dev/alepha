import {
  AutomationController,
  AutomationPersistence,
  AutomationService,
} from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha } from "alepha";
import { JobQueueProvider } from "alepha/api/jobs";
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
        { params: { projectId: project.id, key } },
        { user },
      )
    ).data;
  const set = async (subscribed: boolean, values?: Record<string, string>) =>
    (
      await api.setAutomationSubscription.fetch(
        {
          params: { projectId: project.id, key },
          body: { subscribed, ...(values ? { values } : {}) },
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
      capabilities: [{ key: "work", options: {} }, { key: "support" }],
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
    expect(await get()).toEqual({ subscribed: false });

    const on = await set(true, { channel: "email" });
    expect(on).toMatchObject({ subscribed: true, channel: "email" });

    const rules = await live();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      id: on.automationId,
      enabled: true,
      subscription: true,
      authorUserId: user.id,
      rule: { actions: [{ recipient: user.id, channel: "email" }] },
    });

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

  it("turns off by deleting the rule", async ({ expect }) => {
    await set(true);
    expect(await set(false)).toEqual({ subscribed: false });
    expect(await get()).toEqual({ subscribed: false });
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
    expect(await get()).toEqual({ subscribed: false });

    const on = await set(true);
    const rule = (await live()).find((row) => row.id === on.automationId)!;
    await alepha
      .inject(AutomationService)
      .setEnabled(project.id, rule.id, user, false, rule.revision);
    expect(await get()).toEqual({ subscribed: false });

    // On again replaces the disabled one rather than adding beside it.
    const again = await set(true);
    expect(again.subscribed).toBe(true);
    expect(again.automationId).not.toBe(on.automationId);
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

  it("is refused when the project has Work off", async ({ expect }) => {
    await entities.capabilities.deleteMany({
      projectId: project.id,
      key: "work",
    });
    await expect(get()).rejects.toThrow();
    await expect(set(true)).rejects.toThrow();
    expect(await live()).toHaveLength(0);
  });
});
