import {
  AutomationController,
  AutomationPersistence,
  AutomationPresetRegistry,
} from "@lore/core/api";
import { AutomationVocabulary } from "@lore/core/schemas";
import { automationLine, createPresetRanks } from "@lore/core/testing";
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
      (values) =>
        automationLine({
          trigger: {
            kind: "event",
            event: "deploy.succeeded",
            app: String(values.app),
          },
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
    // One automation (#Q3808), marked with the canonical key of its
    // presets, one source per preset, each bound to the scope.
    const rules = await live();
    expect(rules).toHaveLength(1);
    const [rule] = rules;
    expect(rule.presetKey).toBe(presets.join("+"));
    expect(rule.subscriptionScope).toBe("app=site");
    const sources = rule.rule.nodes.filter((node) => node.kind === "source");
    expect(sources.map((node) => node.id)).toEqual(
      presets.map((key) => `${key}.source`),
    );
    for (const source of sources)
      expect(source.config).toMatchObject({ app: "site" });
    expect(await get("app=site")).toEqual(on);
  });

  it("keeps two object bells independent: A on, B on, A off leaves B on", async ({
    expect,
  }) => {
    await set(true, { app: "site" });
    await set(true, { app: "api" });
    expect(await live()).toHaveLength(2);

    await set(false, { app: "site" });
    expect(await get("app=site")).toMatchObject({ subscribed: false });
    expect(await get("app=api")).toMatchObject({ subscribed: true });
    const left = await live();
    expect(left).toHaveLength(1);
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
    expect(await get()).toMatchObject({ subscribed: false });
    await set(false);
    expect(await get("app=site")).toMatchObject({ subscribed: true });
  });

  it("reads partly on when one event is switched off, and on again puts it back", async ({
    expect,
  }) => {
    const on = await set(true, { app: "site" });
    const [rule] = await live();
    // The per-event checkbox is the source switch (#Q3806).
    await api.setAutomationSourceEnabled.fetch(
      {
        params: { projectId: project.id, id: rule.id },
        body: {
          node: `${presets[0]}.source`,
          enabled: false,
          expectedRevision: rule.revision,
        },
      },
      { user },
    );
    expect(await get("app=site")).toMatchObject({
      subscribed: false,
      partial: true,
      automationId: on.automationId,
      events: [
        { preset: presets[0], enabled: false },
        { preset: presets[1], enabled: true },
      ],
    });
    // On with every event ticks it again, in the same automation.
    expect(await set(true, { app: "site" })).toMatchObject({
      subscribed: true,
      automationId: on.automationId,
    });
    // `events` keeps only some of them on.
    const some = (
      await api.setAutomationSubscription.fetch(
        {
          params: { projectId: project.id },
          body: {
            presets,
            subscribed: true,
            scope: { app: "site" },
            events: [presets[1]],
          },
        },
        { user },
      )
    ).data;
    expect(some).toMatchObject({ partial: true });
    expect(await live()).toHaveLength(1);
    // A bell source deleted by hand reads as off, and ticking it puts it
    // back.
    const current = (await live())[0];
    const without = presets[1];
    await persistence.rules.updateById(current.id, {
      rule: {
        ...current.rule,
        nodes: current.rule.nodes.filter(
          (node) => !node.id.startsWith(`${without}.`),
        ),
        edges: current.rule.edges.filter(
          (edge) => !edge.from.startsWith(`${without}.`),
        ),
      },
    });
    expect(
      (await get("app=site")).events.find((event) => event.preset === without),
    ).toMatchObject({ enabled: false });
    expect(await set(true, { app: "site" })).toMatchObject({
      subscribed: true,
    });
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
