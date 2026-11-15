import {
  AutomationController,
  AutomationPersistence,
  AutomationPresetRegistry,
} from "@lore/core/api";
import { AutomationVocabulary } from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { appInstances } from "@lore/ship/schemas";
import { Alepha } from "alepha";
import { JobQueueProvider } from "alepha/api/jobs";
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

class ScopeQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class ScopeRows {
  public readonly instances = $repository(appInstances);
}

/**
 * Bells with a scope and several presets (#Q3635): one toggle can cover two
 * presets, the bells of two objects on the same presets are independent,
 * and a list's bell shares state with neither.
 */
describe("Automation subscriptions with a scope (#Q3635)", () => {
  let alepha: Alepha;
  let api: AutomationController;
  let persistence: AutomationPersistence;
  let entities: TestEntityRepositories;
  let rows: ScopeRows;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  // Two presets on the same `app` slot: the stock `deploy-failed`, and a
  // recovery twin registered here.
  const presets = ["deploy-failed", "deploy-succeeded-spec"];
  const get = async (scope = "") =>
    (
      await api.getAutomationSubscription.fetch(
        {
          params: { projectId: project.id },
          query: { presets: presets.join(","), scope },
        },
        { user },
      )
    ).data;
  const set = async (subscribed: boolean, scope?: Record<string, string>) =>
    (
      await api.setAutomationSubscription.fetch(
        {
          params: { projectId: project.id },
          body: { presets, subscribed, ...(scope ? { scope } : {}) },
        },
        { user },
      )
    ).data;
  const live = () =>
    persistence.rules.findMany({
      where: { projectId: project.id, subscription: true },
    });

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: ScopeQueue });
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    rows = alepha.inject(ScopeRows);
    api = alepha.inject(AutomationController);
    persistence = alepha.inject(AutomationPersistence);
    await alepha.start();
    const source = new AutomationVocabulary().find("deploy.succeeded")!;
    alepha.inject(AutomationPresetRegistry).register(
      {
        key: "deploy-succeeded-spec",
        title: "Deployment succeeded",
        description: "Spec twin of deploy-failed, on deploy.succeeded.",
        source: source.key,
        fields: source.fields,
        needs: source.needs,
        permissions: ["automation:write", "member:read", ...source.permissions],
        slots: {
          app: {
            kind: "text",
            bindable: true,
            resource: "app",
            required: true,
            min: 1,
            max: 255,
          },
          recipient: { kind: "member", required: true, bindable: true },
          channel: {
            kind: "channel",
            bindable: true,
            required: true,
            default: "inbox",
            values: ["inbox", "email"],
          },
        },
      },
      (values) => ({
        version: 1,
        trigger: {
          kind: "event",
          event: "deploy.succeeded",
          app: String(values.app),
        },
        select: null,
        guard: null,
        actions: [
          {
            kind: "notify",
            recipient: String(values.recipient),
            channel: String(values.channel),
            category: "automations",
            title: "Deployment succeeded: {{app}}",
            text: "{{url}}",
          },
        ],
      }),
    );
    project = await createTestProject(alepha, {
      capabilities: [{ key: "ship", options: { deploy: true } }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
    for (const app of ["site", "api"])
      await rows.instances.create({
        projectId: project.id,
        app,
        env: "production",
      });
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("covers both presets with one toggle, bound to its scope", async ({
    expect,
  }) => {
    const on = await set(true, { app: "site" });
    expect(on).toMatchObject({ subscribed: true });
    const rules = await live();
    expect(
      rules
        .map((rule) => rule.presetKey)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(presets);
    for (const rule of rules) {
      expect(rule.subscriptionScope).toBe("app=site");
      expect(rule.rule.trigger).toMatchObject({ app: "site" });
    }
    expect(await get("app=site")).toEqual(on);
  });

  it("keeps two object bells independent: A on, B on, A off leaves B on", async ({
    expect,
  }) => {
    await set(true, { app: "site" });
    await set(true, { app: "api" });
    expect(await live()).toHaveLength(4);

    await set(false, { app: "site" });
    expect(await get("app=site")).toEqual({ subscribed: false });
    expect(await get("app=api")).toMatchObject({ subscribed: true });
    const left = await live();
    expect(left).toHaveLength(2);
    expect(left.every((rule) => rule.subscriptionScope === "app=api")).toBe(
      true,
    );
  });

  it("keeps a list bell independent of the object bells", async ({
    expect,
  }) => {
    await set(true, { app: "site" });
    // The list bell binds nothing, so it reads off while an object bell is
    // on, and turning it off touches no object bell.
    expect(await get()).toEqual({ subscribed: false });
    await set(false);
    expect(await get("app=site")).toMatchObject({ subscribed: true });
  });

  it("reads off when one of its presets' rules is disabled by hand", async ({
    expect,
  }) => {
    await set(true, { app: "site" });
    const [first] = await live();
    await persistence.rules.updateById(first.id, { enabled: false });
    expect(await get("app=site")).toEqual({ subscribed: false });
    // On again replaces the stray rather than keeping it beside.
    await set(true, { app: "site" });
    expect(await live()).toHaveLength(2);
  });

  it("refuses a setup value that the scope already binds", async ({
    expect,
  }) => {
    await expect(
      api.setAutomationSubscription.fetch(
        {
          params: { projectId: project.id },
          body: {
            presets,
            subscribed: true,
            scope: { app: "site" },
            values: { app: "api" },
          },
        },
        { user },
      ),
    ).rejects.toThrow("setup.app");
  });
});
