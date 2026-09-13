import { Button } from "@alepha/ui/components/ui/button";
import { cn } from "@alepha/ui/lib/utils";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

export interface ToggleChipProps {
  children: ReactNode;
  pressed: boolean;
  onToggle: () => void;
  /**
   * The 1-based position of this key in an ordered clause. `groupBy` is
   * ordered (the first key is the chart's x-axis and the second becomes the
   * breakdown), so a selected chip has to say where it sits.
   */
  order?: number;
  /**
   * Refuses the click and draws a lock. Rendered with `aria-disabled` rather
   * than `disabled`: browsers suppress the native tooltip on a truly disabled
   * button, and for a locked chip that tooltip is the entire explanation.
   */
  locked?: boolean;
  title?: string;
}

/**
 * One clause value, as a pressed-state toggle.
 *
 * A button and not a badge: it carries `aria-pressed`, takes focus, and shows
 * the repo's focus ring. A badge that happens to be clickable does none of
 * those.
 */
export const ToggleChip = (props: ToggleChipProps) => (
  <Button
    type="button"
    variant={props.pressed ? "default" : "outline"}
    aria-pressed={props.pressed}
    aria-disabled={props.locked || undefined}
    title={props.title}
    onClick={() => {
      if (!props.locked) props.onToggle();
    }}
    className={cn(
      "h-[26px] gap-1.5 rounded-md px-[9px] font-normal",
      !props.pressed &&
        "text-muted-foreground hover:text-foreground bg-transparent dark:bg-transparent",
      props.locked && "cursor-not-allowed opacity-45 hover:bg-transparent",
    )}
  >
    {props.order !== undefined && props.pressed && (
      <span className="bg-primary-foreground/25 inline-flex size-3.5 items-center justify-center rounded-[4px] text-[9.5px] font-semibold">
        {props.order}
      </span>
    )}
    {props.children}
    {props.locked && <Lock className="size-2.5" />}
  </Button>
);
