import { $hook, Alepha, AlephaError } from "alepha";
import { AlephaApiUsers, RealmProvider, UserService } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { ConflictError, ForbiddenError } from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaApiOrganizations,
  MemberService,
  organizationMembers,
  organizations,
  OrganizationService,
} from "../index.ts";

class FailingMemberService extends MemberService {
  public override async addOwner(): Promise<any> {
    throw new AlephaError("member write failed");
  }
}

class OrganizationHooksProbe {
  public removed: Array<Record<string, unknown>> = [];
  public transferred: Array<Record<string, unknown>> = [];

  onRemoved = $hook({
    on: "organization:member:removed",
    handler: async (event) => {
      this.removed.push(event);
    },
  });

  onTransferred = $hook({
    on: "organization:ownership:transferred",
    handler: async (event) => {
      this.transferred.push(event);
    },
  });
}

class Repositories {
  public readonly organizations = $repository(organizations);
  public readonly members = $repository(organizationMembers);
}

const setup = async (options: { failingMembers?: boolean } = {}) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });

  if (options.failingMembers) {
    alepha.with({ provide: MemberService, use: FailingMemberService });
  }

  alepha
    .with(AlephaOrmPostgres)
    .with(AlephaApiUsers)
    .with(AlephaApiOrganizations)
    .with(Repositories)
    .with(OrganizationHooksProbe);

  await alepha.start();
  const users = alepha.inject(RealmProvider).userRepository();
  const owner = await users.create({ username: "organization-owner" });
  const other = await users.create({ username: "organization-member" });

  return {
    alepha,
    owner,
    other,
    organizations: alepha.inject(OrganizationService),
    members: alepha.inject(MemberService),
    repos: alepha.inject(Repositories),
    hooks: alepha.inject(OrganizationHooksProbe),
  };
};

describe("alepha/api/organizations - organization and member services", () => {
  it("creates an organization with exactly one owner and lists it", async ({
    expect,
  }) => {
    const ctx = await setup();

    const organization = await ctx.organizations.create(
      { name: "Acme", slug: "acme" },
      { id: ctx.owner.id },
    );

    expect(await ctx.organizations.get(organization.id)).toMatchObject({
      name: "Acme",
      slug: "acme",
    });
    expect(await ctx.organizations.listMine(ctx.owner.id)).toEqual([
      organization,
    ]);
    expect(await ctx.members.list(organization.id)).toMatchObject([
      { userId: ctx.owner.id, rank: "owner" },
    ]);
  });

  it("lists members with the account identity needed by organization UIs", async ({
    expect,
  }) => {
    const ctx = await setup();
    const organization = await ctx.organizations.create(
      { name: "Acme" },
      { id: ctx.owner.id },
    );
    await ctx.members.add(organization.id, ctx.other.id, "member", {
      id: ctx.owner.id,
    });

    expect(await ctx.members.listResources(organization.id)).toMatchObject([
      {
        userId: ctx.owner.id,
        rank: "owner",
        user: { id: ctx.owner.id, username: "organization-owner" },
      },
      {
        userId: ctx.other.id,
        rank: "member",
        user: { id: ctx.other.id, username: "organization-member" },
      },
    ]);
  });

  it("deletes the organization when its owner row cannot be written", async ({
    expect,
  }) => {
    const ctx = await setup({ failingMembers: true });

    await expect(
      ctx.organizations.create({ name: "Broken" }, { id: ctx.owner.id }),
    ).rejects.toThrow("member write failed");
    expect(await ctx.repos.organizations.findMany()).toEqual([]);
  });

  it("keeps slug optional, never derives it, and enforces uniqueness", async ({
    expect,
  }) => {
    const ctx = await setup();
    const withoutSlug = await ctx.organizations.create(
      { name: "No generated slug" },
      { id: ctx.owner.id },
    );
    expect(withoutSlug.slug).toBeUndefined();

    await ctx.organizations.create(
      { name: "First", slug: "shared" },
      { id: ctx.other.id },
    );
    await expect(
      ctx.organizations.create(
        { name: "Second", slug: "shared" },
        { id: ctx.owner.id },
      ),
    ).rejects.toThrow();
  });

  it("refuses to assign owner as an ordinary rank", async ({ expect }) => {
    const ctx = await setup();
    const organization = await ctx.organizations.create(
      { name: "Acme" },
      { id: ctx.owner.id },
    );
    await ctx.members.add(organization.id, ctx.other.id, undefined, {
      id: ctx.owner.id,
    });

    await expect(
      ctx.members.setRank(organization.id, ctx.other.id, "owner", {
        id: ctx.owner.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps one owner by refusing owner removal and leave", async ({
    expect,
  }) => {
    const ctx = await setup();
    const organization = await ctx.organizations.create(
      { name: "Acme" },
      { id: ctx.owner.id },
    );

    await expect(
      ctx.members.remove(organization.id, ctx.owner.id, { id: ctx.owner.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      ctx.members.leave(organization.id, { id: ctx.owner.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await ctx.members.list(organization.id)).toMatchObject([
      { userId: ctx.owner.id, rank: "owner" },
    ]);
  });

  it("transfers ownership atomically and emits awaited hooks", async ({
    expect,
  }) => {
    const ctx = await setup();
    const organization = await ctx.organizations.create(
      { name: "Acme" },
      { id: ctx.owner.id },
    );
    await ctx.members.add(organization.id, ctx.other.id, "member", {
      id: ctx.owner.id,
    });

    await ctx.members.transfer(organization.id, ctx.other.id, "member", {
      id: ctx.owner.id,
    });

    expect(await ctx.members.list(organization.id)).toMatchObject([
      { userId: ctx.owner.id, rank: "member" },
      { userId: ctx.other.id, rank: "owner" },
    ]);
    expect(ctx.hooks.transferred).toEqual([
      {
        organizationId: organization.id,
        fromUserId: ctx.owner.id,
        toUserId: ctx.other.id,
      },
    ]);
  });

  it("emits removal and leave hooks after deleting a member", async ({
    expect,
  }) => {
    const ctx = await setup();
    const organization = await ctx.organizations.create(
      { name: "Acme" },
      { id: ctx.owner.id },
    );
    await ctx.members.add(organization.id, ctx.other.id, undefined, {
      id: ctx.owner.id,
    });

    await ctx.members.leave(organization.id, { id: ctx.other.id });

    expect(ctx.hooks.removed).toEqual([
      {
        organizationId: organization.id,
        userId: ctx.other.id,
        actor: { id: ctx.other.id },
        leave: true,
      },
    ]);
  });

  it("refuses account deletion while the policy reports owned organizations", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.organizations.create({ name: "Acme" }, { id: ctx.owner.id });

    await expect(
      ctx.alepha.inject(UserService).deleteUser(ctx.owner.id),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await ctx.repos.members.findMany()).toHaveLength(1);
  });
});
