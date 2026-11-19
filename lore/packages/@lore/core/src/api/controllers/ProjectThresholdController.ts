import { $inject, z } from "alepha";
import { $action, ForbiddenError } from "alepha/server";

import { projectThresholdsSchema } from "../schemas/projectThresholdsSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { ProjectRecipients } from "../services/ProjectRecipients.ts";
import { ProjectThresholds } from "../services/ProjectThresholds.ts";

/**
 * The coverage and open-errors thresholds (#Q3894), in core since #E162:
 * coverage is Build's, open errors Ship's. Reading needs a
 * membership; setting coverage needs `app:manage`, setting the errors one
 * `error:triage`.
 */
export class ProjectThresholdController {
  protected readonly thresholds = $inject(ProjectThresholds);
  protected readonly recipients = $inject(ProjectRecipients);
  protected readonly gate = $ownsProject({ param: "projectId" });

  getProjectThresholds = $action({
    use: [this.gate],
    method: "GET",
    path: "/projects/:projectId/thresholds",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: projectThresholdsSchema,
    },
    handler: async ({ params }) => {
      const row = await this.thresholds.get(params.projectId);
      return {
        coverageMin: row?.coverageMin ?? null,
        openErrorsMax: row?.openErrorsMax ?? null,
      };
    },
  });

  setProjectThresholds = $action({
    use: [this.gate],
    method: "POST",
    path: "/projects/:projectId/thresholds",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: projectThresholdsSchema,
      response: projectThresholdsSchema,
    },
    handler: async ({ params, body, user }) => {
      const held = await this.recipients.of(params.projectId, user);
      if (body.coverageMin !== undefined && !held.includes("app:manage"))
        throw new ForbiddenError(
          "Setting the coverage threshold needs app:manage",
        );
      if (body.openErrorsMax !== undefined && !held.includes("error:triage"))
        throw new ForbiddenError(
          "Setting the open-errors threshold needs error:triage",
        );
      const row = await this.thresholds.set(params.projectId, body);
      return {
        coverageMin: row.coverageMin ?? null,
        openErrorsMax: row.openErrorsMax ?? null,
      };
    },
  });
}
