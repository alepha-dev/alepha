import { $repository } from "alepha/orm";

import { displayName } from "../../web/app/services/displayName.ts";
import { relations } from "../relations.ts";

/**
 * One member of a project, in the shape everything that writes to people
 * needs: who they are, where to reach them, and what to call them.
 *
 * `name` is built with `displayName`, the same function the comment box
 * uses, because it is what `@handle` is compared against. A roster
 * assembled any other way disagrees with the renderer about what `@nfo` is.
 */
export interface ProjectRosterEntry {
  userId: string;
  email: string;
  name: string;
}

/**
 * Who is in a project, as one read.
 *
 * Its own service because two events need the same list and the same
 * exclusions - a mention matches against it, a release fans out over it -
 * and "which members can actually be written to" is one question, not two.
 */
export class ProjectRoster {
  protected readonly membersWith = $repository(relations, "members");

  /**
   * Every member of the project whose account still exists.
   *
   * One query, selecting what both halves need: the id to compare against an
   * author or a publisher, the address to push to, and enough to build the
   * handle.
   */
  public async of(projectId: number): Promise<ProjectRosterEntry[]> {
    const rows = await this.membersWith.findMany({
      where: { projectId: { eq: projectId } },
      include: { user: true },
    });

    const roster: ProjectRosterEntry[] = [];
    for (const row of rows) {
      // A membership whose account is gone. The row survives the user by
      // design, and there is nobody to write to.
      if (!row.user) continue;
      roster.push({
        userId: row.user.id,
        email: row.user.email ?? "",
        name: displayName(row.user, ""),
      });
    }
    return roster;
  }

  /**
   * The same list without one person and without anybody unreachable.
   *
   * The exclusion is always the actor: an author does not mention themselves
   * and a publisher does not need telling what they just pressed.
   */
  public async others(
    projectId: number,
    exceptUserId: string,
  ): Promise<ProjectRosterEntry[]> {
    const roster = await this.of(projectId);
    return roster.filter((it) => it.userId !== exceptUserId && it.email);
  }
}
