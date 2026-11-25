import { cn } from "@alepha/ui";
import { AgentAvatar, currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import type { ReactNode } from "react";

import type { QuestResource } from "../../../../api/schemas/questResourceSchema.ts";

export interface QuestAssigneeProps {
  quest: Pick<QuestResource, "acceptedBy" | "agentJobId" | "agentName">;
  /**
   * The member's avatar, as the surface draws it: a chip with its card in
   * the table, a bare avatar on a card. Absent, nobody holds the quest.
   */
  member?: ReactNode;
  /**
   * The member's name, for the agent's tooltip.
   */
  memberName?: string;
  /**
   * The agent avatar's size classes, the member avatar's own size.
   */
  size?: string;
  /**
   * Off: the agent avatar is not a link, for a surface that is a link
   * itself (a kanban card), where an anchor inside an anchor is invalid.
   */
  link?: boolean;
}

/**
 * Who holds a quest (#Q4353), the one way every surface draws it: the
 * member who took it and, while an agent job works it for them, the job's
 * agent overlapped in front, the way a forge draws a commit's co-authors.
 * The agent is its CLI's icon (the robot when unknown), links to the job,
 * pulses while it runs (still under `prefers-reduced-motion`), and its
 * tooltip names the agent, the job and the member it works for.
 */
const QuestAssignee = (props: QuestAssigneeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const jobId = props.quest.agentJobId;
  if (!jobId || !project) return <>{props.member ?? null}</>;
  const slug = project.slug ?? String(project.id);
  const name = props.quest.agentName;
  const agent = name
    ? tr(`quest.agent.cli.${name}`, { default: name })
    : tr("quest.agent.unknown");
  const label = tr("quest.agent.label", {
    args: [
      agent,
      jobId.slice(0, 8),
      props.memberName ?? tr("quest.agent.member.none"),
    ],
  });
  const avatar = (
    <AgentAvatar
      {...(name ? { agent: name } : {})}
      className={cn(
        props.size ?? "size-6",
        "ring-card animate-pulse ring-2 motion-reduce:animate-none",
      )}
    />
  );
  return (
    <span className="inline-flex items-center" data-testid="quest-assignee">
      {props.link === false ? (
        <span
          className="relative z-10 inline-flex"
          title={label}
          aria-label={label}
          role="img"
          data-testid="quest-agent-job"
        >
          {avatar}
        </span>
      ) : (
        <Link
          href={`/${slug}/jobs/${jobId}`}
          className="relative z-10 inline-flex rounded-[9px]"
          title={label}
          aria-label={label}
          data-testid="quest-agent-job"
          onClick={(event) => event.stopPropagation()}
        >
          {avatar}
        </Link>
      )}
      {props.member && (
        <span className="-ms-2 inline-flex">{props.member}</span>
      )}
    </span>
  );
};

export default QuestAssignee;
