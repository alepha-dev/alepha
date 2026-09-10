import { Alepha } from "alepha";
import { RankService } from "alepha/api/ranks";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { ProjectRankController } from "../src/api/controllers/ProjectRankController.ts";
import { LoreApi } from "../src/api/index.ts";
import { ProjectInvitationResource } from "../src/api/providers/ProjectInvitationResource.ts";
import { LorePermissions } from "../src/api/security/LorePermissions.ts";
import { ProjectRankPresets } from "../src/api/security/ProjectRankPresets.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

interface Ctx {
  alepha: Alepha;
  repos: TestEntityRepositories;
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
  alepha.with(LoreApi);

  const repos = alepha.inject(TestEntityRepositories);

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
  realm: "default",
  ownership: false,
};

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
    // fixture project stores ZERO definition rows, so both ranks come from
    // code and `member` is what a NULL `members.rank` column reads as.
    const ranks = await ctx.ranks.ranksOf("project", String(project.id));
    expect(ranks.map((it) => it.key)).toEqual(["owner", "member"]);

    const member = await ctx.ranks.permissionsOf(
      "project",
      String(project.id),
      "member",
    );
    expect(member?.sort()).toEqual([...LorePermissions.MEMBER_DEFAULT].sort());

    // And the owner holds everything, listed as a wildcard rather than
    // enumerated: an owner written out permission by permission falls behind
    // every time a new one is declared.
    const owner = await ctx.ranks.permissionsOf(
      "project",
      String(project.id),
      "owner",
    );
    expect(owner).toContain("*");
  });

  it("refuses owner as an assignment target", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const invitee = await ctx.repos.users.create({});
    await ctx.repos.members.create({
      projectId: project.id,
      userId: invitee.id,
    });

    // Ownership is transferred, not handed out: a project with two owners is
    // a state nothing else in this app can express.
    await expect(
      ctx.ranks.assign(
        "project",
        String(project.id),
        invitee.id,
        "owner",
        root,
      ),
    ).rejects.toThrow("transferred, not assigned");
  });

  it("refuses the ceiling and requires the floor", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const scope = String(project.id);

    for (const ceiling of LorePermissions.OWNER_ONLY) {
      await expect(
        ctx.ranks.save(
          "project",
          scope,
          { key: "c", name: "C", permissions: ["project:read", ceiling] },
          root,
        ),
      ).rejects.toThrow("belongs to the owner");
    }

    await expect(
      ctx.ranks.save(
        "project",
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
      "work",
      "knowledge",
      "apps",
      "support",
    ]);
    const contributor = everything.find((it) => it.key === "contributor")!;
    expect(contributor.permissions).toContain("quest:create");
    expect(contributor.permissions).toContain("folio:write");

    // Knowledge only: the Work permissions are gone, and so is Support's
    // inbox. A checkbox for a capability the project does not have grants
    // nothing and explains nothing.
    const knowledgeOnly = ctx.presets.presetsFor(["knowledge"]);
    const narrowed = knowledgeOnly.find((it) => it.key === "contributor")!;
    expect(narrowed.permissions).not.toContain("quest:create");
    expect(narrowed.permissions).not.toContain("feedback:read");
    expect(narrowed.permissions).toContain("folio:write");

    // Core survives every capability being off, which is a legal state.
    const nothing = ctx.presets.presetsFor([]);
    for (const preset of nothing) {
      expect(preset.permissions).toContain("project:read");
    }

    // Admin is everything except the two owner-only acts.
    const admin = everything.find((it) => it.key === "admin")!;
    expect(admin.permissions).toContain("member:manage");
    expect(admin.permissions).toContain("rank:manage");
    for (const ceiling of LorePermissions.OWNER_ONLY) {
      expect(admin.permissions).not.toContain(ceiling);
    }

    // Viewer reads and nothing else.
    const viewer = everything.find((it) => it.key === "viewer")!;
    expect(viewer.permissions.every((it) => it.endsWith(":read"))).toBe(true);
  });

  it("seeds a new project with the three presets, and leaves old ones alone", async ({
    expect,
  }) => {
    const account = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: account.id, roles: ["user"] };

    const created = await ctx.projects.createProject(
      { body: { title: "Seeded Project" } },
      { user },
    );

    const ranks = await ctx.ranks.ranksOf("project", String(created.id));
    expect(ranks.map((it) => it.key).sort()).toEqual([
      "admin",
      "contributor",
      "member",
      "owner",
      "viewer",
    ]);

    // Ordinary custom ranks from now on: editable, deletable, the owner's.
    expect(ranks.find((it) => it.key === "admin")?.builtin).toBe(false);

    // The creator's membership row says owner, which is what makes the seeding
    // pass the subset rule and what the whole epic reads afterwards.
    const membership = await ctx.repos.members.findOne({
      where: { projectId: { eq: created.id }, userId: { eq: account.id } },
    });
    expect(membership?.rank).toBe("owner");

    // An older project - one the fixture built directly - keeps zero rows.
    const old = await createTestProject(ctx.alepha);
    const oldRanks = await ctx.ranks.ranksOf("project", String(old.id));
    expect(oldRanks.map((it) => it.key)).toEqual(["owner", "member"]);
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
      "project",
      String(created.id),
      {
        key: "member",
        name: "Member",
        permissions: ["project:read", "quest:read"],
      },
      user,
    );

    const ranks = await ctx.ranks.ranksOf("project", String(created.id));
    const member = ranks.find((it) => it.key === "member");

    expect(member?.permissions).toEqual(["project:read", "quest:read"]);
    // Non-removable and editable at once, which is what `editable` exists to
    // express: an editor deriving it from `builtin` would offer no way in.
    expect(member?.builtin).toBe(true);
    expect(member?.editable).toBe(true);

    // Owner is the other kind, and stays refused.
    await expect(
      ctx.ranks.save(
        "project",
        String(created.id),
        { key: "owner", name: "Boss", permissions: ["project:read"] },
        user,
      ),
    ).rejects.toThrow("built-in rank and cannot be edited");
  });

  it("answers the editor's presets from the project's own capabilities", async ({
    expect,
  }) => {
    const account = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: account.id, roles: ["user"] };
    const created = await ctx.projects.createProject(
      {
        body: { title: "Knowledge only", capabilities: [{ key: "knowledge" }] },
      },
      { user },
    );

    const rankApi = ctx.alepha.inject(ProjectRankController);
    const { items } = await rankApi.getRankPresets(
      { params: { projectId: created.id } },
      { user },
    );

    expect(items.map((it) => it.key)).toEqual([
      "admin",
      "contributor",
      "viewer",
    ]);

    // The endpoint exists because neither the module nor the browser can work
    // this out: a Contributor of a Knowledge-only project carries folio
    // writes and no quest permission at all.
    const contributor = items.find((it) => it.key === "contributor")!;
    expect(contributor.permissions).toContain("folio:write");
    expect(contributor.permissions).not.toContain("quest:create");
    // The floor survives every narrowing.
    expect(contributor.permissions).toContain("project:read");
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
      projectId: created.id,
      userId: taker.id,
      rank: "member",
    });

    await ctx.projects.transferOwnership(
      { params: { id: created.id }, body: { userId: taker.id, rank: "admin" } },
      { user },
    );

    const rows = await ctx.repos.members.findMany({
      where: { projectId: { eq: created.id } },
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
    await ctx.repos.members.create({
      projectId: created.id,
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
    ).rejects.toThrow("Only the project owner");
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
      projectId: created.id,
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
      projectId: created.id,
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
      where: { projectId: { eq: created.id } },
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
      ctx.ranks.assign("project", String(created.id), owner.id, "viewer", user),
    ).rejects.toThrow("cannot change your own rank");
  });

  it("lands an invitee on the rank the invitation named", async ({
    expect,
  }) => {
    const owner = await ctx.repos.users.create({});
    const guest = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: owner.id, roles: ["user"] };
    const created = await ctx.projects.createProject(
      { body: { title: "Invited" } },
      { user },
    );

    const resource = ctx.alepha.inject(ProjectInvitationResource);

    await resource.project.options.grant?.(guest.id, {
      resourceType: "project",
      resourceId: String(created.id),
      roles: ["viewer"],
    } as never);

    const row = await ctx.repos.members.findOne({
      where: {
        projectId: { eq: created.id },
        userId: { eq: guest.id },
      },
    });
    expect(row?.rank).toBe("viewer");
  });

  it("falls back to member when the named rank is gone", async ({ expect }) => {
    const owner = await ctx.repos.users.create({});
    const guest = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: owner.id, roles: ["user"] };
    const created = await ctx.projects.createProject(
      { body: { title: "Stale" } },
      { user },
    );

    const resource = ctx.alepha.inject(ProjectInvitationResource);

    // A real state rather than a defensive branch: the matrix refuses to
    // delete a HELD rank, and an unanswered invitation holds nothing. Same
    // path as every invitation sent before this quest, which names no rank at
    // all.
    await resource.project.options.grant?.(guest.id, {
      resourceType: "project",
      resourceId: String(created.id),
      roles: ["deleted-since"],
    } as never);

    const row = await ctx.repos.members.findOne({
      where: {
        projectId: { eq: created.id },
        userId: { eq: guest.id },
      },
    });
    expect(row?.rank).toBe("member");
  });

  it("names a seeded rank in the creator's language", ({ expect }) => {
    const [admin] = ctx.presets.presetsFor(["work"]);
    expect(ctx.presets.nameFor(admin, "en")).toBe("Admin");
    expect(ctx.presets.nameFor(admin, "fr-FR")).toBe("Administrateur");
    // Anything else falls back to English, like the rest of the app.
    expect(ctx.presets.nameFor(admin, "de")).toBe("Admin");
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
        body: { title: "Knowledge Only", capabilities: [{ key: "knowledge" }] },
      },
      { user },
    );

    const member = await ctx.repos.users.create({});
    await ctx.repos.members.create({
      projectId: created.id,
      userId: member.id,
      rank: "contributor",
    });

    // ⚠️ The closed loop this exists to break: told "your rank does not grant
    // quest:create", the member asks the owner for a better rank, the owner
    // opens the matrix, and there is no `quest:create` row there at all.
    await expect(
      ctx.ranks.assert("project", String(created.id), "quest:create", {
        id: member.id,
        roles: ["user"],
      }),
    ).rejects.toThrow("does not have");

    // And when the rank really is the reason, the refusal names the RANK, the
    // PERMISSION and the FIX. Three layers can refuse a call and the fixes are
    // different: turn the capability on (Settings), ask the owner for a
    // better rank, or nothing the owner can do at all. A message that only
    // said "forbidden" would leave an agent with nowhere to go.
    await expect(
      ctx.ranks.assert("project", String(created.id), "member:manage", {
        id: member.id,
        roles: ["user"],
      }),
    ).rejects.toThrow(
      "Your rank (Contributor) does not grant member:manage. Ask the project owner.",
    );
  });
});
