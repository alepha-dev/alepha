import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, type Page } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ForbiddenError } from "alepha/server";

import { invitationConfigAtom } from "../atoms/invitationConfigAtom.ts";
import { type InvitationEntity, invitations } from "../entities/invitations.ts";
import type {
  InvitationDescription,
  InvitationPrincipal,
} from "../primitives/$invitationResource.ts";
import { InvitationResourceProvider } from "../providers/InvitationResourceProvider.ts";
import type { CreateInvitation } from "../schemas/createInvitationSchema.ts";
import type { InvitationQuery } from "../schemas/invitationQuerySchema.ts";
import { InvitationTokenService } from "./InvitationTokenService.ts";

declare module "alepha" {
  interface Hooks {
    "invitation:created": {
      invitation: InvitationEntity;
      inviter: { id: string; email?: string };
      /**
       * The one-time secret that lets this address register into a closed
       * realm, minted with the row and never recoverable afterwards.
       *
       * It is on the event because the mail is the application's: only the
       * application knows its own register URL, and only this moment holds
       * the secret. Put it in a link; do not log it.
       */
      token: string;
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

/**
 * The invitation lifecycle, for any kind of resource.
 *
 * What is generic lives here: the status machine, the expiry, the caps, the
 * email binding, the events, the sweeps. What is not is asked of the
 * `$invitationResource` registered for the row's `resourceType`.
 */
export class InvitationService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly repo = $repository(invitations);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly resources = $inject(InvitationResourceProvider);
  protected readonly tokens = $inject(InvitationTokenService);

  public async getById(id: string): Promise<InvitationEntity> {
    return this.repo.getById(id);
  }

  public async create(
    data: CreateInvitation,
    inviter: UserAccountToken,
  ): Promise<InvitationEntity> {
    const email = data.email.trim().toLowerCase();

    if (email === inviter.email?.toLowerCase()) {
      throw new BadRequestError("Cannot invite yourself");
    }

    const resource = this.resources.get(data.resourceType);

    // The authorization gate. First, so nothing below it leaks whether a
    // resource exists or who is already on it to someone with no business
    // inviting anyone to it.
    await resource.options.assertCanInvite(data.resourceId, inviter);

    // Asked by address, not by user id: the invitee may have no account yet,
    // and resolving one is the application's job precisely because only it
    // knows what being a principal means.
    const alreadyPrincipal = await resource.options.isPrincipal(
      data.resourceId,
      { email },
    );
    if (alreadyPrincipal) {
      throw new BadRequestError("User is already a member of this resource");
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

    await resource.options.assertRoom?.(data.resourceId);

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

    // Minted for every invitation, including one addressed to somebody who
    // already has an account: this module has no users table and cannot know
    // which case it is in. A token nobody needs costs one row and is simply
    // never redeemed.
    const token = await this.tokens.mint(entity);

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
      token,
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
   * insensitive), each described by the resolver for its own type.
   */
  public async listForUser(user: {
    id: string;
    email?: string;
  }): Promise<InvitationInboxItem[]> {
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
    // Grouped by `resourceType` and described one GROUP at a time, never one
    // row at a time. Lore's inbox was two sequential queries per invitation
    // until it was collapsed to two queries total, and a per-row seam would
    // have handed that N+1 straight back the moment the code moved here.
    const byType = new Map<string, number[]>();
    rows.forEach((invitation, index) => {
      const bucket = byType.get(invitation.resourceType);
      if (bucket) {
        bucket.push(index);
      } else {
        byType.set(invitation.resourceType, [index]);
      }
    });

    const described: Array<InvitationDescription | undefined> = new Array(
      rows.length,
    );

    await Promise.all(
      [...byType.entries()].map(async ([resourceType, indexes]) => {
        // `find`, not `get`: a row whose type the application has since
        // stopped registering must still be listed, so its owner can decline
        // it. Failing the whole inbox over one such row would be worse.
        const resource = this.resources.find(resourceType);
        if (!resource?.options.describe) {
          return;
        }
        const answers = await resource.options.describe(
          indexes.map((index) => rows[index]),
        );
        indexes.forEach((index, position) => {
          described[index] = answers[position];
        });
      }),
    );

    return rows.map((invitation, index) => ({
      ...invitation,
      resourceTitle: described[index]?.resourceTitle,
      inviterName: described[index]?.inviterName,
    }));
  }

  /**
   * Accept an invitation by id. The session's email must match the
   * invitation's email (case-insensitive) — that's the proof.
   */
  public async accept(
    invitationId: string,
    acceptedBy: { id: string; email?: string },
  ): Promise<{ resourceType: string; resourceId: string }> {
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

    const resource = this.resources.get(invitation.resourceType);
    const principal: InvitationPrincipal = {
      email: invitation.email,
      userId: acceptedBy.id,
    };

    const alreadyPrincipal = await resource.options.isPrincipal(
      invitation.resourceId,
      principal,
    );
    if (!alreadyPrincipal) {
      // Checked again here, not only at invite time: pending invitations
      // are capped separately and independently, so a resource one seat
      // short of the limit can still hold several of them, and whichever
      // arrives second must be the one refused.
      await resource.options.assertRoom?.(invitation.resourceId);
      await resource.options.grant(acceptedBy.id, invitation);
    }

    await this.repo.updateById(invitation.id, {
      status: "accepted",
      resolvedAt: now.toISOString(),
      resolvedBy: acceptedBy.id,
    });

    this.log.info("Invitation accepted", {
      id: invitation.id,
      resourceType: invitation.resourceType,
      resourceId: invitation.resourceId,
      acceptedBy: acceptedBy.id,
    });

    await this.alepha.events.emit("invitation:accepted", {
      invitation,
      acceptedBy,
    });

    return {
      resourceType: invitation.resourceType,
      resourceId: invitation.resourceId,
    };
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

  protected assertOwnedByEmail(
    invitation: InvitationEntity,
    user: { email?: string },
  ): void {
    if (!user.email || user.email.toLowerCase() !== invitation.email) {
      throw new ForbiddenError("This invitation is not addressed to you");
    }
  }
}

/**
 * A pending invitation as its recipient sees it: the row, plus whatever the
 * resolver for its type could say about it. Both descriptive fields are
 * optional because a row whose resolver is gone must still be listable.
 */
export type InvitationInboxItem = InvitationEntity & {
  resourceTitle?: string;
  inviterName?: string;
};
