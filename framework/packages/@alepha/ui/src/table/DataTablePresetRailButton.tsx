import type { ComponentType, SVGProps } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "../core/Tooltip.tsx";
import { cn } from "../core/utils.ts";

export interface DataTablePresetRailButtonProps {
  label: string;
  hint?: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  count?: number;
  tone?: "default" | "danger";
  presetKey: string;
  active: boolean;
  onClick: () => void;
}

/**
 * One preset of the rail: icon above label, a badge in its corner.
 */
export const DataTablePresetRailButton = (
  props: DataTablePresetRailButtonProps,
) => {
  const Icon = props.icon;
  const count = props.count ?? 0;
  const button = (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      data-preset={props.presetKey}
      className={cn(
        "text-muted-foreground hover:bg-hover hover:text-foreground relative flex w-13 shrink-0 cursor-pointer flex-col items-center gap-0.5 rounded-lg border border-transparent px-0.5 pt-2 pb-1 text-[11px] leading-none transition-colors",
        props.active && "bg-background text-foreground border-border",
      )}
    >
      {/* A marker on the rail's edge, as a selected sidebar entry has. */}
      {props.active && (
        <span
          aria-hidden
          className="bg-foreground absolute start-[-0.375rem] top-2.5 bottom-2.5 w-0.5 rounded-e-full"
        />
      )}
      {Icon && <Icon className="size-[18px]" aria-hidden />}
      {/* `leading-tight`, not the button's `leading-none`: `truncate` clips
          its overflow, and a one-line box that tall cut off a descender
          ("Urgent" lost the tail of its g). */}
      <span className="max-w-full truncate leading-tight">{props.label}</span>
      {count > 0 && (
        <span
          data-slot="data-table-preset-count"
          className={cn(
            "absolute end-0.5 top-0.5 min-w-4 rounded-md border px-1 py-px text-center font-mono text-[10px] leading-tight",
            props.tone === "danger"
              ? "border-danger/40 bg-danger/15 text-danger-text"
              : "bg-background text-muted-foreground border-border",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
  if (!props.hint) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="inline-end">{props.hint}</TooltipContent>
    </Tooltip>
  );
};
