import type { ReactNode } from "react";

export interface GroupProps {
  title: string;
  children: ReactNode;
}

/**
 * A labelled run of examples INSIDE a Showcase preview.
 *
 * One Showcase per page is the rule, so a page that still needs to separate
 * "chosen by the data" from "overridden by a prop" does it here rather than by
 * stacking cards.
 */
export const Group = (props: GroupProps) => (
  <div className="space-y-3">
    <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
      {props.title}
    </p>
    <div className="space-y-4">{props.children}</div>
  </div>
);
