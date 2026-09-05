import { Badge } from "@alepha/ui/components/ui/badge";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  AlertTriangle,
  CalendarClock,
  Lock,
  Paperclip,
  Sparkles,
  Timer,
  Flag,
} from "lucide-react";

import type { PaletteColor } from "@/api/schemas/paletteColorSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import { currentReleasesAtom } from "../../atoms/currentReleasesAtom.ts";
import { displayName } from "../../services/displayName.ts";
import type { I18n } from "../../services/I18n.ts";
import { QuestDueDate } from "../project/quest/questDueDate.ts";
import { TAG_CHIP_CLASS, TAG_CHIP_FALLBACK } from "../shared/areaColor.ts";
import { formatReference } from "../shared/element/typedReference.ts";
import type { ProjectUser } from "../shared/useProjectUsers.ts";
import { UserAvatar } from "../shared/UserAvatar.tsx";

export interface KanbanCardProps {
  quest: QuestResource;
  onSelect: (quest: QuestResource) => void;
  /**
   * Dot class for the quest's area, resolved by the board once for the
   * whole set rather than per card.
   */
  areaDotClass: string;
  /**
   * The project's tag → colour map. A tag with no entry renders neutral.
   */
  tagColors?: Record<string, PaletteColor>;
  /**
   * True when the quest is `new` and its predecessor is not complete — or
   * is outside the board's set, in which case the blocker exists and we
   * simply cannot see it. Derived by the board, which holds every quest.
   */
  blocked?: boolean;
  /**
   * The member `acceptedBy` names, resolved by the board so a column of 20
   * cards does not each look the id up.
   */
  assignee?: ProjectUser;
  /**
   * How long the card has sat in its column. Rendered as a left edge
   * rather than a full halo: a glow on every second card would be noise,
   * an edge reads as a margin note.
   */
  aging?: "fresh" | "aging" | "stale";
}

/**
 * At most this many tag chips before the row is cut short with a count.
 * A card carrying six labels stops being glanceable, which is the whole
 * reason the chips are there.
 */
const MAX_TAGS = 3;

/**
 * The aging tint, one literal per level — Tailwind scans source text, so a
 * computed class compiles to nothing.
 */
const AGING_EDGE: Record<string, string> = {
  fresh: "",
  aging: "border-l-2 border-l-amber-400/70",
  stale: "border-l-2 border-l-red-400/70",
};

/**
 * Stateless, so one instance serves every card.
 */
const dueDate = new QuestDueDate();

const priorityVariant = (
  priority: string,
): "default" | "secondary" | "destructive" | "outline" => {
  switch (priority) {
    case "high":
      return "destructive";
    case "medium":
      return "default";
    case "low":
      return "secondary";
    default:
      return "outline";
  }
};

