import { Button } from "@alepha/ui";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

import type { AppRouter } from "../../AppRouter.ts";
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
 * `RECENT` rows show, and "Show more" is a link to `/account/projects`,
 * which lists every project, rather than growing this list in place.
 */
export const HomeRecentProjects = (props: HomeRecentProjectsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const openTags = useHomeOpenTags(props.openCounts);
  const router = useRouter<AppRouter>();

  const shown = props.projects.slice(0, RECENT);

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
      {props.projects.length > RECENT && (
        <Button
          render={<Link href={router.path("accountProjects")} />}
          // A link wearing a button's clothes, as on the hero's CTA.
          nativeButton={false}
          role="link"
          variant="ghost"
          size="sm"
          className="text-muted-foreground mt-4 self-center"
        >
          {tr("home.recent.showMore")}
        </Button>
      )}
    </section>
  );
};

/**
 * Rows the list shows before "Show more".
 */
const RECENT = 5;
