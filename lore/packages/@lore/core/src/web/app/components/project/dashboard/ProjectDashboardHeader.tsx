import { Button } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { Check, LayoutGrid, Pencil, Plus } from "lucide-react";
import type { ReactNode } from "react";

import type { I18n } from "../../../services/I18n.ts";
import ProjectDashboardMenu from "./ProjectDashboardMenu.tsx";
import ProjectDashboardWindow from "./ProjectDashboardWindow.tsx";

export interface ProjectDashboardHeaderProps {
  /**
   * What opens the row, left of the controls: the computed board's headline
   * or the dormant line. The page title is not repeated here, since the
   * breadcrumb already names the page.
   */
  lead?: ReactNode;
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
   * Whether the board is in edit mode: the card menus and drag, and the
   * tiles that have nothing to show, collapsed with their reason (#Q2649).
   */
  editing: boolean;
  /**
   * Edit turns edit mode on, Save turns it off.
   */
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
   * The reader picked another time window (#Q2661).
   */
  onWindowChange: (days: "7" | "14" | "30") => void;
  /**
   * True while a board write runs.
   */
  busy?: boolean;
}

/**
 * The project board's own header, drawn as a chrome bar: the same muted band,
 * border and bevel as a `DataTable`'s toolbar, so the board opens like every
 * list in the app. The opening line on the left; the window, Add card,
 * Edit / Save and the menu on the right.
 *
 * ⚠️ **Not `DashboardHeader`.** That one greets the account by name, which is
 * exactly wrong on a board that belongs to the project and is read by
 * everybody in it - "Welcome back, Nicolas" over a shared surface reads as a
 * personal board. It also carried Reset, which is gone from both boards
 * (#Q2145), and the account cluster, which the project shell already renders.
 */
const ProjectDashboardHeader = (props: ProjectDashboardHeaderProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    // The bar's classes are `DataTableToolbar`'s own, laid edge to edge
    // across the page with a bottom rule instead of a rounded box: it is the
    // page's bar, not a block inside the content. `px-3` is the content's
    // own gutter, so the bar's ends line up with the tiles'.
    <div
      data-testid="dashboard-header"
      className="bg-muted [&_:is(input,[role=combobox])]:bg-background dark:[&_:is(input,[role=combobox])]:bg-background flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 shadow-[inset_0_1px_0_0_var(--bevel)]"
    >
      {props.lead && <div className="min-w-0 px-1">{props.lead}</div>}
      <span className="flex-1" />
      <div className="w-40 shrink-0">
        <ProjectDashboardWindow onChange={props.onWindowChange} />
      </div>
      {/* The computed board is not stored, so it is not edited: it is
          customized, which copies it, once (#Q2660). */}
      {props.canEdit && props.computed && (
        <Button
          variant="outlined"
          onClick={props.onCustomize}
          disabled={props.busy}
          data-testid="dashboard-customize"
          className="h-9 shrink-0 px-3"
        >
          <LayoutGrid className="size-4" />
          {tr("dashboard.customize")}
        </Button>
      )}
      {props.canEdit && !props.computed && (
        <Button
          variant="outlined"
          onClick={props.onAdd}
          disabled={props.busy}
          data-testid="dashboard-add"
          className="h-9 shrink-0 px-3"
        >
          <Plus className="size-4" />
          {tr("dashboard.addCard")}
        </Button>
      )}
      {/* Save leaves edit mode. Every edit is already stored as it is made
          (a move, a resize, an added card), so there is nothing to flush:
          the button names the moment the reader is done. */}
      {props.canEdit && !props.computed && (
        <Button
          variant={props.editing ? "solid" : "outlined"}
          onClick={props.onToggleEditing}
          disabled={props.busy}
          data-testid="dashboard-edit"
          aria-pressed={props.editing}
          className="h-9 shrink-0 px-3"
        >
          {props.editing ? (
            <Check className="size-4" />
          ) : (
            <Pencil className="size-4" />
          )}
          {tr(props.editing ? "dashboard.save" : "dashboard.edit")}
        </Button>
      )}
      {props.canEdit && !props.computed && (
        <ProjectDashboardMenu onReset={props.onReset} busy={props.busy} />
      )}
    </div>
  );
};

export default ProjectDashboardHeader;
