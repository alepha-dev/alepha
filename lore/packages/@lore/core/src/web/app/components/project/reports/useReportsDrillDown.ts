import { useInject } from "alepha/react";
import { useRouter } from "alepha/react/router";

import type { ReportsUrl } from "../../../../../api/schemas/reportsUrlSchema.ts";
import {
  ReportsDrillDown,
  type ReportsSegment,
} from "../../../services/ReportsDrillDown.ts";

/**
 * Opens the quests behind a chart segment, for a tab holding the bar's URL.
 */
export const useReportsDrillDown = (url: ReportsUrl) => {
  // Untyped on purpose: `projectQuests` is a Work page, and core's own
  // program registers only core's routers.
  const router = useRouter<any>();
  const drillDown = useInject(ReportsDrillDown);

  return (segment: ReportsSegment) => {
    void router.push("projectQuests", { query: drillDown.query(url, segment) });
  };
};
