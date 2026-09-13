import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

export interface ClauseLabelProps {
  children: ReactNode;
  className?: string;
}

/**
 * The heading above one clause of the query.
 *
 * The panel reads top to bottom as a sentence (`from`, `select`, `on range`,
 * `group by`, `where`), so these are keywords of the query language rather
 * than prose, and they are not translated for the same reason `sum(count)` is
 * not.
 */
export const ClauseLabel = (props: ClauseLabelProps) => (
  <span
    className={cn(
      "text-muted-foreground text-[10.5px] font-semibold tracking-[0.08em] uppercase",
      props.className,
    )}
  >
    {props.children}
  </span>
);
