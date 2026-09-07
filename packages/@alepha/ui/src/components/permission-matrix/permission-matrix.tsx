import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@alepha/ui/components/ui/table";
import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

import { PermissionMatrixGroupRows } from "./permission-matrix-group-rows.tsx";

export interface PermissionMatrixProps {
  /**
   * The rows, already grouped and already filtered.
   *
   * ⚠️ **Filtering is the caller's job.** Lore hides the permissions of a
   * capability that is switched off; Alepha Club has no capability concept and
   * shows all of its groups. A `capabilities` prop here would be a
   * Lore-shaped idea that every other consumer passes `undefined` to forever,
   * so this component renders the groups it is handed and asks nothing about
   * where they came from.
   */
  groups: PermissionMatrixGroup[];

  /**
   * The columns, left to right. One per rank.
   */
  columns: PermissionMatrixColumn[];

  /**
   * What each column currently grants, keyed by {@link PermissionMatrixColumn.key}.
   *
   * A column missing from the record grants nothing, which is the same thing
   * as an empty array - a caller building this from a server response does not
   * have to fill in the ranks that hold no permission.
   */
  value: Record<string, readonly string[]>;

  /**
   * Called with the WHOLE record on every tick, not with a delta.
   *
   * The caller owns the save, so the module's refusals ("that set is wider
   * than your own") arrive as ordinary form errors on the page rather than as
   * a state this component would have to model.
   */
  onChange: (next: Record<string, string[]>) => void;

  /**
   * Header above the permission column. A label, not a placeholder: the
   * component carries no copy of its own.
   */
  header?: ReactNode;

  /**
   * Shown in place of the table when {@link groups} is empty - every
   * capability off, or a filter that matched nothing.
   */
  empty?: ReactNode;

  /**
   * Turns every cell off, on top of whatever the columns and rows say.
   * A save in flight, or a reader who may look and not edit.
   */
  disabled?: boolean;

  className?: string;
}

/**
 * Who may do what, as a table: permissions down the left, one column per rank,
 * a checkbox at each crossing.
 *
 * It lives here rather than in either application because two of them need the
 * same table. Lore renders it for a project's ranks; Alepha Club renders it for
 * the club's. What differs between them is entirely in the props.
 *
 * ## What the component deliberately does not know
 *
 * **It does not know what an owner is.** A column that must read all-on and
 * refuse edits is marked `readOnly` by the caller. Teaching the table about
 * ownership would put an application's model inside a component that two
 * applications with different models both use.
 *
 * **It does not know what a capability is.** See {@link PermissionMatrixProps.groups}.
 *
 * **It carries no copy.** Every label is a `ReactNode` the caller supplies,
 * already translated, so an application whose only locale is French renders a
 * French matrix without this package shipping a catalogue.
 *
 * ## The two kinds of locked row
 *
 * A permission can be non-negotiable in either direction, and both are common
 * enough to be data rather than a caller's own rendering:
 *
 * - `lock: "on"` is a **floor** - the permission every rank holds, so the row
 *   is checked everywhere and cannot be unticked (Lore's `project:read`: a
 *   member who cannot read the project is not a member).
 * - `lock: "off"` is a **ceiling** - the permission no rank may be granted, so
 *   the row is unchecked everywhere and cannot be ticked (Lore's
 *   `project:delete`, which belongs to ownership and is transferred rather
 *   than granted).
 *
 * A `readOnly` column beats both: an owner column reads all-on including the
 * ceiling rows, because the ceiling describes what may be GRANTED, not what
 * the owner has.
 */
export const PermissionMatrix = (props: PermissionMatrixProps) => {
  const granted = (columnKey: string, permission: string): boolean =>
    (props.value[columnKey] ?? []).includes(permission);

  const toggle = (
    columnKey: string,
    permission: string,
    next: boolean,
  ): void => {
    const held = props.value[columnKey] ?? [];
    const without = held.filter((it) => it !== permission);

    props.onChange({
      // Every column, not only the one that moved: the caller saves a record
      // and a partial one would silently drop the ranks nobody touched.
      ...Object.fromEntries(
        Object.entries(props.value).map(([key, list]) => [key, [...list]]),
      ),
      [columnKey]: next ? [...without, permission] : without,
    });
  };

  if (props.groups.length === 0) {
    return (
      <div className="text-muted-foreground p-6 text-center text-sm">
        {props.empty}
      </div>
    );
  }

  return (
    <div className={cn("w-full overflow-x-auto", props.className)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">{props.header}</TableHead>
            {props.columns.map((column) => (
              <TableHead key={column.key} className="text-center">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="font-medium">{column.label}</span>
                  {column.description ? (
                    <span className="text-muted-foreground text-xs font-normal">
                      {column.description}
                    </span>
                  ) : null}
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.groups.map((group) => (
            <PermissionMatrixGroupRows
              key={group.key}
              group={group}
              columns={props.columns}
              disabled={props.disabled === true}
              granted={granted}
              toggle={toggle}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export interface PermissionMatrixGroup {
  /**
   * Stable identity for the group. Never rendered: {@link label} is.
   */
  key: string;

  label: ReactNode;

  permissions: PermissionMatrixRow[];
}

export interface PermissionMatrixRow {
  /**
   * The permission as it is stored and sent, e.g. `quest:create`. This is the
   * value that lands in {@link PermissionMatrixProps.value}.
   */
  name: string;

  label: ReactNode;

  description?: ReactNode;

  /**
   * Pins this row in one state on every column. See the component's doc for
   * why a floor and a ceiling are both worth expressing.
   */
  lock?: "on" | "off";
}

export interface PermissionMatrixColumn {
  /**
   * The key this column's grants are stored under in
   * {@link PermissionMatrixProps.value}. A rank key, for both consumers.
   */
  key: string;

  label: ReactNode;

  description?: ReactNode;

  /**
   * All-on and not editable.
   *
   * The caller marks it; the component does not know what an owner is, or that
   * such a column exists at all until it is handed one.
   */
  readOnly?: boolean;
}
