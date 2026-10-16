import {
  AutomationController,
  AutomationPersistence,
  AutomationPresetRegistry,
  AutomationService,
  AutomationVariableService,
} from "@lore/core/api";
import type {
  AutomationPresetCreate,
  AutomationVariableApproval,
} from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { appInstances } from "@lore/deploy/schemas";
import { Alepha } from "alepha";
import { JobQueueProvider } from "alepha/api/jobs";
import { ApiKeyService } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestFolio,
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class SetupQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class SetupRace extends AutomationService {
  public before?: () => Promise<void>;
  public override async create(
    ...args: Parameters<AutomationService["create"]>
  ) {
    if (this.before) {
      const task = this.before;
      this.before = undefined;
      await task();
    }
    return super.create(...args);
  }
}
class SetupRows {
  public readonly instances = $repository(appInstances);
}

describe("Preset setup, explicit bindings and project pickers", () => {
  let alepha: Alepha;
  let api: AutomationController;
  let persistence: AutomationPersistence;
  let variables: AutomationVariableService;
  let rows: SetupRows;
  let entities: TestEntityRepositories;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: { id: string; roles: string[] };
  const create = (body: AutomationPresetCreate) =>
    api.createAutomationFromPreset.fetch(
      { params: { projectId: project.id }, body },
      { user },
    );
  const options = (
    kind: "member" | "folio" | "app" | "quest",
    offset = 0,
    limit = 50,
  ) =>
    api.getAutomationSetupOptions.fetch(
      { params: { projectId: project.id }, query: { kind, offset, limit } },
      { user },
    );
  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: SetupQueue })
      .with({ provide: AutomationService, use: SetupRace });
    bootLore(alepha);
    api = alepha.inject(AutomationController);
    persistence = alepha.inject(AutomationPersistence);
    variables = alepha.inject(AutomationVariableService);
    rows = alepha.inject(SetupRows);
    entities = alepha.inject(TestEntityRepositories);
    await alepha.start();
    alepha.inject(DateTimeProvider).pause();
    project = await createTestProject(alepha, {
      capabilities: [
        {
          key: "work",
          options: { automations: true, releases: true, epics: true },
        },
        { key: "knowledge" },
        { key: "support" },
        { key: "apps", options: { track: true, deploy: true } },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("binds every stock setup slot explicitly without creating or replacing a variable", async ({
    expect,
  }) => {
    const folio = await createTestFolio(alepha, project);
    await rows.instances.create({
      projectId: project.id,
      app: "site",
      env: "production",
    });
    const native: Record<string, string | number> = {
      recipient: user.id,
      channel: "inbox",
      folio: folio.id,
      app: "site",
      tag: "weekly",
      threshold: 5,
      branch: "main",
    };
    for (const preset of alepha.inject(AutomationPresetRegistry).all()) {
      const bindings: Record<string, AutomationVariableApproval> = {};
      for (const [slotName, slot] of Object.entries(preset.slots)) {
        expect(slot.bindable).toBe(true);
        const key = `${preset.key.replaceAll("-", "_")}_${slotName}`;
        const result = await variables.set(project.id, user, key, {
          value: {
            kind: slot.kind as
              | "text"
              | "number"
              | "member"
              | "channel"
              | "folio",
            value: native[slotName],
          },
        });
        bindings[slotName] = {
          id: result.variable.id,
          key,
          version: result.variable.version,
        };
      }
      const count = await persistence.variables.count({
        projectId: project.id,
      });
      const made = (await create({ key: preset.key, values: {}, bindings }))
        .data;
      expect(made).toMatchObject({
        enabled: false,
        revision: 0,
        presetKey: preset.key,
        authorUserId: user.id,
      });
      for (const binding of Object.values(bindings))
        expect(JSON.stringify(made.rule)).toContain(`{{${binding.key}}}`);
      expect(await persistence.variables.count({ projectId: project.id })).toBe(
        count,
      );
      expect(
        (await persistence.rules.getById(made.id)).approvedVariables,
      ).toEqual(expect.arrayContaining(Object.values(bindings)));
      if (
        preset.key === "coverage-regression" ||
        preset.key === "blight-crossing"
      ) {
        expect(made.rule?.guard?.value).toBe(`{{${bindings.threshold.key}}}`);
        expect(JSON.stringify(made.rule?.actions)).toContain(
          `{{${bindings.threshold.key}}}`,
        );
      }
    }
  });

  it("refuses stale or recreated identities, wrong types and unknown slots before saving a rule", async ({
    expect,
  }) => {
    const first = (
      await variables.set(project.id, user, "sharedRecipient", {
        value: { kind: "member", value: user.id },
      })
    ).variable;
    const stamp = { id: first.id, key: first.key, version: first.version };
    const request: AutomationPresetCreate = {
      key: "epic-completed",
      values: {},
      bindings: { recipient: stamp },
    };
    await variables.set(project.id, user, first.key, {
      id: first.id,
      version: first.version,
      value: { kind: "member", value: user.id },
    });
    await expect(create(request)).rejects.toThrow("changed");
    await variables.remove(project.id, user, first.key, first.id, 1);
    await variables.set(project.id, user, first.key, {
      value: { kind: "member", value: user.id },
    });
    await expect(create(request)).rejects.toThrow("changed");
    const text = (
      await variables.set(project.id, user, "wrongRecipient", {
        value: { kind: "text", value: user.id },
      })
    ).variable;
    await expect(
      create({
        ...request,
        bindings: { recipient: { id: text.id, key: text.key, version: 0 } },
      }),
    ).rejects.toThrow("expected a 'member'");
    await expect(
      create({ ...request, bindings: { unknown: stamp } }),
    ).rejects.toThrow("setup.unknown");
    expect(await persistence.rules.count()).toBe(0);
  });

  it("fences a variable change between preset preparation and ordinary rule creation", async ({
    expect,
  }) => {
    const variable = (
      await variables.set(project.id, user, "sharedRecipient", {
        value: { kind: "member", value: user.id },
      })
    ).variable;
    alepha.inject(SetupRace).before = async () => {
      await variables.set(project.id, user, variable.key, {
        id: variable.id,
        version: 0,
        value: { kind: "member", value: user.id },
      });
    };
    await expect(
      create({
        key: "epic-completed",
        values: {},
        bindings: {
          recipient: { id: variable.id, key: variable.key, version: 0 },
        },
      }),
    ).rejects.toThrow("Shared variable changed");
    expect(await persistence.rules.count()).toBe(0);
    expect((await persistence.variables.getById(variable.id)).version).toBe(1);
  });

  it("paginates only current-project options, deduplicates app environments and enforces a live key ceiling", async ({
    expect,
  }) => {
    const foreign = await createTestProject(alepha);
    const localFolio = await createTestFolio(alepha, project, {
      title: "Local folio",
    });
    const secondFolio = await createTestFolio(alepha, project, {
      title: "Second folio",
    });
    const foreignFolio = await createTestFolio(alepha, foreign, {
      title: "Foreign folio",
    });
    await rows.instances.create({
      projectId: project.id,
      app: "site",
      env: "production",
    });
    await rows.instances.create({
      projectId: project.id,
      app: "site",
      env: "preview",
    });
    await rows.instances.create({
      projectId: foreign.id,
      app: "foreign",
      env: "production",
    });
    const member = await entities.users.create({
      roles: ["user"],
      username: "local-member",
    });
    await createTestMember(alepha, project, member.id, { rank: "contributor" });
    const quest = await createTestQuest(alepha, project, {
      title: "Local quest",
    });
    await createTestQuest(alepha, foreign, { title: "Foreign quest" });
    const first = (await options("folio", 0, 1)).data;
    expect(first).toMatchObject({
      items: [{ value: localFolio.id, label: "Local folio" }],
      hasMore: true,
      nextOffset: 1,
    });
    expect((await options("folio", 1, 1)).data).toMatchObject({
      items: [{ value: secondFolio.id }],
      hasMore: false,
    });
    expect(JSON.stringify(first)).not.toContain(foreignFolio.id);
    expect((await options("app")).data.items).toEqual([
      { value: "site", label: "site" },
    ]);
    expect(
      (await options("member")).data.items.map((row) => row.value),
    ).toContain(member.id);
    expect((await options("quest")).data.items).toEqual([
      { value: String(quest.id), label: `#Q${quest.shortId}: Local quest` },
    ]);
    expect(
      (
        await api.getAutomationSetupOptions.fetch(
          {
            params: { projectId: project.id },
            query: { kind: "deployment", offset: 0, limit: 50 },
          },
          { user },
        )
      ).data.items,
    ).toEqual([]);
    const key = await alepha.inject(ApiKeyService).create({
      userId: user.id,
      name: "Setup read only",
      roles: ["user"],
      permissions: ["project:read", "automation:read"],
    });
    await expect(
      api.getAutomationSetupOptions.fetch(
        {
          params: { projectId: project.id },
          query: { kind: "folio", offset: 0, limit: 50 },
        },
        { request: { headers: { authorization: `Bearer ${key.token}` } } },
      ),
    ).rejects.toThrow("folio:read");
  });
});
