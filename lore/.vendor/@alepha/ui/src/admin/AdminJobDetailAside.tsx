import * as React from "react";

void React;

import type { JobRegistration } from "alepha/api/jobs";
import { useI18n } from "alepha/react/i18n";

import { DetailAside, type DetailAsideRow } from "../shell/DetailAside.tsx";
import { AdminJobsTypeIcon } from "./AdminJobsTypeIcon.tsx";
import { useJobRetentionLabels } from "./useJobRetentionLabels.ts";

export interface AdminJobDetailAsideProps {
  job: JobRegistration;
}

/**
 * What a job is: its description, how it runs, when, what it keeps, and when
 * it last ran. Every value comes from the registration payload, so it says
 * what this process actually registered.
 */
export const AdminJobDetailAside = (props: AdminJobDetailAsideProps) => {
  const { l, tr } = useI18n();
  const retention = useJobRetentionLabels();
  const job = props.job;

  const typeLabel: Record<JobRegistration["type"], string> = {
    cron: tr("admin.jobs.typeCron", { default: "Cron" }),
    queue: tr("admin.jobs.typeQueue", { default: "Queue" }),
    direct: tr("admin.jobs.typeDirect", { default: "Direct" }),
  };

  const rows: DetailAsideRow[] = [
    {
      label: tr("admin.jobs.colDescription", { default: "Description" }),
      value: job.description,
    },
    {
      label: tr("admin.jobs.colType", { default: "Type" }),
      value: (
        <span className="inline-flex items-center gap-1.5">
          <AdminJobsTypeIcon type={job.type} className="size-3.5" />
          {typeLabel[job.type]}
        </span>
      ),
    },
    ...(job.cron
      ? [
          {
            label: tr("admin.jobs.colSchedule", { default: "Schedule" }),
            value: <code className="text-xs">{job.cron}</code>,
          },
        ]
      : []),
    {
      label: tr("admin.jobs.colRetention", { default: "Retention" }),
      value: retention.sentence(job.retention),
    },
    ...(job.timeout
      ? [
          {
            label: tr("admin.jobs.colTimeout", { default: "Timeout" }),
            value: formatTimeout(job.timeout),
          },
        ]
      : []),
    ...(job.retry
      ? [
          {
            label: tr("admin.jobs.colRetries", { default: "Retries" }),
            value: String(job.retry.retries),
          },
        ]
      : []),
    {
      label: tr("admin.jobs.colOrigin", { default: "Origin" }),
      value: job.name.startsWith("system.")
        ? tr("admin.jobs.originSystem", { default: "System" })
        : tr("admin.jobs.originApp", { default: "App" }),
    },
    {
      label: tr("admin.jobs.colLastRun", { default: "Last run" }),
      value: job.recent.lastRun
        ? l(job.recent.lastRun, { date: "lll" })
        : tr("admin.jobs.unknown", { default: "unknown" }),
    },
  ];

  return <DetailAside title={job.name} avatar={false} rows={rows} />;
};

/**
 * An ISO 8601 duration (`PT5M`, `PT1H30M`, `PT30S`) as `5m`, `1h 30m`, `30s`,
 * or the raw string when it is some other shape.
 */
const formatTimeout = (iso: string): string => {
  const match =
    /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(
      iso,
    );
  if (!match || (!match[1] && !match[2] && !match[3])) return iso;
  return [
    match[1] ? `${match[1]}h` : "",
    match[2] ? `${match[2]}m` : "",
    match[3] ? `${match[3]}s` : "",
  ]
    .filter(Boolean)
    .join(" ");
};