const KanbanCard = (props: KanbanCardProps) => {
  const { quest, onSelect } = props;
  const dt = useInject(DateTimeProvider);
  const { l } = useI18n<I18n, "en">();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `quest-${quest.id}`,
      data: { type: "quest", quest },
    });
  // A card is a drop target as well as a draggable: dropping onto one is
  // how a position WITHIN a column is expressed. The column droppable
  // underneath still catches everything that lands between cards, which is
  // the "move to this column, position unspecified" case.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `card-drop-${quest.id}`,
    data: { type: "card", quest },
    disabled: isDragging,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : undefined,
  };

  const cursorClass = isDragging ? "cursor-grabbing" : "cursor-grab";

  const [releases] = useStore(currentReleasesAtom);
  const releaseTag = quest.releaseId
    ? (releases?.find((r) => r.id === quest.releaseId)?.tag ?? undefined)
    : undefined;
  const tags = quest.tags ?? [];
  const shownTags = tags.slice(0, MAX_TAGS);
  const hiddenTagCount = tags.length - shownTags.length;

  const objectives = quest.metadata.objectivesProgress;
  const attachmentCount = quest.attachments?.length ?? 0;
  // Same rule as the quest log's `QuestItem`: the last session with no
  // `stoppedAt` is a timer still running.
  const lastSession = quest.timerSessions?.[quest.timerSessions.length - 1];
  const timerRunning = Boolean(lastSession && !lastSession.stoppedAt);
  // A completed quest's deadline is history, not a warning — the card would
  // otherwise sit in Done shouting about a date nobody can act on.
  const due =
    quest.dueAt && !quest.completedAt
      ? dueDate.describe(quest.dueAt, dt)
      : undefined;
  const hasBadges =
    attachmentCount > 0 ||
    timerRunning ||
    props.blocked ||
    Boolean(due) ||
    objectives.total > 0;

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setDropRef(node);
      }}
      style={style}
      // A line above the card, so "drop here" reads as a position between
      // two cards rather than as replacing the one under the cursor.
      className={`p-1 ${isOver ? "border-primary border-t-2" : "border-t-2 border-transparent"}`}
    >
      <button
        type="button"
        data-testid="kanban-card"
        data-quest-short-id={quest.shortId}
        onClick={() => onSelect(quest)}
        {...attributes}
        {...listeners}
        // `items-start`, not `items-center`: the card grew a tag row and a
        // badge row, and a vertically centred priority badge floats in the
        // middle of a tall card instead of reading as its header.
        data-aging={props.aging ?? "fresh"}
        className={`group border-border bg-card hover:bg-muted flex w-full items-start gap-2 overflow-hidden rounded-md border px-2 py-1.5 text-left shadow-sm transition-colors ${cursorClass} ${AGING_EDGE[props.aging ?? "fresh"]}`}
      >
        <div className="flex flex-1 flex-col overflow-hidden">
          <span
            className={`truncate text-sm font-medium ${
              quest.completedAt ? "text-muted-foreground line-through" : ""
            }`}
          >
            {quest.title}
          </span>
          {shownTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              {shownTags.map((tag) => (
                // The same chip the quest rail renders, in the same palette:
                // one `Badge variant="tint"`, differing only in the size a
                // card can afford. It was a bare span in its own format
                // before #1638.
                <Badge
                  key={tag}
                  variant="tint"
                  data-testid="kanban-card-tag"
                  className={`h-4 max-w-full truncate px-1.5 font-mono text-[10px] leading-none ${
                    TAG_CHIP_CLASS[props.tagColors?.[tag] as PaletteColor] ??
                    TAG_CHIP_FALLBACK
                  }`}
                >
                  {tag}
                </Badge>
              ))}
              {hiddenTagCount > 0 && (
                <span className="text-muted-foreground text-[10px]">
                  +{hiddenTagCount}
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-1 pt-0.5">
            <span className="text-muted-foreground/70 font-mono text-[10px]">
              {formatReference("quest", quest.shortId)}
            </span>
            {/* The area's colour, the same token the questline map renders. */}
            <span
              data-testid="kanban-card-area-dot"
              className={`size-1.5 shrink-0 rounded-full ${props.areaDotClass}`}
            />
            <span className="text-muted-foreground truncate text-xs">
              {quest.area}
            </span>
            {/* Where it ships, beside where it lives. Read from the project's
                own release list rather than carried on the quest: the board
                already holds every release, and a per-card lookup of a name
                the row does not have would be a request per card. */}
            {releaseTag && (
              <span
                data-testid="kanban-card-release"
                className="text-muted-foreground/80 flex shrink-0 items-center gap-0.5 font-mono text-[10px]"
              >
                <Flag className="size-2.5" />
                {releaseTag}
              </span>
            )}
          </div>
          {hasBadges && (
            <div
              data-testid="kanban-card-badges"
              className="text-muted-foreground flex items-center gap-1.5 pt-1"
            >
              {props.blocked && (
                <Lock
                  data-testid="kanban-card-blocked"
                  aria-label="Blocked"
                  className="size-3 text-amber-500"
                />
              )}
              {objectives.total > 0 && (
                // A bar rather than the bare `2/5` it replaced: the point of
                // a checklist on a board is how far along it is, which a
                // fraction makes you compute.
                <span
                  className="flex items-center gap-1"
                  aria-label={`${objectives.completed} of ${objectives.total} objectives`}
                >
                  <span className="bg-muted h-1 w-8 overflow-hidden rounded-full">
                    <span
                      className="bg-muted-foreground/60 block h-full rounded-full"
                      style={{
                        width: `${Math.round(
                          (objectives.completed / objectives.total) * 100,
                        )}%`,
                      }}
                    />
                  </span>
                  <span className="text-[10px]">
                    {objectives.completed}/{objectives.total}
                  </span>
                </span>
              )}
              {attachmentCount > 0 && (
                <span className="flex items-center gap-0.5 text-[10px]">
                  <Paperclip className="size-3" />
                  {attachmentCount}
                </span>
              )}
              {timerRunning && (
                <Timer
                  data-testid="kanban-card-timer"
                  aria-label="Timer running"
                  className="size-3 text-emerald-500"
                />
              )}
              {due && (
                // The same rule the quest page's chip reads, so one quest
                // cannot be overdue on the board and on time on its page.
                <span
                  data-testid="kanban-card-due"
                  data-overdue={due.overdue}
                  className={`flex items-center gap-0.5 text-[10px] ${
                    due.overdue ? "text-red-500" : "text-amber-500"
                  }`}
                >
                  <CalendarClock className="size-3" />
                  {String(l(quest.dueAt as string, { date: due.dateFormat }))}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Who is doing this. The board's reason for existing is seeing
              that at a glance, so it sits in the card's top-right corner
              rather than among the badges below. */}
          {quest.acceptedBy && (
            <UserAvatar
              fileId={props.assignee?.picture}
              className="size-4"
              alt={String(displayName(props.assignee, quest.acceptedBy))}
            />
          )}
          <Badge variant={priorityVariant(quest.priority)} className="text-xs">
            {quest.priority}
          </Badge>
          {quest.priority === "high" && (
            <AlertTriangle className="size-3.5 text-red-500" />
          )}
          {quest.priority === "optional" && (
            <Sparkles className="text-muted-foreground size-3.5" />
          )}
        </div>
      </button>
    </div>
  );
};

export default KanbanCard;
