import { ProjectTools } from "@lore/core/mcp";
import { projectParamsSchema } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $tool } from "alepha/mcp";

import { ProjectThresholdController } from "../../api/controllers/ProjectThresholdController.ts";
import {
  thresholdResultSchema,
  thresholdSetParamsSchema,
} from "../schemas/thresholdSchemas.ts";

/**
 * The coverage and open-errors thresholds over MCP (#Q3914), on the actions
 * Settings > Apps and Settings > Errors call. Who is told when one is
 * crossed is `subscription_set`.
 */
export class ThresholdTools {
  protected readonly thresholds = $inject(ProjectThresholdController);
  protected readonly projects = $inject(ProjectTools);

  threshold_get = $tool({
    title: "Read thresholds",
    description:
      "The project's two alert thresholds: `coverageMin` (line coverage on main, in percent) and `openErrorsMax` (open errors); null is no alert. Crossing one records `coverage.dropped` or `errors.threshold_crossed`, once, which subscription_set routes to people or channels.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: projectParamsSchema.strict(),
      result: thresholdResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      const row = await this.thresholds.getProjectThresholds({
        params: { projectId },
      });
      return {
        coverageMin: row.coverageMin ?? null,
        openErrorsMax: row.openErrorsMax ?? null,
      };
    },
  });

  threshold_set = $tool({
    title: "Set thresholds",
    description:
      "Set or clear either alert threshold: `coverage_min` (needs app:manage) fires `coverage.dropped` once when a push on main brings line coverage under it; `open_errors_max` (needs error:triage) fires `errors.threshold_crossed` once when the hourly count goes over it. null clears one; an omitted one is left alone. A changed threshold rearms its alert.",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: { params: thresholdSetParamsSchema, result: thresholdResultSchema },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      const row = await this.thresholds.setProjectThresholds({
        params: { projectId },
        body: {
          ...(params.coverage_min !== undefined
            ? { coverageMin: params.coverage_min }
            : {}),
          ...(params.open_errors_max !== undefined
            ? { openErrorsMax: params.open_errors_max }
            : {}),
        },
      });
      return {
        coverageMin: row.coverageMin ?? null,
        openErrorsMax: row.openErrorsMax ?? null,
      };
    },
  });
}
