import { Link } from "alepha/react/router";

import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

import { ProjectIcon } from "../shared/ProjectIcon.tsx";

export interface DashboardRailProjectProps {
  project: ProjectOverviewResource;
  href: string;
  /**
   * What to mark the row with, defaulting to the rail's own name.
   *
   * ⚠️ A parameter rather than a constant, because this row renders on TWO
   * surfaces now: the rail at `lg` and up, and `DashboardProjectsSection`
   * inline below it. Both are in the DOM at every width - the section is
   * CSS-hidden, not unmounted - so a shared testid resolves to two elements
   * per project, and every page-wide selector on it becomes a strict-mode
   * violation. `home.spec` counted ten rows for five projects before this.
   */
  testId?: string;
}

/**
 * One row in the projects rail.
 *
 * The number is open quests, counted through `OpenQuestScope` — the same
 * definition the sidebar badge and the Active Quests tile use. That matters
 * here more than anywhere: the tile is on screen a few hundred pixels to the
 * right, and two different numbers for the same project would make one of
 * them a lie.
 *
 * A project with none shows nothing rather than a zero, as the mockup does:
 * a column of zeroes is noise, and the rail is a place to notice the rows
 * that are not.
 */
const DashboardRailProject = (props: DashboardRailProjectProps) => (
  <Link
    href={props.href}
    data-testid={props.testId ?? "dashboard-rail-project"}
    className="hover:bg-accent flex items-center gap-2.5 rounded-lg px-1.5 py-2 transition-colors"
  >
    <ProjectIcon fileId={props.project.icon} className="size-8 rounded-lg" />
    <span className="flex-1 truncate text-[13.5px]">{props.project.title}</span>
    {props.project.openQuestCount > 0 && (
      <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
        {props.project.openQuestCount}
      </span>
    )}
  </Link>
);

export default DashboardRailProject;
