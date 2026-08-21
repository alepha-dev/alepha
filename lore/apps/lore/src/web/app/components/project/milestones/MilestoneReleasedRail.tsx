import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { ChevronRight, History, Trash } from "lucide-react";

import type { I18n } from "@/web/app/services/I18n.ts";

import type { MilestoneWithCount } from "./ProjectMilestones.tsx";

export interface MilestoneReleasedRailProps {
  milestones: MilestoneWithCount[];
  onOpenDetail: (milestone: MilestoneWithCount) => void;
  onDelete: (id: number) => void;
}

/**
 * Closed milestones, newest first. Each row opens the detail sheet — the
 * only place a milestone's title, notes and tags can still be edited now
 * that the page has no detail pane of its own.
 */
const MilestoneReleasedRail = (props: MilestoneReleasedRailProps) => {
  const { tr } = useI18n<I18n, "en">();
  const i18n = useI18n();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex h-12 shrink-0 items-center gap-2 border-y px-5">
        <History className="text-muted-foreground size-4" />
        <span className="text-[13.5px] font-semibold">
          {tr("milestone.ledger.released")}
        </span>
        <span className="text-muted-foreground text-xs">
          {props.milestones.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.milestones.length === 0 ? (
          <p className="text-muted-foreground px-5 py-6 text-center text-xs text-pretty">
            {tr("milestone.history.empty")}
          </p>
        ) : (
          props.milestones.map((milestone) => (
            <div
              key={milestone.id}
              role="button"
              tabIndex={0}
              onClick={() => props.onOpenDetail(milestone)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  props.onOpenDetail(milestone);
                }
              }}
              className="group border-border/60 hover:bg-muted/50 flex cursor-pointer items-center gap-3 border-b px-5 py-3 text-left transition-colors"
            >
              <span className="bg-muted flex size-6.5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold">
                {milestone.number}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">
                  {milestone.title}
                </div>
                <div className="text-muted-foreground mt-0.5 text-[11.5px]">
                  {tr("milestone.ledger.released.meta", {
                    args: [
                      String(milestone.questCount),
                      String(
                        milestone.closedAt
                          ? i18n.l(milestone.closedAt, { date: "ll" })
                          : "",
                      ),
                    ],
                  })}
                </div>
              </div>
              {/* Only empty milestones can be deleted — the API refuses any
                  that recorded quests, so offering the button would be a
                  guaranteed error toast. */}
              {milestone.questCount === 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive size-7 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onDelete(milestone.id);
                  }}
                  aria-label={String(tr("milestone.delete"))}
                >
                  <Trash className="size-3.5" />
                </Button>
              )}
              <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default MilestoneReleasedRail;
