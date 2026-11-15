import type { ZObject } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { ArrowDownAZ, ArrowUpAZ, Check } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../core/Popover.tsx";
import { cn } from "../core/utils.ts";
import type { DataTableFilterBarField } from "./DataTableFilterBar.tsx";
import { DataTableHeaderPopupChevron } from "./DataTableHeaderPopupChevron.tsx";
import { DataTableHeaderPopupFilter } from "./DataTableHeaderPopupFilter.tsx";

export interface DataTableHeaderPopupProps {
  /**
   * The table's filter form, the one the bar writes. Absent on a table with
   * no filters: the popup then holds the sort entries alone.
   */
  form?: FormModel<ZObject>;
  /**
   * The column's header text, drawn in the trigger.
   */
  label: ReactNode;
  /**
   * The column's filters: none, one, or the `min` and `max` ends of a range.
   */
  fields: DataTableFilterBarField[];
  /**
   * The column sorts: the popup opens on the two sort entries.
   */
  sortable: boolean;
  /**
   * The order in force on this column, or `null` when it is not sorted.
   */
  sorted: "asc" | "desc" | null;
  onSort: (direction: "asc" | "desc" | null) => void;
  /**
   * Underlined, for a column with a `hint`.
   */
  hinted?: boolean;
}

/**
 * A column's header under `headerPopup`: its name and a small chevron, one
 * button, and the popup it opens.
 *
 * ```text
 * Status ⌄          a dim chevron: the column has a filter
 * Status ⌄          an accent chevron: the filter holds a value
 * Title             a sortable column with no filter: no chevron
 * ```
 *
 * The popup holds, top to bottom: the two sort entries for a sortable column
 * (the order in force ticked, choosing it again removes the sort), the filter
 * drawn in place, and « Reset », which empties the filter and leaves the
 * sort alone.
 *
 * The filter is drawn by kind: a list is a column of checkboxes (its
 * operator switch above them), a `min` / `max` pair two boxes, a text filter
 * one box, and anything else (a date range, a server-searched list) its own
 * `Control`.
 */
export const DataTableHeaderPopup = (props: DataTableHeaderPopupProps) => {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const hasFilter = props.fields.length > 0 && props.form !== undefined;

  const chevron = hasFilter ? (
    <DataTableHeaderPopupChevron form={props.form!} fields={props.fields} />
  ) : null;

  const sortEntry = (direction: "asc" | "desc") => {
    const active = props.sorted === direction;
    const Icon = direction === "asc" ? ArrowUpAZ : ArrowDownAZ;
    return (
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={active}
        data-header-sort={direction}
        onClick={() => {
          props.onSort(active ? null : direction);
          setOpen(false);
        }}
        className="hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm outline-none"
      >
        <Icon className="text-muted-foreground size-4" aria-hidden />
        <span className="flex-1">
          {direction === "asc"
            ? tr("dataTable.sortAsc", { default: "Sort ascending" })
            : tr("dataTable.sortDesc", { default: "Sort descending" })}
        </span>
        <Check
          className={cn("size-4", active ? "opacity-100" : "opacity-0")}
          aria-hidden
        />
      </button>
    );
  };

  const trigger = (
    <button
      type="button"
      data-header-popup=""
      className="hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded-sm outline-none select-none focus-visible:ring-2"
    >
      <span
        className={cn(
          props.hinted &&
            "decoration-muted-foreground/60 underline decoration-dotted underline-offset-4",
        )}
      >
        {props.label}
      </span>
      {chevron}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger}>{trigger.props.children}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-1"
        data-header-popup-content=""
      >
        {props.sortable && (
          <div role="group">
            {sortEntry("asc")}
            {sortEntry("desc")}
          </div>
        )}
        {props.sortable && hasFilter && (
          <div aria-hidden className="bg-border -mx-1 my-1 h-px" />
        )}
        {hasFilter && (
          <DataTableHeaderPopupFilter
            form={props.form!}
            fields={props.fields}
          />
        )}
      </PopoverContent>
    </Popover>
  );
};
