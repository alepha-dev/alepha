import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { PaletteColor } from "@lore/core/schemas";
import { formatReference, type ProjectUser } from "@lore/core/web";
import { useStore } from "alepha/react";

import type { QuestResource } from "../../../../api/schemas/questResourceSchema.ts";
import { kanbanCardStyleAtom } from "../../atoms/kanbanCardStyleAtom.ts";
import KanbanCardClean from "./KanbanCardClean.tsx";
import KanbanCardCompact from "./KanbanCardCompact.tsx";

export interface KanbanCardProps {
  quest: QuestResource;
  /**
   * The copy the board's `DragOverlay` draws under the pointer: not
   * draggable, not a drop target, and lifted with a stronger shadow.
   */
  overlay?: boolean;
  /**
   * Whether this card may be picked up. `false` for a rank that may read the
   * board and not move anything on it.
   */
  draggable?: boolean;
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
   * True when the quest is `todo` and its predecessor is not complete — or
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
   * How long the card has sat in its column: the Compact card's left edge,
   * an hourglass among the Clean card's signals.
   */
  aging?: "fresh" | "aging" | "stale";
}

/**
 * One card on the board: the draggable, droppable shell, and the body the
 * viewer chose with the board's card toggle (`kanbanCardStyleAtom`),
 * `KanbanCardClean` or `KanbanCardCompact`.
 */
const KanbanCard = (props: KanbanCardProps) => {
  const { quest, onSelect } = props;
  const [{ style: cardStyle }] = useStore(kanbanCardStyleAtom);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    // The overlay copy registers under its own id, so it never stands in
    // for the card it shadows.
    id: props.overlay ? `overlay-quest-${quest.id}` : `quest-${quest.id}`,
    data: { type: "quest", quest },
    // ⚠️ A drag handle is a write control with no button to hide. A rank
    // without `quest:update` still opens the card - the board is a READ
    // surface too - and simply cannot pick one up. The board asks the
    // action, so no permission string is written here.
    //
    // A held card is undraggable for a different reason: every lifecycle
    // move a drop can express (accept, move, complete) is refused server
    // side while the quest is on hold, so a draggable one would animate
    // into another column and snap back on the error. Lift the hold from
    // the card to move it.
    disabled:
      props.overlay || props.draggable === false || Boolean(quest.heldAt),
  });
  // A card is a drop target as well as a draggable: dropping onto one is
  // how a position WITHIN a column is expressed. The column droppable
  // underneath still catches everything that lands between cards, which is
  // the "move to this column, position unspecified" case.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `card-drop-${quest.id}`,
    data: { type: "card", quest },
    disabled: isDragging || props.overlay,
  });

  const cursorClass = props.overlay
    ? "cursor-grabbing shadow-lg"
    : isDragging
      ? "cursor-grabbing"
      : "cursor-grab";
  const clean = cardStyle === "clean";

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setDropRef(node);
      }}
      // The card stays where it was, faded, while the board's `DragOverlay`
      // carries a copy under the pointer: translating this one in place had
      // its own column clip it and scroll sideways after it.
      style={{ opacity: isDragging ? 0.4 : undefined }}
      // A line above the card, so "drop here" reads as a position between
      // two cards rather than as replacing the one under the cursor.
      className={`p-1 ${isOver ? "border-primary border-t-2" : "border-t-2 border-transparent"}`}
    >
      <button
        type="button"
        data-testid="kanban-card"
        data-quest-short-id={quest.shortId}
        data-card-style={cardStyle}
        // The Clean card shows neither the reference nor the priority's
        // word, so both are here for whoever hovers.
        title={
          clean
            ? `${formatReference("quest", quest.shortId)} · ${quest.priority}`
            : undefined
        }
        onClick={() => onSelect(quest)}
        {...attributes}
        {...listeners}
        data-aging={props.aging ?? "fresh"}
        className={`group border-border bg-card hover:border-foreground/25 relative flex w-full flex-col overflow-hidden border text-left shadow-sm transition-[border-color,box-shadow] hover:shadow-md ${
          clean
            ? "rounded-lg py-2.5 pr-3 pl-3.5"
            : `rounded-md px-2.5 py-2 ${AGING_EDGE[props.aging ?? "fresh"]}`
        } ${cursorClass}`}
      >
        {clean ? (
          <KanbanCardClean
            quest={quest}
            areaDotClass={props.areaDotClass}
            tagColors={props.tagColors}
            blocked={props.blocked}
            assignee={props.assignee}
            aging={props.aging}
          />
        ) : (
          <KanbanCardCompact
            quest={quest}
            areaDotClass={props.areaDotClass}
            blocked={props.blocked}
            assignee={props.assignee}
          />
        )}
      </button>
    </div>
  );
};

/**
 * The Compact card's aging tint, one literal per level: Tailwind scans
 * source text, so a computed class compiles to nothing. The Clean card's
 * left edge is its priority, so it shows aging as an hourglass instead.
 */
const AGING_EDGE: Record<string, string> = {
  fresh: "",
  aging: "border-l-2 border-l-amber-400/70",
  stale: "border-l-2 border-l-red-400/70",
};

export default KanbanCard;
