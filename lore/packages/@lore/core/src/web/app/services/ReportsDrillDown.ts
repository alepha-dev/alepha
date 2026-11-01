import type { ReportsUrl } from "../../../api/schemas/reportsUrlSchema.ts";

export interface ReportsSegment {
  status?: string;
  area?: string;
  tag?: string;
  releaseId?: string | number;
}

/**
 * From a chart segment to the quests behind it (#Q2997): the query of the
 * quests list, `projectQuests`, from the report's filters plus what was clicked.
 *
 * ⚠️ The list filters on status, area, tag and release, so that is what
 * carries. A report's epic, priority and member filters and its period have no
 * list filter to land on: a drill-down under them opens a wider list than the
 * chart, never a narrower one.
 */
export class ReportsDrillDown {
  query(url: ReportsUrl, segment: ReportsSegment): Record<string, string> {
    const merged = {
      status: segment.status,
      area: segment.area ?? url.area,
      tag: segment.tag ?? url.tag,
      release:
        segment.releaseId === undefined
          ? url.releaseId
          : String(segment.releaseId),
    };
    return Object.fromEntries(
      Object.entries(merged).filter(
        (entry): entry is [string, string] => !!entry[1],
      ),
    );
  }
}
