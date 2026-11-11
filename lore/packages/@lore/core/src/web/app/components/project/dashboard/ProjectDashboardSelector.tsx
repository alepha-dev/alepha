import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Check, ChevronsUpDown, Pencil, Plus, Trash2 } from "lucide-react";

import type { DashboardSummary } from "../../../../../api/schemas/dashboardSummarySchema.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface ProjectDashboardSelectorProps {
  projectSlug: string;
  /**
   * Every dashboard of the project, in order, from the page read.
   */
  dashboards: DashboardSummary[];
  /**
   * The dashboard on screen.
   */
  current?: DashboardSummary;
  /**
   * Whether the reader may create, rename and delete dashboards. Absent
   * means those entries are not rendered at all, as every other board
   * control is for a reader.
   */
  canEdit: boolean;
  onCreate: () => void;
  onRename: () => void;
  onDelete: () => void;
  /**
   * True while a board write runs (#E59 rule 10).
   */
  busy?: boolean;
}

/**
 * The left of the dashboard header (#E127, #Q3300): names the dashboard on
 * screen, lists the project's dashboards, and creates, renames and deletes
 * one. A menu, as `ProjectSwitcher` is one, not a form field.
 *
 * ⚠️ **Its entries are links.** Switching navigates, to `/:project` for the
 * first and `/:project/dashboards/:slug` for any other, so a dashboard is
 * always the URL's and never a stored choice copied into it by an effect:
 * that is the shape that once made every sidebar link dead (#156).
 *
 * Shown on a project with a single dashboard too: it is where a second one
 * is created.
 */
const ProjectDashboardSelector = (props: ProjectDashboardSelectorProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();

  const nameOf = (dashboard?: DashboardSummary) =>
    dashboard?.name ?? tr("project.menu.dashboard");

  const hrefOf = (dashboard: DashboardSummary) =>
    dashboard.first
      ? router.path("projectDashboard", {
          params: { projectSlug: props.projectSlug },
        })
      : router.path("projectDashboardNamed", {
          params: {
            projectSlug: props.projectSlug,
            dashboardSlug: dashboard.slug ?? `dashboard-${dashboard.id}`,
          },
        });

  const isCurrent = (dashboard: DashboardSummary) =>
    dashboard.id === props.current?.id &&
    dashboard.first === props.current?.first;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="dashboard-selector"
        aria-label={tr("project.dashboards.selector")}
        className="border-input bg-background hover:border-border-hover inline-flex h-9 max-w-64 min-w-0 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors"
      >
        <span className="truncate" data-testid="dashboard-selector-current">
          {nameOf(props.current)}
        </span>
        <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {props.dashboards.map((dashboard) => (
          <DropdownMenuItem
            key={dashboard.id ?? "first"}
            data-testid="dashboard-selector-item"
            render={<Link href={hrefOf(dashboard)} />}
          >
            <span className="flex-1 truncate">{nameOf(dashboard)}</span>
            {isCurrent(dashboard) && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        {props.canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="dashboard-create"
              disabled={props.busy}
              onClick={props.onCreate}
            >
              <Plus className="size-3.5" />
              {tr("project.dashboards.create")}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="dashboard-rename"
              disabled={props.busy}
              onClick={props.onRename}
            >
              <Pencil className="size-3.5" />
              {tr("project.dashboards.rename")}
            </DropdownMenuItem>
            {props.dashboards.length > 1 && (
              <DropdownMenuItem
                variant="destructive"
                data-testid="dashboard-delete"
                disabled={props.busy}
                onClick={props.onDelete}
              >
                <Trash2 className="size-3.5" />
                {tr("project.dashboards.delete")}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ProjectDashboardSelector;
