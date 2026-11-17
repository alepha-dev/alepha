import { ProjectSecurityService } from "@lore/core/api";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { requirements } from "../entities/requirements.ts";
import { requirementsCoverageDays } from "../entities/requirementsCoverageDays.ts";
import type { RequirementResource } from "../schemas/requirementResourceSchema.ts";
import { RequirementService } from "./RequirementService.ts";

/**
 * Today's coverage snapshot (#E153, #Q3775): one row per project with
 * Plan's `requirements` option on, for all its requirements and for each
 * release holding at least one, upserted so a second run the same day
 * replaces the first. What the Coverage over time card draws. `on` names
 * the day (`YYYY-MM-DD`); today by default.
 */
export class RequirementsCoverageSnapshot {
  protected readonly requirements = $repository(requirements);
  protected readonly days = $repository(requirementsCoverageDays);
  protected readonly requirementService = $inject(RequirementService);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly dt = $inject(DateTimeProvider);

  public async snapshot(projectId?: number, on?: string): Promise<number> {
    const day = on ?? this.dt.nowISOString().slice(0, 10);
    const ids = projectId
      ? [projectId]
      : [
          ...new Set(
            (await this.requirements.findMany({ columns: ["projectId"] })).map(
              (it) => it.projectId,
            ),
          ),
        ];
    let written = 0;
    for (const id of ids) {
      const plan = (await this.security.capabilitiesOf(id)).plan;
      if (plan?.requirements !== true) continue;
      const rows = await this.requirementService.toResources(
        await this.requirements.findMany({ where: { projectId: { eq: id } } }),
      );
      const scopes = new Map<string, RequirementResource[]>([["all", rows]]);
      for (const row of rows) {
        if (!row.targetRelease) continue;
        const key = `release:${row.targetRelease.id}`;
        scopes.set(key, [...(scopes.get(key) ?? []), row]);
      }
      for (const [scope, list] of scopes) {
        const counts = {
          verified: list.filter((it) => it.status === "verified").length,
          covered: list.filter((it) => it.status !== "not_covered").length,
          total: list.length,
        };
        const [existing] = await this.days.findMany({
          where: {
            projectId: { eq: id },
            scope: { eq: scope },
            day: { eq: day },
          },
          limit: 1,
        });
        if (existing) {
          await this.days.updateById(existing.id, counts);
        } else {
          await this.days.create({ projectId: id, day, scope, ...counts });
        }
        written += 1;
      }
    }
    return written;
  }
}
