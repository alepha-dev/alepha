import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Bot } from "lucide-react";

export interface QuestAgentJobLinkProps {
  /**
   * The quest's `agentJobId`: set only while its job runs, since the job's
   * end clears it.
   */
  jobId?: string;
  /**
   * The icon alone, its label kept as the accessible name: a table cell.
   */
  compact?: boolean;
}

/**
 * The agent job working a quest (#Q4350), linked to its page: an animated
 * robot while the job runs, still under `prefers-reduced-motion`, and the
 * job's short id. Nothing when no job holds the quest.
 */
const QuestAgentJobLink = (props: QuestAgentJobLinkProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  if (!props.jobId || !project) return null;
  const slug = project.slug ?? String(project.id);
  const label = tr("quest.agentJob.label", {
    args: [props.jobId.slice(0, 8)],
  });
  return (
    <Link
      href={`/${slug}/jobs/${props.jobId}`}
      className={cn(
        textLinkUnderlineClassName,
        "inline-flex items-center gap-1 text-xs",
      )}
      title={label}
      aria-label={label}
      data-testid="quest-agent-job"
    >
      <Bot
        className="size-3.5 shrink-0 animate-pulse motion-reduce:animate-none"
        aria-hidden
        data-testid="quest-agent-job-icon"
      />
      {!props.compact && (
        <span className="font-mono">{props.jobId.slice(0, 8)}</span>
      )}
    </Link>
  );
};

export default QuestAgentJobLink;
