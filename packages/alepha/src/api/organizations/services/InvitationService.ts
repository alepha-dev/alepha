import { $inject, Alepha } from "alepha";
import { RealmProvider } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ForbiddenError } from "alepha/server";

import { organizationConfigAtom } from "../atoms/organizationConfigAtom.ts";
import {
  type OrganizationInvitation,
  organizationInvitations,
} from "../entities/organizationInvitations.ts";
import { organizationMembers } from "../entities/organizationMembers.ts";
import { organizations } from "../entities/organizations.ts";
import { OrganizationPolicyProvider } from "../providers/OrganizationPolicyProvider.ts";
import { InvitationTokenService } from "./InvitationTokenService.ts";
import { MemberService } from "./MemberService.ts";
import { RankService } from "./RankService.ts";

export class InvitationService {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly realm = $inject(RealmProvider);
  protected readonly policy = $inject(OrganizationPolicyProvider);
  protected readonly ranks = $inject(RankService);
  protected readonly members = $inject(MemberService);
  protected readonly tokens = $inject(InvitationTokenService);
  protected readonly invitations = $repository(organizationInvitations);
  protected readonly memberRows = $repository(organizationMembers);
  protected readonly organizations = $repository(organizations);

  public async create(
    organizationId: string,
    input: {
      email: string;
      rank?: string;
      metadata?: Record<string, unknown>;
    },
    inviter: UserAccountToken,
  ): Promise<OrganizationInvitation> {
    const email = input.email.trim().toLowerCase();
    const rank = input.rank ?? MemberService.MEMBER;
    await this.ranks.assertAssignable(organizationId, rank, inviter);
    await this.policy.assertRoom(organizationId);

    const account = await this.realm.userRepository(inviter.realm).findOne({
      where: { email: { eq: email } },
    });
    if (account) {
      const member = await this.memberRows.findOne({
        where: {
          organizationId: { eq: organizationId },
          userId: { eq: account.id },
        },
      });
      if (member) {
        throw new BadRequestError(
          "This email is already a member of this organization",
        );
      }
    }

    const pending = await this.invitations.findOne({
      where: {
        organizationId: { eq: organizationId },
        email: { eq: email },
        status: { eq: "pending" },
      },
    });
    if (pending) {
      throw new BadRequestError(
        "A pending invitation already exists for this email",
      );
    }

    const config = this.alepha.store.get(organizationConfigAtom);
    const organizationPending = await this.invitations.count({
      organizationId: { eq: organizationId },
      status: { eq: "pending" },
    });
    if (organizationPending >= config.maxPendingInvitationsPerOrganization) {
      throw new BadRequestError(
        `Maximum pending invitations per organization reached (${config.maxPendingInvitationsPerOrganization})`,
      );
    }
    const inviterPending = await this.invitations.count({
      invitedBy: { eq: inviter.id },
      status: { eq: "pending" },
    });
    if (inviterPending >= config.maxPendingInvitationsPerInviter) {
      throw new BadRequestError(
        `Maximum pending invitations per inviter reached (${config.maxPendingInvitationsPerInviter})`,
      );
    }

    const invitation = await this.invitations.create({
      organizationId,
      invitedBy: inviter.id,
      email,
      status: "pending",
      rank: rank === MemberService.MEMBER ? undefined : rank,
      metadata: input.metadata,
      expiresAt: this.dateTime
        .now()
        .add(config.invitationExpirationDays, "days")
        .toISOString(),
    });
    const token = await this.tokens.mint(invitation);
    await this.alepha.events.emit("organization:invitation:created", {
      invitation,
      inviter,
      token,
    });
    return invitation;
  }

  public getById(id: string): Promise<OrganizationInvitation> {
    return this.invitations.getById(id);
  }

  public list(
    organizationId: string,
    status: OrganizationInvitation["status"] = "pending",
  ): Promise<OrganizationInvitation[]> {
    return this.invitations.findMany({
      where: {
        organizationId: { eq: organizationId },
        status: { eq: status },
      },
      orderBy: { column: "createdAt", direction: "desc" },
    });
  }

  public async listMine(user: {
    email?: string;
  }): Promise<InvitationInboxItem[]> {
    if (!user.email) return [];
    const rows = await this.invitations.findMany({
      where: {
        email: { eq: user.email.toLowerCase() },
        status: { eq: "pending" },
      },
      orderBy: { column: "createdAt", direction: "desc" },
    });
    if (rows.length === 0) return [];
    const organizations = await this.organizations.findMany({
      where: {
        id: { inArray: [...new Set(rows.map((row) => row.organizationId))] },
      },
    });
    const names = new Map(organizations.map((item) => [item.id, item.name]));
    return rows.map((row) => ({
      ...row,
      organizationName: names.get(row.organizationId),
    }));
  }

