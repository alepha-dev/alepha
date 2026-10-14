import { Button } from "@alepha/ui";
import { DateTimeProvider } from "alepha/datetime";
import { ClientOnly, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Check, LayoutGrid, Pencil, Plus } from "lucide-react";

import type { I18n } from "../../../services/I18n.ts";
import ProjectDashboardMenu from "./ProjectDashboardMenu.tsx";

export interface ProjectDashboardHeaderProps {
  cardCount: number;
  /**
   * Absent until the first resolve returns.
   */
  refreshedAt?: string;
  /**
   * Whether the viewer may curate the board. Absent means the Add button is
   * not rendered at all, rather than rendered disabled.
   */
  canEdit: boolean;
  /**
   * Whether the reader is looking at the computed default board (#Q2652),
   * which has no edit mode: it is not stored, so there is nothing to edit.
   */
  computed?: boolean;
  /**
   * Whether the board is in edit mode: Add, the card menus and drag, and the
   * tiles that have nothing to show, collapsed with their reason (#Q2649).
   */
  editing: boolean;
  onToggleEditing: () => void;
  onAdd: () => void;
  /**
   * Copy the computed board into stored cards and open edit mode (#Q2660).
   */
  onCustomize: () => void;
  /**
   * Delete the stored cards, back to the computed board (#Q2660).
   */
  onReset: () => void;
  /**
   * True while a board write runs.
   */
  busy?: boolean;
}

/**
 * The project board's own header: a title, a standfirst and Add.
 *
 * ⚠️ **Not `DashboardHeader`.** That one greets the account by name, which is
 * exactly wrong on a board that belongs to the project and is read by
 * everybody in it - "Welcome back, Nicolas" over a shared surface reads as a
 * personal board. It also carried Reset, which is gone from both boards
 * (#Q2145), and the account cluster, which the project shell already renders.
 *
 * ⚠️ "refreshed ..." is a timestamp on the last resolve, not a polling
 * indicator. Rendered `ClientOnly` because it is relative to now and this app
 * is server-rendered: a `fromNow()` string differs between the server render
 * and hydration and trips React #418.
 */
const ProjectDashboardHeader = (props: ProjectDashboardHeaderProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dateTime = useInject(DateTimeProvider);

  // Only ever rendered with cards on the board: at zero the empty state is the
  // whole page (feedback #P2180), which is why there is no empty standfirst.
  const standfirst = (
    <>
      {props.computed
        ? tr("project.dashboard.standfirst.computed")
        : tr(
            props.cardCount === 1
              ? "project.dashboard.standfirst.one"
              : "project.dashboard.standfirst",
            { args: [String(props.cardCount)] },
          )}{" "}
      {props.refreshedAt && (
        <ClientOnly>
          {tr("dashboard.refreshed", {
            args: [dateTime.of(props.refreshedAt).fromNow()],
          })}
        </ClientOnly>
      )}
    </>
  );

  return (
    <div className="mb-5 flex flex-col items-start gap-4 sm:flex-row sm:items-end">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-[-0.02em]">
          {tr("project.dashboard.title")}
        </h1>
        <p className="text-muted-foreground mt-[5px] text-[13px]">
          {standfirst}
        </p>
      </div>
      {/* Inert in the stacked direction, so it is not drawn there. */}
      <span className="hidden flex-1 sm:block" />
      {props.canEdit && !props.computed && (
        <Button
          variant="outlined"
          onClick={props.onToggleEditing}
          data-testid="dashboard-edit"
          aria-pressed={props.editing}
          className="h-8 shrink-0 rounded-[9px] px-3 text-[12.5px]"
        >
          {props.editing ? (
            <Check className="size-3.5" />
          ) : (
            <Pencil className="size-3.5" />
          )}
          {tr(props.editing ? "dashboard.edit.done" : "dashboard.edit")}
        </Button>
      )}
      {/* The computed board is not stored, so it is not edited: it is
          customized, which copies it, once (#Q2660). */}
      {props.canEdit && props.computed && (
        <Button
          variant="outlined"
          onClick={props.onCustomize}
          disabled={props.busy}
          data-testid="dashboard-customize"
          className="h-8 shrink-0 rounded-[9px] px-3 text-[12.5px]"
        >
          <LayoutGrid className="size-3.5" />
          {tr("dashboard.customize")}
        </Button>
      )}
      {props.canEdit && props.editing && !props.computed && (
        <Button
          onClick={props.onAdd}
          data-testid="dashboard-add"
          className="h-8 shrink-0 rounded-[9px] px-3 text-[12.5px]"
        >
          <Plus className="size-3.5" />
          {tr("dashboard.addCard")}
        </Button>
      )}
      {props.canEdit && !props.computed && (
        <ProjectDashboardMenu onReset={props.onReset} busy={props.busy} />
      )}
    </div>
  );
};

export default ProjectDashboardHeader;
