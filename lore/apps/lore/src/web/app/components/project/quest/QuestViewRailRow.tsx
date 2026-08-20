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

  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
        <Icon className="size-3.5" />
        {props.label}
      </span>
      <span className="min-w-0 text-right text-xs font-medium">
        {props.children}
      </span>
    </div>
  );
};

export default QuestViewRailRow;
