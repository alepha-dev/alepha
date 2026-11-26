import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { Check, Pencil, Plus } from "lucide-react";
import type { ReactNode } from "react";

import type { DashboardPreset } from "../../../../../api/schemas/DashboardPresetCatalog.ts";
import type { I18n } from "../../../services/I18n.ts";
import ProjectDashboardMenu from "./ProjectDashboardMenu.tsx";
import ProjectDashboardWindow from "./ProjectDashboardWindow.tsx";

export interface ProjectDashboardHeaderProps {
  /**
   * What opens the row, left of the controls: the dashboard selector
   * (#Q3300). The dormant line sits under the bar, not here. The page title
   * is not repeated, since the breadcrumb already names the page.
   */
  lead?: ReactNode;
  /**
   * Whether this is the project's first dashboard, the only one with a
   * default: "Reset to default" is offered there alone (#Q3300), since its
   * confirmation promises the computed board.
   */
  first?: boolean;
  /**
   * Whether the viewer may curate the board. Absent means the Add button is
   * not rendered at all, rather than rendered disabled.
   */
  canEdit: boolean;
  /**
   * Whether the reader is looking at the computed default board (#Q2652).
   * It offers Edit and Add card like a stored one (#Q3675): the first of them
   * stores it, which the page does, so the reader never meets the
   * distinction. Only "Reset to default" waits for a stored board.
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
   * Delete the stored cards, back to the computed board (#Q2660).
   */
  onReset: () => void;
  /**
   * Apply a preset to this board, and start a new board from one (#Q3831).
   */
  onApplyPreset: (preset: DashboardPreset) => void;
  onCreateFromPreset: (preset: DashboardPreset) => void;
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
 * list in the app. The dashboard selector on the left; the window, Add card,
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
      data-computed={props.computed ? "true" : undefined}
      className="[&_:is(input,[role=combobox])]:bg-background dark:[&_:is(input,[role=combobox])]:bg-background chrome flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
    >
      {props.lead && <div className="min-w-0 px-1">{props.lead}</div>}
      <span className="flex-1" />
      <div className="w-36 shrink-0">
        <ProjectDashboardWindow onChange={props.onWindowChange} />
      </div>
      {/* No Customize step (#Q3675): Add card and Edit are offered on the
          computed board too, and the page stores it on the first. */}
      {/* Add card and Edit / Save are minimal icon buttons (#Q4442), sized
          and coloured like the "…" menu trigger beside them; the label is
          their accessible name and their tooltip. */}
      {props.canEdit && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="minimal"
                size="icon-sm"
                onClick={props.onAdd}
                disabled={props.busy}
                data-testid="dashboard-add"
                aria-label={tr("dashboard.addCard")}
                className="text-muted-foreground shrink-0"
              >
                <Plus className="size-4" />
              </Button>
            }
          />
          <TooltipContent>{tr("dashboard.addCard")}</TooltipContent>
        </Tooltip>
      )}
      {/* Save leaves edit mode. Every edit is already stored as it is made
          (a move, a resize, an added card), so there is nothing to flush:
          the button names the moment the reader is done. In edit mode it
          stays pressed, with the hover background, so the mode shows
          without a border or a solid fill. */}
      {props.canEdit && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="minimal"
                size="icon-sm"
                onClick={props.onToggleEditing}
                disabled={props.busy}
                data-testid="dashboard-edit"
                aria-pressed={props.editing}
                aria-label={tr(
                  props.editing ? "dashboard.save" : "dashboard.edit",
                )}
                className="text-muted-foreground aria-pressed:bg-hover aria-pressed:text-foreground shrink-0"
              >
                {props.editing ? (
                  <Check className="size-4" />
                ) : (
                  <Pencil className="size-4" />
                )}
              </Button>
            }
          />
          <TooltipContent>
            {tr(props.editing ? "dashboard.save" : "dashboard.edit")}
          </TooltipContent>
        </Tooltip>
      )}
      {props.canEdit && (
        <ProjectDashboardMenu
          // Reset only where there is a computed board to go back to.
          onReset={
            props.first !== false && !props.computed ? props.onReset : undefined
          }
          onApplyPreset={props.onApplyPreset}
          onCreateFromPreset={props.onCreateFromPreset}
          busy={props.busy}
        />
      )}
    </div>
  );
};

export default ProjectDashboardHeader;
