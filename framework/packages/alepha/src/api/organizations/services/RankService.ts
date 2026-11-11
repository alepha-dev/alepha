import { $inject, Alepha } from "alepha";
import { $repository } from "alepha/orm";
import {
  ResourceGateMemoProvider,
  SecurityProvider,
  type UserAccountToken,
} from "alepha/security";
import { BadRequestError, ForbiddenError, NotFoundError } from "alepha/server";

import { currentOrganizationRankAtom } from "../atoms/currentOrganizationRankAtom.ts";
import { organizationConfigAtom } from "../atoms/organizationConfigAtom.ts";
import { organizationMembers } from "../entities/organizationMembers.ts";
import { organizationRanks } from "../entities/organizationRanks.ts";
import { OrganizationPolicyProvider } from "../providers/OrganizationPolicyProvider.ts";

export class RankService {
  public static readonly DEFINITIONS_CACHE_TTL_MS = 30_000;

  protected readonly alepha = $inject(Alepha);
  protected readonly security = $inject(SecurityProvider);
  protected readonly memo = $inject(ResourceGateMemoProvider);
  protected readonly policy = $inject(OrganizationPolicyProvider);
  protected readonly definitions = $repository(organizationRanks);
  protected readonly members = $repository(organizationMembers);

  public async ranksOf(organizationId: string): Promise<Rank[]> {
    return this.ranksFromRows(await this.definitionsOf(organizationId));
  }

  public async ranksOfMany(
    organizationIds: string[],
  ): Promise<Map<string, Rank[]>> {
    const result = new Map<string, Rank[]>();
    if (organizationIds.length === 0) return result;
    const rows = await this.definitions.findMany(
      { where: { organizationId: { inArray: organizationIds } } },
      { cache: { ttl: RankService.DEFINITIONS_CACHE_TTL_MS } },
    );
    for (const organizationId of organizationIds) {
      result.set(
        organizationId,
        this.ranksFromRows(
          rows.filter((row) => row.organizationId === organizationId),
        ),
      );
    }
    return result;
  }

  protected ranksFromRows(
    rows: Array<{
      key: string;
      name: string;
      permissions: string[];
      builtin: boolean;
    }>,
  ): Rank[] {
    const config = this.alepha.store.get(organizationConfigAtom);
    const byKey = new Map<string, Rank>([
      [
        "owner",
        {
          key: "owner",
          name: "Owner",
          permissions: ["*"],
          builtin: true,
          editable: false,
        },
      ],
      [
        "member",
        {
          key: "member",
          name: "Member",
          permissions: config.memberPermissions,
          builtin: true,
          editable: true,
        },
      ],
    ]);

    for (const row of rows) {
      const declared = byKey.get(row.key);
      byKey.set(row.key, {
        key: row.key,
        name: row.name,
        permissions: row.permissions,
        builtin: row.builtin || declared?.builtin === true,
        editable: declared ? declared.editable : !row.builtin,
      });
    }
    return [...byKey.values()];
  }

  public async permissionsOf(
    organizationId: string,
    key: string,
  ): Promise<string[] | undefined> {
    const rank = (await this.ranksOf(organizationId)).find(
      (item) => item.key === key,
    );
    return rank ? this.withFloor(rank.permissions) : undefined;
  }

  public async resolve(rows: RankRows): Promise<ResolvedRank | undefined> {
    const organizationId = rows.membership?.organizationId;
    if (typeof organizationId !== "string") return undefined;
    const key =
      typeof rows.membership?.rank === "string"
        ? rows.membership.rank
        : "member";
    const rank = (await this.ranksOf(organizationId)).find(
      (item) => item.key === key,
    );
    const resolved: ResolvedRank = {
      organizationId,
      ...(rank ? { key: rank.key, name: rank.name } : {}),
      permissions: rank ? this.withFloor(rank.permissions) : [],
    };
    this.alepha.store.set(currentOrganizationRankAtom, resolved);
    return resolved;
  }

  public grants(permissions: readonly string[], permission: string): boolean {
    return permissions.some(
      (granted) =>
        granted === "*" ||
        granted === permission ||
        (granted.endsWith("*") && permission.startsWith(granted.slice(0, -1))),
    );
  }

