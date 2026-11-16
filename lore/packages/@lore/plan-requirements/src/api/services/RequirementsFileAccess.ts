import { FileAccessRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { useCaseRuns } from "../entities/useCaseRuns.ts";
import { RequirementsBuckets } from "./RequirementsBuckets.ts";

/**
 * Who may read a file of run evidence (#E153): whoever reads use cases in
 * the run's project.
 */
export class RequirementsFileAccess {
  protected readonly registry = $inject(FileAccessRegistry);
  protected readonly runs = $repository(useCaseRuns);

  constructor() {
    this.registry.register(
      RequirementsBuckets.EVIDENCE_BUCKET,
      async (fileId) => {
        const [row] = await this.runs.findMany({
          where: { evidence: { like: `%"${fileId}"%` } },
          columns: ["id", "projectId"],
          limit: 1,
        });
        return row
          ? { projectId: row.projectId, permission: "usecase:read" }
          : undefined;
      },
    );
  }
}
