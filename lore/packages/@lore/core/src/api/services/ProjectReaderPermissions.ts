import { $inject } from "alepha";
import { organizationMembers, RankService } from "alepha/api/organizations";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";

import { LoreRankBounds } from "../security/LoreRankBounds.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

/**
 * What a reader's rank holds in each of several projects, in two reads
 * (#Q3794): their membership rows, and those projects' rank definitions.
 *
 * For the surfaces that answer about many projects at once, or about many
 * kinds of row behind one gate: the dashboards, Home, the activity feed.
 * A route that names one project and one permission keeps `$ownsProject`.
 *
 * Membership is not trust: a rank grants what it grants, so these surfaces
 * ask what the rank reads, per project.
 *
 * The answer is the rank's stored set with the floor, as
 * `RankService.permissionsOf` gives it. A project the reader is not a member
 * of, or a rank key with no definition, holds nothing. An identity built
 * unrestricted (the system user) holds `*`; an instance admin does not.
 */
export class ProjectReaderPermissions {
  protected readonly ranks = $inject(RankService);
  protected readonly members = $repository(organizationMembers);
  protected readonly projectSecurity = $inject(ProjectSecurityService);

  public async of(
    user: Pick<UserAccountToken, "id" | "ownership">,
    projects: ReadonlyArray<{ id: number; organizationId?: string | null }>,
  ): Promise<Map<number, string[]>> {
    const held = new Map<number, string[]>();
    // Only an identity built unrestricted; an instance admin reads what
    // their rank holds, and nothing where they are not a member (#Q4538).
    if (this.projectSecurity.bypassesMembership(user)) {
      for (const project of projects) held.set(project.id, ["*"]);
      return held;
    }

    const organizationIds = [
      ...new Set(
        projects.flatMap((project) =>
          project.organizationId ? [project.organizationId] : [],
        ),
      ),
    ];
    // `inArray: []` throws rather than matching nothing.
    if (organizationIds.length === 0) {
      for (const project of projects) held.set(project.id, []);
      return held;
    }

    const [rows, ranks] = await Promise.all([
      this.members.findMany({
        where: {
          userId: { eq: user.id },
          organizationId: { inArray: organizationIds },
        },
        columns: ["organizationId", "rank"],
      }),
      this.ranks.ranksOfMany(organizationIds),
    ]);
    const rankOf = new Map(
      rows.map((row) => [row.organizationId, row.rank ?? "member"]),
    );

    for (const project of projects) {
      const key = project.organizationId
        ? rankOf.get(project.organizationId)
        : undefined;
      const rank = key
        ? ranks
            .get(project.organizationId!)
            ?.find((candidate) => candidate.key === key)
        : undefined;
      held.set(
        project.id,
        rank
          ? [...new Set([...rank.permissions, ...LoreRankBounds.FLOOR])]
          : [],
      );
    }
    return held;
  }

  /**
   * One project's set, for a route that already named it.
   */
  public async ofOne(
    user: Pick<UserAccountToken, "id" | "ownership">,
    project: { id: number; organizationId?: string | null },
  ): Promise<string[]> {
    return (await this.of(user, [project])).get(project.id) ?? [];
  }

  /**
   * Whether a set grants a permission, wildcards included.
   */
  public grants(permissions: readonly string[], permission: string): boolean {
    return this.ranks.grants(permissions, permission);
  }
}
