import {
  Badge,
  cn,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@alepha/ui";
import type { HostJobController } from "@lore/core/api";
import { HOST_JOB_TERMINAL } from "@lore/core/schemas";
import { AgentAvatar, currentProjectAtom, type I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { TriangleAlert } from "lucide-react";
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
 * The agent is its CLI's icon (the robot when unknown) and links to the job.
 *
 * Since #Q4410 it does not pulse: hovering it opens a card naming the agent,
 * the job, the member it works for and the job's state, read from the job
 * for a reader who may see it (`host:read`). Once the job has ended, the
 * quest still shows it until it goes back to To do, so the avatar turns grey
 * and the card says that this is expected.
 */
const QuestAssignee = (props: QuestAssigneeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const jobsApi = useClient<HostJobController>();
  const jobId = props.quest.agentJobId;
  // Keyed on the job, so every surface that shows it shares one read. Quiet
  // on failure: the card then says nothing of the job's state.
  const jobQuery = useQuery(
    {
      key: ["agent-job", jobId],
      enabled: !!jobId && jobsApi.getJob.can(),
      handler: () => jobsApi.getJob({ params: { jobId: jobId as string } }),
      onError: () => {},
    },
    [jobsApi, jobId],
  );
  if (!jobId || !project) return <>{props.member ?? null}</>;
  const slug = project.slug ?? String(project.id);
  const name = props.quest.agentName;
  const agent = name
    ? tr(`quest.agent.cli.${name}`, { default: name })
    : tr("quest.agent.unknown");
  const memberName = props.memberName ?? tr("quest.agent.member.none");
  const label = tr("quest.agent.label", {
    args: [agent, jobId.slice(0, 8), memberName],
  });
  const status = jobQuery.data?.status;
  const ended = !!status && HOST_JOB_TERMINAL.includes(status);
  const avatar = (
    <AgentAvatar
      {...(name ? { agent: name } : {})}
      className={cn(
        props.size ?? "size-6",
        "ring-card ring-2",
        ended && "grayscale",
      )}
    />
  );
  const triggerClass = "relative z-10 inline-flex rounded-[9px]";
  return (
    <span className="inline-flex items-center" data-testid="quest-assignee">
      <HoverCard>
        <HoverCardTrigger
          delay={200}
          render={
            props.link === false ? (
              <span
                className={triggerClass}
                aria-label={label}
                role="img"
                data-testid="quest-agent-job"
                data-ended={ended ? "true" : undefined}
              />
            ) : (
              <Link
                href={`/${slug}/jobs/${jobId}`}
                className={triggerClass}
                aria-label={label}
                data-testid="quest-agent-job"
                data-ended={ended ? "true" : undefined}
                onClick={(event) => event.stopPropagation()}
              />
            )
          }
        >
          {avatar}
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          className="flex w-72 flex-col gap-2"
          data-testid="quest-agent-card"
        >
          <div className="flex items-center gap-3">
            <AgentAvatar
              {...(name ? { agent: name } : {})}
              className={cn("size-10", ended && "grayscale")}
            />
            <div className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-semibold">{agent}</span>
                {status && (
                  <Badge
                    variant="tint"
                    tone={ended ? "neutral" : "success"}
                    className="shrink-0 px-1.5 py-0 text-[10px] leading-4 font-normal"
                    data-testid="quest-agent-card-status"
                  >
                    {tr(
                      ended
                        ? "quest.agent.card.ended"
                        : "quest.agent.card.running",
                    )}
                  </Badge>
                )}
              </span>
              <span className="text-muted-foreground truncate text-xs">
                {tr("quest.agent.card.job", { args: [jobId.slice(0, 8)] })}
              </span>
              <span className="text-muted-foreground truncate text-xs">
                {tr("quest.agent.card.for", { args: [memberName] })}
              </span>
            </div>
          </div>
          {ended && (
            <p
              className="text-foreground flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs"
              data-testid="quest-agent-card-ended"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
              <span>{tr("quest.agent.card.endedNotice")}</span>
            </p>
          )}
        </HoverCardContent>
      </HoverCard>
      {props.member && (
        <span className="-ms-2 inline-flex">{props.member}</span>
      )}
    </span>
  );
};

export default QuestAssignee;
