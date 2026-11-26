import {
  JobKeyService,
  McpProjectScope,
  ProjectSecurityService,
  ResourceRegistry,
} from "@lore/core/api";
import { $inject } from "alepha";
import { RankService } from "alepha/api/organizations";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { ForbiddenError, NotFoundError } from "alepha/server";

import { type ProjectError, projectErrors } from "../entities/projectErrors.ts";

/**
 * How an error is reached, by every action that names one (#E185): the row
 * in its project, and the rule that keeps an agent off an untrusted one.
 * One place, so the inbox, the single read, the trend and the thread cannot
 * drift apart.
 */
export class ProjectErrorAccess {
  protected readonly projectErrors = $repository(projectErrors);
  protected readonly jobKeys = $inject(JobKeyService);
  protected readonly scope = $inject(McpProjectScope);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly ranks = $inject(RankService);

  /**
   * Load an error by id, asserting it belongs to the expected project.
   * Returns 404 otherwise — never leaks cross-project rows.
   *
   * The project scope is a column rather than a join: an error carries its own
   * `projectId`, so cross-project leakage is one WHERE clause instead of a
   * two-step lookup that could be got wrong — and it still answers for an error
   * whose sigil has since been deleted.
   */
  public async load(projectId: number, errorId: number): Promise<ProjectError> {
    const projectError = await this.projectErrors.findOne({
      where: { id: { eq: errorId }, projectId: { eq: projectId } },
    });
    if (!projectError) {
      throw new NotFoundError("Error not found");
    }
    return projectError;
  }

  /**
   * Whether a model is reading (#Q4233, #Q4235): an agent job's key, or a
   * run pinned to one project, which is what a chat agent answering in a
   * room runs under (`McpProjectScope.pinned`). A member's own MCP client
   * is neither, and reads the inbox as the page does.
   */
  public async isAgent(user: UserAccountToken | undefined): Promise<boolean> {
    if (this.scope.pinnedProject() !== undefined) return true;
    return Boolean(await this.jobKeys.scopeOf(user));
  }

  /**
   * An agent acts on a trusted group only (#Q4233): its text comes from an
   * ingest open to anyone, so a member reads it first. A refusal, never a
   * redacted row.
   */
  public async assertAgentMayRead(
    row: ProjectError,
    user: UserAccountToken | undefined,
  ): Promise<void> {
    if (row.trustedAt) return;
    if (await this.isAgent(user)) {
      throw new ForbiddenError(
        `Error ${row.id} is not trusted yet: a member reads and trusts it before an agent acts on it`,
      );
    }
  }

  /**
   * Whether this caller is shown the quest an error points at: Plan is
   * registered and on for the project, and the caller's rank reads quests.
   * Ship never reads a quest itself (#E75): what it shows comes through the
   * `quest` kind of the resources registry, under that kind's permission.
   */
  public async questsReadable(
    project: { id: number; organizationId?: string | null },
    user: UserAccountToken,
  ): Promise<boolean> {
    const capabilities = await this.security.capabilitiesOf(project.id);
    if (!capabilities.plan) return false;
    return await this.kindReadable("quest", project, user);
  }

  /**
   * Whether this caller is shown a resource of another module that an error
   * points at (its quest, the use case of a run error): the kind is
   * registered, and the caller's rank holds the kind's own read permission.
   */
  public async kindReadable(
    kindName: string,
    project: { id: number; organizationId?: string | null },
    user: UserAccountToken,
  ): Promise<boolean> {
    const kind = this.resources.get(kindName);
    if (!kind?.describe || !project.organizationId) return false;
    return await this.ranks.can(project.organizationId, kind.permission, user);
  }
}
