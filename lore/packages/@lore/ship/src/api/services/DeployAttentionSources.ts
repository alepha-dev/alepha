import {
  DashboardAttentionRegistry,
  type DashboardAttentionItems,
} from "@lore/core/api";
import type { Project } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { projectErrors } from "../entities/projectErrors.ts";

/**
 * Deploy's contribution to "needs you" (#Q2656): open errors, most recently
 * seen first, under Apps with tracking on. A crash outranks a hold and is
 * outranked only by overdue work.
 */
export class DeployAttentionSources {
  protected readonly attention = $inject(DashboardAttentionRegistry);
  protected readonly projectErrors = $repository(projectErrors);

  constructor() {
    this.attention.register({
      key: "errors",
      needs: { capability: "ship", option: "track" },
      read: (project) => this.projectErrorsOf(project),
    });
  }

  protected async projectErrorsOf(
    project: Project,
  ): Promise<DashboardAttentionItems> {
    const where = { projectId: { eq: project.id }, status: { eq: "open" } };
    const [open, total] = await Promise.all([
      this.projectErrors.findMany({
        where,
        orderBy: [{ column: "lastSeenAt", direction: "desc" }],
        limit: 8,
      }),
      this.projectErrors.count(where),
    ]);
    const link = {
      route: "projectErrors",
      params: { projectSlug: project.slug ?? "" },
    };
    return {
      items: open.map((projectError) => ({
        weight: 35,
        row: {
          // A bare `Error` names nothing: the row read as a failed source
          // on the board (#Q3524), so the message speaks for it instead.
          title:
            projectError.name && projectError.name !== "Error"
              ? projectError.name
              : projectError.message || projectError.name,
          meta: String(projectError.count),
          badge: "error",
          state: "bad" as const,
          link,
        },
      })),
      total,
      link,
    };
  }
}
