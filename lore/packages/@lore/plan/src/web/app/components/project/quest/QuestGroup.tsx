import { cn, ContextMenu, ContextMenuTrigger } from "@alepha/ui";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import type { AreaResource } from "../../../../../api/schemas/areaResourceSchema.ts";
import { byPriorityDesc } from "../../../../../api/schemas/questPriority.ts";
import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";
import QuestGroupMenu from "./QuestGroupMenu.tsx";
import QuestItem from "./QuestItem.tsx";

export interface QuestGroupProps {
  name: string;
  quests: QuestResource[];
  /**
   * The area's dot class, from `AreaDotColor`, resolved once by the list.
   */
  dotClass: string;
  /**
   * The area row, for the right-click menu. Absent for a name with no area
   * behind it (a quest whose area was deleted), which gets no menu.
   */
  area?: AreaResource;
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
  const quests = [...props.quests].sort(byPriorityDesc);

  return (
    <div className="flex flex-col">
      {/* The whole row is the toggle: chevron, the area's colour, its name
          and how many quests it holds. */}
      {/* Right-click: the area's colour and its settings. */}
      <ContextMenu>
        <ContextMenuTrigger render={<div className="flex flex-col" />}>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="group/group hover:bg-hover focus-visible:ring-ring/50 flex h-7 items-center gap-1.5 rounded-md px-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
            aria-expanded={isExpanded}
          >
            <ChevronRight
              className={cn(
                "text-muted-foreground group-hover/group:text-foreground size-3.5 shrink-0 transition-transform",
                isExpanded && "rotate-90",
              )}
            />
            <span
              className={`size-2 shrink-0 rounded-full ${props.dotClass}`}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate text-xs font-semibold">
              {props.name}
            </span>
            <span className="text-muted-foreground text-[11px] tabular-nums">
              {quests.length}
            </span>
          </button>
        </ContextMenuTrigger>
        {props.area && <QuestGroupMenu area={props.area} />}
      </ContextMenu>
      {isExpanded && (
        <div className="mt-0.5 mb-2 flex flex-col gap-px">
          {quests.map((item, index) => (
            <QuestItem key={item.id} quest={item} index={index} />
          ))}
        </div>
      )}
    </div>
  );
};

export default QuestGroup;
