import { $inject, Alepha } from "alepha";
import { type UserEntity, users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, type Page } from "alepha/orm";
import { BadRequestError, ForbiddenError } from "alepha/server";

import { type InvitationEntity, invitations } from "../entities/invitations.ts";
import { members } from "../entities/members.ts";
import { projects } from "../entities/projects.ts";
import type { CreateInvitation } from "../schemas/createInvitationSchema.ts";
import { invitationConfigAtom } from "../schemas/invitationConfigAtom.ts";
import type { InvitationQuery } from "../schemas/invitationQuerySchema.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

declare module "alepha" {
  interface Hooks {
    "invitation:created": {
      invitation: InvitationEntity;
      inviter: { id: string; email?: string };
    };
    "invitation:accepted": {
      invitation: InvitationEntity;
      acceptedBy: { id: string; email?: string };
    };
    "invitation:declined": {
      invitation: InvitationEntity;
      declinedBy: { id: string; email?: string };
    };
    "invitation:expired": {
      invitation: InvitationEntity;
    };
    "invitation:revoked": {
      invitation: InvitationEntity;
      revokedBy: { id: string };
    };
  }
}

export class InvitationService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly repo = $repository(invitations);
  protected readonly users = $repository(users);
  protected readonly projects = $repository(projects);
  protected readonly members = $repository(members);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly security = $inject(ProjectSecurityService);

  public async getById(id: string): Promise<InvitationEntity> {
    return this.repo.getById(id);
  }

  public async create(
    data: CreateInvitation,
    inviter: { id: string; email?: string },
  ): Promise<InvitationEntity> {
    const email = data.email.trim().toLowerCase();

    if (email === inviter.email?.toLowerCase()) {
      throw new BadRequestError("Cannot invite yourself");
    }

    await this.security.assertOwner(Number(data.resourceId), inviter as any);

    const existingUser = await this.users.findOne({
      where: { email: { eq: email } },
    });

    if (existingUser) {
      const alreadyMember = await this.isProjectMember(
        data.resourceId,
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
        email: { eq: email },
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

    const expiresAt = this.dateTime
      .now()
      .add(config.expirationDays, "days")
      .toISOString();

    const entity = await this.repo.create({
      invitedBy: inviter.id,
      email,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      status: "pending",
      roles: data.roles,
      metadata: data.metadata,
      expiresAt,
    });

    this.log.info("Invitation created", {
      id: entity.id,
      email,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      invitedBy: inviter.id,
    });

    await this.alepha.events.emit("invitation:created", {
      invitation: entity,
      inviter,
    });

    return entity;
  }

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

  /**
   * Inbox: pending invitations addressed to the caller's email (case-
   * insensitive). The user surfaces these on /account/invitations.
   */
  public async listForUser(user: {
    id: string;
    email?: string;
  }): Promise<
    Array<InvitationEntity & { projectTitle: string; inviterName?: string }>
  > {
    if (!user.email) {
      return [];
    }
    const email = user.email.toLowerCase();
    const rows = await this.repo.findMany({
      where: {
        email: { eq: email },
        status: { eq: "pending" },
      },
      orderBy: { column: "createdAt", direction: "desc" },
    });
    if (rows.length === 0) {
      return [];
    }
    const enriched = await Promise.all(
      rows.map(async (inv) => {
        const project = await this.projects.findOne({
          where: { id: { eq: Number(inv.resourceId) } },
        });
        const inviter = await this.users.findOne({
          where: { id: { eq: inv.invitedBy } },
        });
        return {
          ...inv,
          projectTitle: project?.title ?? "Project",
          inviterName: this.formatInviterName(inviter),
        };
      }),
    );
    return enriched;
  }

  /**
   * Accept an invitation by id. The session's email must match the
   * invitation's email (case-insensitive) — that's the proof.
   */
  public async accept(
    invitationId: string,
    acceptedBy: { id: string; email?: string },
  ): Promise<{ projectId: string }> {
    const invitation = await this.repo.getById(invitationId);
    this.assertOwnedByEmail(invitation, acceptedBy);
    if (invitation.status !== "pending") {
      throw new BadRequestError(
        `Invitation is not pending (current status: ${invitation.status})`,
      );
    }
    const now = this.dateTime.now();
    if (now.isAfter(invitation.expiresAt)) {
      await this.repo.updateById(invitation.id, {
        status: "expired",
        resolvedAt: now.toISOString(),
      });
      throw new BadRequestError("Invitation has expired");
    }

    const alreadyMember = await this.isProjectMember(
      invitation.resourceId,
      acceptedBy.id,
    );
    if (!alreadyMember) {
      await this.members.create({
        projectId: Number(invitation.resourceId),
        userId: acceptedBy.id,
        owner: false,
      });
    }

    await this.repo.updateById(invitation.id, {
      status: "accepted",
      resolvedAt: now.toISOString(),
      resolvedBy: acceptedBy.id,
    });

    this.log.info("Invitation accepted", {
      id: invitation.id,
      resourceId: invitation.resourceId,
      acceptedBy: acceptedBy.id,
    });

    await this.alepha.events.emit("invitation:accepted", {
      invitation,
      acceptedBy,
    });

    return { projectId: invitation.resourceId };
  }

  /**
   * Decline an invitation by id. Same email-binding posture as accept.
   */
  public async decline(
    invitationId: string,
    declinedBy: { id: string; email?: string },
  ): Promise<void> {
    const invitation = await this.repo.getById(invitationId);
    this.assertOwnedByEmail(invitation, declinedBy);
    if (invitation.status !== "pending") {
      throw new BadRequestError(
        `Invitation is not pending (current status: ${invitation.status})`,
      );
    }
    const now = this.dateTime.now();
    await this.repo.updateById(invitation.id, {
      status: "declined",
      resolvedAt: now.toISOString(),
      resolvedBy: declinedBy.id,
    });
    this.log.info("Invitation declined", {
      id: invitation.id,
      declinedBy: declinedBy.id,
    });
    await this.alepha.events.emit("invitation:declined", {
      invitation,
      declinedBy,
    });
  }

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

  public async findInvitations(
    query: InvitationQuery = {},
  ): Promise<Page<InvitationEntity>> {
    query.sort ??= "-createdAt";

    const where = this.repo.createQueryWhere();

    if (query.email) {
      where.email = { like: `%${query.email.toLowerCase()}%` };
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

  protected async isProjectMember(
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    const member = await this.members.findOne({
      where: {
        projectId: { eq: Number(projectId) },
        userId: { eq: userId },
      },
    });
    return !!member;
  }

  protected assertOwnedByEmail(
    invitation: InvitationEntity,
    user: { email?: string },
  ): void {
    if (!user.email || user.email.toLowerCase() !== invitation.email) {
      throw new ForbiddenError("This invitation is not addressed to you");
    }
  }

  protected formatInviterName(user?: UserEntity): string | undefined {
    if (!user?.email) {
      return undefined;
    }
    const at = user.email.indexOf("@");
    return at > 0 ? user.email.slice(0, at) : user.email;
  }
}