  public async can(
    organizationId: string,
    permission: string,
    user: UserAccountToken,
  ): Promise<boolean> {
    if (user.ownership === false) return true;
    const current = this.alepha.store.get(currentOrganizationRankAtom);
    if (current?.organizationId === organizationId) {
      return this.grants(current.permissions, permission);
    }
    const membership = await this.membership(organizationId, user.id);
    if (!membership) return false;
    const permissions =
      (await this.permissionsOf(organizationId, membership.rank ?? "member")) ??
      [];
    return this.grants(permissions, permission);
  }

  /**
   * List the user ids of the members whose rank grants a permission in an
   * organization: the people to tell when something only they can fix goes
   * wrong.
   *
   * The owner is always among them, since the built-in owner rank grants
   * `*`. A member with no rank holds the default member rank; a member whose
   * rank key has no definition holds nothing and is left out, as `can`
   * answers for them. It reads the organization's members once and its rank
   * definitions once (cached), never once per member.
   *
   * The answer is the rank's alone: an application that also narrows a
   * permission by a feature switch applies that on top.
   */
  public async holdersOf(
    organizationId: string,
    permission: string,
  ): Promise<string[]> {
    const [rows, ranks]: [
      Array<{ userId: string; rank?: string | null }>,
      Rank[],
    ] = await Promise.all([
      this.loadMembers(organizationId),
      this.ranksOf(organizationId),
    ]);
    const granting = new Set(
      ranks
        .filter((rank) =>
          this.grants(this.withFloor(rank.permissions), permission),
        )
        .map((rank) => rank.key),
    );
    return rows
      .filter((row) => granting.has(row.rank ?? "member"))
      .map((row) => row.userId);
  }

  public async assert(
    organizationId: string,
    permission: string,
    user: UserAccountToken,
  ): Promise<void> {
    if (await this.can(organizationId, permission, user)) return;
    const membership = await this.membership(organizationId, user.id);
    const key = membership?.rank ?? "member";
    const rank = membership
      ? (await this.ranksOf(organizationId)).find((item) => item.key === key)
      : undefined;
    const rows: RankRows = { membership: membership ?? undefined, user };
    throw new ForbiddenError(
      await this.refusal(
        {
          organizationId,
          rank: membership
            ? {
                key,
                name: rank?.name ?? key,
              }
            : undefined,
          missing: [permission],
          user,
        },
        rows,
      ),
    );
  }

  public async save(
    organizationId: string,
    input: { key: string; name: string; permissions: string[] },
    writer: UserAccountToken,
  ): Promise<Rank> {
    await this.assertGrantable(organizationId, input.permissions, writer);
    if (input.key === "owner") {
      throw new BadRequestError(
        '"Owner" is a built-in rank and cannot be edited',
      );
    }
    await this.assertNoSelfLockout(organizationId, input, writer);
    // Rewriting a rank acts on everyone who holds it, so the rank as it
    // stands must be inside the writer's set too: otherwise a `rank:manage`
    // holder could cut down a rank above their own and demote its holders.
    const current = (await this.ranksOf(organizationId)).find(
      (item) => item.key === input.key,
    );
    if (current) {
      await this.assertWithinWriterSet(
        organizationId,
        current.permissions,
        writer,
        `"${current.name}" holds permissions you do not`,
      );
    }
    const existing = await this.definitionOf(organizationId, input.key);
    if (existing?.builtin && input.key !== "member") {
      throw new BadRequestError(`"${existing.name}" cannot be edited`);
    }
    if (existing) {
      await this.definitions.updateById(existing.id, {
        name: input.name,
        permissions: input.permissions,
      });
    } else {
      await this.definitions.create({
        organizationId,
        key: input.key,
        name: input.name,
        permissions: input.permissions,
      });
    }
    return {
      ...input,
      builtin: input.key === "member",
      editable: true,
    };
  }

