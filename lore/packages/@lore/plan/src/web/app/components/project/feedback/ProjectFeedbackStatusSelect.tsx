import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Circle, CircleCheck, CircleX, type LucideIcon } from "lucide-react";

import type { FeedbackResource } from "../../../../../api/schemas/feedbackResourceSchema.ts";

export interface ProjectFeedbackStatusSelectProps {
  value: FeedbackResource["status"];
  onChange: (next: FeedbackResource["status"]) => void;
}

/**
 * The status the Feedback list shows (#Q4289): a small `Control` select
 * where it was a `Segmented`, so the band keeps room for the pinned prompts
 * and the bell. A one-field form whose change is the pick; the list keys it
 * by its value, so a status set from elsewhere (an addressed item switching
 * to its own) redraws it.
 */
const ProjectFeedbackStatusSelect = (
  props: ProjectFeedbackStatusSelectProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const form = useForm({
    schema: z.object({ status: z.enum(FILTERS) }),
    initialValues: { status: props.value },
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, next) => {
      if (next && next !== props.value) {
        props.onChange(next as FeedbackResource["status"]);
      }
    },
  });
  return (
    <span className="w-36 shrink-0">
      <Control
        input={form.input.status}
        size="sm"
        inputProps={{
          "aria-label": tr("feedback.filter.label"),
          "data-testid": "feedback-status-filter",
        }}
        items={FILTERS.map((value) => {
          const Icon = FILTER_ICONS[value];
          return {
            value,
            label: tr(`feedback.filter.${value}` as const),
            icon: <Icon className="size-3.5 shrink-0" />,
          };
        })}
      />
    </span>
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
