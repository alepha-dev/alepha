import { Alepha } from "alepha";
import { AlephaApiUsers, RealmProvider } from "alepha/api/users";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import {
  $permission,
  ResourceGrantsProvider,
  ResourceGateMemoProvider,
  type UserAccountToken,
} from "alepha/security";
import { BadRequestError } from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaApiOrganizations,
  MemberService,
  organizationConfigAtom,
  OrganizationService,
  RankService,
} from "../index.ts";

class Permissions {
  public readonly organizationRead = $permission({
    group: "organization",
    name: "read",
  });
  public readonly rankManage = $permission({ group: "rank", name: "manage" });
  public readonly questWrite = $permission({ group: "quest", name: "write" });
}

class CountingRankService extends RankService {
  public definitionReads = 0;

  protected override loadDefinitions(organizationId: string) {
    this.definitionReads += 1;
    return super.loadDefinitions(organizationId);
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
    .with(Permissions);
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
    ).rejects.toThrow("Ownership is transferred, not invited");
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
});
