import { $inject, Alepha, z } from "alepha";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ConflictError, ForbiddenError } from "alepha/server";

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
  protected readonly database = $inject(DatabaseProvider);
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

    await this.database.transactional(async () => {
      const updated = await this.swapRanks(
        organizationId,
        actor.id,
        toUserId,
        keptRank,
      );
      // Two rows or none: the statement's own guard refuses the swap when
      // the actor stopped owning or the target stopped being a member since
      // the reads above. On Postgres the throw also rolls back a partial
      // swap the row-level re-check could still let through.
      if (updated !== 2) {
        throw new ConflictError(
          "The organization's membership changed during the transfer; nothing was changed",
        );
      }
    });
    await this.alepha.events.emit("organization:ownership:transferred", {
      organizationId,
      fromUserId: actor.id,
      toUserId,
    });
  }

  /**
   * Swap the two ranks in one statement that carries its own preconditions,
   * and return how many rows it changed.
   *
   * Correct without a transaction, which is what D1 needs: the WHERE
   * re-checks both rows (the actor still owns, the target is still a
   * member), and a scalar subquery requires both to qualify, so on SQLite
   * and D1 the statement changes two rows or none. On Postgres READ
   * COMMITTED re-checks the row-level predicates on a row another
   * transaction just changed, and the caller's transaction rolls back a
   * count other than 2.
   */
  protected async swapRanks(
    organizationId: string,
    fromUserId: string,
    toUserId: string,
    keptRank: string,
  ): Promise<number> {
    const rows = await this.members.query(
      (t) => sql`
        UPDATE ${t}
        SET ${sql.identifier(t.rank.name)} = CASE
          WHEN ${t.userId} = ${toUserId} THEN ${MemberService.OWNER}
          ELSE ${keptRank}
        END
        WHERE ${t.organizationId} = ${organizationId}
          AND (
            (${t.userId} = ${fromUserId} AND ${t.rank} = ${MemberService.OWNER})
            OR ${t.userId} = ${toUserId}
          )
          AND (
            SELECT count(*) FROM ${t} AS qualifying
            WHERE qualifying.${sql.identifier(t.organizationId.name)} = ${organizationId}
              AND (
                (qualifying.${sql.identifier(t.userId.name)} = ${fromUserId}
                  AND qualifying.${sql.identifier(t.rank.name)} = ${MemberService.OWNER})
                OR qualifying.${sql.identifier(t.userId.name)} = ${toUserId}
              )
          ) = 2
        RETURNING ${t.userId}
      `,
      z.object({ userId: z.uuid() }),
    );
    return rows.length;
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
