import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { cn } from "@alepha/ui/lib/utils";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Swords, Trash } from "lucide-react";
import type { I18n } from "@/web/app/services/I18n.ts";
import type { ChapterWithCount } from "./CampaignChapters.tsx";

export interface CampaignChaptersRowProps {
  chapter: ChapterWithCount;
  onDelete: (id: number) => void;
  onOpenDetail: (chapter: ChapterWithCount) => void;
  /**
   * When true, the connector line below the medallion is hidden — used
   * for the last item in the timeline.
   */
  isLast?: boolean;
}

/**
 * A timeline row: a numbered medallion attached to a vertical rail on the
 * left, with a chapter card to its right. Active chapter rows pulse;
 * closed rows are quiet. Click the card to open the detail sheet.
 */
const CampaignChaptersRow = (props: CampaignChaptersRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const i18n = useI18n();
  const dt = useInject(DateTimeProvider);
  const isActive = !props.chapter.closedAt;
  const tags = props.chapter.tags ?? [];

  // Visual style for the medallion ring
  const ringClass = isActive
    ? "bg-green-600 text-white ring-green-500/30"
    : "bg-muted text-foreground ring-border";

  return (
    <div className="relative flex gap-4">
      {/* Rail + medallion */}
      <div className="relative flex w-10 shrink-0 flex-col items-center">
        <div
          className={cn(
            "relative z-10 flex size-10 items-center justify-center rounded-full font-display text-sm font-bold shadow-sm ring-4",
            ringClass,
          )}
        >
          {props.chapter.number}
          {isActive && (
            <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-green-400 ring-2 ring-background" />
          )}
        </div>
        {!props.isLast && (
          <div className="bg-border absolute top-10 bottom-0 w-px" />
        )}
      </div>

      {/* Card */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => props.onOpenDetail(props.chapter)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onOpenDetail(props.chapter);
          }
        }}
        className={cn(
          "group hover:border-primary/40 hover:bg-muted/40 mb-4 flex-1 cursor-pointer rounded-xl border bg-card p-4 text-left transition-all",
          isActive && "border-green-600/40",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display truncate text-base font-semibold">
                {props.chapter.title}
              </h3>
              {tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className={cn(
                    "font-mono text-[10px]",
                    isActive && "border-primary/40 text-primary",
                  )}
                >
                  {tag}
                </Badge>
              ))}
            </div>

            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              <span className="flex items-center gap-1">
                <Swords className="size-3" />
                {tr("chapter.list.quests", {
                  args: [String(props.chapter.questCount)],
                })}
              </span>
              {props.chapter.closedAt && (
                <span>
                  {tr("chapter.list.closed", {
                    args: [
                      String(i18n.l(props.chapter.closedAt, { date: "ll" })),
                    ],
                  })}
                </span>
              )}
              {isActive && props.chapter.closesAt && (
                <span>
                  {tr("chapter.list.closesIn", {
                    args: [dt.of(props.chapter.closesAt).fromNow()],
                  })}
                </span>
              )}
              {isActive && !props.chapter.closesAt && (
                <span>
                  {tr("chapter.row.startedNow", {
                    args: [dt.of(props.chapter.createdAt).fromNow()],
                  })}
                </span>
              )}
            </div>
          </div>

          {props.chapter.questCount === 0 && !isActive && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                props.onDelete(props.chapter.id);
              }}
              aria-label={String(tr("chapter.delete"))}
            >
              <Trash className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CampaignChaptersRow;
