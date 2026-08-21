import { cn } from "@alepha/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import QuestItem from "./QuestItem.tsx";

export interface QuestGroupProps {
  name: string;
  quests: QuestResource[];
  /**
   * Optional broadcast from QuestLog: when `version` changes, the group
   * snaps its expanded state to `!collapsed`.
   */
  collapseSignal?: { collapsed: boolean; version: number };
}

const QuestGroup = (props: QuestGroupProps) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const collapseVersion = props.collapseSignal?.version ?? 0;
  const collapseCollapsed = props.collapseSignal?.collapsed ?? false;
  // Apply the global directive when its version bumps. Local toggles still
  // override afterwards until the next bump — intentionally keyed on
  // collapseVersion only. Applied during render so the expand/collapse-all
  // button does not paint the old state first.
  const [appliedVersion, setAppliedVersion] = useState(collapseVersion);
  if (props.collapseSignal && collapseVersion !== appliedVersion) {
    setAppliedVersion(collapseVersion);
    setIsExpanded(!collapseCollapsed);
  }

  // Highest priority first. This used to sort by difficulty, which is
  // gone — priority is the field that actually answers "which of these
  // first", and it is the same order the table offers.
  const quests = [...props.quests].sort(
    (a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority],
  );

  return (
    <div className="flex flex-col gap-0.5">
      {/* The quest view's collapsible header, minus the icon: name, count,
          hairline, chevron, and the whole row is the toggle. It used to lead
          with a +/- button, which put the control before the thing it
          controls and made only that 24px square clickable.

          The name keeps its own weight rather than the block's uppercase
          muted label: an area is a name the reader scans for, not a section
          title. */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="group/group hover:bg-muted/40 focus-visible:ring-ring/50 -mx-1 flex items-center gap-2 rounded px-2 py-1 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
        aria-expanded={isExpanded}
      >
        <span className="truncate text-sm font-bold">{props.name}</span>
        <div className="bg-border h-px flex-1 opacity-40" />
        <ChevronDown
          className={cn(
            "text-muted-foreground group-hover/group:text-foreground size-4 shrink-0 transition-all",
            !isExpanded && "-rotate-90",
          )}
        />
      </button>
      {isExpanded && (
        <div className="flex flex-col gap-0.5">
          {quests.map((item, index) => (
            <QuestItem key={item.id} quest={item} index={index} />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Rank of each priority for sorting, high first. Mirrors the ordering the
 * MCP tools and the quest table already state: optional < low < medium < high.
 */
const PRIORITY_ORDER: Record<QuestResource["priority"], number> = {
  optional: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export default QuestGroup;
