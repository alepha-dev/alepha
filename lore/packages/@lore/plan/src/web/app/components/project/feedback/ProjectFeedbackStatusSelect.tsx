import { Segmented } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Circle, CircleCheck, CircleX, type LucideIcon } from "lucide-react";

import type { FeedbackResource } from "../../../../../api/schemas/feedbackResourceSchema.ts";

export interface ProjectFeedbackStatusSelectProps {
  value: FeedbackResource["status"];
  onChange: (next: FeedbackResource["status"]) => void;
}

/**
 * The status the Feedback list shows: a `Segmented` of three icons, no text
 * (#Q4564), each named by a tooltip and its `aria-label` as the band's icon
 * buttons are. #Q4289 had made it a select to leave the band room for the
 * pinned prompts and the bell; three icon segments are about as narrow as
 * that select was, so the room stays. 32px tall at the default size, like
 * the band's icon buttons, so one value spaces the whole band (#Q4449).
 */
const ProjectFeedbackStatusSelect = (
  props: ProjectFeedbackStatusSelectProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <Segmented
      variant="solid"
      className="shrink-0"
      aria-label={tr("feedback.filter.label")}
      data-testid="feedback-status-filter"
      value={props.value}
      onChange={(next) => {
        if (next !== props.value) {
          props.onChange(next as FeedbackResource["status"]);
        }
      }}
      options={FILTERS.map((value) => {
        const Icon = FILTER_ICONS[value];
        return {
          value,
          label: <Icon className="size-4 shrink-0" aria-hidden />,
          tooltip: tr(`feedback.filter.${value}` as const),
        };
      })}
    />
  );
};

export default ProjectFeedbackStatusSelect;

/*
 * Order is the triage order, which is also why "all" is gone: the inbox is a
 * queue, and a choice that mixes the three states back together answers a
 * reporting question on a screen built for acting on one item at a time.
 */
const FILTERS = ["pending", "accepted", "rejected"] as const;

/*
 * The same three glyphs `ProjectFeedbackCard.statusIcon` puts on each row,
 * `ProjectFeedbackEmptyState` puts in its tile and the detail's status chip
 * carries, so the filter, the rows it filters to and the pane beside them are
 * one vocabulary.
 */
const FILTER_ICONS: Record<FeedbackResource["status"], LucideIcon> = {
  pending: Circle,
  accepted: CircleCheck,
  rejected: CircleX,
};
