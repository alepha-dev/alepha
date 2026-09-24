import { $inject, Alepha, z } from "alepha";
import { $repository, sql } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ForbiddenError } from "alepha/server";

import {
  type OrganizationMember,
  organizationMembers,
} from "../entities/organizationMembers.ts";
import { organizationRelations } from "../relations/organizationRelations.ts";
import type { OrganizationMemberResource } from "../schemas/organizationMemberResourceSchema.ts";

export class MemberService {
  public static readonly OWNER = "owner";
  public static readonly MEMBER = "member";

  protected readonly alepha = $inject(Alepha);
  protected readonly members = $repository(organizationMembers);
  protected readonly membersWith = $repository(
    organizationRelations,
    "organizationMembers",
  );

  public list(organizationId: string): Promise<OrganizationMember[]> {
    return this.members.findMany({
      where: { organizationId: { eq: organizationId } },
      orderBy: { column: "createdAt", direction: "asc" },
    });
  }

  public async listResources(
    organizationId: string,
  ): Promise<OrganizationMemberResource[]> {
    const rows = await this.membersWith.findMany({
      where: { organizationId: { eq: organizationId } },
      include: { user: true },
      orderBy: { column: "createdAt", direction: "asc" },
    });

    const resources: OrganizationMemberResource[] = [];
    for (const row of rows) {
      if (row.user) {
        resources.push({ ...row, user: row.user });
      }
    }
    return resources.sort((a, b) => {
      if (a.rank === MemberService.OWNER) return -1;
      if (b.rank === MemberService.OWNER) return 1;
      return 0;
    });
  }

  public async addOwner(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember> {
    return this.members.create({
      organizationId,
      userId,
      rank: MemberService.OWNER,
    });
  }

  /**
   * Write a membership row, with no guard of its own.
   *
   * The caller is the guard: invitation acceptance, which checked the rank
   * when the invitation was sent and checks the member cap when it is
   * accepted. No route calls this directly (see `MemberController`).
   */
  public async add(
    organizationId: string,
    userId: string,
    rank: string | undefined,
    _actor: Pick<UserAccountToken, "id">,
  ): Promise<OrganizationMember> {
    if (rank === MemberService.OWNER) {
      throw new ForbiddenError("Ownership must be transferred");
    }
    return this.members.create({ organizationId, userId, rank });
  }

  public async remove(
    organizationId: string,
    userId: string,
    actor: Pick<UserAccountToken, "id">,
  ): Promise<void> {
    const member = await this.members.findOne({
      where: { organizationId: { eq: organizationId }, userId: { eq: userId } },
    });
    if (!member) return;
    if (member.rank === MemberService.OWNER) {
      throw new ForbiddenError("The organization owner cannot be removed");
    }
    await this.members.deleteById(member.id);
    await this.alepha.events.emit("organization:member:removed", {
      organizationId,
      userId,
      actor,
      leave: false,
    });
  }

  public async leave(
    organizationId: string,
    actor: Pick<UserAccountToken, "id">,
  ): Promise<void> {
    const member = await this.members.findOne({
      where: {
        organizationId: { eq: organizationId },
        userId: { eq: actor.id },
      },
    });
    if (!member) return;
    if (member.rank === MemberService.OWNER) {
      throw new ForbiddenError(
        "The organization owner cannot leave. Transfer ownership first",
      );
    }
    await this.members.deleteById(member.id);
    await this.alepha.events.emit("organization:member:removed", {
      organizationId,
      userId: actor.id,
      actor,
      leave: true,
    });
  }

  public async transfer(
    organizationId: string,
    toUserId: string,
    outgoingRank: string | undefined,
    actor: Pick<UserAccountToken, "id">,
  ): Promise<void> {
    if (actor.id === toUserId) {
      throw new BadRequestError("You already own this organization");
    }
    const [mine, theirs] = await Promise.all([
      this.members.findOne({
        where: {
          organizationId: { eq: organizationId },
          userId: { eq: actor.id },
        },
      }),
      this.members.findOne({
        where: {
          organizationId: { eq: organizationId },
          userId: { eq: toUserId },
        },
      }),
    ]);
    if (mine?.rank !== MemberService.OWNER) {
      throw new ForbiddenError(
        "Only the organization owner can transfer ownership",
      );
    }
    if (!theirs) {
      throw new BadRequestError("The new owner must be an organization member");
    }
    const keptRank = outgoingRank ?? MemberService.MEMBER;
    if (keptRank === MemberService.OWNER) {
      throw new BadRequestError("An organization has exactly one owner");
    }

    const updated = await this.members.query(
      (t) => sql`
        UPDATE ${t}
        SET ${sql.identifier(t.rank.name)} = CASE
          WHEN ${t.userId} = ${toUserId} THEN ${MemberService.OWNER}
          ELSE ${keptRank}
        END
        WHERE ${t.organizationId} = ${organizationId}
          AND ${t.userId} IN (${toUserId}, ${actor.id})
        RETURNING ${t.userId}
      `,
      z.object({ userId: z.uuid() }),
    );
    if (updated.length !== 2) {
      throw new BadRequestError(
        "Ownership transfer did not update both members",
      );
    }
    await this.alepha.events.emit("organization:ownership:transferred", {
      organizationId,
      fromUserId: actor.id,
      toUserId,
    });
  }

  public async ownedBy(userId: string): Promise<string[]> {
    const rows = await this.members.findMany({
      where: { userId: { eq: userId }, rank: { eq: MemberService.OWNER } },
    });
    return rows.map((row) => row.organizationId);
  }

  protected async member(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember> {
    return this.members.getOne({
      where: { organizationId: { eq: organizationId }, userId: { eq: userId } },
    });
  }
}
