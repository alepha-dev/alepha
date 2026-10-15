import {
  AutomationAccess,
  AutomationAuthority,
  AutomationPersistence,
} from "@lore/core/api";
import type { AutomationRule } from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha } from "alepha";
import { apiKeyEntity } from "alepha/api/keys";
import { RankService } from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import {
  ResourceGateMemoProvider,
  type UserAccountToken,
} from "alepha/security";
import { beforeEach, afterEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  TestEntityRepositories,
  createTestProject,
  createTestMember,
} from "./fixtures/entities.ts";

class AuthorityRepositories {
  public readonly keys = $repository(apiKeyEntity);
}

describe("Current automation authority", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;
  let authority: AutomationAuthority;
  let access: AutomationAccess;
  let persistence: AutomationPersistence;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let repositories: AuthorityRepositories;
  const config = (): AutomationRule => ({
    version: 1,
    trigger: { kind: "event", event: "feedback.created" },
    select: null,
    guard: null,
    actions: [
      {
        kind: "notify",
        recipient: project.createdBy,
        channel: "inbox",
        title: "Feedback",
        text: "{{title}}",
        category: "automations",
      },
    ],
  });
  const create = async (
    extra: { authorUserId?: string; authorKeyId?: string } = {},
  ) => {
    const row = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Rule",
      rule: config(),
      ...extra,
    });
    return persistence.rules.updateById(row.id, { enabled: true });
  };
  const key = async () =>
    repositories.keys.create({
      userId: user.id,
      name: crypto.randomUUID(),
      tokenHash: crypto.randomUUID(),
      tokenPrefix: "test",
      tokenSuffix: "test",
      roles: ["user"],
    });
  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "error" },
    });
    bootLore(alepha, ["api"]);
    entities = alepha.inject(TestEntityRepositories);
    repositories = alepha.inject(AuthorityRepositories);
    authority = alepha.inject(AutomationAuthority);
    access = alepha.inject(AutomationAccess);
    persistence = alepha.inject(AutomationPersistence);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "work", options: { automations: true } },
        { key: "support" },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("rechecks actual membership even for an owner field or privileged worker", async ({
    expect,
  }) => {
    const row = await create();
    expect(
      (await authority.check({ automationId: row.id, revision: 0 })).user,
    ).toMatchObject({ id: user.id, ownership: true });
    await entities.organizationMembers.deleteMany({
      organizationId: project.organizationId!,
      userId: user.id,
    });
    await expect(
      authority.check({ automationId: row.id, revision: 0 }),
    ).rejects.toThrow("current member");
    expect(await persistence.rules.getById(row.id)).toMatchObject({
      enabled: true,
      health: "paused",
      requiresApproval: true,
      authorUserId: user.id,
    });
  });

  it("permits rank renames but refuses permission loss between effects", async ({
    expect,
  }) => {
    await alepha.context.run(async () => {
      alepha.context.set(
        ResourceGateMemoProvider.KEY,
        new Map<string, Promise<unknown>>(),
      );
      const author = await entities.users.create({ roles: ["user"] });
      const ranks = alepha.inject(RankService);
      const grants = [
        "project:read",
        "automation:read",
        "automation:write",
        "feedback:read",
        "member:read",
      ];
      await ranks.save(
        project.organizationId!,
        { key: "author", name: "Author", permissions: grants },
        user,
      );
      await createTestMember(alepha, project, author.id, { rank: "author" });
      const row = await create({ authorUserId: author.id });
      await expect(
        authority.check({ automationId: row.id, revision: 0 }),
      ).resolves.toBeDefined();
      await ranks.save(
        project.organizationId!,
        { key: "author", name: "Renamed", permissions: grants },
        user,
      );
      const first = await authority.check({
        automationId: row.id,
        revision: 0,
        effect: {
          index: 0,
          action: {
            ...config().actions[0],
            kind: "notify",
            recipient: project.createdBy,
            channel: "inbox",
            title: "Done",
            text: "{{literal untrusted data}}",
            category: "automations",
          },
        },
      });
      expect(first.user.id).toBe(author.id);
      await ranks.save(
        project.organizationId!,
        {
          key: "author",
          name: "Renamed",
          permissions: grants.filter((value) => value !== "feedback:read"),
        },
        user,
      );
      await expect(
        authority.check({ automationId: row.id, revision: 0 }),
      ).rejects.toThrow("feedback:read");
    });
  });

  it("intersects current application roles with current key scope without reading its secret", async ({
    expect,
  }) => {
    const credential = await key();
    const row = await create({ authorKeyId: credential.id });
    const first = await authority.check({ automationId: row.id, revision: 0 });
    expect(first.user.credential).toEqual({
      type: "api-key",
      id: credential.id,
    });
    expect(first.user).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(first)).not.toContain(credential.tokenHash);
    await repositories.keys.updateById(credential.id, {
      permissions: ["automation:read", "automation:write", "member:read"],
    });
    await expect(
      authority.check({ automationId: row.id, revision: 0 }),
    ).rejects.toThrow("feedback:read");
    const another = await create();
    await entities.users.updateById(user.id, { roles: [] });
    await expect(
      authority.check({ automationId: another.id, revision: 0 }),
    ).rejects.toThrow("automation:write");
  });

  it("refuses revoked, expired, deleted or foreign keys and allows explicit session reauthorization", async ({
    expect,
  }) => {
    const revoked = await key();
    const row = await create({ authorKeyId: revoked.id });
    await repositories.keys.updateById(revoked.id, {
      revokedAt: alepha.inject(DateTimeProvider).nowISOString(),
    });
    await expect(
      authority.check({ automationId: row.id, revision: 0 }),
    ).rejects.toThrow("revoked");
    const expired = await key();
    await repositories.keys.updateById(expired.id, {
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    await expect(
      access.author({ authorUserId: user.id, authorKeyId: expired.id }),
    ).rejects.toThrow("expired");
    await repositories.keys.deleteById(expired.id);
    await expect(
      access.author({ authorUserId: user.id, authorKeyId: expired.id }),
    ).rejects.toThrow("no longer exists");
    const other = await entities.users.create({ roles: ["user"] });
    await expect(
      access.author({ authorUserId: other.id, authorKeyId: revoked.id }),
    ).rejects.toThrow("no longer exists");
    expect(await access.provenance(user)).toBeUndefined();
    await access.assertMutation(row, user, "enable");
    await persistence.rules.updateById(row.id, {
      authorKeyId: null,
      requiresApproval: false,
      health: "active",
      reason: null,
      revision: 1,
    });
    await expect(
      authority.check({ automationId: row.id, revision: 1 }),
    ).resolves.toBeDefined();
  });

  it("checks changed revisions, shared versions, capabilities and resolved foreign destinations", async ({
    expect,
  }) => {
    const row = await create();
    await expect(
      authority.check({ automationId: row.id, revision: 1 }),
    ).rejects.toThrow("revision changed");
    await expect(
      authority.check({
        automationId: row.id,
        revision: 0,
        variables: [{ key: "missing", version: 0 }],
      }),
    ).rejects.toThrow("versions changed");
    const next = await create();
    const foreign = await createTestProject(alepha);
    await expect(
      authority.check({
        automationId: next.id,
        revision: 0,
        effect: {
          index: 0,
          action: {
            kind: "notify",
            recipient: foreign.createdBy,
            channel: "inbox",
            title: "x",
            text: "x",
            category: "automations",
          },
        },
      }),
    ).rejects.toThrow("Member is no longer in this project");
    const last = await create();
    await entities.capabilities.updateMany(
      { projectId: project.id, key: "work" },
      { options: { automations: false } },
    );
    await expect(
      authority.check({ automationId: last.id, revision: 0 }),
    ).rejects.toThrow("automations");
  });

  it("refuses foreign rule edits and destructive AST kinds while preserving immutable authorship", async ({
    expect,
  }) => {
    const row = await create();
    const manager = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, manager.id, { rank: "admin" });
    const actor: UserAccountToken = { id: manager.id, roles: ["user"] };
    await expect(access.assertMutation(row, actor, "edit")).rejects.toThrow(
      "immutable author",
    );
    await expect(access.assertMutation(row, actor, "enable")).rejects.toThrow(
      "immutable author",
    );
    await expect(
      access.assertMutation(row, actor, "disable"),
    ).resolves.toBeUndefined();
    await expect(
      persistence.rules.updateById(row.id, { authorUserId: manager.id }),
    ).rejects.toThrow("immutable");
    for (const kind of ["project:delete", "capability:manage"]) {
      const unsafe = config();
      unsafe.actions = [{ kind } as never];
      await expect(
        persistence.rules.create({
          projectId: project.id,
          authorUserId: user.id,
          title: "Unsafe",
          rule: unsafe,
        }),
      ).rejects.toThrow();
    }
  });
});
