import { Button } from "@alepha/ui";
import { DataTable, type DataTableFilterFields } from "@alepha/ui/table";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Bug, Crown, Inbox, Layers, Sparkles, Swords } from "lucide-react";

import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

import type { AppRouter } from "../../AppRouter.ts";
import type { I18n } from "../../services/I18n.ts";
import {
  capabilityOption,
  hasCapability,
} from "../../services/projectCapabilities.ts";
import { ProjectIcon } from "../shared/ProjectIcon.tsx";
import {
  activityAgeInDays,
  HOME_INACTIVE_AFTER_DAYS,
} from "./homeActivityAge.ts";
import { HomeLastActivity } from "./HomeLastActivity.tsx";
import { HomeMomentum } from "./HomeMomentum.tsx";
import { type HomeOpenLink, HomeOpenLinks } from "./HomeOpenLinks.tsx";

export interface HomeProjectsTableProps {
  projects: ProjectOverviewResource[];
  /**
   * Daily counts per project id, from `getHomeBoard`.
   */
  momentum: Map<number, number[]>;
  /**
   * The day labels those counts are indexed by.
   */
  days: string[];
  /**
   * When each project last saw any activity, by project id, from
   * `getHomeBoard`. Empty until the board has been read.
   */
  lastActivity: Map<number, string>;
  /**
   * Draft epics, open blights and pending feedback, by project id, from
   * `getHomeBoard`. Empty until the board has been read.
   */
  openCounts: Map<number, { epics: number; blights: number; feedback: number }>;
}

/**
 * Every project you belong to, most recently active first.
 *
 * Static-data mode: the rows are `userProjectsAtom`, which the bootstrap
 * already filled with the COMPLETE membership list, and the same array feeds
 * the activity panel's project names. Paging it on the server would be a
 * second copy of data already in memory - and the atom cannot be capped, since
 * Spotlight filters it client-side to search projects by name.
 */
