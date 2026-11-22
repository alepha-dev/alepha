import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { FeedbackTrail } from "../../../../../api/schemas/feedbackTrailSchema.ts";

export interface FeedbackTrailListProps {
  trail: FeedbackTrail;
}

/**
 * A feedback report's trail (#Q4038): the crashes first, then the pages
 * visited and the actions, newest last as recorded. Every value is the
 * reporter's page's, so attacker-controlled: rendered as escaped plain text
 * only, never as a link or markdown (folio #12).
 *
 * Its root is `display: contents`, so each section is a cell of the Context
 * grid around it (`ProjectFeedbackDetail`): one column on a narrow pane;
 * from `@2xl` the facts, the pages and the actions side by side, with the
 * crashes as a full row above them.
 */
const FeedbackTrailList = (props: FeedbackTrailListProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const time = (at: number) => l(new Date(at), { date: "LTS" });

  return (
    <div className="contents text-xs" data-testid="feedback-trail">
      {props.trail.errors.length > 0 && (
        <section className="flex flex-col gap-0.5 @2xl:order-first @2xl:col-span-3">
          <span className="text-muted-foreground font-medium">
            {tr("feedback.trail.errors")}
          </span>
          <ul className="flex flex-col gap-0.5">
            {props.trail.errors.map((error, index) => (
              <li key={`e${index}`} className="text-danger-text break-all">
                {time(error.at)} · {error.path} · {error.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      {props.trail.pages.length > 0 && (
        <section className="flex flex-col gap-0.5">
          <span className="text-muted-foreground font-medium">
            {tr("feedback.trail.pages")}
          </span>
          <ul className="flex flex-col gap-0.5">
            {props.trail.pages.map((page, index) => (
              <li key={`p${index}`} className="break-all">
                {time(page.at)} · {page.path}
              </li>
            ))}
          </ul>
        </section>
      )}
      {props.trail.actions.length > 0 && (
        <section className="flex flex-col gap-0.5">
          <span className="text-muted-foreground font-medium">
            {tr("feedback.trail.actions")}
          </span>
          <ul className="flex flex-col gap-0.5">
            {props.trail.actions.map((action, index) => (
              <li key={`a${index}`} className="break-all">
                {action.name} ·{" "}
                {action.outcome === "error"
                  ? tr("feedback.trail.failed")
                  : tr("feedback.trail.succeeded")}{" "}
                · {action.ms} ms
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default FeedbackTrailList;
