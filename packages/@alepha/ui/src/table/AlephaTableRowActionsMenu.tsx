import { useI18n } from "alepha/react/i18n";
import { MoreVertical } from "lucide-react";

import { Button } from "../core/Button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";
import { AlephaTableRowActionItem } from "./AlephaTableRowActionItem.tsx";
import type {
  RowActionContext,
  RowActionEntry,
  RowActionGroup,
} from "./alephaTableTypes.ts";

export interface AlephaTableRowActionsMenuProps<T> {
  actions: RowActionEntry<T>[];
  item: T;
  ctx: RowActionContext;
}

/**
 * The three-dots menu at the end of a row, with one level of submenus for
 * groups. Renders nothing when no entry survives.
 */
export const AlephaTableRowActionsMenu = <T,>(
  props: AlephaTableRowActionsMenuProps<T>,
) => {
  const { tr } = useI18n();
  // ⚠️ Effective entries, not entries: a group is one entry however many
  // children it has, so a lone empty group would otherwise render the
  // three-dots trigger over an empty menu.
  const effective = props.actions.filter((action) =>
    isRowActionGroup(action) ? action.children.length > 0 : true,
  );
  if (effective.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={tr("alephaTable.openRowActions", {
              default: "Open row actions",
            })}
          />
        }
      >
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {effective.map((action, idx) => {
          const Icon = action.icon;
          if (isRowActionGroup(action)) {
            return (
              <DropdownMenuSub key={action.label}>
                <DropdownMenuSubTrigger>
                  {Icon && <Icon className="mr-2 size-4" />}
                  {action.label}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {action.children.map((child) => (
                    <AlephaTableRowActionItem
                      key={child.label}
                      action={child}
                      item={props.item}
                      ctx={props.ctx}
                    />
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          }
          // A group is never destructive, so the previous entry being one
          // reads as falsy here and the separator rule needs no case for it.
          const previous = effective[idx - 1];
          const sep =
            idx > 0 &&
            action.destructive &&
            !(previous && !isRowActionGroup(previous) && previous.destructive);
          return (
            <span key={action.label}>
              {sep && <DropdownMenuSeparator />}
              <AlephaTableRowActionItem
                action={action}
                item={props.item}
                ctx={props.ctx}
              />
            </span>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

function isRowActionGroup<T>(
  entry: RowActionEntry<T>,
): entry is RowActionGroup<T> {
  return "children" in entry;
}
