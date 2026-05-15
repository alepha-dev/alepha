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
        className="flex items-center justify-center gap-2 text-left"
        aria-expanded={open}
        data-testid={`quest-collapsible-${props.label.toLowerCase()}`}
      >
        {props.icon}
        <span className="text-lg font-bold">{props.label}</span>
        <div className="bg-border h-px flex-1 opacity-30" />
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open && <div className="flex flex-col gap-2">{props.children}</div>}
    </div>
  );
};

export default QuestViewCollapsibleBlock;
