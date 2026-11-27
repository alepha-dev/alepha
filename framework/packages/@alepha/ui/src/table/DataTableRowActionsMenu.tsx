import { useI18n } from "alepha/react/i18n";
import { MoreVertical } from "lucide-react";

import { Button } from "../core/Button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";
import {
  DataTableRowActionGroupItem,
  hasRowAction,
  isRowActionGroup,
} from "./DataTableRowActionGroupItem.tsx";
import { DataTableRowActionItem } from "./DataTableRowActionItem.tsx";
import type { RowActionContext, RowActionEntry } from "./dataTableTypes.ts";

export interface DataTableRowActionsMenuProps<T> {
  actions: RowActionEntry<T>[];
  item: T;
  ctx: RowActionContext;
}

/**
 * The three-dots menu at the end of a row, a group drawn as a submenu (and
 * a group inside it as a submenu of that). Renders nothing when no entry
 * survives.
 */
export const DataTableRowActionsMenu = <T,>(
  props: DataTableRowActionsMenuProps<T>,
) => {
  const { tr } = useI18n();
  // ⚠️ Effective entries, not entries: a group is one entry however many
  // children it has, so a lone empty group would otherwise render the
  // three-dots trigger over an empty menu.
  const effective = props.actions.filter(hasRowAction);
  if (effective.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="minimal"
            size="icon"
            aria-label={tr("dataTable.openRowActions", {
              default: "Open row actions",
            })}
          />
        }
      >
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {effective.map((action, idx) => {
          // A separator above an entry when the one before asked for it
          // (`separatorAfter`), or above the first of a run of destructive
          // entries. A group is never destructive, so the previous entry
          // being one reads as falsy here and the rule needs no case for it.
          const previous = effective[idx - 1];
          const previousAction =
            previous && !isRowActionGroup(previous) ? previous : undefined;
          const sep =
            idx > 0 &&
            (!!previousAction?.separatorAfter ||
              (!isRowActionGroup(action) &&
                !!action.destructive &&
                !previousAction?.destructive));
          return (
            <span key={action.label}>
              {sep && <DropdownMenuSeparator />}
              {isRowActionGroup(action) ? (
                <DataTableRowActionGroupItem
                  group={action}
                  item={props.item}
                  ctx={props.ctx}
                />
              ) : (
                <DataTableRowActionItem
                  action={action}
                  item={props.item}
                  ctx={props.ctx}
                />
              )}
            </span>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
