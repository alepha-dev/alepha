import { useI18n } from "alepha/react/i18n";
import { ChevronDown, ChevronUp, Columns3, GripVertical } from "lucide-react";
import { useState } from "react";

import { Button } from "../core/Button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../core/Tooltip.tsx";
import { cn } from "../core/utils.ts";
import type { ColumnDef } from "./alephaTableTypes.ts";

export interface AlephaTableColumnPickerProps<T> {
  columns: Record<string, ColumnDef<T>>;
  order: string[];
  visible: Set<string>;
  onToggle: (key: string) => void;
  onReorder: (key: string, target: string) => void;
}

/**
 * The single home for column state: what is shown, and in what order.
 *
 * Both live here rather than order being reachable only from the header's
 * context menu, and that is the shape decision. Right-click advertises
 * nothing and does not exist on touch, so a feature reachable only that way
 * is one most people never find. The menu is a fast path into this.
 *
 * Reordering is native HTML5 drag, the way Lore's folio tree does it: this
 * package has no drag-and-drop dependency and a column list is not worth
 * adding one. The arrows beside each row are not a fallback for a broken
 * drag - they are the keyboard and touch path, where drag does not exist.
 */
export const AlephaTableColumnPicker = <T,>(
  props: AlephaTableColumnPickerProps<T>,
) => {
  const { tr } = useI18n();
  const [dragging, setDragging] = useState<string | null>(null);
  // The reader's order, so the list reads like the table it controls.
  const entries = props.order.map(
    (key) => [key, props.columns[key]!] as [string, ColumnDef<T>],
  );
  const label = tr("alephaTable.toggleColumns", {
    default: "Toggle columns",
  });
  return (
    <DropdownMenu>
      {/*
       * The trigger is composed rather than plain: it has to be the dropdown
       * trigger AND the tooltip trigger at once, or this button is the only
       * icon-only control in the toolbar with no tooltip (reset-filters and
       * refresh sit right next to it and both have one).
       *
       * `TooltipTrigger` wraps the rendered element rather than the other way
       * round, matching how `sidebar.tsx` composes the same two primitives.
       * `TooltipProvider` is supplied by the toolbar that renders this.
       */}
      <Tooltip>
        <DropdownMenuTrigger
          render={
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0"
                  aria-label={label}
                />
              }
            />
          }
        >
          <Columns3 className="size-4" />
        </DropdownMenuTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {tr("alephaTable.columns", { default: "Columns" })}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {entries.map(([key, def], index) => (
            <div
              key={key}
              draggable
              onDragStart={() => setDragging(key)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => {
                // Required, or the drop never fires.
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging && dragging !== key)
                  props.onReorder(dragging, key);
                setDragging(null);
              }}
              className={cn(
                "flex items-center gap-1 pr-1",
                dragging === key && "opacity-45",
              )}
            >
              <GripVertical
                className="text-muted-foreground/60 size-3.5 shrink-0 cursor-grab"
                aria-hidden
              />
              <DropdownMenuCheckboxItem
                checked={props.visible.has(key)}
                closeOnClick={false}
                onCheckedChange={() => props.onToggle(key)}
                className="flex-1"
              >
                {def.label}
              </DropdownMenuCheckboxItem>
              {/* Keyboard and touch reach the order here. A drag handle alone
                  would put reordering out of reach for both. */}
              <button
                type="button"
                disabled={index === 0}
                aria-label={tr("alephaTable.moveUp", { default: "Move up" })}
                onClick={() => props.onReorder(key, entries[index - 1]![0])}
                className="text-muted-foreground/60 hover:text-foreground rounded p-0.5 disabled:opacity-30"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                type="button"
                disabled={index === entries.length - 1}
                aria-label={tr("alephaTable.moveDown", {
                  default: "Move down",
                })}
                onClick={() => props.onReorder(entries[index + 1]![0], key)}
                className="text-muted-foreground/60 hover:text-foreground rounded p-0.5 disabled:opacity-30"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
