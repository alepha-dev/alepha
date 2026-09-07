import { $hook, Alepha, z } from "alepha";
import { $entity, $repository, AlephaOrm, db } from "alepha/orm";
import {
  $owns,
  $permission,
  $role,
  AlephaSecurity,
  ResourceGrantsProvider,
  type UserAccountToken,
} from "alepha/security";
import { $action, AlephaServer, ForbiddenError } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import { RankController } from "../controllers/RankController.ts";
import { AlephaApiRanks } from "../index.ts";
import { $rankResource } from "../primitives/$rankResource.ts";
import { RankService } from "../services/RankService.ts";

const projects = $entity({
  name: "rank_projects",
  schema: z.object({
    id: db.primaryKey(z.text()),
    title: z.text(),
  }),
});

const members = $entity({
  name: "rank_members",
  schema: z.object({
    id: db.primaryKey(z.text()),
    projectId: z.text(),
    userId: z.text(),
    rank: z.text(),
  }),
});

/**
 * A single-tenant application's user table: the "membership" row IS the user
 * row, and there is no scope to derive because there is only one.
 */
const staff = $entity({
  name: "rank_staff",
  schema: z.object({
    id: db.primaryKey(z.text()),
    rank: z.text(),
  }),
});

/**
 * The permissions this spec's ranks name.
 *
 * `$secure` registers whatever a gate is given, so `quest:create` and
 * `project:read` are in the registry already - but `project:delete` is only
 * ever named as a CEILING, by a rank that must be refused, and a ceiling on a
 * permission nothing declares is refused for the wrong reason.
 */
class Permissions {
  projectDelete = $permission({ group: "project", name: "delete" });
  rankManage = $permission({ group: "rank", name: "manage" });
}

class Roles {
  /**
   * ⚠️ `ownership: true` matters. The placeholder realm's `admin` grants `*`
   * unrestricted, which `$secure` resolves to `ownership: false` and `$owns`
   * treats as a privileged bypass - under it every case here passes whatever
   * the gate does.
   */
  member = $role({
    name: "member",
    permissions: [{ name: "*", ownership: true }],
  });
}

/**
 * Lore's shape: a scope derived from a route param, the assignment on the
 * membership row the gate already read.
 */
class ProjectRanks {
  projects = $repository(projects);
  members = $repository(members);

  project = $rankResource({
    type: "project",
    scope: ({ authority }) =>
      typeof authority?.id === "string" && "title" in authority
        ? authority.id
        : undefined,
    rank: ({ membership }) => membership?.rank as string | undefined,
    builtins: [
      { key: "owner", name: "Owner", permissions: ["*"] },
      { key: "member", name: "Member", permissions: ["project:read"] },
      // The other kind of built-in: a DEFAULT rather than a rule. Both are
      // non-removable; only this one accepts a rewrite.
      {
        key: "guest",
        name: "Guest",
        permissions: ["project:read"],
        configurable: true,
      },
    ],
    ownerOnly: ["project:delete"],
    floor: ["project:read"],
    manage: "rank:manage",
    load: async (scopeId, user) =>
      await this.members.findOne({
        where: { projectId: { eq: scopeId }, userId: { eq: user.id } },
      }),
    countHolders: async (scopeId, key) =>
      await this.members.count({
        projectId: { eq: scopeId },
        rank: { eq: key },
      }),
    assign: async (scopeId, userId, key) => {
      const row = await this.members.findOne({
        where: { projectId: { eq: scopeId }, userId: { eq: userId } },
      });
      if (row) {
        await this.members.updateById(row.id, { rank: key });
      }
    },
  });
}

/**
 * A single-tenant application's shape: the scope is a CONSTANT, and the
 * assignment is a column on the user row the session was built from.
 *
 * ⚠️ The constant is the point. Modelling "one scope" as a null scope would
 * make `UNIQUE(type, scopeId, key)` useless on SQLite, where NULLs are
 * distinct in a unique index.
 */
class ClubRanks {
  staff = $repository(staff);

  club = $rankResource({
    type: "club",
    scope: ({ authority }) =>
      authority?.club === true ? "the-club" : undefined,
    rank: ({ membership }) => membership?.rank as string | undefined,
    builtins: [
      { key: "administrateur", name: "Administrateur", permissions: ["*"] },
      { key: "accueil", name: "Accueil", permissions: ["project:read"] },
    ],
    load: async (_scopeId, user) => await this.staff.findById(user.id),
  });
}

