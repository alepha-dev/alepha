import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import { TableCell, TableRow } from "@alepha/ui/components/ui/table";

import type {
  PermissionMatrixColumn,
  PermissionMatrixGroup,
} from "./permission-matrix.tsx";

export interface PermissionMatrixGroupRowsProps {
  group: PermissionMatrixGroup;

  columns: PermissionMatrixColumn[];

  disabled: boolean;

  granted: (columnKey: string, permission: string) => boolean;

  toggle: (columnKey: string, permission: string, next: boolean) => void;
}

/**
 * One group's heading row and the permission rows under it.
 *
 * Its own component rather than a loop body inside {@link PermissionMatrix}
 * so the heading's `colSpan` is computed in one place: it has to span the
 * permission column plus every rank, and a heading that stops short of the
 * last column reads as a table with a missing cell.
 */
export const PermissionMatrixGroupRows = (
  props: PermissionMatrixGroupRowsProps,
) => {
  return (
    <>
      <TableRow className="hover:bg-transparent">
        <TableCell
          colSpan={props.columns.length + 1}
          className="bg-muted/40 text-muted-foreground py-1.5 text-xs font-medium tracking-wide uppercase"
        >
          {props.group.label}
        </TableCell>
      </TableRow>
      {props.group.permissions.map((permission) => (
        <TableRow key={permission.name}>
          <TableCell>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">{permission.label}</span>
              {permission.description ? (
                <span className="text-muted-foreground text-xs">
                  {permission.description}
                </span>
              ) : null}
            </div>
          </TableCell>
          {props.columns.map((column) => {
            // ⚠️ A read-only column beats a locked row, in both directions. The
            // ceiling says what may be GRANTED to a rank; the column that is
            // granted nothing - an owner - is not narrowed by it, and showing
            // that column half-ticked would say the opposite of what it means.
            const checked = column.readOnly
              ? true
              : permission.lock === "on"
                ? true
                : permission.lock === "off"
                  ? false
                  : props.granted(column.key, permission.name);

            const locked =
              props.disabled || column.readOnly === true || !!permission.lock;

            return (
              <TableCell key={column.key} className="text-center">
                <Checkbox
                  checked={checked}
                  disabled={locked}
                  // The stored name, not the label: a screen reader hears the
                  // permission this cell actually grants, and a test can find
                  // one cell out of a hundred without depending on copy.
                  aria-label={permission.name}
                  onCheckedChange={(next) =>
                    props.toggle(column.key, permission.name, next === true)
                  }
                />
              </TableCell>
            );
          })}
        </TableRow>
      ))}
    </>
  );
};
