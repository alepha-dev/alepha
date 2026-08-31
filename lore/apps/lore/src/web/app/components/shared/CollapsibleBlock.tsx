import { cn } from "@alepha/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

export interface CollapsibleBlockProps {
  /**
   * Rendered to the left of the label, at `size-5` by every call site.
   * Required rather than optional so every block reads the same: a section
   * heading with no glyph sits differently from its neighbours, which is
   * exactly the inconsistency this component exists to prevent.
   */
  icon: ReactNode;
  label: string;
  /**
   * Whether the block starts expanded. Default is `false` (collapsed) —
   * call sites that should be open by default pass `defaultOpen` explicitly.
   * Persistence is in-memory only.
   */
  defaultOpen?: boolean;
  /**
   * Optional content between the label and the hairline rule, for a
   * section's own summary (Objectives puts its progress there). Sits inside
   * the toggle button, so keep it non-interactive.
   */
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * Lightweight accordion block, per Lore quest #42's UX spec. State is local,
 * no persistence.
 *
 * Shared rather than quest-local: it started as `QuestViewCollapsibleBlock`
 * beside QuestView, and the create form's Advanced section is the third
 * caller. The section-heading face below is the only definition of it in the
 * app, so a surface that wants a collapsible heading composes this instead of
 * restating the type ramp.
 */
const CollapsibleBlock = (props: CollapsibleBlockProps) => {
  const [open, setOpen] = useState(props.defaultOpen ?? false);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group hover:bg-muted/40 focus-visible:ring-ring/50 -mx-1 flex items-center gap-2 rounded px-1 py-1 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
        aria-expanded={open}
        data-testid={`collapsible-${props.label.toLowerCase()}`}
      >
        <span className="text-muted-foreground group-hover:text-foreground shrink-0 transition-colors [&>svg]:size-4">
          {props.icon}
        </span>
        {/* The section-label face: 12px, 600, uppercase, +0.84px tracking,
            muted. */}
        <span className="text-muted-foreground group-hover:text-foreground text-xs font-semibold tracking-[0.84px] whitespace-nowrap uppercase transition-colors">
          {props.label}
        </span>
        {props.aside}
        <div className="bg-border h-px flex-1 opacity-40" />
        <ChevronDown
          className={cn(
            "text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-all",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open && <div className="flex flex-col gap-2">{props.children}</div>}
    </div>
  );
};

export default CollapsibleBlock;
