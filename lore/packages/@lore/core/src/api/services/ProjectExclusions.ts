import { $inject } from "alepha";
import { organizationMembers } from "alepha/api/organizations";
import { $repository } from "alepha/orm";

import { projectExclusions } from "../entities/projectExclusions.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

/**
 * The durable record that someone an admin removed may not rejoin a project
 * by themselves (#Q3646).
 *
 * ## A removal racing a join
 *
 * D1 has no transaction, so a removal and a self-join can interleave: the
 * removal deletes the membership, the join (which read no exclusion yet)
 * writes a new one, and only then is the exclusion written. Both writers
 * converge instead: {@link exclude} deletes any membership it finds after
 * writing the record, and a join re-reads the record after writing its
 * membership and takes it back (`ProjectJoinController`). Whichever lands
 * last, the end state is excluded and not a member.
 */
export class ProjectExclusions {
  protected readonly exclusions = $repository(projectExclusions);
  protected readonly members = $repository(organizationMembers);
  protected readonly security = $inject(ProjectSecurityService);

  public async isExcluded(projectId: number, userId: string): Promise<boolean> {
    return (
      (await this.exclusions.count({
        projectId: { eq: projectId },
        userId: { eq: userId },
      })) > 0
    );
  }

  /**
   * Record the exclusion (idempotent), then remove any membership a racing
   * join wrote in between.
   */
  public async exclude(
    projectId: number,
    userId: string,
    excludedBy: string,
  ): Promise<void> {
    if (!(await this.isExcluded(projectId, userId))) {
      await this.exclusions
        .create({ projectId, userId, excludedBy })
        .catch(async (error: unknown) => {
          // A concurrent exclusion of the same person won the unique index.
          if (!(await this.isExcluded(projectId, userId))) throw error;
        });
    }
    const organizationId = await this.security.organizationIdOf(projectId);
    // Read, then delete by id: `rank` is NULL for a plain member, and
    // `rank <> 'owner'` is not true for NULL in SQL.
    const rows = await this.members.findMany({
      where: {
        organizationId: { eq: organizationId },
        userId: { eq: userId },
      },
    });
    for (const row of rows) {
      if (row.rank !== "owner") await this.members.deleteById(row.id);
    }
  }

  /**
   * Lift it. Answers whether there was one.
   */
  public async lift(projectId: number, userId: string): Promise<boolean> {
    const removed = await this.exclusions.deleteMany({
      projectId: { eq: projectId },
      userId: { eq: userId },
    });
    return removed.length > 0;
  }

  public async list(projectId: number) {
    return this.exclusions.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "createdAt", direction: "desc" }],
    });
  }
}
