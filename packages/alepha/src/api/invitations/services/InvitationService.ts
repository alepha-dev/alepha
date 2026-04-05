import { $inject, Alepha } from "alepha";
import { type UserEntity, users } from "alepha/api/users";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, type Page } from "alepha/orm";
import { BadRequestError, ForbiddenError } from "alepha/server";
import { type InvitationEntity, invitations } from "../entities/invitations.ts";
import { InvitationProvider } from "../providers/InvitationProvider.ts";
import type { CreateInvitation } from "../schemas/createInvitationSchema.ts";
import { invitationConfigAtom } from "../schemas/invitationConfigAtom.ts";
import type { InvitationQuery } from "../schemas/invitationQuerySchema.ts";
import type { InvitationWithResourceInfo } from "../schemas/invitationWithResourceInfoSchema.ts";
import type { MyInvitationsQuery } from "../schemas/myInvitationsQuerySchema.ts";

export class InvitationService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly repo = $repository(invitations);
  protected readonly users = $repository(users);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly provider = $inject(InvitationProvider);

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Get an invitation by ID.
   */
  public async getById(id: string): Promise<InvitationEntity> {
    return this.repo.getById(id);
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Create a new invitation.
   */
  public async create(
    data: CreateInvitation,
    inviter: { id: string; email?: string },
  ): Promise<InvitationEntity> {
    if (data.email === inviter.email) {
      throw new BadRequestError("Cannot invite yourself");
    }

    await this.provider.validateResource(
      data.resourceType,
      data.resourceId,
      inviter,
    );

    const existingUser = await this.users.findOne({
      where: { email: { eq: data.email } },
    });

    if (existingUser) {
      const alreadyMember = await this.provider.isMember(
        data.resourceType,
        data.resourceId,
        data.email,
        existingUser.id,
      );

      if (alreadyMember) {
        throw new BadRequestError("User is already a member of this resource");
      }
    }

    const pendingForSameTarget = await this.repo.findOne({
      where: {
        resourceType: { eq: data.resourceType },
        resourceId: { eq: data.resourceId },
        email: { eq: data.email },
        status: { eq: "pending" },
      },
    });

    if (pendingForSameTarget) {
      throw new BadRequestError(
        "A pending invitation already exists for this email and resource",
      );
    }

    const config = this.alepha.store.get(invitationConfigAtom);

    const resourcePendingCount = await this.repo.count({
      resourceType: { eq: data.resourceType },
      resourceId: { eq: data.resourceId },
      status: { eq: "pending" },
    });

    if (resourcePendingCount >= config.maxPendingPerResource) {
      throw new BadRequestError(
        `Maximum pending invitations per resource reached (${config.maxPendingPerResource})`,
      );
    }

    const inviterPendingCount = await this.repo.count({
      invitedBy: { eq: inviter.id },
      status: { eq: "pending" },
    });

    if (inviterPendingCount >= config.maxPendingPerInviter) {
      throw new BadRequestError(
        `Maximum pending invitations per inviter reached (${config.maxPendingPerInviter})`,
      );
    }

    const token = this.crypto.randomUUID();
    const tokenHash = this.crypto.hash(token, "sha256");
    const expiresAt = this.dateTime
      .now()
      .add(config.expirationDays, "days")
      .toISOString();

    const entity = await this.repo.create({
      invitedBy: inviter.id,
      email: data.email,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      status: "pending",
      roles: data.roles,
      metadata: data.metadata,
      token: tokenHash,
      expiresAt,
    });

    this.log.info("Invitation created", {
      id: entity.id,
      email: data.email,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      invitedBy: inviter.id,
    });

    await this.alepha.events.emit("invitation:created", {
      invitation: entity,
      token,
      inviter,
    });

    return entity;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Accept a pending invitation.
   */
  public async accept(
    invitationId: string,
    acceptedBy: { id: string; email?: string },
  ): Promise<void> {
    const invitation = await this.repo.getById(invitationId);

    if (invitation.status !== "pending") {
      throw new BadRequestError(
        `Invitation is not pending (current status: ${invitation.status})`,
      );
    }

    if (invitation.email !== acceptedBy.email) {
      throw new ForbiddenError("This invitation was sent to a different email");
    }

    const now = this.dateTime.now();

    if (now.isAfter(invitation.expiresAt)) {
      await this.repo.updateById(invitationId, {
        status: "expired",
        resolvedAt: now.toISOString(),
      });
      throw new BadRequestError("Invitation has expired");
    }

    const alreadyMember = await this.provider.isMember(
      invitation.resourceType,
      invitation.resourceId,
      invitation.email,
      acceptedBy.id,
    );

    if (alreadyMember) {
      await this.repo.updateById(invitationId, {
        status: "accepted",
        resolvedAt: now.toISOString(),
        resolvedBy: acceptedBy.id,
      });

      this.log.info("Invitation accepted (already member)", {
        id: invitationId,
        acceptedBy: acceptedBy.id,
      });

      return;
    }

    await this.provider.onAccept(invitation, acceptedBy);

    await this.repo.updateById(invitationId, {
      status: "accepted",
      resolvedAt: now.toISOString(),
      resolvedBy: acceptedBy.id,
    });

    this.log.info("Invitation accepted", {
      id: invitationId,
      email: invitation.email,
      resourceType: invitation.resourceType,
      resourceId: invitation.resourceId,
      acceptedBy: acceptedBy.id,
    });

    await this.alepha.events.emit("invitation:accepted", {
      invitation,
      acceptedBy,
    });
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Decline a pending invitation.
   */
  public async decline(
    invitationId: string,
    declinedBy: { id: string; email?: string },
  ): Promise<void> {
    const invitation = await this.repo.getById(invitationId);

    if (invitation.status !== "pending") {
      throw new BadRequestError(
        `Invitation is not pending (current status: ${invitation.status})`,
      );
    }

    if (invitation.email !== declinedBy.email) {
      throw new ForbiddenError("This invitation was sent to a different email");
    }

    const now = this.dateTime.now();

    await this.repo.updateById(invitationId, {
      status: "declined",
      resolvedAt: now.toISOString(),
      resolvedBy: declinedBy.id,
    });

    this.log.info("Invitation declined", {
      id: invitationId,
      email: invitation.email,
      resourceType: invitation.resourceType,
      resourceId: invitation.resourceId,
      declinedBy: declinedBy.id,
    });

    await this.alepha.events.emit("invitation:declined", {
      invitation,
      declinedBy,
    });
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Revoke a pending invitation (by the inviter or admin).
   */
  public async revoke(
    invitationId: string,
    revokedBy: { id: string },
  ): Promise<void> {
    const invitation = await this.repo.getById(invitationId);

    if (invitation.status !== "pending") {
      throw new BadRequestError(
        `Invitation is not pending (current status: ${invitation.status})`,
      );
    }

    const now = this.dateTime.now();

    await this.repo.updateById(invitationId, {
      status: "revoked",
      resolvedAt: now.toISOString(),
      resolvedBy: revokedBy.id,
    });

    this.log.info("Invitation revoked", {
      id: invitationId,
      email: invitation.email,
      resourceType: invitation.resourceType,
      resourceId: invitation.resourceId,
      revokedBy: revokedBy.id,
    });

    await this.alepha.events.emit("invitation:revoked", {
      invitation,
      revokedBy,
    });
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Find invitations for a given email with resource info enrichment.
   */
  public async findByEmail(
    email: string,
    query: MyInvitationsQuery = {},
  ): Promise<InvitationWithResourceInfo[]> {
    const where = this.repo.createQueryWhere();
    where.email = { eq: email };

    if (query.status) {
      where.status = { eq: query.status };
    }

    const results = await this.repo.findMany({
      where,
      orderBy: { column: "createdAt", direction: "desc" },
    });

    const inviterIds = [...new Set(results.map((inv) => inv.invitedBy))];
    const inviters = await this.loadInviters(inviterIds);

    const enriched: InvitationWithResourceInfo[] = [];

    for (const inv of results) {
      const inviter = inviters.get(inv.invitedBy);
      let resourceName = inv.resourceType;
      let resourceUrl: string | undefined;

      try {
        const info = await this.provider.getResourceInfo(
          inv.resourceType,
          inv.resourceId,
        );
        resourceName = info.name;
        resourceUrl = info.url;
      } catch (error) {
        this.log.warn("Failed to load resource info for invitation", {
          invitationId: inv.id,
          resourceType: inv.resourceType,
          resourceId: inv.resourceId,
          error,
        });
      }

      enriched.push({
        id: inv.id,
        email: inv.email,
        resourceType: inv.resourceType,
        resourceId: inv.resourceId,
        resourceName,
        resourceUrl,
        invitedBy: inv.invitedBy,
        inviterName: this.formatInviterName(inviter),
        inviterEmail: inviter?.email,
        roles: inv.roles,
        status: inv.status,
        createdAt: inv.createdAt,
        expiresAt: inv.expiresAt,
      });
    }

    return enriched;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Find invitations for a specific resource.
   */
  public async findByResource(
    resourceType: string,
    resourceId: string,
    status?: string,
  ): Promise<InvitationEntity[]> {
    const where = this.repo.createQueryWhere();
    where.resourceType = { eq: resourceType };
    where.resourceId = { eq: resourceId };

    if (status) {
      where.status = { eq: status as InvitationEntity["status"] };
    }

    return this.repo.findMany({
      where,
      orderBy: { column: "createdAt", direction: "desc" },
    });
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Find invitations with pagination and filtering (admin).
   */
  public async findInvitations(
    query: InvitationQuery = {},
  ): Promise<Page<InvitationEntity>> {
    query.sort ??= "-createdAt";

    const where = this.repo.createQueryWhere();

    if (query.email) {
      where.email = { like: `%${query.email}%` };
    }

    if (query.resourceType) {
      where.resourceType = { eq: query.resourceType };
    }

    if (query.resourceId) {
      where.resourceId = { eq: query.resourceId };
    }

    if (query.status) {
      where.status = { eq: query.status };
    }

    if (query.invitedBy) {
      where.invitedBy = { eq: query.invitedBy };
    }

    return this.repo.paginate(query, { where }, { count: true });
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Delete an invitation (admin). Only non-pending invitations can be deleted.
   */
  public async deleteInvitation(id: string): Promise<void> {
    const invitation = await this.repo.getById(id);

    if (invitation.status === "pending") {
      throw new BadRequestError(
        "Cannot delete a pending invitation. Revoke it first.",
      );
    }

    await this.repo.deleteById(id);

    this.log.info("Invitation deleted", { id });
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Expire all pending invitations that have passed their expiration date.
   * Returns the number of expired invitations.
   */
  public async expirePending(): Promise<number> {
    const now = this.dateTime.nowISOString();

    const expired = await this.repo.findMany({
      where: {
        status: { eq: "pending" },
        expiresAt: { lt: now },
      },
    });

    if (expired.length === 0) {
      return 0;
    }

    const ids = expired.map((inv) => inv.id);

    await this.repo.updateMany(
      { id: { inArray: ids } },
      {
        status: "expired",
        resolvedAt: now,
      },
    );

    for (const inv of expired) {
      await this.alepha.events.emit("invitation:expired", {
        invitation: inv,
      });
    }

    this.log.info("Expired pending invitations", { count: expired.length });

    return expired.length;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Purge resolved invitations older than the configured purge days.
   * Returns the number of purged invitations.
   */
  public async purgeResolved(): Promise<number> {
    const config = this.alepha.store.get(invitationConfigAtom);

    if (config.purgeDays === 0) {
      return 0;
    }

    const cutoff = this.dateTime
      .now()
      .subtract(config.purgeDays, "days")
      .toISOString();

    const ids = await this.repo.deleteMany({
      status: { inArray: ["accepted", "declined", "expired", "revoked"] },
      resolvedAt: { lt: cutoff },
    });

    if (ids.length > 0) {
      this.log.info("Purged resolved invitations", { count: ids.length });
    }

    return ids.length;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Load user records for a list of inviter IDs.
   */
  protected async loadInviters(
    ids: string[],
  ): Promise<Map<string, UserEntity>> {
    if (ids.length === 0) {
      return new Map();
    }

    const result = await this.users.findMany({
      where: { id: { inArray: ids } },
    });

    return new Map(result.map((user) => [user.id, user]));
  }

  /**
   * Format inviter display name from user entity.
   */
  protected formatInviterName(user?: UserEntity): string | undefined {
    if (!user) {
      return undefined;
    }

    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }

    if (user.firstName) {
      return user.firstName;
    }

    return user.username ?? user.email;
  }
}
