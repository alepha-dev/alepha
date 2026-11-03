import { $inject, AlephaError } from "alepha";
import { NotFoundError } from "alepha/server";

import type { ReportsQuery } from "../schemas/reportsQuerySchema.ts";
import { ReportsSummaryRegistry } from "./ReportsSummaryRegistry.ts";

/**
 * The Reports tabs as data, for a caller with no browser (#Q3015): each module
 * registers the sections it owns, from its reports controller, and `project_report`
 * asks. Core reads no module's table.
 *
 * Reading a section with its capability off answers what is stored, like any
 * other read: disabling hides, it never deletes.
 */
export class ProjectReportRegistry {
  protected readonly summary = $inject(ReportsSummaryRegistry);
  protected readonly sections = new Map<string, ProjectReportSection>();

  constructor() {
    this.register("summary", async (projectId, query) => ({
      lines: await this.summary.lines(projectId, query),
    }));
  }

  public register(section: string, read: ProjectReportSection): void {
    if (this.sections.has(section)) {
      throw new AlephaError(`Report section '${section}' is registered twice`);
    }
    this.sections.set(section, read);
  }

  public names(): string[] {
    return [...this.sections.keys()].toSorted();
  }

  public async read(
    section: string,
    projectId: number,
    query: ReportsQuery,
  ): Promise<Record<string, unknown>> {
    const read = this.sections.get(section);
    if (!read) {
      throw new NotFoundError(
        `No report section '${section}'. Sections: ${this.names().join(", ")}.`,
      );
    }
    return await read(projectId, query);
  }
}

export type ProjectReportSection = (
  projectId: number,
  query: ReportsQuery,
) => Promise<Record<string, unknown>>;