export const HomeProjectsTable = (props: HomeProjectsTableProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const dt = useInject(DateTimeProvider);

  /**
   * The tallest day across every row, so one scale serves the column. Read
   * from the momentum map rather than from the rows, because a project with
   * no events at all contributes no entry.
   */
  const ceiling = Math.max(
    1,
    ...[...props.momentum.values()].flatMap((counts) => counts),
  );

  /**
   * Whether a project has gone quiet: no activity for a week. Its momentum
   * and last activity turn muted, so the eye lands on the live rows.
   *
   * Never before the board arrives: without its last activity the answer is
   * unknown, and muting first then lighting up would flicker every row that
   * turns out to be busy.
   */
  const isInactive = (project: ProjectOverviewResource) => {
    const at = props.lastActivity.get(project.id);
    return !!at && activityAgeInDays(dt, at) >= HOME_INACTIVE_AFTER_DAYS;
  };

  /**
   * The Open column's buttons for one project: quests, epics, blights and
   * feedback, each only when the project has that feature on, the same
   * switches that put the entry in its sidebar. A feature that is off has
   * nothing to count, and a "0" for it would read as "all done" instead.
   *
   * The quest count comes with the project (`openQuestCount`), the others
   * with the board, so until the board arrives those three read 0.
   */
  const openTags = (project: ProjectOverviewResource) => {
    const counts = props.openCounts.get(project.id);
    const tags: HomeOpenLink[] = [];
    if (hasCapability(project, "work")) {
      tags.push({
        kind: "quests",
        route: "projectQuests",
        icon: Swords,
        count: project.openQuestCount,
        label: tr("home.table.open.quests", {
          args: [String(project.openQuestCount)],
        }),
      });
    }
    if (capabilityOption(project, "work", "epics")) {
      const count = counts?.epics ?? 0;
      tags.push({
        kind: "epics",
        route: "projectEpics",
        icon: Layers,
        count,
        label: tr("home.table.open.epics", { args: [String(count)] }),
      });
    }
    if (capabilityOption(project, "apps", "track")) {
      const count = counts?.blights ?? 0;
      tags.push({
        kind: "blights",
        route: "projectBlights",
        icon: Bug,
        count,
        label: tr("home.table.open.blights", { args: [String(count)] }),
      });
    }
    if (hasCapability(project, "support")) {
      const count = counts?.feedback ?? 0;
      tags.push({
        kind: "feedback",
        route: "projectFeedback",
        icon: Inbox,
        count,
        label: tr("home.table.open.feedback", { args: [String(count)] }),
      });
    }
    return tags;
  };

  /**
   * One filter, and it is the search box: `preset: "search"` is the locked
   * one, so it sits on the bar rather than behind the add-filter menu.
   *
   * It spans the title alone. A project has nothing else a reader would type:
   * the description is not on the overview resource, and matching an id or a
   * slug answers a question nobody asks of nine rows.
   */
  const filterFields = {
    search: { preset: "search", placeholder: tr("home.table.search") },
  } satisfies DataTableFilterFields;

  return (
    <DataTable<ProjectOverviewResource, typeof filterFields>
      className="h-full min-h-0 min-w-0 flex-1"
      // One surface with the activity panel beside it: the filter bar, the
      // column header and the footer take the page's own background rather
      // than a band of their own, as the panel does.
      chromeClassName="bg-transparent"
      // The panel joins on the right from `lg`, where it appears.
      squareRight="lg"
      // Twenty and no picker: Home is a glance at your projects, not a list
      // to page through, and with one page the footer goes too.
      pageSizes={[]}
      defaultSize={20}
      persistenceKey="lor.home.projects"
      data={props.projects}
      defaultSort={{ field: "updatedAt", direction: "desc" }}
      emptyMessage={tr("home.table.empty")}
      rowKey={(project) => String(project.id)}
      filters={{ fields: filterFields }}
      filter={(project, filters) =>
        !filters.search ||
        project.title.toLowerCase().includes(filters.search.toLowerCase())
      }
      onRowClick={(project) =>
        router.push("project", { params: { projectSlug: project.slug } })
      }
      toolbar={
        <Button
          render={
            <Link href={router.path("projectCreate")} />
            // A link wearing a button's clothes: `nativeButton={false}` stops
            // Base UI assuming a native <button> (it warns otherwise), and
            // `role` puts back the link semantics its non-native branch would
            // overwrite with `role="button"`.
          }
          nativeButton={false}
          role="link"
          data-testid="home-new-project"
        >
          <Sparkles className="size-4" />
          {tr("home.create-project")}
        </Button>
      }
      columns={{
        title: {
          label: tr("home.table.col.project"),
          sortable: true,
          cell: (project) => (
            <div className="flex items-center gap-3">
              <ProjectIcon
                fileId={project.icon}
                className="size-7 rounded-md"
                alt={project.title}
              />
              {/* A real anchor, so the name shows its URL on hover, opens in
                  a new tab on a modified click and offers "copy link
                  address"; a plain click still routes in place. The same
                  shape as the quests table's title cell.

                  `stopPropagation` because the row carries `onRowClick` too,
                  and without it a plain click would navigate twice, and a
                  modified click would open the tab AND navigate this one. */}
              <Link
                href={router.path("project", {
                  params: { projectSlug: project.slug },
                })}
                onClick={(e) => e.stopPropagation()}
                className="truncate font-medium underline-offset-2 hover:underline"
              >
                {project.title}
              </Link>
              {/* Ownership, the one fact about a membership that compares
                  across projects. A rank name would not: two projects can
                  both have an "Admin" meaning different things. */}
              {project.owner && (
                <Crown
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-label={tr("home.table.owner")}
                />
              )}
            </div>
          ),
        },
        momentum: {
          label: tr("home.table.col.momentum"),
          // Sorted by the window's total, which is the question the column
          // asks. The bars themselves have no order to sort by.
          sortable: true,
          sortValue: (project) =>
            (props.momentum.get(project.id) ?? []).reduce(
              (total, count) => total + count,
              0,
            ),
          cell: (project) => {
            const counts =
              props.momentum.get(project.id) ?? props.days.map(() => 0);
            const total = counts.reduce((sum, count) => sum + count, 0);
            return (
              <HomeMomentum
                counts={counts}
                days={props.days}
                ceiling={ceiling}
                label={tr("home.table.momentum.label", {
                  args: [String(total), String(props.days.length)],
                })}
                inactive={isInactive(project)}
              />
            );
          },
        },
        // Keyed `openQuestCount` still: the key is what `persistenceKey`
        // stores a reader's sort and column choices under.
        openQuestCount: {
          label: tr("home.table.col.open"),
          sortable: true,
          // Everything the row shows as open, so the busiest project sorts
          // first whichever kind its work is.
          sortValue: (project) =>
            openTags(project).reduce((total, tag) => total + tag.count, 0),
          cell: (project) => (
            <HomeOpenLinks
              projectSlug={project.slug}
              links={openTags(project)}
            />
          ),
        },
        // Keyed `updatedAt` still, because the key is what `persistenceKey`
        // stores a reader's sort and column choices under. What it shows
        // is the board's last activity, not the project row's own
        // `updatedAt`, which only moves when the project itself is edited:
        // a quest, a folio or a release never touched it.
        updatedAt: {
          label: tr("home.table.col.lastActivity"),
          sortable: true,
          // The row's own `updatedAt` until the board arrives, so the order
          // is already close and does not reshuffle from nothing.
          sortValue: (project) =>
            Date.parse(props.lastActivity.get(project.id) ?? project.updatedAt),
          cell: (project) => (
            <HomeLastActivity
              at={props.lastActivity.get(project.id)}
              inactive={isInactive(project)}
            />
          ),
        },
      }}
    />
  );
};
