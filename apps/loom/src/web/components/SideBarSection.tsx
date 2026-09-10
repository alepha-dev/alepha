import { cn } from "@alepha/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

export interface SideBarSectionProps {
  title: string;
  /**
   * Icon buttons shown on the header's right while the pointer is over the
   * section, as in VS Code.
   */
  actions?: ReactNode;
  /**
   * Take the remaining height and scroll inside it.
   */
  grow?: boolean;
  children: ReactNode;
}

/**
 * A collapsible side-bar section: a 22px uppercase header with a chevron,
 * the shape of VS Code's "OPEN EDITORS" and folder sections.
 */
export const SideBarSection = (props: SideBarSectionProps) => {
  const [open, setOpen] = useState(true);

  return (
    <section
      className={cn(
        "group/section border-sidebar-border flex min-h-0 flex-col border-t",
        props.grow && open && "flex-1",
      )}
    >
      <div className="flex h-[22px] shrink-0 items-center pr-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="focus-visible:ring-ring flex h-full min-w-0 flex-1 items-center gap-0.5 pl-0.5 text-[11px] font-bold tracking-[0.04em] uppercase outline-none focus-visible:ring-1 focus-visible:ring-inset"
        >
          <ChevronRight
            className={cn(
              "size-4 shrink-0 transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="truncate">{props.title}</span>
        </button>
        {props.actions && (
          <div className="flex items-center opacity-0 transition-opacity group-focus-within/section:opacity-100 group-hover/section:opacity-100">
            {props.actions}
          </div>
        )}
      </div>
      {open && (
        <div className={cn("min-h-0", props.grow && "flex-1 overflow-y-auto")}>
          {props.children}
        </div>
      )}
    </section>
  );
};
