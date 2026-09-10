import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface DetailGroupProps {
  title: string;
  icon: LucideIcon;
  /**
   * Shown at the header's right: a link, a status.
   */
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * A titled panel of label/value rows in the worktree view. Its children are
 * `DetailRow`s, which lay out as a two-column definition list.
 */
export const DetailGroup = (props: DetailGroupProps) => {
  const Icon = props.icon;
  return (
    <section className="border-border bg-card/50 min-w-0 rounded-md border">
      <h2 className="border-border text-muted-foreground flex h-8 items-center gap-2 border-b px-3 text-[11px] font-semibold tracking-[0.06em] uppercase">
        <Icon className="size-3.5" strokeWidth={1.75} />
        {props.title}
        {props.aside && (
          <span className="ml-auto text-[12px] font-normal tracking-normal normal-case">
            {props.aside}
          </span>
        )}
      </h2>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1.5 px-3 py-2.5">
        {props.children}
      </dl>
    </section>
  );
};