class App {
  projects = $repository(projects);
  members = $repository(members);
  staff = $repository(staff);

  protected readonly authenticate = $hook({
    on: "server:onRequest",
    priority: "first",
    handler: ({ request }) => {
      request.user = { id: "u1", realm: "default", roles: ["member"] };
    },
  });

  createQuest = $action({
    schema: {
      params: z.object({ id: z.text() }),
      response: z.text(),
    },
    use: [
      $owns({
        repository: () => this.projects,
        param: "id",
        requires: "quest:create",
        via: {
          repository: () => this.members,
          resource: "projectId",
          user: "userId",
        },
      }),
    ],
    handler: ({ params }) => params.id,
  });

  readProject = $action({
    schema: {
      params: z.object({ id: z.text() }),
      response: z.text(),
    },
    use: [
      $owns({
        repository: () => this.projects,
        param: "id",
        requires: "project:read",
        via: {
          repository: () => this.members,
          resource: "projectId",
          user: "userId",
        },
      }),
    ],
    handler: ({ params }) => params.id,
  });
}

interface Ctx {
  alepha: Alepha;
  app: App;
  ranks: RankService;
  api: RankController;
}

const setup = async (): Promise<Ctx> => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiRanks);
  alepha.inject(Roles);
  alepha.inject(Permissions);
  alepha.inject(ProjectRanks);
  alepha.inject(ClubRanks);
  const app = alepha.inject(App);

  await alepha.start();

  await app.projects.create({ id: "p1", title: "Alpha" });

  return {
    alepha,
    app,
    ranks: alepha.inject(RankService),
    api: alepha.inject(RankController),
  };
};

const token = (id: string): UserAccountToken => ({
  id,
  realm: "default",
  roles: ["member"],
});

