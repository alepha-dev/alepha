import { cn } from "@alepha/ui";
import type { HostJobResource } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import { JOB_STATUS_ICON } from "../host-jobs/jobStatusIcon.ts";
import { JOB_HEADER_STATUS, jobArgsText, jobClock } from "./jobsHeaderText.ts";
import { useJobLastLine } from "./useJobLastLine.ts";

export interface PromptJobsRowProps {
  job: HostJobResource;
  /**
   * The prompt's title, its name when the list of prompts has not loaded.
   */
  title: string;
  /**
   * Now, in milliseconds, ticking while the list is open: the elapsed time
   * of a running job follows it.
   */
  now: number;
  /**
   * The list is open: a running job's last line is read only then.
   */
  open: boolean;
  onOpen: (job: HostJobResource) => void;
}

/**
 * One job of the header's jobs list (#Q4514): its status glyph, the prompt
 * and its args, the host, and for a running job the elapsed time and the
 * last line of its transcript. Labels only, no sentence.
 */
const PromptJobsRow = (props: PromptJobsRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { job } = props;
  const status = JOB_STATUS_ICON[job.status];
  const Glyph = status.icon;
  const running = job.status === "running";
  const last = useJobLastLine(job.id, job.input.agent, props.open && running);
  const args = jobArgsText(job);
  const started = job.startedAt ?? job.queuedAt;
  const detail =
    job.status === "queued" || running
      ? job.hostSlug
      : [job.hostSlug, tr(JOB_HEADER_STATUS[job.status])]
          .filter(Boolean)
          .join(" · ");

  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        className="hover:bg-hover-weak flex w-full flex-col gap-1 px-3 py-2 text-left"
        data-testid="jobs-header-row"
        data-status={job.status}
        onClick={() => props.onOpen(job)}
      >
        <span className="grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2">
          <Glyph className={cn("mt-0.5 size-4", status.className)} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">
              {props.title}
              {args && (
                <span className="text-muted-foreground font-normal">
                  {" "}
                  {args}
                </span>
              )}
            </span>
            <span className="text-muted-foreground block truncate text-xs">
              {detail}
            </span>
          </span>
          <span
            className="text-muted-foreground font-mono text-xs tabular-nums"
            data-testid="jobs-header-elapsed"
          >
            {running ? jobClock((props.now - Date.parse(started)) / 1000) : ""}
          </span>
        </span>
        {running && last && (
          <span
            className="text-muted-foreground block truncate ps-6 font-mono text-[11px]"
            data-testid="jobs-header-last-line"
          >
            {last}
          </span>
        )}
      </button>
    </li>
  );
};

export default PromptJobsRow;
