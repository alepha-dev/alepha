import { $ownsProject } from "@lore/core/api";
import { epics } from "@lore/plan/schemas";
import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $action, NotFoundError, okSchema } from "alepha/server";
import { FileSystemProvider } from "alepha/system";

import {
  requirementCoverageSchema,
  requirementImpactSchema,
} from "../schemas/requirementCoverageSchema.ts";
import { RequirementCoverageService } from "../services/RequirementCoverageService.ts";
import { RequirementController } from "./RequirementController.ts";

/**
 * Traceability (#E153, #Q3774): coverage and readiness, a requirement's
 * impact chain, technical epics, and the CSV export.
 */
export class RequirementCoverageController {
  protected readonly coverage = $inject(RequirementCoverageService);
  protected readonly requirements = $inject(RequirementController);
  protected readonly epics = $repository(epics);
  protected readonly fs = $inject(FileSystemProvider);

  protected ownsProject = (requires: string) =>
    $ownsProject({ requires, param: "projectId" });

  protected ownsProjectForWrite = (requires: string) =>
    $ownsProject({
      requires,
      param: "projectId",
      capability: {
        key: "plan",
        option: "requirements",
        action: "mark an epic technical",
      },
    });

  getRequirementCoverage = $action({
    method: "GET",
    path: "/getRequirementCoverage/:projectId",
    use: [this.ownsProject("requirement:read")],
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({ releaseId: z.integer().optional() }),
      response: requirementCoverageSchema,
    },
    handler: async ({ params, query }) =>
      await this.coverage.coverage(params.projectId, query.releaseId),
  });

  getRequirementImpact = $action({
    method: "GET",
    path: "/getRequirementImpact/:projectId/:number",
    use: [this.ownsProject("requirement:read")],
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer() }),
      response: requirementImpactSchema,
    },
    handler: async ({ params }) =>
      await this.coverage.impactOf(
        await this.requirements.byNumber(params.projectId, params.number),
      ),
  });

  setEpicTechnical = $action({
    method: "POST",
    path: "/setEpicTechnical/:projectId",
    use: [this.ownsProjectForWrite("requirement:write")],
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({ epicNumber: z.integer(), technical: z.boolean() }),
      response: okSchema,
    },
    handler: async ({ params, body }) => {
      const [epic] = await this.epics.findMany({
        where: {
          projectId: { eq: params.projectId },
          number: { eq: body.epicNumber },
        },
        columns: ["id"],
        limit: 1,
      });
      if (!epic) throw new NotFoundError(`Epic #E${body.epicNumber} not found`);
      await this.coverage.setTechnical(
        params.projectId,
        epic.id,
        body.technical,
      );
      return { ok: true };
    },
  });

  /**
   * The requirements as CSV: one row per requirement with its chapter,
   * paragraph, priority, status, release and what verifies it.
   */
  exportRequirements = $action({
    method: "GET",
    path: "/projects/:projectId/requirements/export",
    use: [this.ownsProject("requirement:read")],
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({ releaseId: z.integer().optional() }),
      response: z.file(),
    },
    handler: async ({ params, query }) => {
      const rows = await this.coverage.rows(params.projectId, query.releaseId);
      const cell = (value: string | number | undefined) => {
        const text = value === undefined ? "" : String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const lines = [
        [
          "number",
          "chapter",
          "paragraph",
          "statement",
          "type",
          "priority",
          "status",
          "release",
          "verified_by",
        ].join(","),
        ...rows.map((it) =>
          [
            `S${it.number}`,
            it.chapter,
            it.paragraph,
            it.statement,
            it.type,
            it.priority,
            it.status,
            it.targetRelease?.tag,
            it.metric
              ? `metric ${it.metric.kind}`
              : it.criteria
                  .map((c) => `U${c.useCaseNumber} ${c.key}`)
                  .join("; "),
          ]
            .map(cell)
            .join(","),
        ),
      ];
      return this.fs.createFile({
        text: `${lines.join("\n")}\n`,
        name: "requirements.csv",
        type: "text/csv",
      });
    },
  });
}
