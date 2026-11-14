import { ReportsSummaryRegistry } from "@lore/core/api";
import type { ReportsQuery } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { folioRevisions } from "../entities/folioRevisions.ts";
import { folios } from "../entities/folios.ts";

/**
 * Knowledge's lines of the Reports Summary tab (#Q2999).
 */
export class KnowledgeReportsSummary {
  protected readonly summary = $inject(ReportsSummaryRegistry);
  protected readonly folios = $repository(folios);
  protected readonly revisions = $repository(folioRevisions);

  constructor() {
    this.summary.register({
      capability: "remember",
      read: (projectId, query) => this.read(projectId, query),
    });
  }

  protected async read(projectId: number, query: ReportsQuery) {
    const within = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
    const bounded = !!query.from || !!query.to;
    const [created, revised] = await Promise.all([
      this.folios.count({
        projectId: { eq: projectId },
        ...(bounded ? { createdAt: within } : {}),
      }),
      this.revisions.count({
        ...(bounded ? { at: within } : {}),
        exists: this.folios.subquery({
          id: { eq: this.revisions.table.folioId },
          projectId: { eq: projectId },
        }),
      }),
    ]);
    const tab = "reportsKnowledge";
    return [
      {
        key: "foliosCreated",
        value: created,
        format: "count" as const,
        upIsGood: true,
        tab,
      },
      {
        key: "foliosRevised",
        value: revised,
        format: "count" as const,
        upIsGood: true,
        tab,
      },
    ];
  }
}
