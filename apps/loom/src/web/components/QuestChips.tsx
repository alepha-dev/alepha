import { cn } from "@alepha/ui/lib/utils";

import type { QuestRef } from "../../api/schemas/questRefSchema.ts";

export interface QuestChipsProps {
  quests: QuestRef[];
  /**
   * How many to show before "+n".
   */
  max?: number;
}

/**
 * The Lore quests a branch names, as `#Q` chips. A completed quest is
 * dimmed; the tooltip carries the title and the epic when Lore answered.
 */
export const QuestChips = (props: QuestChipsProps) => {
  if (props.quests.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }
  const max = props.max ?? props.quests.length;
  const shown = props.quests.slice(0, max);
  const hidden = props.quests.length - shown.length;

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((quest) => {
        const title = [
          `#Q${quest.shortId}`,
          quest.title,
          quest.status,
          quest.epic ? `E${quest.epic.number} ${quest.epic.title}` : undefined,
        ]
          .filter(Boolean)
          .join(" · ");
        const className = cn(
          "border-border rounded-sm border px-1 font-mono text-[11px] tabular-nums",
          quest.status === "completed"
            ? "text-muted-foreground"
            : "text-foreground",
          quest.url && "hover:border-warp hover:text-foreground",
        );
        return quest.url ? (
          <a
            key={quest.shortId}
            href={quest.url}
            target="_blank"
            rel="noreferrer"
            title={title}
            className={className}
          >
            #Q{quest.shortId}
          </a>
        ) : (
          <span key={quest.shortId} title={title} className={className}>
            #Q{quest.shortId}
          </span>
        );
      })}
      {hidden > 0 && (
        <span className="text-muted-foreground text-[11px]">+{hidden}</span>
      )}
    </span>
  );
};
