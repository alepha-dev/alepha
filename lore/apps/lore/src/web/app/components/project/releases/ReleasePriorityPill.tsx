import { Badge, type BadgeTone } from "@alepha/ui/components/ui/badge";

export type ReleasePriority = "optional" | "low" | "medium" | "high";

export interface ReleasePriorityPillProps {
  priority: ReleasePriority;
}

/**
 * The small monospace priority tag used across the release view - in the
 * changelog rows, the contents rows and the epic cards.
 *
 * A `Badge variant="tint"` rather than the hand-rolled span this used to be.
 * The span carried its own `border-red-500/35 bg-red-500/10 text-red-600`
 * literals, which is a second palette for the same four meanings the badge
 * already names, and it tinted the TEXT - the pairing that fails contrast
 * first at this size, and the reason `tint` leaves the label as body colour.
 *
 * All four levels now carry a hue. The old pill kept `low` and `optional`
 * grey "so a changelog full of small work doesn't read as a wall of badges",
 * which is true of `optional` and was over-applied: with `high` red and
 * `medium` amber and everything else grey, the scale had three steps where
 * the model has four, and `low` was indistinguishable from work nobody had
 * committed to. `low` is `info`; `optional` stays neutral, which is what
 * being genuinely quiet looks like.
 */
const TONE: Record<ReleasePriority, BadgeTone> = {
  high: "danger",
  medium: "warning",
  low: "info",
  optional: "neutral",
};

const ReleasePriorityPill = (props: ReleasePriorityPillProps) => (
  <Badge
    variant="tint"
    tone={TONE[props.priority]}
    // Smaller than the badge's own `h-5 / text-xs`: this pill sits at the
    // end of a dense row and is read as a tag, not as a status chip.
    className="h-[18px] shrink-0 border-0 px-[7px] font-mono text-[10px] tracking-[0.03em] uppercase"
  >
    {props.priority}
  </Badge>
);

export default ReleasePriorityPill;
