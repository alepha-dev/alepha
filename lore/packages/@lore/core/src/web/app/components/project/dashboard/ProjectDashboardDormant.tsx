import { useI18n } from "alepha/react/i18n";
import { Moon } from "lucide-react";

import type { I18n } from "../../../services/I18n.ts";

export interface ProjectDashboardDormantProps {
  /**
   * When the project last moved, ISO.
   */
  since: string;
}

/**
 * A dormant project's line (#Q2662): no recorded write in 90 days, so the
 * computed board says when it went quiet and shows what it shipped last,
 * rather than a page of slots that all collapse. TransCity Simulator, last
 * change October 2025.
 */
const ProjectDashboardDormant = (props: ProjectDashboardDormantProps) => {
  const { tr, l } = useI18n<I18n, "en">();

  return (
    <p
      data-testid="dashboard-dormant"
      className="text-muted-foreground flex items-center gap-2 text-sm"
    >
      <Moon className="size-4 shrink-0" />
      {tr("dashboard.dormant", {
        args: [l(props.since, { date: "MMMM YYYY" })],
      })}
    </p>
  );
};

export default ProjectDashboardDormant;
