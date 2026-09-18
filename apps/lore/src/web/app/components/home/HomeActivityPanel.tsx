import { useI18n } from "alepha/react/i18n";
import { History } from "lucide-react";

import type { HomeActivityRow } from "@/api/schemas/homeActivityRowSchema.ts";
import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

import type { I18n } from "../../services/I18n.ts";
import { HomeActivityLine } from "./HomeActivityLine.tsx";

export interface HomeActivityPanelProps {
  rows: HomeActivityRow[];
  projects: ProjectOverviewResource[];
  /**
   * The project the pointer is on, if any. The panel narrows to it.
   */
  focused?: ProjectOverviewResource;
  loading: boolean;
}

/**
 * What has happened lately, across every project you belong to.
 *
 * ## Hovering a row narrows it, and nothing is fetched
 *
 * The filter is a predicate over rows already in memory. A request per hover
 * would be a request per pixel of pointer travel, and the panel is a summary
 * rather than a project's Activity page - which is where somebody who wants
 * all of one project's history is going.
 *
 * That also decides what the narrowed view can honestly say: it holds the most
 * recent events across ALL projects, so a quiet project shows few lines or
 * none, and its empty state says "nothing recent here" rather than "no
 * activity". The two are different facts and the panel only knows the first.
 */
export const HomeActivityPanel = (props: HomeActivityPanelProps) => {
  const { tr } = useI18n<I18n, "en">();
  const slugs = new Map(
    props.projects.map((project) => [project.id, project.slug]),
  );
  const rows = props.focused
    ? props.rows.filter((row) => row.projectId === props.focused?.id)
    : props.rows;

  return (
    <aside
      data-testid="home-activity"
      className="hidden w-80 shrink-0 flex-col lg:flex"
    >
      <div className="text-muted-foreground flex items-center gap-2 px-4 py-3 text-[11px] tracking-[0.18em] uppercase">
        <History className="size-3.5" />
        {tr("home.activity.title")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((row) => (
          <HomeActivityLine
            key={row.id}
            row={row}
            projectSlug={slugs.get(row.projectId)}
            filtered={!!props.focused}
          />
        ))}
        {rows.length === 0 && !props.loading && (
          <p className="text-muted-foreground px-4 py-3 text-sm">
            {props.focused
              ? tr("home.activity.empty.project")
              : tr("home.activity.empty")}
          </p>
        )}
      </div>
    </aside>
  );
};
