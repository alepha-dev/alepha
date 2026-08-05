import { cn } from "@alepha/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

export interface QuestViewCollapsibleBlockProps {
  icon: ReactNode;
  label: string;
  /**
   * Whether the block starts expanded. Default is `false` (collapsed) —
   * call sites that should be open by default pass `defaultOpen` explicitly.
   * Persistence is in-memory only.
   */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Lightweight accordion block for QuestView sections (Objectives,
 * Rewards, History, Settings). State is local — no persistence — per
 * Lore quest #42's UX spec.
 */
const QuestViewCollapsibleBlock = (props: QuestViewCollapsibleBlockProps) => {
  const [open, setOpen] = useState(props.defaultOpen ?? false);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group hover:bg-muted/40 focus-visible:ring-ring/50 -mx-1 flex items-center gap-2 rounded px-1 py-1 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
        aria-expanded={open}
        data-testid={`quest-collapsible-${props.label.toLowerCase()}`}
      >
        <span className="text-muted-foreground group-hover:text-foreground shrink-0 transition-colors">
          {props.icon}
        </span>
        <span className="text-muted-foreground group-hover:text-foreground text-lg font-bold whitespace-nowrap transition-colors">
          {props.label}
        </span>
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

export default QuestViewCollapsibleBlock;
