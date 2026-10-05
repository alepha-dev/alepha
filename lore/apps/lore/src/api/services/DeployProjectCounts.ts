import { $inject } from "alepha";
import { $repository, sql } from "alepha/orm";

import { blights } from "../entities/blights.ts";
import { ProjectCountRegistry } from "./ProjectCountRegistry.ts";

/**
 * Deploy's per-project counts, registered on core's `ProjectCountRegistry`
 * (#E75, #Q2623): open blights for the Home cards, what the Blights badge
 * counts.
 */
export class DeployProjectCounts {
  protected readonly counts = $inject(ProjectCountRegistry);
  protected readonly blightRows = $repository(blights);

  constructor() {
    const b = this.blightRows.table;
    // Blights carry no soft delete.
    this.counts.register({
      key: "openBlights",
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
