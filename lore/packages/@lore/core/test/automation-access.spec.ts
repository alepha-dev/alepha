import { Alepha } from "alepha";
import { RankService } from "alepha/api/organizations";
import { type UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreCoreApi } from "../src/api/index.ts";
import type { AutomationRule } from "../src/api/schemas/automationRuleSchema.ts";
import { CapabilityRegistry } from "../src/api/schemas/CapabilityRegistry.ts";
import { ProjectRankPresets } from "../src/api/security/ProjectRankPresets.ts";
import { AutomationAccess } from "../src/api/services/AutomationAccess.ts";
import { AutomationPersistence } from "../src/api/services/AutomationPersistence.ts";
import {
  CoreTestEntities,
  createPresetRanks,
  createTestMember,
  createTestProject,
} from "../src/testing/index.ts";

const definition: AutomationRule = {
  version: 1,
  trigger: { kind: "event", event: "feedback.created" },
  select: null,
  guard: null,
  actions: [
    {
      kind: "notify",
      recipient: "{{recipient}}",
      channel: "inbox",
      title: "Private message",
      text: "DO_NOT_DISCLOSE",
      category: "automations",
    },
  ],
};

describe("Automation access", () => {
  let alepha: Alepha;
  let entities: CoreTestEntities;
  let access: AutomationAccess;
  let persistence: AutomationPersistence;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:", SERVER_PORT: 0 },
    }).with(LoreCoreApi);
    entities = alepha.inject(CoreTestEntities);
    access = alepha.inject(AutomationAccess);
    persistence = alepha.inject(AutomationPersistence);
    await alepha.start();
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("has no Work option of its own and grants only new rank presets", async ({
    expect,
  }) => {
    // A baseline of Work since #Q3594: a stored `automations` key is stripped.
    expect(
      alepha
        .inject(CapabilityRegistry)
        .optionsOf("work", { automations: false }),
    ).not.toHaveProperty("automations");
    const presets = alepha.inject(ProjectRankPresets).presetsFor(["work"]);
    expect(
      presets
        .find((p) => p.key === "viewer")
        ?.permissions.filter((p) => p.startsWith("automation:")),
    ).toEqual(["automation:read"]);
    expect(
      presets
        .find((p) => p.key === "contributor")
        ?.permissions.filter((p) => p.startsWith("automation:")),
    ).toEqual(["automation:read", "automation:write"]);
    expect(presets.find((p) => p.key === "admin")?.permissions).toEqual(
      expect.arrayContaining([
        "automation:read",
        "automation:write",
        "automation:manage",
      ]),
    );
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "work", options: {} }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    const ranks = alepha.inject(RankService);
    await ranks.save(
      project.organizationId!,
      {
        key: "existing",
        name: "Existing rank",
        permissions: ["project:read", "quest:read"],
      },
      { id: project.createdBy } as UserAccountToken,
    );
    await createPresetRanks(alepha, project.id);
    expect(
      (await ranks.permissionsOf(project.organizationId!, "existing"))?.some(
        (p) => p.startsWith("automation:"),
      ),
    ).toBe(false);
  });

  it("enforces rank and scoped-key ceilings independently of membership", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "work", options: {} }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    await createPresetRanks(alepha, project.id);
    const viewer = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, viewer.id, { rank: "viewer" });
    await expect(
      access.assert(
        project.id,
        { id: viewer.id, roles: ["user"] } as UserAccountToken,
        "automation:read",
      ),
    ).resolves.toBeUndefined();
    await expect(
      access.assert(
        project.id,
        { id: viewer.id, roles: ["user"] } as UserAccountToken,
        "automation:write",
      ),
    ).rejects.toThrow("automation:write");
    const key = {
      id: project.createdBy,
      roles: ["user"],
      permissionScope: ["automation:read"],
    } as UserAccountToken;
    await expect(
      access.assert(project.id, key, "automation:read"),
    ).resolves.toBeUndefined();
    await expect(
      access.assert(project.id, key, "automation:write"),
    ).rejects.toThrow("automation:write");
  });

  it("allows managers to disable or delete a foreign rule but never edit or re-enable it", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "work", options: {} }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    await createPresetRanks(alepha, project.id);
    const admin = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, admin.id, { rank: "admin" });
    const rule = await persistence.rules.create({
      projectId: project.id,
      authorUserId: project.createdBy,
      title: "Owner rule",
      rule: definition,
    });
    const user = { id: admin.id, roles: ["user"] } as UserAccountToken;
    await expect(
      access.assertMutation(rule, user, "disable"),
    ).resolves.toBeUndefined();
    await expect(
      access.assertMutation(rule, user, "delete"),
    ).resolves.toBeUndefined();
    await expect(access.assertMutation(rule, user, "edit")).rejects.toThrow(
      "immutable author",
    );
    await expect(access.assertMutation(rule, user, "enable")).rejects.toThrow(
      "immutable author",
    );
    const outsider = {
      id: (await entities.users.create({ roles: ["admin"] })).id,
      ownership: false,
      roles: ["admin"],
    } as UserAccountToken;
    await expect(
      access.assert(project.id, outsider, "automation:manage"),
    ).rejects.toThrow("current member");
  });
});
