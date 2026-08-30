import { cn } from "@alepha/ui/lib/utils";

export interface ReleasePriorityPillProps {
  priority: "optional" | "low" | "medium" | "high";
}

/**
 * The small monospace priority tag used across the releases page — in the
 * changelog rows and in the "Still open" rail. `high` and `medium` carry
 * colour; `low` and `optional` stay quiet so a changelog full of small work
 * doesn't read as a wall of badges.
 */
const ReleasePriorityPill = (props: ReleasePriorityPillProps) => (
  <span
    className={cn(
      "shrink-0 rounded-[5px] border px-1.5 py-px font-mono text-[10px] font-medium uppercase",
      props.priority === "high" &&
        "border-red-500/35 bg-red-500/10 text-red-600 dark:text-red-400",
      props.priority === "medium" &&
        "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      (props.priority === "low" || props.priority === "optional") &&
        "text-muted-foreground border-border",
    )}
  >
    {props.priority}
  </span>
);

export default ReleasePriorityPill;
