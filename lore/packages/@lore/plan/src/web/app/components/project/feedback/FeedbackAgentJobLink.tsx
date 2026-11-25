import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";

import type { FeedbackResource } from "../../../../../api/schemas/feedbackResourceSchema.ts";

export interface FeedbackAgentJobLinkProps {
  feedback: FeedbackResource;
}

/**
 * The agent job that last triaged an item (#Q4126), linked from the detail
 * panel's header. Nothing when no agent looked at it.
 */
const FeedbackAgentJobLink = (props: FeedbackAgentJobLinkProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  if (!props.feedback.agentJobId || !project) return null;
  const slug = project.slug ?? String(project.id);
  return (
    <Link
      href={`/${slug}/jobs/${props.feedback.agentJobId}`}
      className={cn(textLinkUnderlineClassName, "text-xs")}
      data-testid="feedback-agent-job"
    >
      {tr("feedback.agent.job")}
    </Link>
  );
};

export default FeedbackAgentJobLink;
