import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: ReactNode;
  /**
   * Optional one-line description under the title.
   */
  description?: ReactNode;
  /**
   * Optional right-aligned actions (buttons, toggles). Most list pages put
   * their primary actions in `AlephaTable`'s `actions` prop instead; this slot
   * is for bespoke pages.
   */
  actions?: ReactNode;
}

/**
 * Consistent admin page title block: an `<h1>` with an optional description and
 * an optional right-aligned actions slot. On list pages it's passed to
 * `AlephaTable`'s `header` prop so the title sits inside the table card.
 */
export const PageHeader = (props: PageHeaderProps) => (
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
      <h1 className="text-lg font-semibold">{props.title}</h1>
      {props.description != null && (
        <p className="text-muted-foreground text-sm">{props.description}</p>
      )}
    </div>
    {props.actions != null && (
      <div className="flex shrink-0 items-center gap-2">{props.actions}</div>
    )}
  </div>
);
