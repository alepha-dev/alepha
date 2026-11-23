import { cn } from "@alepha/ui";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { useState } from "react";

import type { HostJobController } from "../../../../../api/controllers/HostJobController.ts";
import { type I18n } from "../../../services/I18n.ts";
import { JOB_STATUS_ICON, jobInFlight } from "./jobStatusIcon.ts";

export interface JobHistoryRailProps {
  projectId: number;
  projectSlug: string;
  selectedId: string;
  className?: string;
}

/**
 * The project's job history beside one job (#Q4207), as Chat's room list
 * stands beside a conversation: chrome, a 46px header, one row per job,
 * newest first, the open one on the `--hover` wash. Polled while a job is in
 * flight, so a queued one turns running here as it does on the page.
 */
const JobHistoryRail = (props: JobHistoryRailProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const api = useClient<HostJobController>();
  const [polling, setPolling] = useState(false);

  const { data } = useQuery(
    {
      key: ["host-jobs-rail", props.projectId],
      keepPreviousData: true,
      runEvery: polling ? 3000 : undefined,
      handler: async () => {
        const page = await api.listProjectJobs({
          params: { projectId: props.projectId },
          query: { limit: 100 },
        });
        setPolling(page.items.some((job) => jobInFlight(job.status)));
        return page;
      },
    },
    [props.projectId, polling],
  );

  return (
    <nav
      aria-label={tr("jobs.rail.label")}
      className={cn("chrome min-h-0 flex-col border-e", props.className)}
      data-testid="job-history-rail"
    >
      <div className="flex h-[46px] shrink-0 items-center border-b px-3">
        <Link
          href={`/${props.projectSlug}/jobs`}
          className="flex-1 text-sm font-semibold hover:underline"
        >
          {tr("jobs.title")}
        </Link>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto p-2">
        {(data?.items ?? []).map((job) => {
          const selected = job.id === props.selectedId;
          const status = JOB_STATUS_ICON[job.status];
          const Icon = status.icon;
          return (
            <li key={job.id}>
              <Link
                href={`/${props.projectSlug}/jobs/${job.id}`}
                aria-current={selected ? "page" : undefined}
                data-testid="job-history-row"
                data-job={job.id}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left",
                  selected ? "bg-hover text-foreground" : "hover:bg-hover-weak",
                )}
              >
                <Icon
                  className={cn("mt-0.5 size-3.5 shrink-0", status.className)}
                  aria-label={job.status}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "truncate text-sm",
                      selected && "font-medium",
                    )}
                  >
                    {job.kind}
                    {job.subjectType
                      ? ` · ${job.subjectType} ${job.subjectId ?? ""}`
                      : ""}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {l(job.queuedAt, { date: "lll" })}
                    {job.hostSlug ? ` · ${job.hostSlug}` : ""}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default JobHistoryRail;
