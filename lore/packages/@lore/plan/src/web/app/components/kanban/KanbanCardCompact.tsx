import { UserAvatar } from "@alepha/ui";
import { displayName, formatReference, type ProjectUser } from "@lore/core/web";

import type { QuestResource } from "../../../../api/schemas/questResourceSchema.ts";
import { QUEST_PRIORITY_ICONS } from "../project/quest/questChips.ts";
import QuestAssignee from "../shared/QuestAssignee.tsx";
import KanbanCardSignals from "./KanbanCardSignals.tsx";

export interface KanbanCardCompactProps {
  quest: QuestResource;
  areaDotClass: string;
  blocked?: boolean;
  assignee?: ProjectUser;
}

/**
 * The Compact card: one line per fact, for columns long enough that the
 * Clean card's height costs more than its room buys.
 *
 * - Line one: the priority arrow in its tone, the title on one line, who.
 * - Line two: the `#Q` reference, the area, and the tags as plain text.
 * - Line three, only when there is something to say: the signals and the
 *   objectives bar.
 *
 * Aging stays on the card's left edge, set by `KanbanCard`, so it is not
 * passed to the signals here.
 */
const KanbanCardCompact = (props: KanbanCardCompactProps) => {
  const { quest } = props;
  const objectives = quest.metadata.objectivesProgress;
  const PriorityIcon = QUEST_PRIORITY_ICONS[quest.priority];
  const tags = quest.tags ?? [];

  return (
    <>
      <div className="flex items-center gap-1.5">
        <PriorityIcon
          aria-label={quest.priority}
          className={`size-3.5 shrink-0 ${PRIORITY_TEXT[quest.priority]}`}
        />
        <span
          className={`min-w-0 flex-1 truncate text-sm font-medium ${
            quest.completedAt ? "text-muted-foreground" : ""
          }`}
        >
          {quest.title}
        </span>
        {quest.acceptedBy && (
          // The agent job working it for them in front (#Q4353), not a
          // link: the card is a button.
          <QuestAssignee
            quest={quest}
            link={false}
            size="size-4 shrink-0"
            memberName={String(displayName(props.assignee, quest.acceptedBy))}
            member={
              <UserAvatar
                public
                fileId={props.assignee?.picture}
                className="size-4 shrink-0"
                alt={String(displayName(props.assignee, quest.acceptedBy))}
              />
            }
          />
        )}
      </div>
      <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-[11px]">
        <span className="text-muted-foreground/70 shrink-0 font-mono text-[10px]">
          {formatReference("quest", quest.shortId)}
        </span>
        <span
          data-testid="kanban-card-area-dot"
          className={`size-1.5 shrink-0 rounded-full ${props.areaDotClass}`}
        />
        <span className="min-w-0 truncate">{quest.area}</span>
        {tags.length > 0 && (
          <>
            <span className="flex-1" />
            <span
              data-testid="kanban-card-tag"
              className="max-w-[45%] truncate"
              title={tags.join(", ")}
            >
              {tags.join(" · ")}
            </span>
          </>
        )}
      </div>
      {/* `empty:hidden`: the signals decide for themselves whether they have
          anything to say, so the line hides itself when neither they nor
          the objectives render. */}
      <div className="mt-1.5 flex items-center gap-2 empty:hidden">
        <KanbanCardSignals quest={quest} blocked={props.blocked} />
        {objectives.total > 0 && (
          <span
            className="text-muted-foreground flex flex-1 items-center gap-1.5 text-[10px]"
            aria-label={`${objectives.completed} of ${objectives.total} objectives`}
          >
            <span className="bg-muted h-1 flex-1 overflow-hidden rounded-full">
              <span
                className="block h-full rounded-full bg-emerald-500/70"
                style={{
                  width: `${Math.round((objectives.completed / objectives.total) * 100)}%`,
                }}
              />
            </span>
            {objectives.completed}/{objectives.total}
          </span>
        )}
      </div>
    </>
  );
};

/**
 * The arrow's colour per priority, the tones of the Quests list's chip.
 * Written out literally because Tailwind scans source text.
 */
const PRIORITY_TEXT: Record<QuestResource["priority"], string> = {
  high: "text-red-500",
  medium: "text-amber-500",
  low: "text-blue-500",
  optional: "text-muted-foreground",
};

export default KanbanCardCompact;
