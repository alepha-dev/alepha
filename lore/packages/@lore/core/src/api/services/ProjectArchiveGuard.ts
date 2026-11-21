import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $tool } from "alepha/mcp";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { ForbiddenError } from "alepha/server";

import { type Project, projects } from "../entities/projects.ts";
import { LoreAudits } from "./LoreAudits.ts";
import { UserDockService } from "./UserDockService.ts";

/**
 * An archived project is read-only (#Q4051): every write is refused on the
 * server, whatever asks, while every read still answers.
 *
 * - **HTTP and the CLI** go through `$ownsProject`, which asks
 *   {@link ProjectArchiveGuard.refusesWrite} with the action's method and
 *   required permissions. Archiving, unarchiving and deleting opt out, so
 *   the project can be brought back or ended.
 * - **MCP**: a tool that is not `readOnlyHint` marks its call as a write
 *   (`mcp:tool:call:begin`), and `ProjectTools.resolveProjectId` refuses an
 *   archived project for it. That also covers the tools that call services
 *   rather than actions.
 */
export class ProjectArchiveGuard {
  static readonly WRITE_KEY = "lore.mcp.write";

  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly audits = $inject(LoreAudits);
  protected readonly dock = $inject(UserDockService);
  protected readonly projects = $repository(projects);

  /**
   * Archive or unarchive a project (#Q2601), for its owner and, since
   * #Q4051, for an instance admin. Idempotent: archiving an archived project
   * keeps its first date, so "Archived since" never moves under a double
   * click. Archiving frees the slot on every member's dock (#E139, #Q3436);
   * unarchiving pins nothing back.
   */
  public async setArchived(
    project: Project,
    archived: boolean,
    user: UserAccountToken,
  ): Promise<Project> {
    if (archived === Boolean(project.archivedAt)) return project;
    project.archivedAt = archived ? this.dateTime.nowISOString() : undefined;
    await this.projects.save(project);
    if (archived && project.organizationId) {
      await this.dock.unpinForMembers(project.organizationId, project.id);
    }
    await this.audits.project.logSuccess(archived ? "archive" : "unarchive", {
      ...this.audits.actor(user),
      ...this.audits.scope(project.id),
      resourceType: "project",
      resourceId: String(project.id),
      description: project.title,
    });
    return project;
  }

  /**
   * Marks the MCP call as a write when its tool does not say it only reads.
   */
  protected readonly onToolCall = $hook({
    on: "mcp:tool:call:begin",
    handler: ({ name }) => {
      const tool = this.alepha.primitives($tool).find((it) => it.name === name);
      const readOnly = tool?.options.annotations?.readOnlyHint === true;
      this.alepha.context.set<boolean>(
        ProjectArchiveGuard.WRITE_KEY,
        !readOnly,
      );
    },
  });

  /**
   * Whether the running MCP call is a write.
   */
  public mcpWrite(): boolean {
    return (
      this.alepha.context.get<boolean>(ProjectArchiveGuard.WRITE_KEY) === true
    );
  }

  /**
   * Whether a call is a write an archived project refuses: any method but a
   * read's, unless every permission it requires is a `:read`.
   */
  public refusesWrite(
    method: string | undefined,
    requires: string | string[] | undefined,
  ): boolean {
    if (!method || method === "GET" || method === "HEAD") return false;
    const needed = requires === undefined ? [] : [requires].flat();
    return !(needed.length > 0 && needed.every((it) => it.endsWith(":read")));
  }

  public assertWritable(project: { archivedAt?: string | null }): void {
    if (project.archivedAt) {
      throw new ForbiddenError(
        "This project is archived and read-only: unarchive it to change it",
      );
    }
  }
}
