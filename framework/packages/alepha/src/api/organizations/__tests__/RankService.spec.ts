import { $hook, Alepha } from "alepha";
import { $realm, AlephaApiUsers, RealmProvider } from "alepha/api/users";
import { AlephaOrmTestPostgres } from "alepha/orm";
import {
  $permission,
  ResourceGrantsProvider,
  ResourceGateMemoProvider,
  type UserAccountToken,
} from "alepha/security";
import { BadRequestError } from "alepha/server";
import { describe, it } from "vitest";

import { MemberController } from "../controllers/MemberController.ts";
import {
  AlephaApiOrganizations,
  MemberService,
  organizationConfigAtom,
  OrganizationService,
  RankService,
} from "../index.ts";

class Realm {
  // A real realm, so a token's `user` role resolves: the roster test calls
  // an action, and `$secure` checks the permission at application scope
  // before the rank is ever read.
  public readonly realm = $realm();
}

class Permissions {
  public readonly organizationRead = $permission({
    group: "organization",
    name: "read",
  });
  public readonly rankManage = $permission({ group: "rank", name: "manage" });
  public readonly memberRead = $permission({ group: "member", name: "read" });
  public readonly questWrite = $permission({ group: "quest", name: "write" });
}

/**
 * An application rule on one rank, through the two hooks: `locked` may not
 * hold `quest:write`, and may not be deleted.
 */
class LockedRankGuard {
  public seen: string[] = [];

  protected readonly onSaving = $hook({
    on: "organization:rank:save:before",
    handler: ({ key, permissions }) => {
      this.seen.push(`save ${key}`);
      if (key === "locked" && permissions.includes("quest:write")) {
        throw new BadRequestError('"locked" may not write quests');
      }
    },
  });

  protected readonly onDeleting = $hook({
    on: "organization:rank:delete:before",
    handler: ({ key }) => {
      this.seen.push(`delete ${key}`);
      if (key === "locked") {
        throw new BadRequestError('"locked" may not be deleted');
      }
    },
  });
}

class CountingRankService extends RankService {
  public definitionReads = 0;
  public membershipReads = 0;
  public memberListReads = 0;

  protected override loadDefinitions(organizationId: string) {
    this.definitionReads += 1;
    return super.loadDefinitions(organizationId);
  }

  protected override loadMembers(organizationId: string) {
    this.memberListReads += 1;
    return super.loadMembers(organizationId);
  }

  protected override loadMembership(organizationId: string, userId: string) {
    this.membershipReads += 1;
    return super.loadMembership(organizationId, userId);
  }
}

const setup = async (
  options: {
    countDefinitions?: boolean;
    guard?: boolean;
    builtinRanks?: string[];
    defaultRanks?: Array<{ key: string; name: string; permissions: string[] }>;
  } = {},
) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  if (options.countDefinitions) {
    alepha.with({ provide: RankService, use: CountingRankService });
  }
  alepha
    .with(AlephaOrmTestPostgres)
    .with(AlephaApiUsers)
    .with(AlephaApiOrganizations)
    .with(Permissions)
    .with(Realm);
  if (options.guard) alepha.with(LockedRankGuard);
  alepha.store.set(organizationConfigAtom, {
    memberPermissions: ["organization:read"],
    floor: ["organization:read"],
    ownerOnly: ["organization:delete"],
    invitationExpirationDays: 7,
    maxPendingInvitationsPerOrganization: 50,
    maxPendingInvitationsPerInviter: 100,
    invitationPurgeDays: 90,
    builtinRanks: options.builtinRanks,
    defaultRanks: options.defaultRanks,
  });
  await alepha.start();

  const users = alepha.inject(RealmProvider).userRepository();
  const owner = await users.create({ username: "rank-owner" });
  const member = await users.create({ username: "rank-member" });
  const organizations = alepha.inject(OrganizationService);
  const organization = await organizations.create(
    { name: "Ranks" },
    { id: owner.id },
  );
  await alepha
    .inject(MemberService)
    .add(organization.id, member.id, undefined, { id: owner.id });

  const token = (id: string): UserAccountToken => ({
    id,
    name: id,
    roles: [],
  });

  return {
    alepha,
    organization,
    owner: token(owner.id),
    member: token(member.id),
    ranks: alepha.inject(RankService),
    members: alepha.inject(MemberService),
  };
};

