import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface QuestViewRailRowProps {
  icon: LucideIcon;
  label: string;
  /**
   * The value. A row whose value is `undefined` renders nothing at all —
   * the rail never shows a label waiting for data that is not coming.
   */
  children?: ReactNode;
}

/**
 * One definition row in the quest rail: a muted icon and label on the left,
 * the value right-aligned.
 *
 * Read-only by design. Editing a quest goes through the edit drawer, which
 * already validates the whole shape; inline row editors would be a second
 * write path per field, each with its own failure states.
 */
const QuestViewRailRow = (props: QuestViewRailRowProps) => {
  if (props.children === undefined || props.children === null) return null;

  const Icon = props.icon;

  /*
   * `items-center`, not the `items-start` this had. Most values are plain
   * text the same height as their label, so the difference was invisible -
   * but Assigned renders an avatar chip and Release a select trigger with a
   * chevron, and on both the label was pinned to the top of a box the value
   * filled (feedback #2083).
   *
   * Chosen over the alternative of a `min-h` on the two tall rows: that
   * keeps first-line alignment when a value wraps, but the number would be
   * a copy of a control's height living in a different file, which is
   * exactly the drift `FilterSlot` and `releaseOrder` were each written to
   * stop. A label centred against its value is also the ordinary treatment
   * for a definition row.
   *
   * The cost is real and small: a value long enough to wrap - a long area
   * name, an epic title, an email; see the `break-words` note below for why
   * wrapping is possible at all - now sits centred against its label rather
   * than level with its first line. Checked at 1440 and at 491.
   */
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
        <Icon className="size-3.5" />
        {props.label}
      </span>
      {/* `break-words` is the row's own guard, not decoration: `min-w-0`
          lets this cell shrink, and without a break rule a single long
          unbreakable value (an area name, an epic title, an email) still
          renders at max-content and spills LEFT over the label, because
          the cell is right-aligned. Values that carry `white-space: nowrap`
          of their own — the commits column — additionally need a definite
          width to truncate against; see `QuestViewRail`. */}
      <span className="min-w-0 text-right text-xs font-medium break-words">
        {props.children}
      </span>
    </div>
  );
};

export default QuestViewRailRow;
