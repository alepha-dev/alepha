import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
} from "../core/DropdownMenu.tsx";
import type { RowAction, RowActionContext } from "./alephaTableTypes.ts";

export interface AlephaTableRowActionItemProps<T> {
  action: RowAction<T>;
  item: T;
  ctx: RowActionContext;
}

/**
 * One menu entry, wherever it sits: at the top level of the row menu or
 * inside a group's submenu. Both render the same way, which is what keeps a
 * `checked` entry from behaving differently depending on where it was put.
 */
export const AlephaTableRowActionItem = <T,>(
  props: AlephaTableRowActionItemProps<T>,
) => {
  const { action, item, ctx } = props;
  const Icon = action.icon;
  const disabled = action.disabled?.(item);
  if (action.checked) {
    return (
      <DropdownMenuCheckboxItem
        // Controlled with no `onCheckedChange`: the write is `onClick`, and
        // the state comes back from the row on the next render. Letting the
        // primitive toggle itself would show a check for a write that has
        // not landed, and would uncheck the current value when it is picked
        // again.
        checked={action.checked(item)}
        disabled={disabled}
        onClick={() => action.onClick(item, ctx)}
      >
        {Icon && <Icon className="mr-2 size-4" />}
        {action.label}
      </DropdownMenuCheckboxItem>
    );
  }
  return (
    <DropdownMenuItem
      disabled={disabled}
      onClick={() => action.onClick(item, ctx)}
      variant={action.destructive ? "destructive" : undefined}
    >
      {Icon && <Icon className="mr-2 size-4" />}
      {action.label}
    </DropdownMenuItem>
  );
};
