import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";

export interface EpicAgentJobLinkProps {
  jobId?: string;
}

/**
 * The epic's last Review with Claude job (#Q4214), linked to its page, which
 * streams the job's log while it runs and keeps it after.
 */
const EpicAgentJobLink = (props: EpicAgentJobLinkProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  if (!props.jobId || !project) return null;
  const slug = project.slug ?? String(project.id);
  return (
    <Link
      href={`/${slug}/jobs/${props.jobId}`}
      className={cn(textLinkUnderlineClassName, "text-xs")}
      data-testid="epic-agent-job"
    >
      {tr("epic.agent.job")}
    </Link>
  );
};

export default EpicAgentJobLink;
