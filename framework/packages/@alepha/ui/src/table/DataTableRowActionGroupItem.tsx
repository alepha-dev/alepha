import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../core/DropdownMenu.tsx";
import { DataTableRowActionItem } from "./DataTableRowActionItem.tsx";
import type {
  RowActionContext,
  RowActionEntry,
  RowActionGroup,
} from "./dataTableTypes.ts";

export interface DataTableRowActionGroupItemProps<T> {
  group: RowActionGroup<T>;
  item: T;
  ctx: RowActionContext;
}

/**
 * A row action group as a submenu: its trigger, then its children, each an
 * action or a group of its own, drawn the same way one level further in.
 * An empty child group is left out, as the row menu leaves out an empty
 * group.
 */
export const DataTableRowActionGroupItem = <T,>(
  props: DataTableRowActionGroupItemProps<T>,
) => {
  const Icon = props.group.icon;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {Icon && <Icon className="me-2 size-4" />}
        {props.group.label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {props.group.children
          .filter(hasRowAction)
          .map((child) =>
            isRowActionGroup(child) ? (
              <DataTableRowActionGroupItem
                key={child.label}
                group={child}
                item={props.item}
                ctx={props.ctx}
              />
            ) : (
              <DataTableRowActionItem
                key={child.label}
                action={child}
                item={props.item}
                ctx={props.ctx}
              />
            ),
          )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};

/**
 * Whether an entry is a group rather than an action: it has `children`.
 */
export function isRowActionGroup<T>(
  entry: RowActionEntry<T>,
): entry is RowActionGroup<T> {
  return "children" in entry;
}

/**
 * Whether an entry holds anything to click: an action does, a group does
 * when one of its children does, at any depth.
 */
export function hasRowAction<T>(entry: RowActionEntry<T>): boolean {
  return isRowActionGroup(entry) ? entry.children.some(hasRowAction) : true;
}
