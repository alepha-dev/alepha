import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { Check, Copy, Crosshair, MoreVertical, Trash2 } from "lucide-react";

import type { I18n } from "../../services/I18n.ts";

export interface DashboardCardMenuProps {
  onChangeScope: () => void;
  /**
   * The tile's current width (columns) and height (rows).
   */
  size?: number;
  height?: number;
  /**
   * Resize from the menu rather than by dragging an edge (#Q2651). Absent,
   * the size entries are not drawn.
   */
  onResize?: (size: { size: number; height: number }) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  /**
   * True while a card write runs: the menu's writes are held until it lands,
   * since `run()` would drop a second one in silence (#E59 rule 10).
   */
  busy?: boolean;
}

/**
 * The per-card kebab.
 *
 * The mockup lists five entries; three are here. "Update card" and "Change
 * window" are the two the v1 metrics have nothing to configure behind:
 * every filter set is a single default, and the only period the visitors
 * metric accepts is yesterday. An entry that opens a picker with one option
 * is worse than no entry, so they arrive with the metric that needs them.
 *
 * A real dropdown rather than the mockup's hand-rolled absolute panel: it
 * gets focus handling, escape, outside-click and keyboard navigation from
 * the design system instead of from an ad-hoc document listener.
 */
const DashboardCardMenu = (props: DashboardCardMenuProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={tr("dashboard.card.options")}
        // `size-6` (24px), not the 22px this started on. WCAG 2.2's Target
        // Size (Minimum) asks for 24x24 CSS px and this missed by two in each
        // direction - reachable with a mouse, awkward with a thumb. The glyph
        // stays `size-3.5`, so only the hover chip grows, by one pixel a side.
        className="text-muted-foreground/70 hover:bg-hover hover:text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors"
      >
        <MoreVertical className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-46">
        <DropdownMenuItem onClick={props.onChangeScope}>
          <Crosshair className="text-muted-foreground size-3.5" />
          {tr("dashboard.card.scope")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={props.busy} onClick={props.onDuplicate}>
          <Copy className="text-muted-foreground size-3.5" />
          {tr("dashboard.card.duplicate")}
        </DropdownMenuItem>
        {props.onResize && (
          <>
            <DropdownMenuSeparator />
            {/* A group, not a fragment: Base UI's label throws (error #31)
                outside a `Menu.Group`. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground text-[11px]">
                {tr("dashboard.card.size")}
              </DropdownMenuLabel>
              {SIZES.map((option) => {
                const current =
                  option.size === (props.size ?? 1) &&
                  option.height === (props.height ?? 1);
                return (
                  <DropdownMenuItem
                    key={`${option.size}x${option.height}`}
                    data-testid="dashboard-card-size"
                    disabled={props.busy || current}
                    onClick={() => props.onResize?.(option)}
                  >
                    <span className="text-muted-foreground w-3.5">
                      {current && <Check className="size-3.5" />}
                    </span>
                    {tr("dashboard.card.size.option", {
                      args: [String(option.size), String(option.height)],
                    })}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={props.busy}
          onClick={props.onRemove}
        >
          <Trash2 className="size-3.5" />
          {tr("dashboard.card.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * The sizes a tile may take: width in columns, height in rows. Six presets
 * rather than two free inputs, because a 5-wide tile on a 4-column grid is a
 * size nobody chose on purpose.
 */
const SIZES = [
  { size: 1, height: 1 },
  { size: 2, height: 1 },
  { size: 3, height: 1 },
  { size: 1, height: 2 },
  { size: 2, height: 2 },
  { size: 3, height: 2 },
];

export default DashboardCardMenu;