  public async delete(
    organizationId: string,
    key: string,
    writer: UserAccountToken,
  ): Promise<void> {
    if (key === "owner" || key === "member") {
      throw new BadRequestError("A built-in rank cannot be deleted");
    }
    const existing = await this.definitionOf(organizationId, key);
    if (!existing)
      throw new NotFoundError(`No rank "${key}" in this organization`);
    if (existing.builtin) {
      throw new BadRequestError(`"${existing.name}" cannot be deleted`);
    }
    await this.assertWithinWriterSet(
      organizationId,
      existing.permissions,
      writer,
      `"${existing.name}" holds permissions you do not`,
    );
    const holders = await this.members.count({
      organizationId: { eq: organizationId },
      rank: { eq: key },
    });
    if (holders > 0) {
      throw new BadRequestError(
        `${holders} member(s) still hold "${existing.name}". Move them to another rank first`,
      );
    }
    await this.definitions.deleteById(existing.id);
  }

  public async assign(
    organizationId: string,
    userId: string,
    key: string,
    writer: UserAccountToken,
  ): Promise<void> {
    if (key === "owner") {
      throw new BadRequestError("Ownership is transferred, not assigned");
    }
    if (userId === writer.id) {
      throw new BadRequestError("You cannot change your own rank");
    }
    const member = await this.members.getOne({
      where: { organizationId: { eq: organizationId }, userId: { eq: userId } },
    });
    if (member.rank === "owner") {
      throw new BadRequestError("Ownership is transferred, not assigned");
    }
    await this.assertOutranks(organizationId, userId, writer);
    await this.assertAssignable(organizationId, key, writer);
    // `null`, not `undefined`: an update skips an undefined field, so the
    // member would silently keep their old rank instead of going back to
    // the default one.
    await this.members.updateById(member.id, {
      rank: key === "member" ? null : key,
    });
  }

  /**
   * Refuse an act on a member whose rank holds a permission the actor does
   * not: moving them to another rank, or removing them.
   *
   * The ceiling on the TARGET rank alone let a `member:manage` holder demote
   * or remove somebody ranked above them, as long as where they were sent
   * was low enough. The owner is never inside anybody's set, and a member
   * with no row is nobody to protect.
   */
  public async assertOutranks(
    organizationId: string,
    userId: string,
    actor: RankWriter,
  ): Promise<void> {
    if (actor.ownership === false) return;
    const target = await this.loadMembership(organizationId, userId);
    if (!target) return;
    const key = target.rank ?? "member";
    if (key === "owner") {
      throw new ForbiddenError("The owner cannot be moved or removed");
    }
    const rank = (await this.ranksOf(organizationId)).find(
      (item) => item.key === key,
    );
    await this.assertWithinWriterSet(
      organizationId,
      rank?.permissions ?? [],
      actor,
      `This member's rank (${rank?.name ?? key}) holds permissions you do not`,
    );
  }

  public async assertAssignable(
    organizationId: string,
    key: string,
    writer: UserAccountToken,
  ): Promise<Rank> {
    if (key === "owner") {
      throw new BadRequestError("Ownership is transferred, not invited");
    }
    const rank = (await this.ranksOf(organizationId)).find(
      (item) => item.key === key,
    );
    if (!rank) throw new NotFoundError(`No rank "${key}" in this organization`);
    await this.assertWithinWriterSet(organizationId, rank.permissions, writer);
    return rank;
  }

  public async refusal(refusal: RankRefusal, rows: RankRows): Promise<string> {
    const written = await this.policy.refuse(refusal, rows);
    if (written) return written;
    const held = refusal.rank
      ? `Your rank (${refusal.rank.name})`
      : "Your rank";
    return `${held} does not grant ${refusal.missing.join(", ")}. Ask somebody who holds rank:manage.`;
  }