  public async accept(
    invitationId: string,
    acceptedBy: UserAccountToken,
  ): Promise<{ organizationId: string }> {
    const invitation = await this.invitations.getById(invitationId);
    this.assertOwnedByEmail(invitation, acceptedBy);
    this.assertPending(invitation);
    const now = this.dateTime.now();
    if (now.isAfter(invitation.expiresAt)) {
      await this.invitations.updateById(invitation.id, {
        status: "expired",
        resolvedAt: now.toISOString(),
      });
      throw new BadRequestError("Invitation has expired");
    }
    const existing = await this.memberRows.findOne({
      where: {
        organizationId: { eq: invitation.organizationId },
        userId: { eq: acceptedBy.id },
      },
    });
    if (existing) {
      throw new BadRequestError(
        "You are already a member of this organization",
      );
    }
    await this.policy.assertRoom(invitation.organizationId);
    const requested = invitation.rank ?? MemberService.MEMBER;
    const rank = (await this.ranks.ranksOf(invitation.organizationId)).some(
      (item) => item.key === requested && item.key !== MemberService.OWNER,
    )
      ? requested
      : MemberService.MEMBER;
    await this.members.add(
      invitation.organizationId,
      acceptedBy.id,
      rank === MemberService.MEMBER ? undefined : rank,
      acceptedBy,
    );
    await this.invitations.updateById(invitation.id, {
      status: "accepted",
      resolvedAt: now.toISOString(),
      resolvedBy: acceptedBy.id,
    });
    await this.alepha.events.emit("organization:invitation:accepted", {
      invitation,
      acceptedBy,
    });
    return { organizationId: invitation.organizationId };
  }

  public async decline(
    invitationId: string,
    declinedBy: UserAccountToken,
  ): Promise<void> {
    const invitation = await this.invitations.getById(invitationId);
    this.assertOwnedByEmail(invitation, declinedBy);
    this.assertPending(invitation);
    await this.invitations.updateById(invitation.id, {
      status: "declined",
      resolvedAt: this.dateTime.nowISOString(),
      resolvedBy: declinedBy.id,
    });
    await this.alepha.events.emit("organization:invitation:declined", {
      invitation,
      declinedBy,
    });
  }

  public async revoke(
    invitationId: string,
    revokedBy: Pick<UserAccountToken, "id">,
  ): Promise<void> {
    const invitation = await this.invitations.getById(invitationId);
    this.assertPending(invitation);
    await this.invitations.updateById(invitation.id, {
      status: "revoked",
      resolvedAt: this.dateTime.nowISOString(),
      resolvedBy: revokedBy.id,
    });
    await this.alepha.events.emit("organization:invitation:revoked", {
      invitation,
      revokedBy,
    });
  }

  public async expirePending(): Promise<number> {
    const now = this.dateTime.nowISOString();
    const expired = await this.invitations.findMany({
      where: { status: { eq: "pending" }, expiresAt: { lt: now } },
    });
    if (expired.length === 0) return 0;
    await this.invitations.updateMany(
      { id: { inArray: expired.map((item) => item.id) } },
      { status: "expired", resolvedAt: now },
    );
    for (const invitation of expired) {
      await this.alepha.events.emit("organization:invitation:expired", {
        invitation,
      });
    }
    return expired.length;
  }

  public async purgeResolved(): Promise<number> {
    const days = this.alepha.store.get(
      organizationConfigAtom,
    ).invitationPurgeDays;
    if (days === 0) return 0;
    const cutoff = this.dateTime.now().subtract(days, "days").toISOString();
    return (
      await this.invitations.deleteMany({
        status: { inArray: ["accepted", "declined", "expired", "revoked"] },
        resolvedAt: { lt: cutoff },
      })
    ).length;
  }

  public findAll(): Promise<OrganizationInvitation[]> {
    return this.invitations.findMany({
      orderBy: { column: "createdAt", direction: "desc" },
    });
  }

  public async delete(id: string): Promise<void> {
    const invitation = await this.invitations.getById(id);
    if (invitation.status === "pending") {
      throw new BadRequestError(
        "Revoke a pending invitation before deleting it",
      );
    }
    await this.invitations.deleteById(id);
  }

  protected assertPending(invitation: OrganizationInvitation): void {
    if (invitation.status !== "pending") {
      throw new BadRequestError(
        `Invitation is ${invitation.status}, not pending`,
      );
    }
  }

  protected assertOwnedByEmail(
    invitation: OrganizationInvitation,
    user: { email?: string },
  ): void {
    if (!user.email || user.email.toLowerCase() !== invitation.email) {
      throw new ForbiddenError("This invitation is not addressed to you");
    }
  }
}

export type InvitationInboxItem = OrganizationInvitation & {
  organizationName?: string;
};
