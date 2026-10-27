import { $inject, z } from "alepha";
import { RankService } from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $action } from "alepha/server";

import { projects } from "../entities/projects.ts";
import { projectMergeResultSchema } from "../schemas/projectMergeResultSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
import { ProjectMergeReport } from "../services/ProjectMergeReport.ts";
import { ProjectMergeService } from "../services/ProjectMergeService.ts";

/**
 * Merge one project into another (#E94, #Q2783, folio #F1401): every row
 * of the source moves into the target, a per-project number the target
 * already uses is renumbered, and the references in moved text follow. A
 * **dry run by default**: the caller reads the plan, conflicts included,
 * before anything is written.
 *
 * Gated on `project:delete` in BOTH projects, the owner-only permission
 * that may already empty a project: a merge empties the source and writes
 * into the target, so whoever runs it must be able to do both. It was a
 * realm admin action first, and an MCP session's OAuth credential carries
 * no `admin:*` permission in its scope, so the one caller that needed it
 * (an agent running the merge for the owner) could never reach it.
 */
export class ProjectMergeController {
  protected readonly projects = $repository(projects);
  protected readonly projectMerge = $inject(ProjectMergeService);
  protected readonly mergeReport = $inject(ProjectMergeReport);
  protected readonly ranks = $inject(RankService);
  protected readonly audits = $inject(LoreAudits);
  protected readonly dateTime = $inject(DateTimeProvider);

  public readonly mergeProject = $action({
    path: "/projects/:id/merge",
    method: "POST",
    use: [$ownsProject({ param: "id", requires: "project:delete" })],
    description:
      "Merge a project into another, renumbering what collides (dry run unless dryRun is false)",
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        target: z.integer(),
        dryRun: z.boolean().optional(),
      }),
      response: projectMergeResultSchema,
    },
    handler: async ({ params, body, user }) => {
      const source = await this.projects.findById(params.id);
      const target = await this.projects.findById(body.target);
      // ⚠️ ranks: imperative. The gate above reads one path param, and the
      // target is a body field, so its half of the rule is asked here, of
      // the same permission.
      if (target?.organizationId && user) {
        await this.ranks.assert(target.organizationId, "project:delete", user);
      }
      const dryRun = body.dryRun !== false;
      const plan = await this.projectMerge.merge(params.id, body.target, {
        dryRun,
      });
      if (!dryRun) {
        await this.audits.project.logSuccess("merge", {
          ...this.audits.actor(user),
          severity: "warning",
          resourceType: "project",
          resourceId: String(body.target),
          description: `${source?.title ?? params.id} merged into ${target?.title ?? body.target}`,
        });
      }
      return {
        ...plan,
        report: this.mergeReport.markdown(plan, {
          source: source?.title ?? String(params.id),
          target: target?.title ?? String(body.target),
          at: this.dateTime.nowISOString(),
        }),
      };
    },
  });
}
