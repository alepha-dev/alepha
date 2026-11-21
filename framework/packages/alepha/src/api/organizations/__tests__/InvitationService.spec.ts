import { $hook, Alepha } from "alepha";
import { AlephaApiUsers, RealmProvider } from "alepha/api/users";
import { VerificationService } from "alepha/api/verifications";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, AlephaOrmTestPostgres } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaApiOrganizations,
  InvitationService,
  InvitationRegistrationService,
  InvitationTokenService,
  MemberService,
  organizationConfigAtom,
  organizationInvitations,
  OrganizationPolicyProvider,
  OrganizationService,
  RankService,
} from "../index.ts";

class InvitationHooksProbe {
  public created: Array<Record<string, unknown>> = [];
  public accepted: Array<Record<string, unknown>> = [];

  public readonly onCreated = $hook({
    on: "organization:invitation:created",
    handler: async (event) => this.created.push(event),
  });

  public readonly onAccepted = $hook({
    on: "organization:invitation:accepted",
    handler: async (event) => this.accepted.push(event),
  });
}

class RefusingRoomPolicy extends OrganizationPolicyProvider {
  public full = false;

  public override async assertRoom(): Promise<void> {
    if (this.full) {
      throw new BadRequestError("Organization is full");
    }
  }
}

class InvitationRepositories {
  public readonly invitations = $repository(organizationInvitations);
}

const setup = async (options: { full?: boolean } = {}) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  if (options.full) {
    alepha.with({
      provide: OrganizationPolicyProvider,
      use: RefusingRoomPolicy,
    });
  }
  alepha
    .with(AlephaOrmTestPostgres)
    .with(AlephaApiUsers)
    .with(AlephaApiOrganizations)
    .with(InvitationHooksProbe)
    .with(InvitationRepositories);
  alepha.store.set(organizationConfigAtom, {
    memberPermissions: [],
    floor: [],
    ownerOnly: ["organization:delete"],
    invitationExpirationDays: 7,
    maxPendingInvitationsPerOrganization: 2,
    maxPendingInvitationsPerInviter: 3,
    invitationPurgeDays: 90,
  });
  await alepha.start();

  const users = alepha.inject(RealmProvider).userRepository();
  const ownerRow = await users.create({
    username: "invite-owner",
    email: "owner@example.com",
  });
  const memberRow = await users.create({
    username: "invite-member",
    email: "member@example.com",
    emailVerified: true,
  });
  const owner: UserAccountToken = {
    id: ownerRow.id,
    name: "Owner",
    email: ownerRow.email,
    roles: [],
  };
  const member: UserAccountToken = {
    id: memberRow.id,
    name: "Member",
    email: memberRow.email,
    roles: [],
  };
  const organization = await alepha
    .inject(OrganizationService)
    .create({ name: "Invitation Org" }, owner);
  const policy = options.full
    ? (alepha.inject(OrganizationPolicyProvider) as RefusingRoomPolicy)
    : undefined;
  if (policy) policy.full = true;

  return {
    alepha,
    users,
    owner,
    member,
    organization,
    invitations: alepha.inject(InvitationService),
    tokens: alepha.inject(InvitationTokenService),
    ranks: alepha.inject(RankService),
    members: alepha.inject(MemberService),
    hooks: alepha.inject(InvitationHooksProbe),
    repos: alepha.inject(InvitationRepositories),
    policy,
  };
};

