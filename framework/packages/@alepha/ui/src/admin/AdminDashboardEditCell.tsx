import { useI18n } from "alepha/react/i18n";
import { ChevronLeft, ChevronRight, GripVertical, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../core/utils.ts";

export interface AdminDashboardEditCellProps {
  /**
   * The tile's name, as the picker shows it.
   */
  title: string;
  first: boolean;
  last: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onRemove: () => void;
  /**
   * The tile itself, rendered inert.
   */
  children: ReactNode;
}

/**
 * One grid cell in Customize mode: the tile, inert, under a bar holding its
 * drag handle, its move buttons and its remove button.
 *
 * ### The controls wrap the cell, not the tile
 *
 * A tile's `render()` owns its whole surface and is one link, so nothing can
 * be put inside it. The bar sits above it, and the tile underneath is
 * `inert`: a click or Enter never navigates while editing, and its link
 * leaves the tab order, so Tab walks the controls only.
 *
 * Reordering is the kit's: native drag onto a cell, plus the arrows, which
 * are the keyboard and touch path (`DataTableColumnPicker` does the same, on
 * the same `reorderKeys`).
 */
export const AdminDashboardEditCell = (props: AdminDashboardEditCellProps) => {
  const { tr } = useI18n();
  const control =
    "text-muted-foreground hover:text-foreground hover:bg-hover focus-visible:ring-ring/50 rounded p-1 outline-none focus-visible:ring-3 disabled:opacity-30";

  return (
    <div
      data-slot="dashboard-edit-cell"
      draggable
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => {
        // Required, or the drop never fires.
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        props.onDrop();
      }}
      className={cn(
        "border-border flex flex-col gap-2 rounded-xl border border-dashed p-2",
        props.dragging && "opacity-45",
      )}
    >
      <div className="flex items-center gap-1">
        <GripVertical
          className="text-muted-foreground/60 size-4 shrink-0 cursor-grab"
          aria-hidden
        />
        <span className="flex-1 truncate text-sm font-medium">
          {props.title}
        </span>
        <button
          type="button"
          className={control}
          disabled={props.first}
          aria-label={tr("admin.dashboard.moveEarlier", {
            default: "Move $1 earlier",
            args: [props.title],
          })}
          onClick={props.onMoveEarlier}
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          className={control}
          disabled={props.last}
          aria-label={tr("admin.dashboard.moveLater", {
            default: "Move $1 later",
            args: [props.title],
          })}
          onClick={props.onMoveLater}
        >
          <ChevronRight className="size-4" />
        </button>
        <button
          type="button"
          className={control}
          aria-label={tr("admin.dashboard.removeTile", {
            default: "Remove $1",
            args: [props.title],
          })}
          onClick={props.onRemove}
        >
          <X className="size-4" />
        </button>
      </div>
      <div inert className="pointer-events-none">
        {props.children}
      </div>
    </div>
  );
};
