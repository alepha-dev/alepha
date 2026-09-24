import { useI18n } from "alepha/react/i18n";
import { Loader2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "../core/Button.tsx";
import { DataTableBulkMenu } from "./DataTableBulkMenu.tsx";
import type {
  BulkAction,
  BulkActionContext,
  BulkMenuAction,
} from "./dataTableTypes.ts";

export interface DataTableBulkBarProps<T> {
  /**
   * The selection across every page, as `useTableSelection` holds it. Only
   * its size is read here.
   */
  selection: ReadonlyMap<string, T>;
  selectedItems: T[];
  /**
   * The bulk actions offered for this selection, already narrowed by their
   * `visible` predicate.
   */
  visibleBulkActions: Array<BulkAction<T> | BulkMenuAction<T>>;
  bulkCtx: BulkActionContext;
  clearSelection: () => void;
}

/**
 * The floating pill of bulk actions, shown while rows are selected.
 *
 * An action whose `onClick` returns a promise holds the pill until it
 * settles: every button is disabled and the running one spins, so a bulk
 * write cannot be sent twice by a second click while the first is on the
 * wire.
 */
export const DataTableBulkBar = <T,>(props: DataTableBulkBarProps<T>) => {
  const {
    selection,
    selectedItems,
    visibleBulkActions,
    bulkCtx,
    clearSelection,
  } = props;
  const { tr } = useI18n();
  // The label of the action whose promise is pending, if any.
  const [running, setRunning] = useState<string>();

  const run = async (action: BulkAction<T>) => {
    const result = action.onClick(selectedItems, bulkCtx);
    if (!(result instanceof Promise)) return;
    setRunning(action.label);
    try {
      await result;
    } finally {
      setRunning(undefined);
    }
  };

  return (
    // Linear-style floating action pill: fixed at the bottom-center of
    // the viewport, dark surface that stays readable in both themes
    // because the colors are hard-coded (theme-relative `bg-foreground`
    // inverts awkwardly against a white container in dark mode).
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
      <div className="animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-auto flex items-center gap-2 rounded-full bg-zinc-900 px-3 py-1.5 text-zinc-100 shadow-lg ring-1 ring-white/10 duration-150">
        <span className="pl-2 text-sm">
          {tr("dataTable.selected", {
            default: `${selection.size} selected`,
            args: [String(selection.size)],
          })}
        </span>
        <span className="mx-1 h-4 w-px bg-white/20" />
        {visibleBulkActions.map((action) => {
          if ("items" in action) {
            return (
              <DataTableBulkMenu<T>
                key={action.label}
                action={action}
                selected={selectedItems}
                ctx={bulkCtx}
              />
            );
          }
          const ActionIcon = action.icon;
          const count = action.count?.(selectedItems);
          // Never the default solid primary: its darker-than-fill border,
          // gradient and top highlight survive a `bg-*` override and draw a
          // blue ring on this dark pill. `minimal` carries none of them, so a
          // destructive action paints its red fill onto that instead.
          return (
            <Button
              key={action.label}
              size="sm"
              variant="minimal"
              intent={action.destructive ? "danger" : "none"}
              className={
                action.destructive
                  ? "h-8 bg-red-600 text-white hover:bg-red-500 hover:text-white"
                  : "h-8 text-zinc-100 hover:bg-white/10 hover:text-zinc-100"
              }
              disabled={running !== undefined}
              onClick={() => void run(action)}
            >
              {running === action.label ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                ActionIcon && <ActionIcon className="size-4" />
              )}
              {action.label}
              {count !== undefined && (
                // The space keeps the accessible name "Shelve 3", not
                // "Shelve3"; the flex gap does the visual spacing.
                <>
                  {" "}
                  <span className="tabular-nums opacity-70">{count}</span>
                </>
              )}
            </Button>
          );
        })}
        <span className="mx-1 h-4 w-px bg-white/20" />
        <Button
          size="icon"
          variant="minimal"
          className="size-8 rounded-full text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
          onClick={clearSelection}
          aria-label={tr("dataTable.clearSelection", {
            default: "Clear selection",
          })}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
};
