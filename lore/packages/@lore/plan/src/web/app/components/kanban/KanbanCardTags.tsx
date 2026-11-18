import { Badge } from "@alepha/ui";
import type { PaletteColor } from "@lore/core/schemas";

import { tagTone } from "../shared/areaColor.ts";

export interface KanbanCardTagsProps {
  tags: string[];
  /**
   * The project's tag → colour map. A tag with no entry renders neutral.
   */
  tagColors?: Record<string, PaletteColor>;
}

/**
 * The Clean card's tag row: soft pills in the tag's colour, at most
 * `MAX_TAGS` and then a count.
 *
 * The same `Badge variant="tint"` and palette the quest rail renders, so a
 * tag the owner coloured reads the same on every surface (#1638), with the
 * border dropped: on a card the fill alone separates the pills, and a ring
 * around each one was most of the old row's noise.
 */
const KanbanCardTags = (props: KanbanCardTagsProps) => {
  const shown = props.tags.slice(0, MAX_TAGS);
  const hidden = props.tags.length - shown.length;

  if (shown.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((tag) => (
        <Badge
          key={tag}
          variant="tint"
          data-testid="kanban-card-tag"
          tone={tagTone(props.tagColors?.[tag])}
          className="max-w-full truncate"
        >
          {tag}
        </Badge>
      ))}
      {hidden > 0 && (
        <span className="text-muted-foreground text-[11px]">+{hidden}</span>
      )}
    </div>
  );
};

/**
 * At most this many pills before the row is cut short with a count. A card
 * carrying six labels stops being glanceable, which is the whole reason the
 * pills are there.
 */
const MAX_TAGS = 3;

export default KanbanCardTags;
