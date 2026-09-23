import { Button } from "@alepha/ui";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

import type { I18n } from "../../services/I18n.ts";
import {
  activityAgeInDays,
  HOME_INACTIVE_AFTER_DAYS,
} from "./homeActivityAge.ts";
import { HomeRecentProjectRow } from "./HomeRecentProjectRow.tsx";
import { useHomeOpenTags } from "./useHomeOpenTags.ts";

export interface HomeRecentProjectsProps {
  /**
   * Every project, most recently active first.
   */
  projects: ProjectOverviewResource[];
  /**
   * Daily counts per project id, `undefined` when the strip could not be read
   * (#E65), which is not the same as every project being quiet.
   */
  momentum: Map<number, number[]> | undefined;
  days: string[];
  lastActivity: Map<number, string>;
  openCounts: Map<number, { epics: number; blights: number; feedback: number }>;
}

/**
 * Home's one column: the projects you touched last, one row each.
 *
 * A glance, not a table: no sorting, no filters, no paging. The first
 * `RECENT` rows show, and the rest are one click away in place, since the
 * list is already complete in memory (`userProjectsAtom`).
 */
export const HomeRecentProjects = (props: HomeRecentProjectsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const openTags = useHomeOpenTags(props.openCounts);
  const [expanded, setExpanded] = useState(false);

  const shown = expanded ? props.projects : props.projects.slice(0, RECENT);
  const hidden = props.projects.length - RECENT;

  /**
   * The tallest day across every project, so one scale serves the column.
   */
  const ceiling = Math.max(
    1,
    ...[...(props.momentum?.values() ?? [])].flatMap((counts) => counts),
  );

  /**
   * Never muted before the board arrives: muting first then lighting up
   * would flicker every row that turns out to be busy.
   */
  const isInactive = (project: ProjectOverviewResource) => {
    const at = props.lastActivity.get(project.id);
    return !!at && activityAgeInDays(dt, at) >= HOME_INACTIVE_AFTER_DAYS;
  };

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-muted-foreground px-3 text-sm">
        {tr("home.recent.title")}
      </h2>
      <ul>
        {shown.map((project) => (
          <HomeRecentProjectRow
            key={project.id}
            project={project}
            counts={
              // No map at all: the strip is unavailable and draws nothing. A
              // project missing FROM the map was quiet: fourteen zeroes.
              props.momentum
                ? (props.momentum.get(project.id) ?? props.days.map(() => 0))
                : []
            }
            days={props.days}
            ceiling={ceiling}
            inactive={isInactive(project)}
            openLinks={openTags(project)}
          />
        ))}
      </ul>
      {hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground mt-4 self-center"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? tr("home.recent.showLess")
            : tr("home.recent.showAll", {
                args: [String(props.projects.length)],
              })}
        </Button>
      )}
    </section>
  );
};

/**
 * Rows the list shows before "Show all".
 */
const RECENT = 8;
