import { UserAvatar } from "@alepha/ui";
import type { PaletteColor } from "@lore/core/schemas";
import { displayName, type ProjectUser } from "@lore/core/web";
import { ListChecks } from "lucide-react";

import type { QuestResource } from "../../../../api/schemas/questResourceSchema.ts";
import QuestAssignee from "../shared/QuestAssignee.tsx";
import KanbanCardSignals from "./KanbanCardSignals.tsx";
import KanbanCardTags from "./KanbanCardTags.tsx";

export interface KanbanCardCleanProps {
  quest: QuestResource;
  areaDotClass: string;
  tagColors?: Record<string, PaletteColor>;
  blocked?: boolean;
  assignee?: ProjectUser;
  aging?: "fresh" | "aging" | "stale";
}

/**
 * The Clean card: the title gets the room, everything else is a quiet
 * signal.
 *
 * - The title wraps to two lines instead of being cut at one.
 * - Priority is the colour of the card's left edge, not a pill: a column is
 *   scanned for red edges faster than it is read for "High". The word and
 *   the `#Q` reference are in the card's tooltip, set by `KanbanCard`.
 * - A completed quest's title is muted, not struck through: a column of
 *   struck text is hard to read, and the column already says it is done.
 * - One footer: where it lives on the left, how far along and who on the
 *   right.
 */
const KanbanCardClean = (props: KanbanCardCleanProps) => {
  const { quest } = props;
  const objectives = quest.metadata.objectivesProgress;

  return (
    <>
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-[3px] ${PRIORITY_EDGE[quest.priority]}`}
      />
      <span
        className={`line-clamp-2 text-sm leading-snug font-medium ${
          quest.completedAt ? "text-muted-foreground" : ""
        }`}
      >
        {quest.title}
      </span>
      {(quest.tags?.length ?? 0) > 0 && (
        <div className="mt-2">
          <KanbanCardTags tags={quest.tags ?? []} tagColors={props.tagColors} />
        </div>
      )}
      <div className="text-muted-foreground mt-2 flex items-center gap-1.5 text-[11px]">
        {/* The area's colour, the same token the questline map renders. */}
        <span
          data-testid="kanban-card-area-dot"
          className={`size-1.5 shrink-0 rounded-full ${props.areaDotClass}`}
        />
        <span className="min-w-0 truncate">{quest.area}</span>
        <span className="flex-1" />
        <KanbanCardSignals
          quest={quest}
          blocked={props.blocked}
          aging={props.aging}
        />
        {objectives.total > 0 && (
          <span
            className={`flex shrink-0 items-center gap-0.5 ${
              objectives.completed === objectives.total
                ? "text-emerald-600 dark:text-emerald-400"
                : ""
            }`}
            aria-label={`${objectives.completed} of ${objectives.total} objectives`}
          >
            <ListChecks className="size-3" />
            {objectives.completed}/{objectives.total}
          </span>
        )}
        {quest.acceptedBy && (
          // The agent job working it for them in front (#Q4353), not a
          // link: the card is a button.
          <QuestAssignee
            quest={quest}
            link={false}
            size="size-5 shrink-0"
            memberName={String(displayName(props.assignee, quest.acceptedBy))}
            member={
              <UserAvatar
                public
                fileId={props.assignee?.picture}
                className="size-5 shrink-0"
                alt={String(displayName(props.assignee, quest.acceptedBy))}
              />
            }
          />
        )}
      </div>
    </>
  );
};

/**
 * The left edge's colour per priority, the tones of the Quests list's
 * priority chip (`QUEST_PRIORITY_TONE`): danger, warning, info, and none for
 * `optional`, the one priority that asks nothing of the reader. Written out
 * literally because Tailwind scans source text.
 */
const PRIORITY_EDGE: Record<QuestResource["priority"], string> = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-blue-400",
  optional: "bg-transparent",
};

export default KanbanCardClean;
