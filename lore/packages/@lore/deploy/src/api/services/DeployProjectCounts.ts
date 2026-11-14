import { ProjectCountRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository, sql } from "alepha/orm";

import { projectErrors } from "../entities/projectErrors.ts";

/**
 * Deploy's per-project counts, registered on core's `ProjectCountRegistry`
 * (#E75, #Q2623): open errors for the Home cards, what the Errors badge
 * counts.
 */
export class DeployProjectCounts {
  protected readonly counts = $inject(ProjectCountRegistry);
  protected readonly projectErrorRows = $repository(projectErrors);

  constructor() {
    const b = this.projectErrorRows.table;
    // Errors carry no soft delete.
    this.counts.register({
      key: "openErrors",
      select: () => sql`
        SELECT ${b.projectId} AS project_id, COUNT(*) AS n
        FROM ${b}
        WHERE ${b.projectId} IN (SELECT id FROM ids)
          AND ${b.status} = 'open'
        GROUP BY ${b.projectId}
      `,
    });
  }
}
