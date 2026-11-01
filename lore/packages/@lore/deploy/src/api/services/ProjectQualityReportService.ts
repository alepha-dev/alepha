import { projects, type ReportsQuery } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { artifacts } from "../entities/artifacts.ts";
import type { QualityRun } from "../entities/qualityRuns.ts";
import type { QualityReport } from "../schemas/qualityReportSchema.ts";
import { QualityService } from "./QualityService.ts";

/**
 * Quality as a section of the Delivery tab (#Q3010).
 */
export class ProjectQualityReportService {
  protected readonly quality = $inject(QualityService);
  protected readonly artifacts = $repository(artifacts);
  protected readonly projects = $repository(projects);

  /**
   * How much history one read holds: one row per branch per day.
   */
  protected readonly seriesLimit = 365;

  async report(
    projectId: number,
    query: ReportsQuery,
    resource: (run: QualityRun) => QualityReport["runs"][number],
  ): Promise<QualityReport> {
    const [all, project, built] = await Promise.all([
      this.quality.findSeries(projectId, this.seriesLimit),
      this.projects.getOne({ where: { id: { eq: projectId } } }),
      this.artifacts.findMany({
        where: { projectId: { eq: projectId } },
        columns: ["tag", "commitSha"],
      }),
    ]);

    const branches = [...new Set(all.map((run) => run.branch))];
    // `main` unless asked, so a topic branch's push never displaces it, and
    // the newest branch for a project that only ever pushed from a topic one.
    const branch =
      query.branch ?? (branches.includes("main") ? "main" : all[0]?.branch);
    const onBranch = all.filter((run) => run.branch === branch);

    const from = query.from?.slice(0, 10);
    const to = query.to?.slice(0, 10);
    const inPeriod = onBranch.filter(
      (run) => (!from || run.day >= from) && (!to || run.day <= to),
    );
    const previous = from ? onBranch.find((run) => run.day < from) : undefined;
    const latest = inPeriod[0] ?? onBranch[0];

    return {
      latest: latest ? resource(latest) : undefined,
      runs: inPeriod.map(resource),
      branches,
      ...(branch ? { branch } : {}),
      ...(previous ? { previous: resource(previous) } : {}),
      ...(project.coverageTarget === undefined
        ? {}
        : { target: project.coverageTarget }),
      coverageByTag: this.coverageByTag(onBranch, built),
    };
  }

  /**
   * Runs arrive newest first, so the first one matching a tag's commit is that
   * tag's. A run holds the last push of its day, so a tag cut mid-day from an
   * earlier commit has no run.
   */
  protected coverageByTag(
    runs: QualityRun[],
    built: Array<{ tag: string; commitSha?: string }>,
  ): QualityReport["coverageByTag"] {
    const seen = new Set<string>();
    return runs.flatMap((run) => {
      const tag = built.find(
        (it) =>
          it.commitSha?.startsWith(run.commitSha) ||
          (it.commitSha && run.commitSha.startsWith(it.commitSha)),
      )?.tag;
      if (!tag || seen.has(tag)) {
        return [];
      }
      seen.add(tag);
      return [{ tag, day: run.day, coverage: run.coverageLines }];
    });
  }
}