describe("alepha/api/organizations - InvitationService", () => {
  it("creates a lowercased invitation with a validated rank and token", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.ranks.save(
      ctx.organization.id,
      { key: "guest", name: "Guest", permissions: [] },
      ctx.owner,
    );

    const invitation = await ctx.invitations.create(
      ctx.organization.id,
      { email: "NEW@Example.com", rank: "guest" },
      ctx.owner,
    );

    expect(invitation).toMatchObject({
      email: "new@example.com",
      organizationId: ctx.organization.id,
      rank: "guest",
      status: "pending",
    });
    expect(ctx.hooks.created[0]).toMatchObject({
      invitation,
      inviter: ctx.owner,
      token: expect.stringMatching(new RegExp(`^${invitation.id}\\.`)),
    });
  });

  it("refuses owner, duplicate, existing member, and room-limit invitations", async ({
    expect,
  }) => {
    const ctx = await setup();
    await expect(
      ctx.invitations.create(
        ctx.organization.id,
        { email: "new@example.com", rank: "owner" },
        ctx.owner,
      ),
    ).rejects.toThrow("Ownership is transferred, not invited");

    await ctx.invitations.create(
      ctx.organization.id,
      { email: "new@example.com" },
      ctx.owner,
    );
    await expect(
      ctx.invitations.create(
        ctx.organization.id,
        { email: "NEW@example.com" },
        ctx.owner,
      ),
    ).rejects.toThrow("already exists");
    await expect(
      ctx.invitations.create(
        ctx.organization.id,
        { email: ctx.owner.email! },
        ctx.owner,
      ),
    ).rejects.toThrow("already a member");

    const full = await setup({ full: true });
    await expect(
      full.invitations.create(
        full.organization.id,
        { email: "another@example.com" },
        full.owner,
      ),
    ).rejects.toThrow("Organization is full");
  });

  it("accepts with the requested rank and falls back to member if it was deleted", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.ranks.save(
      ctx.organization.id,
      { key: "guest", name: "Guest", permissions: [] },
      ctx.owner,
    );
    const invitation = await ctx.invitations.create(
      ctx.organization.id,
      { email: ctx.member.email!, rank: "guest" },
      ctx.owner,
    );
    await ctx.ranks.delete(ctx.organization.id, "guest", ctx.owner);

    await ctx.invitations.accept(invitation.id, ctx.member);

    expect(
      await ctx.alepha.inject(OrganizationService).listMine(ctx.member.id),
    ).toContainEqual({ ...ctx.organization, rank: "member" });
    const acceptedMember = (await ctx.members.list(ctx.organization.id)).find(
      (item) => item.userId === ctx.member.id,
    );
    expect(acceptedMember?.rank).toBeUndefined();
    expect(ctx.hooks.accepted).toHaveLength(1);
  });

  it("refuses acceptance when the invitee became a member meanwhile", async ({
    expect,
  }) => {
    const ctx = await setup();
    const invitation = await ctx.invitations.create(
      ctx.organization.id,
      { email: ctx.member.email! },
      ctx.owner,
    );
    await ctx.members.add(
      ctx.organization.id,
      ctx.member.id,
      undefined,
      ctx.owner,
    );

    await expect(
      ctx.invitations.accept(invitation.id, ctx.member),
    ).rejects.toThrow("already a member");
  });

  it("checks room again when an invitation is accepted", async ({ expect }) => {
    const ctx = await setup({ full: true });
    ctx.policy!.full = false;
    const invitation = await ctx.invitations.create(
      ctx.organization.id,
      { email: ctx.member.email! },
      ctx.owner,
    );
    ctx.policy!.full = true;

    await expect(
      ctx.invitations.accept(invitation.id, ctx.member),
    ).rejects.toThrow("Organization is full");
  });

  it("names the organization on each invitation of an inbox", async ({
    expect,
  }) => {
    const ctx = await setup();
    const invitation = await ctx.invitations.create(
      ctx.organization.id,
      { email: ctx.member.email! },
      ctx.owner,
    );

    expect(await ctx.invitations.listMine(ctx.member)).toEqual([
      expect.objectContaining({
        id: invitation.id,
        organizationName: "Invitation Org",
      }),
    ]);
  });

  it("enforces organization and inviter pending caps", async ({ expect }) => {
    const ctx = await setup();
    await ctx.invitations.create(
      ctx.organization.id,
      { email: "one@example.com" },
      ctx.owner,
    );
    await ctx.invitations.create(
      ctx.organization.id,
      { email: "two@example.com" },
      ctx.owner,
    );
    await expect(
      ctx.invitations.create(
        ctx.organization.id,
        { email: "three@example.com" },
        ctx.owner,
      ),
    ).rejects.toThrow("per organization");

    ctx.alepha.store.set(organizationConfigAtom, {
      memberPermissions: [],
      floor: [],
      ownerOnly: ["organization:delete"],
      invitationExpirationDays: 7,
      maxPendingInvitationsPerOrganization: 10,
      maxPendingInvitationsPerInviter: 2,
      invitationPurgeDays: 90,
    });
    const second = await ctx.alepha
      .inject(OrganizationService)
      .create({ name: "Second" }, ctx.owner);
    await expect(
      ctx.invitations.create(
        second.id,
        { email: "other@example.com" },
        ctx.owner,
      ),
    ).rejects.toThrow("per inviter");
  });

  it("keeps declined, revoked, and expired states distinguishable", async ({
    expect,
  }) => {
    const ctx = await setup();
    const declined = await ctx.invitations.create(
      ctx.organization.id,
      { email: ctx.member.email! },
      ctx.owner,
    );
    await ctx.invitations.decline(declined.id, ctx.member);
    await expect(
      ctx.invitations.accept(declined.id, ctx.member),
    ).rejects.toThrow("declined");

    const revoked = await ctx.invitations.create(
      ctx.organization.id,
      { email: ctx.member.email! },
      ctx.owner,
    );
    await ctx.invitations.revoke(revoked.id, ctx.owner);
    await expect(
      ctx.invitations.accept(revoked.id, ctx.member),
    ).rejects.toThrow("revoked");

    const expired = await ctx.invitations.create(
      ctx.organization.id,
      { email: "expired@example.com" },
      ctx.owner,
    );
    await ctx.alepha.inject(DateTimeProvider).travel([8, "days"]);
    await ctx.invitations.expirePending();
    await expect(ctx.invitations.getById(expired.id)).resolves.toMatchObject({
      status: "expired",
    });
  });

  it("pre-authorizes credentials by token and OAuth only for verified email", async ({
    expect,
  }) => {
    const ctx = await setup();
    const invitation = await ctx.invitations.create(
      ctx.organization.id,
      { email: "oauth@example.com" },
      ctx.owner,
    );
    const token = (ctx.hooks.created[0] as { token: string }).token;
    const registration = ctx.alepha.inject(InvitationRegistrationService);

    await expect(
      registration.preAuthorize({
        email: invitation.email,
        method: "credentials",
        token,
      }),
    ).resolves.toEqual({ emailVerified: true });
    await expect(
      registration.preAuthorize({
        email: invitation.email,
        method: "oauth",
        emailVerified: false,
      }),
    ).resolves.toBe(false);
    await expect(
      registration.preAuthorize({
        email: invitation.email,
        method: "oauth",
        emailVerified: true,
      }),
    ).resolves.toEqual({ emailVerified: false });
  });

  it("resolves a link from its invitation:<id> verification purpose", async ({
    expect,
  }) => {
    const ctx = await setup();
    const id = crypto.randomUUID();
    const expiresAt = ctx.alepha
      .inject(DateTimeProvider)
      .now()
      .add(7, "days")
      .toISOString();
    const verification = await ctx.alepha
      .inject(VerificationService)
      .createVerification({
        type: "link",
        target: "legacy@example.com",
        purpose: `invitation:${id}`,
        expiresAt,
      });
    await ctx.repos.invitations.create({
      id,
      organizationId: ctx.organization.id,
      invitedBy: ctx.owner.id,
      email: "legacy@example.com",
      status: "pending",
      expiresAt,
    });

    await expect(
      ctx.tokens.resolve(`${id}.${verification.token}`),
    ).resolves.toMatchObject({ id });
  });

  it("neither lists nor answers an invitation for an account that never verified the address", async ({
    expect,
  }) => {
    const ctx = await setup();
    const invitation = await ctx.invitations.create(
      ctx.organization.id,
      { email: "ceo@corp.example" },
      ctx.owner,
    );
    const row = await ctx.users.create({
      username: "squatter",
      email: "ceo@corp.example",
    });
    const squatter: UserAccountToken = {
      id: row.id,
      email: row.email,
      roles: [],
    };

    expect(await ctx.invitations.listMine(squatter)).toEqual([]);
    await expect(
      ctx.invitations.accept(invitation.id, squatter),
    ).rejects.toThrow("not addressed to you");
    await expect(
      ctx.invitations.decline(invitation.id, squatter),
    ).rejects.toThrow("not addressed to you");
    expect(await ctx.members.list(ctx.organization.id)).toHaveLength(1);

    await ctx.users.updateById(row.id, { emailVerified: true });
    expect(await ctx.invitations.listMine(squatter)).toHaveLength(1);
    await expect(
      ctx.invitations.accept(invitation.id, squatter),
    ).resolves.toEqual({ organizationId: ctx.organization.id });
  });

  it("neither lists nor answers an invitation for an account of another realm", async ({
    expect,
  }) => {
    const ctx = await setup();
    const invitation = await ctx.invitations.create(
      ctx.organization.id,
      { email: "ceo@corp.example" },
      ctx.owner,
    );
    const row = await ctx.users.create({
      username: "elsewhere",
      email: "ceo@corp.example",
      realm: "other-realm",
      emailVerified: true,
    });
    const elsewhere: UserAccountToken = {
      id: row.id,
      email: row.email,
      realm: "other-realm",
      roles: [],
    };

    expect(await ctx.invitations.listMine(elsewhere)).toEqual([]);
    await expect(
      ctx.invitations.accept(invitation.id, elsewhere),
    ).rejects.toThrow("not addressed to you");
    await expect(
      ctx.invitations.decline(invitation.id, elsewhere),
    ).rejects.toThrow("not addressed to you");
    expect(await ctx.members.list(ctx.organization.id)).toHaveLength(1);
  });

  it("matches the invitation to the account's stored address, not the token's", async ({
    expect,
  }) => {
    const ctx = await setup();
    const invitation = await ctx.invitations.create(
      ctx.organization.id,
      { email: "ceo@corp.example" },
      ctx.owner,
    );
    const forged: UserAccountToken = {
      ...ctx.member,
      email: "ceo@corp.example",
    };

    expect(await ctx.invitations.listMine(forged)).toEqual([]);
    await expect(ctx.invitations.accept(invitation.id, forged)).rejects.toThrow(
      "not addressed to you",
    );
  });

  it("says nothing about an invitation to a preview without its secret", async ({
    expect,
  }) => {
    const ctx = await setup();
    const accepted = await ctx.invitations.create(
      ctx.organization.id,
      { email: ctx.member.email! },
      ctx.owner,
    );
    const acceptedToken = (ctx.hooks.created[0] as { token: string }).token;
    await ctx.invitations.accept(accepted.id, ctx.member);
    const expired = await ctx.invitations.create(
      ctx.organization.id,
      { email: "late@example.com" },
      ctx.owner,
    );
    const expiredToken = (ctx.hooks.created[1] as { token: string }).token;
    await ctx.repos.invitations.updateById(expired.id, {
      expiresAt: ctx.alepha
        .inject(DateTimeProvider)
        .now()
        .subtract(1, "minute")
        .toISOString(),
    });

    expect(await ctx.tokens.inspect(`${accepted.id}.garbage`)).toEqual({
      status: "invalid",
    });
    expect(await ctx.tokens.inspect(`${expired.id}.garbage`)).toEqual({
      status: "invalid",
    });
    expect(await ctx.tokens.inspect(acceptedToken)).toMatchObject({
      status: "accepted",
      invitation: { id: accepted.id },
    });
    expect(await ctx.tokens.inspect(expiredToken)).toMatchObject({
      status: "expired",
      invitation: { id: expired.id },
    });
  });

  it("answers invalid for a token whose id half is not an id", async ({
    expect,
  }) => {
    const ctx = await setup();

    expect(await ctx.tokens.inspect("abc.def")).toEqual({ status: "invalid" });
    await expect(ctx.tokens.resolve("abc.def")).resolves.toBeUndefined();
  });

  it("keeps the real link working after any number of wrong secrets", async ({
    expect,
  }) => {
    const ctx = await setup();
    const invitation = await ctx.invitations.create(
      ctx.organization.id,
      { email: "second@corp.example" },
      ctx.owner,
    );
    const token = (ctx.hooks.created[0] as { token: string }).token;

    for (let i = 0; i < 5; i++) {
      expect(await ctx.tokens.inspect(`${invitation.id}.wrong${i}`)).toEqual({
        status: "invalid",
      });
    }

    expect(await ctx.tokens.inspect(token)).toMatchObject({ status: "ok" });
    await expect(
      ctx.alepha.inject(InvitationRegistrationService).preAuthorize({
        email: invitation.email,
        method: "credentials",
        token,
      }),
    ).resolves.toEqual({ emailVerified: true });
  });
});
