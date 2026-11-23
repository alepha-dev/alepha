import {
  DefaultRankService,
  LorePermissions,
  LoreViewerAllowlist,
  ProjectController,
  ProjectRankController,
  ProjectRankPresets,
} from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha } from "alepha";
import { RankService } from "alepha/api/organizations";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreCoreApi } from "../src/api/index.ts";
import {
  createTestMember,
  createTestProject,
  CoreTestEntities,
} from "../src/testing/index.ts";

interface Ctx {
  alepha: Alepha;
  repos: CoreTestEntities;
  ranks: RankService;
  presets: ProjectRankPresets;
  projects: ProjectController;
}

/**
 * Pinned `DATABASE_URL`, like every other lore spec: the ROOT vitest config
 * points it at Postgres, which this app's SQLite provider refuses outright.
 */
const setup = async (): Promise<Ctx> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreCoreApi);

  const repos = alepha.inject(CoreTestEntities);

  await alepha.start();

  return {
    alepha,
    repos,
    ranks: alepha.inject(RankService),
    presets: alepha.inject(ProjectRankPresets),
    projects: alepha.inject(ProjectController),
  };
};

const root: UserAccountToken = {
  id: "00000000-0000-4000-8000-0000000000ff",
  realm: "users",
  ownership: false,
};

const organizationIdOf = async (ctx: Ctx, projectId: number) =>
  (await ctx.repos.projects.findById(projectId))!.organizationId!;

