import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useI18n } from "alepha/react/i18n";
import { ChevronUp, Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import type {
  BulkAction,
  BulkActionContext,
  BulkMenuAction,
} from "./alepha-table.tsx";

export interface AlephaTableBulkMenuProps<T> {
  action: BulkMenuAction<T>;
  /**
   * The selected rows, as the table hands them to every bulk action. Also
   * the cache key: a new selection is a new question, so the items resolve
   * again for it.
   */
  selected: T[];
  ctx: BulkActionContext;
}

/**
 * What one selection's producer answered, keyed on that selection.
 */
interface BulkMenuCache<T> {
  key: T[];
  items?: BulkAction<T>[];
  failed: boolean;
}

/**
 * The menu form of a bulk action, rendered in the selection pill.
 *
 * Items resolve on OPEN INTENT rather than on hover alone: pointer enter,
 * focus, or the menu opening (which covers the keyboard and touch, where
 * hover does not exist). Resolved once per selection and kept for its life,
 * since the list a table offers does not move mid-triage. A producer that
 * fails is shown as such inside the menu, and the next open tries again.
 */
export const AlephaTableBulkMenu = <T,>(props: AlephaTableBulkMenuProps<T>) => {
  const { tr } = useI18n();
  // Keyed on the selection's identity: `selectedItems` is a fresh array for
  // every change of the checkbox set, so a cache carrying another array is
  // simply not this selection's and reads as unresolved. No effect resets
  // anything; the render derives it.
  const [cache, setCache] = useState<BulkMenuCache<T>>({
    key: props.selected,
    failed: false,
  });
  const resolved = cache.key === props.selected ? cache : undefined;
  // The once-guard, event-time only: pointer enter, focus and open can all
  // fire before a render lands, and state would still say "not started".
  const guard = useRef<{ key: T[]; started: boolean } | undefined>(undefined);

  const resolve = useCallback(() => {
    const key = props.selected;
    if (guard.current?.key === key && guard.current.started) {
      return;
    }
    guard.current = { key, started: true };

    let produced: BulkAction<T>[] | Promise<BulkAction<T>[]>;
    try {
      produced = props.action.items();
    } catch {
      guard.current = { key, started: false };
      setCache({ key, failed: true });
      return;
    }

    if (Array.isArray(produced)) {
      setCache({ key, items: produced, failed: false });
      return;
    }

    // A result landing for a selection that has since changed is dropped:
    // the guard already belongs to the newer selection.
    produced.then(
      (list) => {
        if (guard.current?.key !== key) {
          return;
        }
        setCache({ key, items: list, failed: false });
      },
      () => {
        if (guard.current?.key !== key) {
          return;
        }
        guard.current = { key, started: false };
        setCache({ key, failed: true });
      },
    );
  }, [props.action, props.selected]);

  const Icon = props.action.icon;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          resolve();
        }
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            className="h-8 bg-transparent text-zinc-100 hover:bg-white/10 hover:text-zinc-100 aria-expanded:bg-white/10 aria-expanded:text-zinc-100"
            onPointerEnter={resolve}
            onFocus={resolve}
          />
        }
      >
        {Icon && <Icon className="size-4" />}
        {props.action.label}
        <ChevronUp className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      {/*
        Above the trigger: the pill is pinned to the bottom of the viewport,
        so below it there is nowhere to go.
      */}
      <DropdownMenuContent side="top" align="center">
        {resolved?.failed ? (
          <DropdownMenuItem disabled>
            {tr("alephaTable.bulkMenu.failed", {
              default: "Could not load the choices",
            })}
          </DropdownMenuItem>
        ) : resolved?.items === undefined ? (
          <DropdownMenuItem disabled>
            <Loader2 className="size-4 animate-spin" />
            {tr("alephaTable.bulkMenu.loading", { default: "Loading…" })}
          </DropdownMenuItem>
        ) : resolved.items.length === 0 ? (
          <DropdownMenuItem disabled>
            {tr("alephaTable.bulkMenu.empty", { default: "Nothing to pick" })}
          </DropdownMenuItem>
        ) : (
          resolved.items.map((item, idx, items) => {
            const ItemIcon = item.icon;
            const separator =
              idx > 0 && item.destructive && !items[idx - 1].destructive;
            return (
              <span key={item.label}>
                {separator && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  variant={item.destructive ? "destructive" : undefined}
                  onClick={() => item.onClick(props.selected, props.ctx)}
                >
                  {ItemIcon && <ItemIcon className="size-4" />}
                  {item.label}
                </DropdownMenuItem>
              </span>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
