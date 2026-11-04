import { Button } from "../core/Button.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../core/Tooltip.tsx";
import { DataTableRowActionsMenu } from "./DataTableRowActionsMenu.tsx";
import type {
  RowAction,
  RowActionContext,
  RowActionEntry,
  RowActionGroup,
} from "./dataTableTypes.ts";

export interface DataTableRowActionsInlineProps<T> {
  actions: RowActionEntry<T>[];
  item: T;
  ctx: RowActionContext;
}

/**
 * A row's actions as a line of icon buttons, for `rowActionsDisplay="inline"`:
 * each one outlined, named by a tooltip from its `label`, red when it is
 * `destructive`.
 *
 * A group cannot be one button, so the groups keep a three-dots menu of
 * their own after the buttons. A `checked` entry is a toggle: its button
 * carries `aria-pressed`.
 */
export const DataTableRowActionsInline = <T,>(
  props: DataTableRowActionsInlineProps<T>,
) => {
  const actions = props.actions.filter(
    (entry): entry is RowAction<T> => !("children" in entry),
  );
  const groups = props.actions.filter(
    (entry): entry is RowActionGroup<T> => "children" in entry,
  );
  if (actions.length === 0 && groups.length === 0) return null;
  return (
    <TooltipProvider>
      <div className="flex items-center justify-end gap-1">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Tooltip key={action.label}>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="outlined"
                    intent={action.destructive ? "danger" : undefined}
                    size={Icon ? "icon" : "sm"}
                    aria-label={action.label}
                    aria-pressed={
                      action.checked ? action.checked(props.item) : undefined
                    }
                    disabled={action.disabled?.(props.item)}
                    onClick={() => action.onClick(props.item, props.ctx)}
                  />
                }
              >
                {Icon ? <Icon className="size-4" /> : action.label}
              </TooltipTrigger>
              <TooltipContent>{action.label}</TooltipContent>
            </Tooltip>
          );
        })}
        {groups.length > 0 ? (
          <DataTableRowActionsMenu
            actions={groups}
            item={props.item}
            ctx={props.ctx}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
};