describe("Lore's rank resource", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("gives a project that never touched its ranks exactly today's access", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);

    // ⚠️ The acceptance criterion of the whole epic, as one assertion. A
    // fixture project stores ZERO definition rows, so every rank comes from
    // code (Admin too since #Q3920) and `member` is what a NULL
    // `members.rank` column reads as.
    const ranks = await ctx.ranks.ranksOf(project.organizationId!);
    expect(ranks.map((it) => it.key)).toEqual(["owner", "member", "admin"]);

    const member = await ctx.ranks.permissionsOf(
      project.organizationId!,
      "member",
    );
    expect(member?.sort()).toEqual([...LorePermissions.MEMBER_DEFAULT].sort());

    // And the owner holds everything, listed as a wildcard rather than
    // enumerated: an owner written out permission by permission falls behind
    // every time a new one is declared.
    const owner = await ctx.ranks.permissionsOf(
      project.organizationId!,
      "owner",
    );
    expect(owner).toContain("*");
  });

  it("refuses owner as an assignment target", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const invitee = await ctx.repos.users.create({});
    await ctx.repos.members.create({
      organizationId: project.organizationId!,
      userId: invitee.id,
    });

    // Ownership is transferred, not handed out: a project with two owners is
    // a state nothing else in this app can express.
    await expect(
      ctx.ranks.assign(project.organizationId!, invitee.id, "owner", root),
    ).rejects.toThrow("transferred, not assigned");
  });

  it("refuses the ceiling and requires the floor", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const scope = project.organizationId!;

    for (const ceiling of LorePermissions.OWNER_ONLY) {
      await expect(
        ctx.ranks.save(
          scope,
          { key: "c", name: "C", permissions: ["project:read", ceiling] },
          root,
        ),
      ).rejects.toThrow("belongs to the owner");
    }

    await expect(
      ctx.ranks.save(
        scope,
        { key: "c", name: "C", permissions: ["quest:read"] },
        root,
      ),
    ).rejects.toThrow('Every rank holds "project:read"');
  });

  it("computes a preset from the capabilities the project actually has", ({
    expect,
  }) => {
    const everything = ctx.presets.presetsFor([
      "plan",
      "remember",
      "build",
      "ship",
      "chat",
    ]);
    // Two presets since #Q3661: Member, a built-in, covers Contributor.
    expect(everything.map((it) => it.key)).toEqual(["admin", "viewer"]);

    // Remember only: Viewer loses the Plan reads. A checkbox for a
    // capability the project does not have grants nothing and explains
    // nothing. Admin is not narrowed (#Q3736): it holds everything, so a
    // capability switched on later is already covered.
    const knowledgeOnly = ctx.presets.presetsFor(["remember"]);
    const remembersAdmin = knowledgeOnly.find((it) => it.key === "admin")!;
    expect(remembersAdmin.permissions).toContain("quest:create");
    expect(remembersAdmin.permissions).toContain("folio:write");
    expect(
      knowledgeOnly.find((it) => it.key === "viewer")!.permissions,
    ).toEqual([
      "project:read",
      "member:read",
      "stats:read",
      "folio:read",
      // Hosts are Core since #E166: a Viewer reads them with Ship off.
      "host:read",
      "subscription:read",
    ]);

    // Core survives every capability being off, which is a legal state.
    const nothing = ctx.presets.presetsFor([]);
    for (const preset of nothing) {
      expect(preset.permissions).toContain("project:read");
    }

    // Admin is everything but deleting the project (#Q3736).
    const admin = everything.find((it) => it.key === "admin")!;
    expect(LorePermissions.OWNER_ONLY).toEqual(["project:delete"]);
    expect(admin.permissions).toContain("member:manage");
    expect(admin.permissions).toContain("rank:manage");
    expect(admin.permissions).toContain("capability:manage");
    // Build (#E162): a Member pushes, an Admin manages repositories, a
    // Viewer clones.
    expect(LorePermissions.MEMBER_DEFAULT).toEqual(
      expect.arrayContaining(["code:read", "code:write"]),
    );
    expect(LorePermissions.MEMBER_DEFAULT).not.toContain("code:admin");
    expect(admin.permissions).toEqual(
      expect.arrayContaining(["code:read", "code:write", "code:admin"]),
    );
    expect(everything.find((it) => it.key === "viewer")!.permissions).toContain(
      "code:read",
    );
    expect(
      everything.find((it) => it.key === "viewer")!.permissions,
    ).not.toContain("code:write");
    expect([...admin.permissions].sort()).toEqual(
      [...LorePermissions.MEMBER_DEFAULT, ...LorePermissions.OWNER_TODAY]
        .filter((it) => it !== "project:delete")
        .sort(),
    );

    // Viewer is every `:read` and nothing else (#Q3833): the member list,
    // subscriptions, apps, errors, hosts, reports and feedback included.
    const viewer = everything.find((it) => it.key === "viewer")!;
    expect([...viewer.permissions].sort()).toEqual(
      [...LorePermissions.MEMBER_DEFAULT, ...LorePermissions.OWNER_TODAY]
        .filter(
          (it, index, all) => it.endsWith(":read") && all.indexOf(it) === index,
        )
        .sort(),
    );
    for (const read of ["member:read", "subscription:read", "feedback:read"]) {
      expect(viewer.permissions).toContain(read);
    }
    expect(LoreViewerAllowlist.isReadOnly(viewer.permissions)).toBe(true);
  });

  it("starts a new project with owner, admin, member and viewer", async ({
    expect,
  }) => {
    // #Q3661 reverses #Q2511: every project starts with the four ranks.
    const account = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: account.id, roles: ["user"] };

    const created = await ctx.projects.createProject(
      { body: { title: "Four Ranks" } },
      { user },
    );

    const organizationId = await organizationIdOf(ctx, created.id);
    const ranks = await ctx.ranks.ranksOf(organizationId);
    expect(
      ranks.map((it) => it.key).sort((a, b) => a.localeCompare(b)),
    ).toEqual(["admin", "member", "owner", "viewer"]);
    // Built in since #Q3736: renamable and editable, never deleted.
    for (const key of ["owner", "admin", "member", "viewer"]) {
      expect(ranks.find((it) => it.key === key)?.builtin).toBe(true);
      expect(ranks.find((it) => it.key === key)?.renamable).toBe(true);
      await expect(ctx.ranks.delete(organizationId, key, user)).rejects.toThrow(
        "A built-in rank cannot be deleted",
      );
    }
    const viewer = ranks.find((it) => it.key === "viewer")!.permissions;
    expect(viewer).toEqual(
      expect.arrayContaining(["quest:read", "member:read"]),
    );
    expect(LoreViewerAllowlist.isReadOnly(viewer)).toBe(true);

    // The creator's membership row says owner, which is what the whole epic
    // reads afterwards.
    const membership = await ctx.repos.members.findOne({
      where: {
        organizationId: { eq: organizationId },
        userId: { eq: account.id },
      },
    });
    expect(membership?.rank).toBe("owner");

    // Create rank offers the three bases, each as this project holds it.
    const offered = await ctx.alepha
      .inject(ProjectRankController)
      .getRankPresets({ params: { projectId: created.id } }, { user });
    expect(offered.items.map((it) => it.key)).toEqual([
      "admin",
      "member",
      "viewer",
    ]);
    expect(
      offered.items.find((it) => it.key === "member")?.permissions,
    ).toEqual(ranks.find((it) => it.key === "member")?.permissions);
  });

  it("offers a base as the project holds it now, and the preset where the rank is missing", async ({
    expect,
  }) => {
    const account = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: account.id, roles: ["user"] };
    const created = await ctx.projects.createProject(
      { body: { title: "Tuned bases" } },
      { user },
    );
    const organizationId = await organizationIdOf(ctx, created.id);

    // The owner widens Admin's name and drops Viewer altogether.
    const admin = (await ctx.ranks.ranksOf(organizationId)).find(
      (it) => it.key === "admin",
    )!;
    await ctx.ranks.save(
      organizationId,
      { key: "admin", name: "Maintainer", permissions: admin.permissions },
      user,
    );
    // A Viewer missing altogether: a project from before #Q3661 that the
    // sweep has not reached. The service refuses the delete since #Q3736.
    await ctx.repos.organizationRanks.deleteMany({
      organizationId: { eq: organizationId },
      key: { eq: "viewer" },
    });

    const { items } = await ctx.alepha
      .inject(ProjectRankController)
      .getRankPresets({ params: { projectId: created.id } }, { user });

    expect(items.find((it) => it.key === "admin")?.name).toBe("Maintainer");
    const viewer = items.find((it) => it.key === "viewer")!.permissions;
    expect(viewer).toContain("member:read");
    expect(LoreViewerAllowlist.isReadOnly(viewer)).toBe(true);
  });

  it("resets a project to the four built-ins, moving holders of a hand-made Admin to admin", async ({
    expect,
  }) => {
    // A project from before #Q3736: no owner row, Viewer missing, Admin
    // narrowed by hand, a hand-made "Administrateur" and a legacy
    // contributor, each held by somebody.
    const project = await createTestProject(ctx.alepha, {
      capabilities: [{ key: "plan", options: {} }],
    });
    const organizationId = project.organizationId!;
    await ctx.repos.organizationRanks.deleteMany({
      organizationId: { eq: organizationId },
    });
    await ctx.repos.organizationMembers.deleteMany({
      organizationId: { eq: organizationId },
    });
    for (const [key, name] of [
      ["admin", "Staff"],
      ["rmw1", " Administrateur "],
      ["contributor", "Contributor"],
    ]) {
      await ctx.repos.organizationRanks.create({
        organizationId,
        key,
        name,
        permissions: ["project:read"],
      });
    }
    const handMade = await ctx.repos.users.create({});
    const contributor = await ctx.repos.users.create({});
    await createTestMember(ctx.alepha, project, handMade.id, { rank: "rmw1" });
    await createTestMember(ctx.alepha, project, contributor.id, {
      rank: "contributor",
    });

    const result = await ctx.alepha
      .inject(DefaultRankService)
      .reset(project.id);

    expect(result.rewritten).toEqual(["admin", "viewer"]);
    expect([...result.removed].sort()).toEqual(["contributor", "rmw1"]);
    const ranks = await ctx.ranks.ranksOf(organizationId);
    expect(
      ranks.map((it) => it.key).sort((a, b) => a.localeCompare(b)),
    ).toEqual(["admin", "member", "owner", "viewer"]);
    const admin = ranks.find((it) => it.key === "admin")!;
    // Admin is a default rank (#Q3920): its row goes, name and all, and it
    // reads the preset again.
    expect(admin.name).toBe("Admin");
    expect(admin.permissions).toEqual(ProjectRankPresets.ADMIN);
    expect(ranks.find((it) => it.key === "viewer")?.name).toBe("Viewer");

    const rankOf = async (userId: string) =>
      (
        await ctx.repos.organizationMembers.findOne({
          where: {
            organizationId: { eq: organizationId },
            userId: { eq: userId },
          },
        })
      )?.rank ?? null;
    expect(await rankOf(handMade.id)).toBe("admin");
    expect(await rankOf(contributor.id)).toBeNull();
  });

  it("backfills viewer where missing, holds admin with no row, and leaves a stored viewer as it is", async ({
    expect,
  }) => {
    // A project from before #Q3833: owner and member only, plus the narrow
    // Viewer the open-project allowlist seeded. Widening it is an admin's
    // call, never the sweep's.
    const project = await createTestProject(ctx.alepha, {
      capabilities: [{ key: "plan", options: {} }],
    });
    const organizationId = project.organizationId!;
    const narrow = ["project:read", "quest:read", "folio:read"];
    await ctx.ranks.save(
      organizationId,
      { key: "viewer", name: "Viewer", permissions: narrow },
      { id: project.createdBy, roles: ["user"] },
    );

    const added = await ctx.alepha
      .inject(DefaultRankService)
      .backfill(project.id);

    // Admin needs no row: the framework reads it from the code (#Q3920).
    expect(added).toEqual([]);
    const ranks = await ctx.ranks.ranksOf(organizationId);
    expect(ranks.find((it) => it.key === "admin")?.permissions).toEqual(
      ProjectRankPresets.ADMIN,
    );
    expect(ranks.find((it) => it.key === "viewer")?.permissions).toEqual(
      narrow,
    );
    // A second pass has nothing to do.
    expect(
      await ctx.alepha.inject(DefaultRankService).backfill(project.id),
    ).toEqual([]);
  });

  it("lets a stale Admin snapshot follow the default, and keeps a narrowed or recent one", async ({
    expect,
  }) => {
    const late = DefaultRankService.ADMIN_LATE_PERMISSIONS;
    const snapshot = ProjectRankPresets.ADMIN.filter(
      (it) => !late.includes(it),
    );
    const before = "2026-11-16T10:00:00.000Z";
    const write = async (permissions: string[], updatedAt: string) => {
      const project = await createTestProject(ctx.alepha, {
        capabilities: [{ key: "plan", options: {} }],
      });
      const organizationId = project.organizationId!;
      await ctx.repos.organizationRanks.create({
        organizationId,
        key: "admin",
        name: "Admin",
        // A permission the automations declared, gone since #Q3896.
        permissions: [...permissions, "automation:manage"],
        createdAt: updatedAt,
        updatedAt,
      } as never);
      return organizationId;
    };
    const stale = await write(snapshot, before);
    const narrowed = await write(
      snapshot.filter((it) => it !== "member:manage"),
      before,
    );
    const recent = await write(snapshot, "2026-11-21T10:00:00.000Z");

    expect(
      await ctx.alepha.inject(DefaultRankService).dropStaleAdmins(),
    ).toBeGreaterThanOrEqual(1);

    const adminOf = async (organizationId: string) =>
      (
        await ctx.repos.organizationRanks.findMany({
          where: {
            organizationId: { eq: organizationId },
            key: { eq: "admin" },
          },
        })
      ).length;
    expect(await adminOf(stale)).toBe(0);
    expect(await adminOf(narrowed)).toBe(1);
    expect(await adminOf(recent)).toBe(1);
    expect(
      (await ctx.ranks.ranksOf(stale)).find((it) => it.key === "admin")
        ?.permissions,
    ).toEqual(ProjectRankPresets.ADMIN);
  });

  it("lets an owner tune the built-in member rank, and reads it back", async ({
    expect,
  }) => {
    const account = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: account.id, roles: ["user"] };
    const created = await ctx.projects.createProject(
      { body: { title: "Tuned" } },
      { user },
    );

    // ⚠️ The one built-in an owner is expected to change. `member` is what a
    // NULL `members.rank` column reads as, so "members may read but not
    // create quests" is a change to this rank and nothing else - and before
    // it was `configurable`, the module refused the write and the matrix had
    // a column nobody could edit with nothing on screen to say why.
    await ctx.ranks.save(
      await organizationIdOf(ctx, created.id),
      {
        key: "member",
        name: "Member",
        permissions: ["project:read", "quest:read"],
      },
      user,
    );

    const ranks = await ctx.ranks.ranksOf(
      await organizationIdOf(ctx, created.id),
    );
    const member = ranks.find((it) => it.key === "member");

    expect(member?.permissions).toEqual(["project:read", "quest:read"]);
    // Non-removable and editable at once, which is what `editable` exists to
    // express: an editor deriving it from `builtin` would offer no way in.
    expect(member?.builtin).toBe(true);
    expect(member?.editable).toBe(true);

    // Owner is the other kind: renamed (#Q3736), and its permissions stay
    // `*` whatever the write carried.
    await ctx.ranks.save(
      await organizationIdOf(ctx, created.id),
      { key: "owner", name: "Boss", permissions: ["project:read"] },
      user,
    );
    const owner = (
      await ctx.ranks.ranksOf(await organizationIdOf(ctx, created.id))
    ).find((it) => it.key === "owner");
    expect(owner).toMatchObject({
      name: "Boss",
      permissions: ["*"],
      editable: false,
      renamable: true,
    });
  });

  it("answers the editor's bases from the project's own capabilities", async ({
    expect,
  }) => {
    const account = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: account.id, roles: ["user"] };
    const created = await ctx.projects.createProject(
      {
        body: { title: "Knowledge only", capabilities: [{ key: "remember" }] },
      },
      { user },
    );

    const rankApi = ctx.alepha.inject(ProjectRankController);
    const { items } = await rankApi.getRankPresets(
      { params: { projectId: created.id } },
      { user },
    );

    expect(items.map((it) => it.key)).toEqual(["admin", "member", "viewer"]);

    // Admin holds everything whatever the capabilities (#Q3736); Viewer is
    // narrowed to what a Remember-only project has.
    const admin = items.find((it) => it.key === "admin")!;
    expect(admin.permissions).toContain("folio:write");
    expect(admin.permissions).toContain("quest:create");
    // Viewer reads Core's own groups (members, stats, hosts, subscriptions) and the
    // one capability's folios, nothing of a capability that is off.
    expect(items.find((it) => it.key === "viewer")?.permissions).toEqual([
      "project:read",
      "member:read",
      "stats:read",
      "folio:read",
      // Hosts are Core since #E166: a Viewer reads them with Ship off.
      "host:read",
      "subscription:read",
    ]);
    // The floor survives every narrowing.
    expect(admin.permissions).toContain("project:read");
  });

  it("swaps the two ranks in one statement, and leaves exactly one owner", async ({
    expect,
  }) => {
    const giver = await ctx.repos.users.create({});
    const taker = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: giver.id, roles: ["user"] };

    const created = await ctx.projects.createProject(
      { body: { title: "Handover" } },
      { user },
    );
    await ctx.repos.members.create({
      organizationId: await organizationIdOf(ctx, created.id),
      userId: taker.id,
      rank: "member",
    });

    await ctx.projects.transferOwnership(
      { params: { id: created.id }, body: { userId: taker.id, rank: "admin" } },
      { user },
    );

    const rows = await ctx.repos.members.findMany({
      where: {
        organizationId: { eq: await organizationIdOf(ctx, created.id) },
      },
    });

    // ⚠️ The property that matters, and the reason this is one UPDATE: D1 has
    // no transactions, so a demote-then-promote pair can leave zero owners
    // and a promote-then-demote pair can leave two. Neither is expressible
    // anywhere else in this application.
    expect(
      rows.filter((it) => it.rank === "owner").map((it) => it.userId),
    ).toEqual([taker.id]);
    expect(rows.find((it) => it.userId === giver.id)?.rank).toBe("admin");
  });

  it("refuses a transfer from anybody but the owner", async ({ expect }) => {
    const owner = await ctx.repos.users.create({});
    const other = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: owner.id, roles: ["user"] };

    const created = await ctx.projects.createProject(
      { body: { title: "Not yours" } },
      { user },
    );
    await createPresetRanks(ctx.alepha, created.id);
    await ctx.repos.members.create({
      organizationId: await organizationIdOf(ctx, created.id),
      userId: other.id,
      // `admin` holds `member:manage`, so it passes the gate and is refused
      // by the owner check inside - which is the point: transfer is not a
      // permission, and a rank that could be granted it would make ownership
      // grantable.
      rank: "admin",
    });

    await expect(
      ctx.projects.transferOwnership(
        { params: { id: created.id }, body: { userId: owner.id } },
        { user: { id: other.id, roles: ["user"] } },
      ),
    ).rejects.toThrow("Only the organization owner");
  });

  it("counts the project quota on owner rows, so a transfer moves the slot", async ({
    expect,
  }) => {
    const giver = await ctx.repos.users.create({});
    const taker = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: giver.id, roles: ["user"] };

    const created = await ctx.projects.createProject(
      { body: { title: "Slot" } },
      { user },
    );
    await ctx.repos.members.create({
      organizationId: await organizationIdOf(ctx, created.id),
      userId: taker.id,
      rank: "member",
    });

    const owned = async (id: string) =>
      await ctx.repos.members.count({
        userId: { eq: id },
        rank: { eq: "owner" },
      });

    expect(await owned(giver.id)).toBe(1);
    expect(await owned(taker.id)).toBe(0);

    await ctx.projects.transferOwnership(
      { params: { id: created.id }, body: { userId: taker.id } },
      { user },
    );

    // ⚠️ The quota counted `projects.createdBy` until this quest, and
    // `createdBy` never changes: the giver would have kept paying for the
    // slot forever and the taker would have paid nothing.
    expect(await owned(giver.id)).toBe(0);
    expect(await owned(taker.id)).toBe(1);
  });

  it("lets the former owner leave once they are not the owner", async ({
    expect,
  }) => {
    const giver = await ctx.repos.users.create({});
    const taker = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: giver.id, roles: ["user"] };

    const created = await ctx.projects.createProject(
      { body: { title: "Leaving" } },
      { user },
    );
    await ctx.repos.members.create({
      organizationId: await organizationIdOf(ctx, created.id),
      userId: taker.id,
      rank: "member",
    });

    // Refused while they hold it, and the message names the transfer because
    // it exists now.
    await expect(
      ctx.projects.leaveProject({ params: { id: created.id } }, { user }),
    ).rejects.toThrow("Transfer ownership first");

    await ctx.projects.transferOwnership(
      { params: { id: created.id }, body: { userId: taker.id } },
      { user },
    );

    // ⚠️ The creator, leaving their own project. `projects.createdBy` still
    // names them and is not an authorization input any more.
    await ctx.projects.leaveProject({ params: { id: created.id } }, { user });

    const rows = await ctx.repos.members.findMany({
      where: {
        organizationId: { eq: await organizationIdOf(ctx, created.id) },
      },
    });
    expect(rows.map((it) => it.userId)).toEqual([taker.id]);
  });

  it("refuses an assignment to the caller's own row", async ({ expect }) => {
    const owner = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: owner.id, roles: ["user"] };
    const created = await ctx.projects.createProject(
      { body: { title: "Self" } },
      { user },
    );

    // ⚠️ The module's rule, not Lore's, because every consumer has it. The
    // subset rule stops you handing somebody MORE than you hold; it cannot
    // stop you handing yourself LESS, and a scope whose only manager has
    // demoted themselves out of `rank:manage` is locked with no way back.
    await expect(
      ctx.ranks.assign(
        await organizationIdOf(ctx, created.id),
        owner.id,
        "viewer",
        user,
      ),
    ).rejects.toThrow("cannot change your own rank");
  });

  it("names the presets in English, whatever the language asking", async ({
    expect,
  }) => {
    // #Q3744 reverses #Q3593: a French creator or a French page gets
    // "Admin" and "Viewer", never "Administrateur" or "Lecteur".
    const account = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: account.id, roles: ["user"] };
    ctx.alepha.store.set("alepha.http.request", {
      language: "fr-FR",
    } as never);
    try {
      const created = await ctx.projects.createProject(
        { body: { title: "French browser", capabilities: [{ key: "plan" }] } },
        { user },
      );
      const organizationId = await organizationIdOf(ctx, created.id);
      const ranks = await ctx.ranks.ranksOf(organizationId);
      expect(ranks.find((it) => it.key === "admin")?.name).toBe("Admin");
      expect(ranks.find((it) => it.key === "viewer")?.name).toBe("Viewer");

      // And the editor's base for a missing rank.
      await ctx.repos.organizationRanks.deleteMany({
        organizationId: { eq: organizationId },
        key: { eq: "admin" },
      });
      const { items } = await ctx.alepha
        .inject(ProjectRankController)
        .getRankPresets({ params: { projectId: created.id } }, { user });
      expect(items.find((it) => it.key === "admin")?.name).toBe("Admin");
    } finally {
      ctx.alepha.store.set("alepha.http.request", undefined as never);
    }
  });

  it("names the capability, not the rank, when a capability is what is off", async ({
    expect,
  }) => {
    const account = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: account.id, roles: ["user"] };

    // Knowledge only: no rank in this project carries `quest:create`, because
    // no preset can compute one.
    const created = await ctx.projects.createProject(
      {
        body: { title: "Knowledge Only", capabilities: [{ key: "remember" }] },
      },
      { user },
    );
    await createPresetRanks(ctx.alepha, created.id);

    const member = await ctx.repos.users.create({});
    await ctx.repos.members.create({
      organizationId: await organizationIdOf(ctx, created.id),
      userId: member.id,
      rank: "viewer",
    });

    // ⚠️ The closed loop this exists to break: told "your rank does not grant
    // quest:create", the member asks the owner for a better rank, the owner
    // opens the matrix, and there is no `quest:create` row there at all.
    await expect(
      ctx.ranks.assert(
        await organizationIdOf(ctx, created.id),
        "quest:create",
        {
          id: member.id,
          roles: ["user"],
        },
      ),
    ).rejects.toThrow("does not have");

    // And when the rank really is the reason, the refusal names the RANK, the
    // PERMISSION and the FIX. Three layers can refuse a call and the fixes are
    // different: turn the capability on (Settings), ask the owner for a
    // better rank, or nothing the owner can do at all. A message that only
    // said "forbidden" would leave an agent with nowhere to go.
    await expect(
      ctx.ranks.assert(
        await organizationIdOf(ctx, created.id),
        "member:manage",
        {
          id: member.id,
          roles: ["user"],
        },
      ),
    ).rejects.toThrow(
      "You are read-only in this project: your rank (Viewer) grants reads only, not member:manage. Ask a project admin to move you to another rank.",
    );
  });
});
