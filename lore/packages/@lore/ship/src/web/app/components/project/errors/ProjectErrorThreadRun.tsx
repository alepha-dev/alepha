import { cn, textLinkUnderlineClassName, TimeAgo } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Bot } from "lucide-react";

import type { ProjectErrorThreadJob } from "../../../../../api/schemas/projectErrorThreadJobSchema.ts";

export interface ProjectErrorThreadRunProps {
  job: ProjectErrorThreadJob;
  /**
   * The agent job's page, for a member who may read jobs.
   */
  href?: string;
}

/**
 * An agent run on the error that has not answered (#Q4471), on one line of
 * the thread: queued, running, or ended without an answer. A run that
 * answered is not drawn: its comment is.
 */
const ProjectErrorThreadRun = (props: ProjectErrorThreadRunProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { job } = props;
  return (
    <li
      className="flex gap-3 py-3"
      data-testid="error-thread-job"
      data-status={job.status}
    >
      <span className="border-border text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full border">
        <Bot className="size-3.5" />
      </span>
      <div className="flex min-h-7 min-w-0 flex-1 items-center gap-2 text-sm">
        <span className="min-w-0">
          <span className="text-muted-foreground">
            {tr(`errors.thread.job.${job.status}`)}
          </span>
          {props.href && (
            <>
              {" "}
              <Link
                href={props.href}
                className={cn(
                  textLinkUnderlineClassName,
                  "hover:text-foreground",
                )}
                data-testid="error-thread-job-link"
              >
                {tr("errors.thread.job.open")}
              </Link>
            </>
          )}
        </span>
        <span className="text-muted-foreground ml-auto shrink-0 text-xs">
          <TimeAgo value={job.startedAt ?? job.queuedAt} />
        </span>
      </div>
    </li>
  );
};

export default ProjectErrorThreadRun;
