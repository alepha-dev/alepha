import {
  DashboardAttentionRegistry,
  type DashboardAttentionItems,
} from "@lore/core/api";
import type { Project } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { blights } from "../entities/blights.ts";

/**
 * Deploy's contribution to "needs you" (#Q2656): open blights, most recently
 * seen first, under Apps with tracking on. A crash outranks a hold and is
 * outranked only by overdue work.
 */
export class DeployAttentionSources {
  protected readonly attention = $inject(DashboardAttentionRegistry);
  protected readonly blights = $repository(blights);

  constructor() {
    this.attention.register({
      key: "blights",
      needs: { capability: "apps", option: "track" },
      read: (project) => this.blightsOf(project),
    });
  }

  protected async blightsOf(
    project: Project,
  ): Promise<DashboardAttentionItems> {
    const where = { projectId: { eq: project.id }, status: { eq: "open" } };
    const [open, total] = await Promise.all([
      this.blights.findMany({
        where,
        orderBy: [{ column: "lastSeenAt", direction: "desc" }],
        limit: 8,
      }),
      this.blights.count(where),
    ]);
    const link = {
      route: "projectBlights",
      params: { projectSlug: project.slug ?? "" },
    };
    return {
      items: open.map((blight) => ({
        weight: 35,
        row: {
          title: blight.name || blight.message,
          meta: String(blight.count),
          badge: "blight",
          state: "bad" as const,
          link,
        },
      })),
      total,
      link,
    };
  }
}
