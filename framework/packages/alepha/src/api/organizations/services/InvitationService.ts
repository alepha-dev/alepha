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

  /**
   * The pending invitations addressed to the signed-in account.
   *
   * Only those the account may answer: see {@link assertAddressedTo}.
   */
  public async listMine(
    user: Pick<UserAccountToken, "id" | "realm">,
  ): Promise<InvitationInboxItem[]> {
    const invitee = await this.invitee(user);
    if (!invitee) return [];
    const addressed = await this.invitations.findMany({
      where: {
        email: { eq: invitee.email },
        status: { eq: "pending" },
      },
      orderBy: { column: "createdAt", direction: "desc" },
    });
    const sent = await this.sentFrom(addressed, invitee.realm);
    const rows = addressed.filter(
      (row) => sent.has(row.id) && this.provesAddress(invitee, row),
    );
    if (rows.length === 0) return [];
    const names = new Map<string, string>();
    const organizationIds = [...new Set(rows.map((row) => row.organizationId))];
    for (const ids of this.batches(organizationIds)) {
      const organizations = await this.organizations.findMany({
        where: { id: { inArray: ids } },
      });
      for (const item of organizations) names.set(item.id, item.name);
    }
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
    await this.assertAddressedTo(invitation, acceptedBy);
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
    await this.assertAddressedTo(invitation, declinedBy);
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

  /**
   * Mark the pending invitations past their date as expired, and say how
   * many went.
   *
   * In batches, each one a bounded read then an update by id: the update
   * binds one parameter per id, and Cloudflare D1 binds 100 per statement.
   * A run stops at {@link maxExpireBatchesPerRun}; the next one takes the
   * rest.
   */
  public async expirePending(): Promise<number> {
    const now = this.dateTime.nowISOString();
    const size = this.batchSize();
    let count = 0;
    for (let batch = 0; batch < this.maxExpireBatchesPerRun; batch++) {
      const expired = await this.invitations.findMany({
        where: { status: { eq: "pending" }, expiresAt: { lt: now } },
        orderBy: { column: "expiresAt", direction: "asc" },
        limit: size,
      });
      if (expired.length === 0) break;
      await this.invitations.updateMany(
        { id: { inArray: expired.map((item) => item.id) } },
        { status: "expired", resolvedAt: now },
      );
      for (const invitation of expired) {
        await this.alepha.events.emit("organization:invitation:expired", {
          invitation,
        });
      }
      count += expired.length;
      if (expired.length < size) break;
    }
    return count;
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

  /**
   * Refuse an invitation the signed-in account may not answer. It may when
   * all three hold:
   *
   * - the account's stored address is the invitation's ({@link invitee});
   * - the invitation was sent from the account's realm ({@link sentFrom});
   * - the account has a claim on the address ({@link provesAddress}).
   *
   * One message for every case, so the refusal says nothing about why.
   */
  protected async assertAddressedTo(
    invitation: OrganizationInvitation,
    user: Pick<UserAccountToken, "id" | "realm">,
  ): Promise<void> {
    const invitee = await this.invitee(user);
    if (
      !invitee ||
      invitee.email !== invitation.email ||
      !this.provesAddress(invitee, invitation) ||
      !(await this.sentFrom([invitation], invitee.realm)).has(invitation.id)
    ) {
      throw new ForbiddenError("This invitation is not addressed to you");
    }
  }

  /**
   * The signed-in account as an invitee, or nothing when it has no address.
   *
   * Read from the account's row, never from the token: an invitation is
   * matched by address alone, so the address is the one the realm stores.
   * `verifies` is the realm's `verifyEmailRequired` setting, read as the
   * realm reads it (a settings parameter wins over the declared value).
   */
  protected async invitee(
    user: Pick<UserAccountToken, "id" | "realm">,
  ): Promise<Invitee | undefined> {
    const realm = this.realm.getRealm(user.realm);
    const account = await this.realm.userRepository(realm.name).findOne({
      where: { id: { eq: user.id }, realm: { eq: realm.name } },
    });
    if (!account?.email) return undefined;
    return {
      email: account.email.toLowerCase(),
      realm: realm.name,
      verified: account.emailVerified === true,
      createdAt: account.createdAt,
      verifies: (await realm.getSettings()).verifyEmailRequired === true,
    };
  }

  /**
   * Whether the account has a claim on the address an invitation was sent
   * to, beyond having typed it at registration.
   *
   * - **A realm that verifies addresses**: the address is verified, or the
   *   account already existed when the invitation was created. The inviter
   *   then invited a known account, which is the only way in for one an
   *   administrator created or one registered before mail was configured.
   *   An unverified account created after the invitation is the case this
   *   refuses: whoever registers an invited address to take the invitation.
   * - **A realm that does not**: every account passes, since none can
   *   verify. There, whoever registers an invited address first can answer
   *   its invitations; turning `verifyEmailRequired` on is what closes that.
   */
  protected provesAddress(
    invitee: Invitee,
    invitation: OrganizationInvitation,
  ): boolean {
    return (
      !invitee.verifies ||
      invitee.verified ||
      !this.dateTime.of(invitee.createdAt).isAfter(invitation.createdAt)
    );
  }

  /**
   * Which of these invitations were sent from `realm`, by id.
   *
   * An invitation belongs to its inviter's realm, the one `create` looked
   * the invitee up in, and only an account of that realm may answer it: the
   * same address in another realm is another person.
   *
   * An inviter whose account is gone answers for no realm. Their
   * invitations are not stranded: the organization's owner answers instead,
   * since an organization always has one and its members share a realm.
   */
  protected async sentFrom(
    invitations: OrganizationInvitation[],
    realm: string,
  ): Promise<Set<string>> {
    const users = this.realm.userRepository(realm);
    const inviterRealms = new Map<string, string>();
    const inviterIds = [...new Set(invitations.map((row) => row.invitedBy))];
    for (const ids of this.batches(inviterIds)) {
      const rows = await users.findMany({ where: { id: { inArray: ids } } });
      for (const row of rows) inviterRealms.set(row.id, row.realm);
    }
    const sent = new Set<string>();
    const orphans: OrganizationInvitation[] = [];
    for (const invitation of invitations) {
      const inviterRealm = inviterRealms.get(invitation.invitedBy);
      if (inviterRealm === realm) sent.add(invitation.id);
      else if (inviterRealm === undefined) orphans.push(invitation);
    }
    if (orphans.length === 0) return sent;

    const owners = new Map<string, string>();
    const organizationIds = [
      ...new Set(orphans.map((row) => row.organizationId)),
    ];
    for (const ids of this.batches(organizationIds)) {
      const rows = await this.memberRows.findMany({
        where: {
          organizationId: { inArray: ids },
          rank: { eq: MemberService.OWNER },
        },
      });
      for (const row of rows) owners.set(row.organizationId, row.userId);
    }
    const ownersInRealm = new Set<string>();
    for (const ids of this.batches([...new Set(owners.values())])) {
      const rows = await users.findMany({
        where: { id: { inArray: ids }, realm: { eq: realm } },
      });
      for (const row of rows) ownersInRealm.add(row.id);
    }
    for (const invitation of orphans) {
      const owner = owners.get(invitation.organizationId);
      if (owner && ownersInRealm.has(owner)) sent.add(invitation.id);
    }
    return sent;
  }

  /**
   * Batches an expiry run takes at most.
   */
  protected readonly maxExpireBatchesPerRun = 10;

  /**
   * Ids one statement names: 1000, or fewer when the driver binds fewer
   * parameters per statement (90 on D1).
   */
  protected batchSize(): number {
    return Math.min(1000, this.invitations.provider.maxBoundParameters - 10);
  }

  protected batches<T>(items: T[]): T[][] {
    const size = this.batchSize();
    const batches: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      batches.push(items.slice(index, index + size));
    }
    return batches;
  }
}

interface Invitee {
  email: string;
  realm: string;
  verified: boolean;
  createdAt: string;
  verifies: boolean;
}

export type InvitationInboxItem = OrganizationInvitation & {
  organizationName?: string;
};