describe("alepha/api/ranks", () => {
  let ctx: Ctx;

  afterEach(async () => {
    await ctx?.alepha.stop();
  });

  it("substitutes the grants provider when the module is registered", async ({
    expect,
  }) => {
    ctx = await setup();
    expect(ctx.alepha.inject(ResourceGrantsProvider).constructor.name).toBe(
      "RankGrantsProvider",
    );
  });

  it("answers from the built-ins with no row stored at all", async ({
    expect,
  }) => {
    ctx = await setup();
    await ctx.app.members.create({
      id: "m1",
      projectId: "p1",
      userId: "u1",
      rank: "member",
    });

    // A scope nobody has customised stores zero definitions.
    const ranks = await ctx.ranks.ranksOf("project", "p1");
    expect(ranks.map((it) => it.key)).toEqual(["owner", "member", "guest"]);
    expect(ranks.every((it) => it.builtin)).toBe(true);

    await expect(
      ctx.app.readProject.run({ params: { id: "p1" } }, { user: token("u1") }),
    ).resolves.toBe("p1");

    await expect(
      ctx.app.createQuest.run({ params: { id: "p1" } }, { user: token("u1") }),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("lets a stored definition widen what a rank grants", async ({
    expect,
  }) => {
    ctx = await setup();
    await ctx.app.members.create({
      id: "m1",
      projectId: "p1",
      userId: "u1",
      rank: "contributor",
    });

    await ctx.ranks.save(
      "project",
      "p1",
      {
        key: "contributor",
        name: "Contributor",
        permissions: ["project:read", "quest:create"],
      },
      // A privileged writer: the subset rule is exercised on its own below.
      { id: "root", realm: "default", ownership: false },
    );

    await expect(
      ctx.app.createQuest.run({ params: { id: "p1" } }, { user: token("u1") }),
    ).resolves.toBe("p1");
  });

  it("resolves an assignment with no query of its own", async ({ expect }) => {
    ctx = await setup();
    await ctx.app.members.create({
      id: "m1",
      projectId: "p1",
      userId: "u1",
      rank: "member",
    });

    // The stop condition, as a test: `rank()` is synchronous, so there is
    // nowhere in the resolution path to put a read of the assignment. If this
    // ever needs an `await`, the design is wrong.
    const resolved = await ctx.ranks.resolve({
      user: token("u1"),
      authority: { id: "p1", title: "Alpha" },
      membership: { projectId: "p1", userId: "u1", rank: "member" },
    });

    expect(resolved).toMatchObject({
      type: "project",
      scopeId: "p1",
      key: "member",
      permissions: ["project:read"],
    });
  });

  it("serves a constant scope as readily as a derived one", async ({
    expect,
  }) => {
    ctx = await setup();
    await ctx.app.staff.create({ id: "u9", rank: "accueil" });

    const resolved = await ctx.ranks.resolve({
      user: token("u9"),
      authority: { club: true },
      membership: { rank: "accueil" },
    });

    expect(resolved).toMatchObject({
      type: "club",
      scopeId: "the-club",
      key: "accueil",
    });

    // And through the imperative door, which is the only one a single-tenant
    // app with no resource gate has.
    await expect(
      ctx.ranks.can("club", "the-club", "project:read", token("u9")),
    ).resolves.toBe(true);
    await expect(
      ctx.ranks.can("club", "the-club", "quest:create", token("u9")),
    ).resolves.toBe(false);
  });

  it("refuses a permission nothing declares", async ({ expect }) => {
    ctx = await setup();
    await expect(
      ctx.ranks.save(
        "project",
        "p1",
        {
          key: "custom",
          name: "Custom",
          permissions: ["project:read", "not:a:thing"],
        },
        { id: "root", realm: "default", ownership: false },
      ),
    ).rejects.toThrowError("not a permission this application declares");
  });

  it("refuses admin:* and the owner-only ceiling", async ({ expect }) => {
    ctx = await setup();
    const root: UserAccountToken = {
      id: "root",
      realm: "default",
      ownership: false,
    };

    await expect(
      ctx.ranks.save(
        "project",
        "p1",
        { key: "c", name: "C", permissions: ["project:read", "admin:users"] },
        root,
      ),
    ).rejects.toThrowError("cannot be granted by a rank");

    await expect(
      ctx.ranks.save(
        "project",
        "p1",
        {
          key: "c",
          name: "C",
          permissions: ["project:read", "project:delete"],
        },
        root,
      ),
    ).rejects.toThrowError("belongs to the owner");
  });

  it("refuses a definition that withholds a floor permission", async ({
    expect,
  }) => {
    ctx = await setup();
    await expect(
      ctx.ranks.save(
        "project",
        "p1",
        { key: "c", name: "C", permissions: ["quest:create"] },
        { id: "root", realm: "default", ownership: false },
      ),
    ).rejects.toThrowError('Every rank holds "project:read"');
  });

  it("refuses a writer granting more than they hold", async ({ expect }) => {
    ctx = await setup();
    await ctx.app.members.create({
      id: "m1",
      projectId: "p1",
      userId: "u1",
      rank: "member",
    });

    // `member` grants `project:read` and nothing else, so it cannot hand out
    // `quest:create` - re-checked here rather than trusted from whatever the
    // editor rendered.
    await expect(
      ctx.ranks.save(
        "project",
        "p1",
        {
          key: "c",
          name: "C",
          permissions: ["project:read", "quest:create"],
        },
        token("u1"),
      ),
    ).rejects.toThrowError("cannot grant a permission you do not hold");
  });

  it("refuses editing or deleting a declared built-in", async ({ expect }) => {
    ctx = await setup();
    const root: UserAccountToken = {
      id: "root",
      realm: "default",
      ownership: false,
    };

    await expect(
      ctx.ranks.save(
        "project",
        "p1",
        { key: "member", name: "Renamed", permissions: ["project:read"] },
        root,
      ),
    ).rejects.toThrowError("built-in rank and cannot be edited");

    await expect(
      ctx.ranks.remove("project", "p1", "member", root),
    ).rejects.toThrowError("built-in rank cannot be deleted");
  });

  it("accepts a rewrite of a configurable built-in, and reads it back", async ({
    expect,
  }) => {
    ctx = await setup();
    const root: UserAccountToken = {
      id: "root",
      realm: "default",
      ownership: false,
    };

    await ctx.ranks.save(
      "project",
      "p1",
      {
        key: "guest",
        name: "Visiteur",
        permissions: ["project:read", "quest:create"],
      },
      root,
    );

    const guest = (await ctx.ranks.ranksOf("project", "p1")).find(
      (it) => it.key === "guest",
    );

    // Read back from the ROW, not from the declaration. Without that half,
    // the edit is accepted and then silently reset on the next boot, which is
    // exactly what the refusal on a plain built-in exists to prevent.
    expect(guest?.name).toBe("Visiteur");
    expect(guest?.permissions).toContain("quest:create");
    // Still built-in, so still non-removable, and still editable - the two
    // are not opposites, which is the whole reason `editable` exists.
    expect(guest?.builtin).toBe(true);
    expect(guest?.editable).toBe(true);
  });

  it("still refuses to delete a configurable built-in", async ({ expect }) => {
    ctx = await setup();
    const root: UserAccountToken = {
      id: "root",
      realm: "default",
      ownership: false,
    };

    await ctx.ranks.save(
      "project",
      "p1",
      { key: "guest", name: "Visiteur", permissions: ["project:read"] },
      root,
    );

    // Editing one wrote a row, and a row is what `remove` deletes. The
    // built-in half has to survive that, or "configurable" would quietly mean
    // "removable once touched".
    await expect(
      ctx.ranks.remove("project", "p1", "guest", root),
    ).rejects.toThrowError("built-in rank cannot be deleted");
  });

  it("refuses deleting a rank somebody still holds", async ({ expect }) => {
    ctx = await setup();
    const root: UserAccountToken = {
      id: "root",
      realm: "default",
      ownership: false,
    };

    await ctx.ranks.save(
      "project",
      "p1",
      { key: "c", name: "Custom", permissions: ["project:read"] },
      root,
    );
    await ctx.app.members.create({
      id: "m1",
      projectId: "p1",
      userId: "u1",
      rank: "c",
    });

    await expect(
      ctx.ranks.remove("project", "p1", "c", root),
    ).rejects.toThrowError("still hold");

    // Reassign, then it goes.
    await ctx.app.members.updateById("m1", { rank: "member" });
    await expect(
      ctx.ranks.remove("project", "p1", "c", root),
    ).resolves.toBeUndefined();
  });

  it("keeps the assignment out of the definitions cache", async ({
    expect,
  }) => {
    ctx = await setup();
    await ctx.app.members.create({
      id: "m1",
      projectId: "p1",
      userId: "u1",
      rank: "member",
    });

    await expect(
      ctx.ranks.can("project", "p1", "project:read", token("u1")),
    ).resolves.toBe(true);

    // Revoked between two calls, inside the definitions cache window. The
    // assignment is never cached, so this takes effect immediately - which is
    // the whole reason the two are cached differently.
    await ctx.app.members.deleteById("m1");

    await expect(
      ctx.ranks.can("project", "p1", "project:read", token("u1")),
    ).resolves.toBe(false);
  });

  it("serves the catalogue and the scope's ranks over HTTP", async ({
    expect,
  }) => {
    ctx = await setup();
    const root: UserAccountToken = {
      id: "root",
      realm: "default",
      ownership: false,
    };

    const catalogue = await ctx.api.getRankCatalogue({}, { user: root });
    const groups = catalogue.groups.map((it) => it.name);
    // Whatever `$secure` and `$permission` named is in here, and nothing else:
    // the editor and the write path read the same list, so a matrix cannot
    // offer a permission a rank would then be refused.
    expect(groups).toContain("project");
    expect(groups).toContain("quest");

    const listed = await ctx.api.getRanks(
      { params: { type: "project", scopeId: "p1" } },
      { user: root },
    );
    expect(listed.items.map((it) => it.key)).toEqual([
      "owner",
      "member",
      "guest",
    ]);
  });

  it("writes, assigns and deletes through the module's own endpoints", async ({
    expect,
  }) => {
    ctx = await setup();
    const root: UserAccountToken = {
      id: "root",
      realm: "default",
      ownership: false,
    };
    await ctx.app.members.create({
      id: "m1",
      projectId: "p1",
      userId: "u1",
      rank: "member",
    });

    await ctx.api.saveRank(
      {
        params: { type: "project", scopeId: "p1", key: "contributor" },
        body: {
          name: "Contributor",
          permissions: ["project:read", "quest:create"],
        },
      },
      { user: root },
    );

    await ctx.api.assignRank(
      {
        params: { type: "project", scopeId: "p1", userId: "u1" },
        body: { key: "contributor" },
      },
      { user: root },
    );

    // The assignment was written by the RESOURCE, not by this module: it does
    // not own the column and cannot reach it.
    await expect(
      ctx.app.createQuest.run({ params: { id: "p1" } }, { user: token("u1") }),
    ).resolves.toBe("p1");

    await expect(
      ctx.api.deleteRank(
        { params: { type: "project", scopeId: "p1", key: "contributor" } },
        { user: root },
      ),
    ).rejects.toThrowError("still hold");
  });
});
