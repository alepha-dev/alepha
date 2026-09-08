import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import { TableCell, TableRow } from "@alepha/ui/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { cn } from "@alepha/ui/lib/utils";
import { Lock } from "lucide-react";

import type {
  PermissionMatrixColumn,
  PermissionMatrixGroup,
  PermissionMatrixRow,
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
  const Icon = props.group.icon;

  return (
    <>
      {/* The heading is chrome, so it wears the chrome surface: `bg-muted`
          under a `--bevel` line, the pair the table header and `PlateTabBar`
          already use. Opaque rather than the `/40` it carried before, because
          a band that is nearly the row colour reads as a row with odd text
          rather than as a divider between two sets of rows. */}
      <TableRow className="hover:bg-transparent">
        <TableCell
          colSpan={props.columns.length + 1}
          className="bg-muted text-muted-foreground py-1.5 text-xs font-medium tracking-wide uppercase shadow-[inset_0_1px_0_0_var(--bevel)]"
        >
          <div className="flex items-center gap-2">
            {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
            {props.group.label}
            {/* Derived, not a prop: it is the length of the array the caller
                already passed, and a count that could disagree with the rows
                under it is worse than no count. */}
            <span className="text-muted-foreground/70 font-mono text-[11px] font-normal">
              {props.group.permissions.length}
            </span>
          </div>
        </TableCell>
      </TableRow>
      {props.group.permissions.map((permission) => (
        <TableRow key={permission.name}>
          <TableCell>
            <div className="flex flex-col gap-0.5">
              <PermissionMatrixRowLabel permission={permission} />
              {/* The stored name, under the label, in mono. It is what the
                  row actually grants and what a reader has to match against
                  an API response or a rank's saved set, so it is worth a line
                  rather than being knowable only from the DOM. */}
              <code className="text-muted-foreground font-mono text-[11px]">
                {permission.name}
              </code>
            </div>
          </TableCell>
          {props.columns.map((column) => {
            const checked = permissionChecked(
              column,
              permission,
              props.granted,
            );

            const locked =
              props.disabled || column.readOnly === true || !!permission.lock;

            // A crossing that is closed rather than merely empty. An unchecked
            // box that cannot be ticked is an invitation to try; a padlock
            // inside it says the answer is settled.
            const closed = locked && !checked;

            const box = (
              <Checkbox
                checked={checked}
                disabled={locked}
                // ⚠️ `data-disabled`, not `disabled`. The primitive already
                // carries `disabled:opacity-50`, but Base UI renders the box
                // as a `<span data-disabled>` and puts the real `disabled` on
                // a hidden input, so that variant only ever fires for a
                // checkbox inside a `field-label` group. Standalone - which is
                // every cell here - a locked box looked exactly like an
                // editable one, and the owner column read as if someone had
                // ticked all of it by hand.
                //
                // Fixed here rather than in `components/ui/checkbox.tsx`,
                // which `yarn w @alepha/ui sync` overwrites wholesale. The
                // durable package-wide home is `styles.css`, but that is a
                // change to every checkbox in every app and not this
                // component's call to make.
                //
                // `mx-auto` because the cell's `text-center` does not reach
                // it: Base UI renders the box as a `display:flex` element,
                // which is a block-level box and ignores the inline centring a
                // `<td>` hands down. It sat left of centre in every column.
                //
                // `size-5` over the primitive's `size-4`: this table is a grid
                // of nothing but checkboxes, so they are the content rather
                // than an adornment beside a label. The tick is pushed with it
                // - `!` because the primitive sets it on the indicator at the
                // same specificity, and same-specificity rules are settled by
                // CSS source order, which is not a thing to bet on.
                className={cn(
                  "mx-auto size-5 [&_svg]:size-4!",
                  // Not on a closed cell: there the padlock carries the
                  // meaning, and fading the square with it makes a 20px box
                  // look smaller than the 20px box beside it.
                  !closed && "data-disabled:opacity-50",
                )}
                // The stored name, not the label: a screen reader hears the
                // permission this cell actually grants, and a test can find
                // one cell out of a hundred without depending on copy.
                aria-label={permission.name}
                onCheckedChange={(next) =>
                  props.toggle(column.key, permission.name, next === true)
                }
              />
            );

            return (
              <TableCell
                key={column.key}
                className="border-border/60 border-l pr-2! text-center"
              >
                {closed ? (
                  // The real checkbox underneath, with the padlock laid over
                  // it, rather than a lock-shaped thing of its own: the box,
                  // its border, its radius and its dark-mode fill stay the
                  // primitive's and cannot drift from the cell beside it. It
                  // also keeps the cell a labelled checkbox for a screen
                  // reader instead of an unlabelled picture.
                  <span
                    data-slot="permission-locked"
                    className="relative mx-auto flex size-5 items-center justify-center"
                  >
                    {box}
                    {/* The GLYPH is muted, not the square. Fading the whole
                        thing halved the border too, and a 1px border at half
                        strength beside a full-strength one reads as a smaller
                        box - the two are the same 20px, but they do not look
                        it. The padlock already says the cell is closed, so the
                        fade was saying it twice and lying about the size to do
                        it. */}
                    <Lock
                      aria-hidden
                      className="text-muted-foreground pointer-events-none absolute size-3"
                    />
                  </span>
                ) : (
                  box
                )}
              </TableCell>
            );
          })}
        </TableRow>
      ))}
    </>
  );
};

export interface PermissionMatrixRowLabelProps {
  permission: PermissionMatrixRow;
}

/**
 * A permission's label, carrying its `description` as a tooltip.
 *
 * A tooltip rather than a second line, because the mono permission name now
 * owns that line and a third one turns a dense table into a loose one.
 *
 * The trigger is Base UI's default (a button) with a dotted underline rather
 * than a bare `<span>`: a span is not focusable, so a description hung on one
 * is reachable with a mouse and by nothing else. The underline is what keeps
 * a focusable element from reading as an action - it is the abbreviation
 * affordance, "there is more to know here", not "this does something".
 *
 * Needs a `TooltipProvider` above it, like every other tooltip in this
 * package; `apps/ui` and `apps/lore` both mount one in their layout.
 */
const PermissionMatrixRowLabel = (props: PermissionMatrixRowLabelProps) => {
  if (!props.permission.description) {
    return <span className="text-sm">{props.permission.label}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger className="decoration-muted-foreground/60 w-fit cursor-default text-left text-sm underline decoration-dotted underline-offset-4">
        {props.permission.label}
      </TooltipTrigger>
      <TooltipContent>{props.permission.description}</TooltipContent>
    </Tooltip>
  );
};

/**
 * Whether one cell reads checked.
 *
 * Shared with {@link PermissionMatrix}, which needs the same answer for every
 * cell in a column to size that column's coverage bar. Deriving it twice is
 * how a bar comes to disagree with the boxes above it.
 *
 * ⚠️ A read-only column beats a locked row, in both directions. The ceiling
 * says what may be GRANTED to a rank; the column that is granted nothing - an
 * owner - is not narrowed by it, and showing that column half-ticked would say
 * the opposite of what it means.
 */
export const permissionChecked = (
  column: PermissionMatrixColumn,
  permission: PermissionMatrixRow,
  granted: (columnKey: string, permission: string) => boolean,
): boolean =>
  column.readOnly
    ? true
    : permission.lock === "on"
      ? true
      : permission.lock === "off"
        ? false
        : granted(column.key, permission.name);
