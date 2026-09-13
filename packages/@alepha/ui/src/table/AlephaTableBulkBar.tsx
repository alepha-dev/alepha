import { useI18n } from "alepha/react/i18n";
import { X } from "lucide-react";

import { Button } from "../core/Button.tsx";
import { AlephaTableBulkMenu } from "./AlephaTableBulkMenu.tsx";
import type {
  BulkAction,
  BulkActionContext,
  BulkMenuAction,
} from "./alephaTableTypes.ts";

export interface AlephaTableBulkBarProps<T> {
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
 */
export const AlephaTableBulkBar = <T,>(props: AlephaTableBulkBarProps<T>) => {
  const {
    selection,
    selectedItems,
    visibleBulkActions,
    bulkCtx,
    clearSelection,
  } = props;
  const { tr } = useI18n();

  return (
    // Linear-style floating action pill: fixed at the bottom-center of
    // the viewport, dark surface that stays readable in both themes
    // because the colors are hard-coded (theme-relative `bg-foreground`
    // inverts awkwardly against a white container in dark mode).
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
      <div className="animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-auto flex items-center gap-2 rounded-full bg-zinc-900 px-3 py-1.5 text-zinc-100 shadow-lg ring-1 ring-white/10 duration-150">
        <span className="pl-2 text-sm">
          {tr("alephaTable.selected", {
            default: `${selection.size} selected`,
            args: [String(selection.size)],
          })}
        </span>
        <span className="mx-1 h-4 w-px bg-white/20" />
        {visibleBulkActions.map((action) => {
          if ("items" in action) {
            return (
              <AlephaTableBulkMenu<T>
                key={action.label}
                action={action}
                selected={selectedItems}
                ctx={bulkCtx}
              />
            );
          }
          const ActionIcon = action.icon;
          return (
            <Button
              key={action.label}
              size="sm"
              className={
                action.destructive
                  ? "h-8 bg-red-600 text-white hover:bg-red-500"
                  : "h-8 bg-transparent text-zinc-100 hover:bg-white/10 hover:text-zinc-100"
              }
              onClick={() => action.onClick(selectedItems, bulkCtx)}
            >
              {ActionIcon && <ActionIcon className="size-4" />}
              {action.label}
            </Button>
          );
        })}
        <span className="mx-1 h-4 w-px bg-white/20" />
        <Button
          size="icon"
          className="size-8 bg-transparent text-zinc-300 hover:bg-white/10 hover:text-zinc-100"
          onClick={clearSelection}
          aria-label={tr("alephaTable.clearSelection", {
            default: "Clear selection",
          })}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
};
