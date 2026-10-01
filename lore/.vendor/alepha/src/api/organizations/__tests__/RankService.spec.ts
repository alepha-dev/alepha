import { Alepha } from "alepha";
import { $realm, AlephaApiUsers, RealmProvider } from "alepha/api/users";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
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

class CountingRankService extends RankService {
  public definitionReads = 0;
  public membershipReads = 0;

  protected override loadDefinitions(organizationId: string) {
    this.definitionReads += 1;
    return super.loadDefinitions(organizationId);
  }

  protected override loadMembership(organizationId: string, userId: string) {
    this.membershipReads += 1;
    return super.loadMembership(organizationId, userId);
  }
}

const setup = async (options: { countDefinitions?: boolean } = {}) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  if (options.countDefinitions) {
    alepha.with({ provide: RankService, use: CountingRankService });
  }
  alepha
    .with(AlephaOrmPostgres)
    .with(AlephaApiUsers)
    .with(AlephaApiOrganizations)
    .with(Permissions)
    .with(Realm);
  alepha.store.set(organizationConfigAtom, {
    memberPermissions: ["organization:read"],
    floor: ["organization:read"],
    ownerOnly: ["organization:delete"],
    invitationExpirationDays: 7,
    maxPendingInvitationsPerOrganization: 50,
    maxPendingInvitationsPerInviter: 100,
    invitationPurgeDays: 90,
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
      },
      {
        key: "member",
        name: "Member",
        permissions: ["organization:read"],
        builtin: true,
        editable: true,
      },
    ]);
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
});
