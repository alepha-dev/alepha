import { Button, TimeAgo, useDialog } from "@alepha/ui";
import { DataTable, type DataTableFilterFields } from "@alepha/ui/table";
import { useAction, useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Crown, Sparkles, Trash2 } from "lucide-react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

import type { AppRouter } from "../../AppRouter.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { ProjectIcon } from "../shared/ProjectIcon.tsx";
import { HomeMomentum } from "./HomeMomentum.tsx";

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
   * Called with the project under the pointer, and with `undefined` when the
   * pointer leaves. Drives the activity panel beside the table.
   */
  onHover: (project: ProjectOverviewResource | undefined) => void;
  /**
   * Re-read the board after a row is deleted, so the bars and the panel stop
   * describing a project that is gone.
   */
  onChanged: () => void;
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
  const alepha = useAlepha();
  const dialog = useDialog();
  const projectApi = useClient<ProjectController>();

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

  /**
   * Deleting a project from its own row.
   *
   * ⚠️ The dialog is the guard, and the server is the gate: `deleteProjectById`
   * refuses a non-owner whatever this menu offers, and the entry is hidden
   * rather than disabled because a disabled item is a question and a missing
   * one is an answer.
   *
   * The overview atom is re-read INSIDE the handler, so a refusal leaves both
   * the list and the board untouched and the root `ActionErrorToaster` says
   * why.
   */
  const deleteProject = useAction<[project: ProjectOverviewResource], void>(
    {
      handler: async (project) => {
        const confirmed = await dialog.confirm({
          title: tr("home.table.delete.title"),
          description: tr("home.table.delete.description", {
            args: [project.title],
          }),
          confirmLabel: tr("home.table.delete.confirm"),
          destructive: true,
        });
        if (!confirmed) return;
        await projectApi.deleteProjectById({ params: { id: project.id } });
        alepha.store.set(userProjectsAtom, await projectApi.getHomeOverview());
        props.onChanged();
      },
    },
    [projectApi, alepha, dialog, props.onChanged],
  );

  return (
    <DataTable<ProjectOverviewResource, typeof filterFields>
      className="h-full min-h-0 w-full flex-1"
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
      onRowHover={props.onHover}
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
      rowActions={(project) =>
        project.owner
          ? [
              {
                label: tr("home.table.delete.action"),
                icon: Trash2,
                destructive: true,
                onClick: (row) => deleteProject.run(row),
              },
            ]
          : []
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
              <span className="truncate font-medium">{project.title}</span>
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
              />
            );
          },
        },
        openQuestCount: {
          label: tr("home.table.col.open"),
          sortable: true,
          cell: (project) => (
            <span className="text-sm">
              {project.openQuestCount === 0 && tr("home.table.open.none")}
              {project.openQuestCount === 1 && tr("home.table.open.quest")}
              {project.openQuestCount > 1 &&
                tr("home.table.open.quests", {
                  args: [String(project.openQuestCount)],
                })}
            </span>
          ),
        },
        updatedAt: {
          label: tr("home.table.col.lastActivity"),
          sortable: true,
          cell: (project) => (
            <span className="text-muted-foreground text-sm whitespace-nowrap">
              <TimeAgo value={project.updatedAt} />
            </span>
          ),
        },
      }}
    />
  );
};
