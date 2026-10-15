import {
  AutomationCatalog,
  AutomationPersistence,
  AutomationVariables,
} from "@lore/core/api";
import type { AutomationRule } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { RankService } from "alepha/api/organizations";
import type { UserAccountToken } from "alepha/security";
import { beforeEach, afterEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  TestEntityRepositories,
  createTestProject,
  createTestMember,
  createTestFolio,
} from "./fixtures/entities.ts";

describe("Shared automation variables", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;
  let variables: AutomationVariables;
  let persistence: AutomationPersistence;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  const rule = (recipient: string): AutomationRule => ({
    version: 1,
    trigger: { kind: "event", event: "feedback.created" },
    select: null,
    guard: null,
    actions: [
      {
        kind: "notify",
        recipient,
        channel: "inbox",
        title: "Feedback",
        text: "{{body}}",
        category: "automations",
      },
    ],
  });
  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "error" },
    });
    bootLore(alepha, ["api"]);
    entities = alepha.inject(TestEntityRepositories);
    variables = alepha.inject(AutomationVariables);
    persistence = alepha.inject(AutomationPersistence);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "work", options: { automations: true, releases: true } },
        { key: "support" },
        { key: "knowledge" },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("saves all six native kinds, stable IDs and finite bounded values", async ({
    expect,
  }) => {
    const folio = await createTestFolio(alepha, project);
    const release = await entities.releases.create({
      projectId: project.id,
      number: 1,
      title: "Next",
    });
    const values = [
      { kind: "number" as const, value: 12.5 },
      { kind: "text" as const, value: "{{literal_data}}" },
      { kind: "member" as const, value: user.id },
      { kind: "folio" as const, value: folio.id },
      { kind: "release" as const, value: release.id },
      { kind: "channel" as const, value: "email" },
    ];
    for (const [index, value] of values.entries()) {
      const saved = await variables.set(project.id, user, {
        key: `target_${index}`,
        value,
      });
      expect(saved.variable).toMatchObject({ version: 0, value });
    }
    await expect(
      variables.set(project.id, user, {
        key: "huge",
        value: { kind: "number", value: Infinity },
      }),
    ).rejects.toThrow();
    await expect(
      variables.set(project.id, user, {
        key: "unconfigured",
        value: { kind: "channel", value: "discord" },
      }),
    ).rejects.toThrow("not configured");
    await expect(
      variables.set(project.id, user, {
        key: "title",
        value: { kind: "text", value: "reserved" },
      }),
    ).rejects.toThrow("reserved");
    await expect(
      variables.set(project.id, user, {
        key: "constructor",
        value: { kind: "text", value: "reserved" },
      }),
    ).rejects.toThrow("reserved");
  });

  it("rejects foreign resources and validates closed or removed references again at runtime", async ({
    expect,
  }) => {
    const other = await createTestProject(alepha);
    const foreign = await createTestFolio(alepha, other);
    await expect(
      variables.set(project.id, user, {
        key: "target",
        value: { kind: "folio", value: foreign.id },
      }),
    ).rejects.toThrow("this project");
    const release = await entities.releases.create({
      projectId: project.id,
      number: 1,
      title: "Next",
    });
    await variables.set(project.id, user, {
      key: "release_target",
      value: { kind: "release", value: release.id },
    });
    const config: AutomationRule = {
      version: 1,
      trigger: { kind: "event", event: "quest.completed" },
      select: null,
      guard: null,
      actions: [
        {
          kind: "assignRelease",
          quest: "{{quest_id}}",
          release: "{{release_target}}",
        },
      ],
    };
    const stored = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Assign",
      rule: config,
    });
    expect((await variables.snapshot(stored, user))[0]).toMatchObject({
      key: "release_target",
      version: 0,
      value: { value: release.id },
    });
    await entities.releases.updateById(release.id, {
      releasedAt: "2026-10-15T12:00:00.000Z",
    });
    await expect(variables.snapshot(stored, user)).rejects.toThrow("published");
    expect(await persistence.rules.getById(stored.id)).toMatchObject({
      health: "paused",
      requiresApproval: true,
    });
  });

  it("pauses for a removed member or deleted folio rather than using stale IDs", async ({
    expect,
  }) => {
    const recipient = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, recipient.id, { rank: "owner" });
    await variables.set(project.id, user, {
      key: "destination",
      value: { kind: "member", value: recipient.id },
    });
    const config = rule("{{destination}}");
    config.actions = [
      {
        kind: "notify",
        recipient: "{{destination}}",
        channel: "inbox",
        title: "x",
        text: "x",
        category: "automations",
      },
    ];
    const consumer = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Removed recipient",
      rule: config,
    });
    await entities.organizationMembers.deleteMany({
      organizationId: project.organizationId!,
      userId: recipient.id,
    });
    await expect(variables.snapshot(consumer, user)).rejects.toThrow(
      "Member is no longer in this project",
    );
    expect(await persistence.rules.getById(consumer.id)).toMatchObject({
      health: "paused",
      requiresApproval: true,
    });
    const folio = await createTestFolio(alepha, project);
    await variables.set(project.id, user, {
      key: "destination_folio",
      value: { kind: "folio", value: folio.id },
    });
    config.actions = [
      { kind: "appendFolio", folio: "{{destination_folio}}", text: "x" },
    ];
    const append = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Removed folio",
      rule: config,
    });
    await entities.folios.deleteById(folio.id);
    await expect(variables.snapshot(append, user)).rejects.toThrow(
      "Folio does not exist in this project",
    );
    expect(await persistence.rules.getById(append.id)).toMatchObject({
      health: "paused",
      requiresApproval: true,
    });
  });

  it("versions edits and pauses foreign authors without changing enabled intent or authorship", async ({
    expect,
  }) => {
    await variables.set(project.id, user, {
      key: "body",
      value: { kind: "text", value: "First" },
    });
    const second = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, second.id, { rank: "owner" });
    const own = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Own",
      rule: rule(user.id),
    });
    const foreign = await persistence.rules.create({
      projectId: project.id,
      authorUserId: second.id,
      title: "Foreign",
      rule: rule(user.id),
    });
    await persistence.rules.updateById(own.id, { enabled: true });
    await persistence.rules.updateById(foreign.id, { enabled: true });
    expect(await variables.dependents(project.id, user, "body")).toHaveLength(
      2,
    );
    const result = await variables.set(project.id, user, {
      key: "body",
      value: { kind: "text", value: "Second" },
      version: 0,
    });
    expect(result.variable).toMatchObject({
      version: 1,
      value: { value: "Second" },
    });
    expect(result.affected).toHaveLength(2);
    expect(await persistence.rules.getById(own.id)).toMatchObject({
      enabled: true,
      health: "active",
      authorUserId: user.id,
      revision: 1,
    });
    expect(await persistence.rules.getById(foreign.id)).toMatchObject({
      enabled: true,
      health: "paused",
      requiresApproval: true,
      authorUserId: second.id,
      revision: 1,
    });
    await expect(
      variables.set(project.id, user, {
        key: "body",
        value: { kind: "text", value: "Stale" },
        version: 0,
      }),
    ).rejects.toThrow("version changed");
    await expect(variables.remove(project.id, user, "body", 1)).rejects.toThrow(
      "referenced",
    );
  });

  it("refuses an incompatible edit before mutating same-author rules", async ({
    expect,
  }) => {
    await variables.set(project.id, user, {
      key: "destination",
      value: { kind: "member", value: user.id },
    });
    const config = rule("{{destination}}");
    config.actions = [
      {
        kind: "notify",
        recipient: "{{destination}}",
        channel: "inbox",
        title: "x",
        text: "x",
        category: "automations",
      },
    ];
    const stored = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Bound",
      rule: config,
    });
    await expect(
      variables.set(project.id, user, {
        key: "destination",
        value: { kind: "text", value: user.id },
        version: 0,
      }),
    ).rejects.toThrow("expected 'member'");
    expect(await persistence.rules.getById(stored.id)).toMatchObject({
      revision: 0,
    });
    expect(
      await persistence.variables.getOne({
        where: { projectId: project.id, key: "destination" },
      }),
    ).toMatchObject({ version: 0, value: { kind: "member" } });
  });

  it("checks recipient source reads without requiring the author's write permissions", async ({
    expect,
  }) => {
    const recipient = await entities.users.create({ roles: ["user"] });
    await alepha.inject(RankService).save(
      project.organizationId!,
      {
        key: "source-reader",
        name: "Source reader",
        permissions: ["project:read", "feedback:read"],
      },
      user,
    );
    await createTestMember(alepha, project, recipient.id, {
      rank: "source-reader",
    });
    await variables.set(project.id, user, {
      key: "destination",
      value: { kind: "member", value: recipient.id },
    });
    const config = rule("{{destination}}");
    config.actions = [
      {
        kind: "notify",
        recipient: "{{destination}}",
        channel: "inbox",
        title: "x",
        text: "x",
        category: "automations",
      },
    ];
    await expect(
      alepha.inject(AutomationCatalog).validate(project.id, user, config),
    ).resolves.toBeDefined();
    await alepha.inject(RankService).save(
      project.organizationId!,
      {
        key: "source-reader",
        name: "Source reader",
        permissions: ["project:read"],
      },
      user,
    );
    await expect(
      alepha.inject(AutomationCatalog).validate(project.id, user, config),
    ).rejects.toThrow("Recipient lacks source permission feedback:read");
  });

  it("deletes only unused current versions and treats placeholder-looking values as data", async ({
    expect,
  }) => {
    await variables.set(project.id, user, {
      key: "body",
      value: { kind: "text", value: "{{untrusted}}" },
    });
    const stored = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Literal data",
      rule: rule(user.id),
    });
    expect(await variables.snapshot(stored, user)).toMatchObject([
      { key: "body", version: 0, value: { value: "{{untrusted}}" } },
    ]);
    expect([...variables.references(rule(user.id))]).toEqual(["body"]);
    await persistence.rules.deleteById(stored.id);
    await expect(variables.remove(project.id, user, "body", 7)).rejects.toThrow(
      "version changed",
    );
    await variables.remove(project.id, user, "body", 0);
    expect(await persistence.variables.count({ projectId: project.id })).toBe(
      0,
    );
  });
});
