import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useI18n } from "alepha/react/i18n";
import { Check, MoreHorizontal } from "lucide-react";

import { PALETTE_COLORS } from "@/api/schemas/paletteColorSchema.ts";
import type { PaletteColor } from "@/api/schemas/paletteColorSchema.ts";
import { AREA_DOT_CLASS } from "@/web/app/components/shared/areaColor.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface KanbanColumnMenuProps {
  name: string;
  color?: PaletteColor;
  busy?: boolean;
  onRename: () => void;
  onColor: (color: PaletteColor | undefined) => void;
  onDelete: () => void;
}

/**
 * Rename, recolour and delete one column, from its own header (#1511).
 *
 * ⚠️ Rendered only for a CONFIGURED, in-progress column. The lifecycle
 * triple is authoritative (folio #1125), so the synthesized `New` and
 * `Completed` lanes have no entry in `kanbanColumns` and nothing to rename
 * or delete - the caller decides, because only it knows which lane this is.
 *
 * Colours come from the project-wide palette rather than a free picker, so a
 * column stays legible in light and dark: `AREA_DOT_CLASS` resolves each
 * token to a literal class, which is also why the tokens are listed rather
 * than interpolated (Tailwind scans source text, so `bg-${token}-400`
 * compiles to nothing, silently).
 *
 * Reordering is deliberately absent: it would fight the card drag already
 * on this surface, and it stays in Settings ▸ Kanban.
 */
const KanbanColumnMenu = (props: KanbanColumnMenuProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            data-testid="kanban-column-menu"
            disabled={props.busy}
            aria-label={String(
              tr("kanban.column.actions", { args: [props.name] }),
            )}
            // 24x24, matching the collapse button it sits beside - see the
            // note there. The audit that found this (#1743) measured a board
            // with no editable column, so it only reported the sibling; this
            // trigger carried the identical 14x14 target in the same row.
            className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-50"
          />
        }
      >
        <MoreHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem
          data-testid="kanban-column-rename"
          onClick={props.onRename}
        >
          {tr("kanban.column.rename")}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        {/* A plain heading, not `DropdownMenuLabel`: Base UI's label has to
            live inside a `Menu.Group`, and the swatches below are a grid
            rather than menu items - they set a value instead of dismissing
            the menu. */}
        <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
          {tr("kanban.column.color")}
        </div>
        <div className="grid grid-cols-4 gap-1 px-2 pb-1">
          {PALETTE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              data-testid={`kanban-column-color-${color}`}
              aria-label={color}
              aria-pressed={props.color === color}
              onClick={() =>
                // Choosing the colour it already has clears it, which is the
                // only way back to the board's derived tint without a
                // separate "default" entry in the list.
                props.onColor(props.color === color ? undefined : color)
              }
              className="hover:bg-muted flex size-7 items-center justify-center rounded"
            >
              <span
                className={`flex size-4 items-center justify-center rounded-full ${AREA_DOT_CLASS[color]}`}
              >
                {props.color === color && (
                  <Check className="size-3 text-white" />
                )}
              </span>
            </button>
          ))}
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          data-testid="kanban-column-delete"
          onClick={props.onDelete}
        >
          {tr("kanban.column.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default KanbanColumnMenu;