const ORG_READ = "organization:read";

describe("alepha/api/organizations - RankService", () => {
  it("provides a fixed owner and editable member built-in", async ({
    expect,
  }) => {
    const ctx = await setup();

    expect(await ctx.ranks.ranksOf(ctx.organization.id)).toEqual([
      {
        key: "owner",
        name: "Owner",
        permissions: ["*"],
        builtin: true,
        editable: false,
        renamable: true,
      },
      {
        key: "member",
        name: "Member",
        permissions: ["organization:read"],
        builtin: true,
        editable: true,
        renamable: true,
        defaultPermissions: ["organization:read"],
      },
    ]);
  });

  it("reads a default rank with no row from the config, so a permission declared later reaches it", async ({
    expect,
  }) => {
    const defaults = { key: "admin", name: "Admin", permissions: [ORG_READ] };
    const ctx = await setup({ defaultRanks: [defaults] });
    const { id } = ctx.organization;

    expect(
      (await ctx.ranks.ranksOf(id)).find((rank) => rank.key === "admin"),
    ).toEqual({
      key: "admin",
      name: "Admin",
      permissions: [ORG_READ],
      builtin: true,
      editable: true,
      renamable: true,
      defaultPermissions: [ORG_READ],
    });

    // The application declares one more permission: no row to migrate.
    ctx.alepha.store.set(organizationConfigAtom, {
      ...ctx.alepha.store.get(organizationConfigAtom),
      defaultRanks: [{ ...defaults, permissions: [ORG_READ, "quest:write"] }],
    });
    expect(await ctx.ranks.permissionsOf(id, "admin")).toEqual([
      ORG_READ,
      "quest:write",
    ]);
    await expect(ctx.ranks.delete(id, "admin", ctx.owner)).rejects.toThrow(
      "A built-in rank cannot be deleted",
    );
  });

  it("keeps an edited default rank, and resets it to its default", async ({
    expect,
  }) => {
    const ctx = await setup({
      guard: true,
      defaultRanks: [
        { key: "admin", name: "Admin", permissions: [ORG_READ, "quest:write"] },
      ],
    });
    const { id } = ctx.organization;

    await ctx.ranks.save(
      id,
      { key: "admin", name: "Staff", permissions: [ORG_READ] },
      ctx.owner,
    );
    expect(
      (await ctx.ranks.ranksOf(id)).find((rank) => rank.key === "admin"),
    ).toMatchObject({
      name: "Staff",
      permissions: [ORG_READ],
      defaultPermissions: [ORG_READ, "quest:write"],
    });

    await ctx.ranks.reset(id, "admin", ctx.owner);
    expect(
      (await ctx.ranks.ranksOf(id)).find((rank) => rank.key === "admin"),
    ).toMatchObject({
      name: "Admin",
      permissions: [ORG_READ, "quest:write"],
    });
    expect(ctx.alepha.inject(LockedRankGuard).seen).toContain("save admin");

    await expect(ctx.ranks.reset(id, "nope", ctx.owner)).rejects.toThrow(
      "has no default to reset to",
    );
  });

  it("refuses a reset by a writer who does not hold the default", async ({
    expect,
  }) => {
    const ctx = await setup({
      defaultRanks: [
        { key: "admin", name: "Admin", permissions: [ORG_READ, "quest:write"] },
      ],
    });
    const { id } = ctx.organization;
    await ctx.ranks.save(
      id,
      {
        key: "manager",
        name: "Manager",
        permissions: [ORG_READ, "rank:manage"],
      },
      ctx.owner,
    );
    await ctx.ranks.save(
      id,
      { key: "admin", name: "Admin", permissions: [ORG_READ] },
      ctx.owner,
    );
    await ctx.ranks.assign(id, ctx.member.id, "manager", ctx.owner);

    await expect(ctx.ranks.reset(id, "admin", ctx.member)).rejects.toThrow(
      "quest:write",
    );
  });

  it("renames the owner and keeps its permissions at *", async ({ expect }) => {
    const ctx = await setup();
    const { id } = ctx.organization;

    await ctx.ranks.save(
      id,
      { key: "owner", name: "Captain", permissions: [ORG_READ] },
      ctx.owner,
    );

    const owner = (await ctx.ranks.ranksOf(id)).find(
      (rank) => rank.key === "owner",
    );
    expect(owner).toMatchObject({
      name: "Captain",
      permissions: ["*"],
      editable: false,
      renamable: true,
    });
    await expect(ctx.ranks.delete(id, "owner", ctx.owner)).rejects.toThrow(
      "A built-in rank cannot be deleted",
    );
  });

  it("refuses to delete a rank the application declares built in, and lets it be renamed and edited", async ({
    expect,
  }) => {
    const ctx = await setup({ builtinRanks: ["admin"] });
    const { id } = ctx.organization;

    await ctx.ranks.save(
      id,
      { key: "admin", name: "Admin", permissions: [ORG_READ] },
      ctx.owner,
    );
    await ctx.ranks.save(
      id,
      {
        key: "admin",
        name: "Staff",
        permissions: [ORG_READ, "quest:write"],
      },
      ctx.owner,
    );

    expect(
      (await ctx.ranks.ranksOf(id)).find((rank) => rank.key === "admin"),
    ).toEqual({
      key: "admin",
      name: "Staff",
      permissions: [ORG_READ, "quest:write"],
      builtin: true,
      editable: true,
      renamable: true,
    });
    await expect(ctx.ranks.delete(id, "admin", ctx.owner)).rejects.toThrow(
      "A built-in rank cannot be deleted",
    );
    await expect(ctx.ranks.delete(id, "member", ctx.owner)).rejects.toThrow(
      "A built-in rank cannot be deleted",
    );
  });

  it("lets an application refuse a rank write or delete from its hooks", async ({
    expect,
  }) => {
    const ctx = await setup({ guard: true });
    const guard = ctx.alepha.inject(LockedRankGuard);
    const { id } = ctx.organization;

    await ctx.ranks.save(
      id,
      { key: "locked", name: "Locked", permissions: [ORG_READ] },
      ctx.owner,
    );
    await expect(
      ctx.ranks.save(
        id,
        {
          key: "locked",
          name: "Locked",
          permissions: [ORG_READ, "quest:write"],
        },
        ctx.owner,
      ),
    ).rejects.toThrow('"locked" may not write quests');
    await expect(ctx.ranks.delete(id, "locked", ctx.owner)).rejects.toThrow(
      '"locked" may not be deleted',
    );

    // Refused means not written: the rank is as it was.
    const locked = (await ctx.ranks.ranksOf(id)).find(
      (rank) => rank.key === "locked",
    );
    expect(locked?.permissions).toEqual([ORG_READ]);
    expect(guard.seen).toEqual(["save locked", "save locked", "delete locked"]);
  });

  it("saves a rank without widening beyond the writer", async ({ expect }) => {
    const ctx = await setup();

    await expect(
      ctx.ranks.save(
        ctx.organization.id,
        { key: "writer", name: "Writer", permissions: ["quest:write"] },
        ctx.member,
      ),
    ).rejects.toBeInstanceOf(BadRequestError);

    await expect(
      ctx.ranks.save(
        ctx.organization.id,
        {
          key: "writer",
          name: "Writer",
          permissions: ["organization:read", "quest:write"],
        },
        ctx.owner,
      ),
    ).resolves.toMatchObject({ key: "writer", builtin: false });
  });

  it("refuses unregistered, admin, owner-only, and missing-floor grants", async ({
    expect,
  }) => {
    const ctx = await setup();
    const save = (permissions: string[]) =>
      ctx.ranks.save(
        ctx.organization.id,
        { key: "invalid", name: "Invalid", permissions },
        ctx.owner,
      );

    await expect(
      save(["organization:read", "unknown:permission"]),
    ).rejects.toThrow("not a permission");
    await expect(
      save(["organization:read", "admin:user:read"]),
    ).rejects.toThrow("cannot be granted");
    await expect(
      save(["organization:read", "organization:delete"]),
    ).rejects.toThrow("belongs to the owner");
    await expect(save(["quest:write"])).rejects.toThrow("cannot be withheld");
  });

  it("assigns through organization_members and never assigns owner", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.ranks.save(
      ctx.organization.id,
      {
        key: "writer",
        name: "Writer",
        permissions: ["organization:read", "quest:write"],
      },
      ctx.owner,
    );

    await ctx.ranks.assign(
      ctx.organization.id,
      ctx.member.id,
      "writer",
      ctx.owner,
    );
    expect(await ctx.members.list(ctx.organization.id)).toContainEqual(
      expect.objectContaining({ userId: ctx.member.id, rank: "writer" }),
    );
    await expect(
      ctx.ranks.assign(ctx.organization.id, ctx.member.id, "owner", ctx.owner),
    ).rejects.toThrow("Ownership is transferred, not assigned");
  });

  it("puts a member back on the default rank, and never demotes the owner", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.ranks.save(
      ctx.organization.id,
      {
        key: "writer",
        name: "Writer",
        permissions: ["organization:read", "quest:write"],
      },
      ctx.owner,
    );
    const rankOf = async (userId: string) =>
      (await ctx.members.list(ctx.organization.id)).find(
        (row) => row.userId === userId,
      )?.rank;

    await ctx.ranks.assign(
      ctx.organization.id,
      ctx.member.id,
      "writer",
      ctx.owner,
    );
    expect(await rankOf(ctx.member.id)).toBe("writer");
    await ctx.ranks.assign(
      ctx.organization.id,
      ctx.member.id,
      "member",
      ctx.owner,
    );
    expect(await rankOf(ctx.member.id)).toBeUndefined();

    await expect(
      ctx.ranks.assign(ctx.organization.id, ctx.owner.id, "member", ctx.member),
    ).rejects.toThrow("Ownership is transferred, not assigned");
    expect(await rankOf(ctx.owner.id)).toBe("owner");
  });

  it("names each member's rank on the roster, a minted key included", async ({
    expect,
  }) => {
    // A rank created from the editor gets a minted key (`r<time>`), and the
    // rank list that would name it is `rank:manage`-gated. So the roster
    // carries the name itself, or a plain member reads `rmug3p08h` beside a
    // colleague's name (#Q2511 exposed it once presets stopped being seeded
    // under readable keys).
    const ctx = await setup();
    await ctx.ranks.save(
      ctx.organization.id,
      {
        key: "rmug3p08h",
        name: "Contributor",
        // Reads the roster, and cannot read the rank list.
        permissions: ["organization:read", "member:read"],
      },
      ctx.owner,
    );
    await ctx.ranks.assign(
      ctx.organization.id,
      ctx.member.id,
      "rmug3p08h",
      ctx.owner,
    );

    const roster = await ctx.alepha
      .inject(MemberController)
      .getOrganizationMembers(
        { params: { organizationId: ctx.organization.id } },
        // The `user` role grants at application scope; the RANK is what
        // this reads under, and it holds `member:read` and no `rank:manage`.
        { user: { ...ctx.member, roles: ["user"] } },
      );
    const byUser = new Map(roster.map((row) => [row.userId, row]));

    expect(byUser.get(ctx.member.id)?.rankName).toBe("Contributor");
    const builtins = await ctx.ranks.ranksOf(ctx.organization.id);
    expect(byUser.get(ctx.owner.id)?.rankName).toBe(
      builtins.find((rank) => rank.key === "owner")?.name,
    );
  });

  it("refuses a self-promotion, an unknown rank and a rank beyond the writer's own", async ({
    expect,
  }) => {
    // #Q2506: the member routes that skipped these checks are gone, so
    // assign is the one way a rank changes, and these are its guards.
    const ctx = await setup();
    await ctx.ranks.save(
      ctx.organization.id,
      {
        key: "steward",
        name: "Steward",
        permissions: ["organization:read", "member:manage", "rank:manage"],
      },
      ctx.owner,
    );
    await ctx.ranks.save(
      ctx.organization.id,
      {
        key: "admin",
        name: "Admin",
        permissions: [
          "organization:read",
          "member:manage",
          "rank:manage",
          "quest:write",
        ],
      },
      ctx.owner,
    );
    await ctx.ranks.assign(
      ctx.organization.id,
      ctx.member.id,
      "steward",
      ctx.owner,
    );

    await expect(
      ctx.ranks.assign(ctx.organization.id, ctx.member.id, "admin", ctx.member),
    ).rejects.toThrow("You cannot change your own rank");
    await expect(
      ctx.ranks.assign(
        ctx.organization.id,
        ctx.member.id,
        "no-such-rank",
        ctx.owner,
      ),
    ).rejects.toThrow('No rank "no-such-rank"');
    await expect(
      ctx.ranks.assertAssignable(ctx.organization.id, "admin", ctx.member),
    ).rejects.toThrow();
  });

  it("refuses self-lockout and deleting a held rank", async ({ expect }) => {
    const ctx = await setup();
    await ctx.ranks.save(
      ctx.organization.id,
      {
        key: "manager",
        name: "Manager",
        permissions: ["organization:read", "rank:manage"],
      },
      ctx.owner,
    );
    await ctx.ranks.assign(
      ctx.organization.id,
      ctx.member.id,
      "manager",
      ctx.owner,
    );

    await expect(
      ctx.ranks.save(
        ctx.organization.id,
        {
          key: "manager",
          name: "Manager",
          permissions: ["organization:read"],
        },
        ctx.member,
      ),
    ).rejects.toThrow("leave nobody able to edit ranks");
    await expect(
      ctx.ranks.delete(ctx.organization.id, "manager", ctx.owner),
    ).rejects.toThrow("still hold");
  });

  it("resolves permissions from the membership organization id", async ({
    expect,
  }) => {
    const ctx = await setup();
    const resolved = await ctx.ranks.resolve({
      authority: { id: "not-the-scope" },
      membership: {
        organizationId: ctx.organization.id,
        userId: ctx.member.id,
        rank: undefined,
      },
      user: ctx.member,
    });

    expect(resolved).toMatchObject({
      organizationId: ctx.organization.id,
      key: "member",
      permissions: ["organization:read"],
    });
  });

  it("uses membership.organizationId when the grants provider checks a gate", async ({
    expect,
  }) => {
    const ctx = await setup();
    const membership = (await ctx.members.list(ctx.organization.id)).find(
      (item) => item.userId === ctx.member.id,
    );

    const decision = await ctx.alepha.inject(ResourceGrantsProvider).check({
      authority: { id: "not-the-organization" },
      membership,
      user: ctx.member,
      requires: ["quest:write"],
    });

    expect(decision).toMatchObject({
      allowed: false,
      message: expect.stringContaining("quest:write"),
    });
  });

  it("reads rank definitions once for concurrent actions in one request", async ({
    expect,
  }) => {
    const ctx = await setup({ countDefinitions: true });
    const ranks = ctx.ranks as CountingRankService;

    await ctx.alepha.context.run(async () => {
      ctx.alepha.context.set(
        ResourceGateMemoProvider.KEY,
        new Map<string, Promise<unknown>>(),
      );
      await Promise.all(
        Array.from({ length: 7 }, () => ranks.ranksOf(ctx.organization.id)),
      );
    });

    expect(ranks.definitionReads).toBe(1);
  });

  it("shares the gate's organization membership memo on imperative checks", async ({
    expect,
  }) => {
    const ctx = await setup({ countDefinitions: true });
    const ranks = ctx.ranks as CountingRankService;
    const membership = (await ctx.members.list(ctx.organization.id)).find(
      (item) => item.userId === ctx.member.id,
    )!;

    await ctx.alepha.context.run(async () => {
      const memo = new Map<string, Promise<unknown>>();
      memo.set(
        ResourceGateMemoProvider.membershipKey({
          table: "organization_members",
          resourceColumn: "organizationId",
          resourceId: ctx.organization.id,
          userColumn: "userId",
          userId: ctx.member.id,
        }),
        Promise.resolve(membership),
      );
      ctx.alepha.context.set(ResourceGateMemoProvider.KEY, memo);
      await expect(
        ranks.can(ctx.organization.id, "organization:read", ctx.member),
      ).resolves.toBe(true);
    });

    expect(ranks.membershipReads).toBe(0);
  });

  it("never lets a manager act on a rank or a member ranked above them", async ({
    expect,
  }) => {
    const ctx = await setup();
    const org = ctx.organization.id;
    const manager = ["organization:read", "rank:manage", "member:manage"];
    const senior = [...manager, "quest:write"];
    for (const [key, permissions] of Object.entries({
      manager,
      senior,
      spare: senior,
      junior: ["organization:read"],
    })) {
      await ctx.ranks.save(org, { key, name: key, permissions }, ctx.owner);
    }
    await ctx.ranks.assign(org, ctx.member.id, "manager", ctx.owner);

    const users = ctx.alepha.inject(RealmProvider).userRepository();
    const seat = async (name: string, rank: string) => {
      const user = await users.create({ username: name });
      await ctx.members.add(org, user.id, rank, ctx.owner);
      return user.id;
    };
    const above = await seat("rank-senior", "senior");
    const below = await seat("rank-junior", "junior");

    // Rewriting or deleting a rank acts on everyone holding it.
    await expect(
      ctx.ranks.save(
        org,
        { key: "senior", name: "senior", permissions: ["organization:read"] },
        ctx.member,
      ),
    ).rejects.toThrow("holds permissions you do not");
    await expect(ctx.ranks.delete(org, "spare", ctx.member)).rejects.toThrow(
      "holds permissions you do not",
    );

    // The target rank is low enough; the member being moved is not.
    await expect(
      ctx.ranks.assign(org, above, "junior", ctx.member),
    ).rejects.toThrow("holds permissions you do not");
    await expect(ctx.members.remove(org, above, ctx.member)).rejects.toThrow(
      "holds permissions you do not",
    );

    // Somebody inside the manager's own set is still theirs to manage.
    await ctx.ranks.assign(org, below, "manager", ctx.member);
    await ctx.members.remove(org, below, ctx.member);
    expect((await ctx.members.list(org)).map((it) => it.userId)).not.toContain(
      below,
    );
    expect(
      (await ctx.members.list(org)).find((it) => it.userId === above)?.rank,
    ).toBe("senior");
  });

  it("lists the members whose rank grants a permission, in two reads", async ({
    expect,
  }) => {
    const ctx = await setup({ countDefinitions: true });
    const ranks = ctx.ranks as CountingRankService;
    const org = ctx.organization.id;
    const users = ctx.alepha.inject(RealmProvider).userRepository();
    const writer = await users.create({ username: "rank-writer" });
    const reader = await users.create({ username: "rank-reader" });
    const ghost = await users.create({ username: "rank-ghost" });
    await ranks.save(
      org,
      {
        key: "writer",
        name: "Writer",
        permissions: ["organization:read", "quest:write"],
      },
      ctx.owner,
    );
    await ranks.save(
      org,
      {
        key: "reader",
        name: "Reader",
        permissions: ["organization:read", "member:read"],
      },
      ctx.owner,
    );
    await ctx.members.add(org, writer.id, "writer", ctx.owner);
    await ctx.members.add(org, reader.id, "reader", ctx.owner);
    // A rank key with no definition: the gate gives it nothing, so this
    // member must not be told about what they could not fix.
    await ctx.members.add(org, ghost.id, "vanished", ctx.owner);

    let holders: string[] = [];
    await ctx.alepha.context.run(async () => {
      ctx.alepha.context.set(
        ResourceGateMemoProvider.KEY,
        new Map<string, Promise<unknown>>(),
      );
      ranks.definitionReads = 0;
      ranks.membershipReads = 0;
      holders = await ranks.holdersOf(org, "quest:write");
    });

    expect(holders.sort()).toEqual([ctx.owner.id, writer.id].sort());
    expect(ranks.memberListReads).toBe(1);
    expect(ranks.definitionReads).toBe(1);
    expect(ranks.membershipReads).toBe(0);

    // The default member rank holds the floor, and a member with no rank
    // holds the default one; the unknown key still holds nothing.
    expect((await ranks.holdersOf(org, "organization:read")).sort()).toEqual(
      [ctx.owner.id, ctx.member.id, writer.id, reader.id].sort(),
    );
    expect(await ranks.holdersOf(org, "host:update")).toEqual([ctx.owner.id]);
  });
});