  protected async assertGrantable(
    organizationId: string,
    permissions: string[],
    writer: UserAccountToken,
  ): Promise<void> {
    const config = this.alepha.store.get(organizationConfigAtom);
    const registered = new Set(
      this.security
        .getPermissions()
        .map((permission) =>
          permission.group
            ? `${permission.group}:${permission.name}`
            : permission.name,
        ),
    );
    for (const permission of permissions) {
      if (permission === "*" || permission.startsWith("admin:")) {
        throw new BadRequestError(
          `"${permission}" cannot be granted by a rank`,
        );
      }
      if (!registered.has(permission)) {
        throw new BadRequestError(
          `"${permission}" is not a permission this application declares`,
        );
      }
      if (config.ownerOnly.includes(permission)) {
        throw new BadRequestError(
          `"${permission}" belongs to the owner and cannot be granted to a rank`,
        );
      }
    }
    for (const floor of config.floor) {
      if (!permissions.includes(floor)) {
        throw new BadRequestError(
          `Every rank holds "${floor}"; it cannot be withheld`,
        );
      }
    }
    await this.assertWithinWriterSet(organizationId, permissions, writer);
  }

  protected async assertWithinWriterSet(
    organizationId: string,
    permissions: string[],
    writer: RankWriter,
    reason = "You cannot grant a permission you do not hold",
  ): Promise<void> {
    if (writer.ownership === false) return;
    const membership = await this.membership(organizationId, writer.id);
    const held = membership
      ? ((await this.permissionsOf(
          organizationId,
          membership.rank ?? "member",
        )) ?? [])
      : [];
    const beyond = permissions.filter(
      (permission) => !this.grants(held, permission),
    );
    if (beyond.length) {
      throw new BadRequestError(`${reason}: ${beyond.join(", ")}`);
    }
  }

  protected async assertNoSelfLockout(
    organizationId: string,
    input: { key: string; permissions: string[] },
    writer: UserAccountToken,
  ): Promise<void> {
    if (writer.ownership === false) return;
    const membership = await this.membership(organizationId, writer.id);
    const ownKey = membership?.rank ?? "member";
    if (
      membership &&
      ownKey === input.key &&
      !this.grants(input.permissions, "rank:manage")
    ) {
      throw new BadRequestError(
        'Removing "rank:manage" from your own rank would leave nobody able to edit ranks here',
      );
    }
  }

  protected membership(organizationId: string, userId: string) {
    return this.memo.resolve(
      ResourceGateMemoProvider.membershipKey({
        table: "organization_members",
        resourceColumn: "organizationId",
        resourceId: organizationId,
        userColumn: "userId",
        userId,
      }),
      () => this.loadMembership(organizationId, userId),
    );
  }

  protected loadMembership(organizationId: string, userId: string) {
    return this.members.findOne({
      where: {
        organizationId: { eq: organizationId },
        userId: { eq: userId },
      },
    });
  }

  protected loadMembers(organizationId: string) {
    return this.members.findMany({
      where: { organizationId: { eq: organizationId } },
      columns: ["userId", "rank"],
    });
  }

  protected definitionsOf(organizationId: string) {
    return this.memo.resolve(`organization-ranks:${organizationId}`, () =>
      this.loadDefinitions(organizationId),
    );
  }

  protected loadDefinitions(organizationId: string) {
    return this.definitions.findMany(
      { where: { organizationId: { eq: organizationId } } },
      { cache: { ttl: RankService.DEFINITIONS_CACHE_TTL_MS } },
    );
  }

  protected definitionOf(organizationId: string, key: string) {
    return this.definitions.findOne({
      where: { organizationId: { eq: organizationId }, key: { eq: key } },
    });
  }

  protected withFloor(permissions: string[]): string[] {
    const merged = new Set(permissions);
    for (const permission of this.alepha.store.get(organizationConfigAtom)
      .floor) {
      merged.add(permission);
    }
    return [...merged];
  }
}

/**
 * Who is acting on a rank or a member: an id, and `ownership: false` for the
 * privileged identity that bypasses ranks.
 */
export type RankWriter = Pick<UserAccountToken, "id" | "ownership">;

export interface Rank {
  key: string;
  name: string;
  permissions: string[];
  builtin: boolean;
  editable: boolean;
}

export interface RankRows {
  authority?: Record<string, unknown>;
  membership?: Record<string, unknown>;
  user: UserAccountToken;
}

export interface RankRefusal {
  organizationId: string;
  rank?: { key: string; name: string };
  missing: string[];
  user: UserAccountToken;
}

export interface ResolvedRank {
  organizationId: string;
  key?: string;
  name?: string;
  permissions: string[];
}
