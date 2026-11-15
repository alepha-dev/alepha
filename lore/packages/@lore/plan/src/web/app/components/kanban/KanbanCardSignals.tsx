import type { I18n } from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  CalendarClock,
  Flag,
  Hourglass,
  Lock,
  Paperclip,
  PauseCircle,
  Timer,
} from "lucide-react";

import type { QuestResource } from "../../../../api/schemas/questResourceSchema.ts";
import { currentReleasesAtom } from "../../atoms/currentReleasesAtom.ts";
import { QuestDueDate } from "../project/quest/questDueDate.ts";

export interface KanbanCardSignalsProps {
  quest: QuestResource;
  /**
   * The quest's predecessor is not complete. Worked out by the board, which
   * holds every quest.
   */
  blocked?: boolean;
  /**
   * How long the card has sat in its column. The Compact card draws it as
   * its left edge; the Clean card's left edge is its priority, so it shows
   * aging here instead, as an hourglass.
   */
  aging?: "fresh" | "aging" | "stale";
}

/**
 * The small facts a card carries beside its title: on hold, blocked,
 * aging, due, timer running, attachments, release. Shared by the Clean and
 * Compact cards so both say the same thing about a quest, each in its own
 * layout. Renders nothing when none applies.
 */
const KanbanCardSignals = (props: KanbanCardSignalsProps) => {
  const { quest } = props;
  const { l, tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const [releases] = useStore(currentReleasesAtom);

  // Read from the project's own release list rather than carried on the
  // quest: the board already holds every release.
  const releaseTag = quest.releaseId
    ? (releases?.find((r) => r.id === quest.releaseId)?.tag ?? undefined)
    : undefined;
  const attachmentCount = quest.attachments?.length ?? 0;
  // The last session with no `stoppedAt` is a timer still running.
  const lastSession = quest.timerSessions?.[quest.timerSessions.length - 1];
  const timerRunning = Boolean(lastSession && !lastSession.stoppedAt);
  // A completed quest's deadline is history, not a warning.
  const due =
    quest.dueAt && !quest.completedAt
      ? dueDate.describe(quest.dueAt, dt)
      : undefined;
  const held = Boolean(quest.heldAt);
  const aging = props.aging && props.aging !== "fresh" ? props.aging : null;

  if (
    !held &&
    !props.blocked &&
    !aging &&
    !due &&
    !timerRunning &&
    attachmentCount === 0 &&
    !releaseTag
  ) {
    return null;
  }

  return (
    <span
      data-testid="kanban-card-badges"
      className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-[11px]"
    >
      {held && (
        <PauseCircle
          data-testid="kanban-card-held"
          aria-label={tr("quest.status.onHold")}
          className="text-danger-text size-3"
        />
      )}
      {props.blocked && (
        <Lock
          data-testid="kanban-card-blocked"
          aria-label="Blocked"
          className="size-3 text-amber-500"
        />
      )}
      {aging && (
        <Hourglass
          data-testid="kanban-card-aging"
          aria-label={aging}
          className={`size-3 ${aging === "stale" ? "text-red-500" : "text-amber-500"}`}
        />
      )}
      {due && (
        // The same rule the quest page's chip reads, so one quest cannot be
        // overdue on the board and on time on its page.
        <span
          data-testid="kanban-card-due"
          data-overdue={due.overdue}
          className={`flex items-center gap-0.5 ${
            due.overdue ? "text-red-500" : "text-amber-500"
          }`}
        >
          <CalendarClock className="size-3" />
          {l(quest.dueAt as string, { date: due.dateFormat })}
        </span>
      )}
      {timerRunning && (
        <Timer
          data-testid="kanban-card-timer"
          aria-label="Timer running"
          className="size-3 text-emerald-500"
        />
      )}
      {attachmentCount > 0 && (
        <span className="flex items-center gap-0.5">
          <Paperclip className="size-3" />
          {attachmentCount}
        </span>
      )}
      {releaseTag && (
        <span
          data-testid="kanban-card-release"
          className="flex items-center gap-0.5 font-mono text-[10px]"
        >
          <Flag className="size-2.5" />
          {releaseTag}
        </span>
      )}
    </span>
  );
};

/**
 * Stateless, so one instance serves every card.
 */
const dueDate = new QuestDueDate();

export default KanbanCardSignals;
